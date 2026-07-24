import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
    get_assigned_members,
    get_primary_buddy,
)
from app.access.schema import create_access_schema


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)


@pytest.fixture
def access_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    return connection


def _create_user_with_roles(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
) -> int:
    user_id = create_user(connection, username, username, "secret")
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.commit()
    return user_id


def test_second_primary_buddy_rejected_by_unique_constraint(
    access_schema: psycopg.Connection,
) -> None:
    member_id = _create_user_with_roles(access_schema, "member", ["Member"])
    buddy_one_id = _create_user_with_roles(access_schema, "buddy1", ["Buddy"])
    buddy_two_id = _create_user_with_roles(access_schema, "buddy2", ["Buddy"])
    create_buddy_relationship(access_schema, member_id, buddy_one_id)

    msg = "该成员在所选日期区间内已有主 Buddy 关系，日期不可重叠。"
    with pytest.raises(ValueError, match=msg):
        create_buddy_relationship(access_schema, member_id, buddy_two_id)


def test_member_queries_primary_buddy(access_schema: psycopg.Connection) -> None:
    member_id = _create_user_with_roles(access_schema, "member", ["Member"])
    buddy_id = _create_user_with_roles(access_schema, "buddy", ["Buddy"])
    create_buddy_relationship(access_schema, member_id, buddy_id)

    primary_buddy = get_primary_buddy(access_schema, member_id)

    assert primary_buddy is not None
    assert primary_buddy["id"] == buddy_id
    assert primary_buddy["username"] == "buddy"
    assert primary_buddy["full_name"] == "buddy"
    assert primary_buddy["is_active"] is True


def test_buddy_queries_assigned_members(access_schema: psycopg.Connection) -> None:
    buddy_id = _create_user_with_roles(access_schema, "buddy", ["Buddy"])
    member_one_id = _create_user_with_roles(access_schema, "member1", ["Member"])
    member_two_id = _create_user_with_roles(access_schema, "member2", ["Member"])
    create_buddy_relationship(access_schema, member_one_id, buddy_id)
    create_buddy_relationship(access_schema, member_two_id, buddy_id)

    assigned = get_assigned_members(access_schema, buddy_id)
    usernames = {member["username"] for member in assigned}

    assert usernames == {"member1", "member2"}


def test_create_buddy_relationship_rejects_missing_member_role(
    access_schema: psycopg.Connection,
) -> None:
    member_id = _create_user_with_roles(access_schema, "member", ["Buddy"])
    buddy_id = _create_user_with_roles(access_schema, "buddy", ["Buddy"])

    with pytest.raises(ValueError, match="member_id"):
        create_buddy_relationship(access_schema, member_id, buddy_id)


def test_create_buddy_relationship_rejects_missing_buddy_role(
    access_schema: psycopg.Connection,
) -> None:
    member_id = _create_user_with_roles(access_schema, "member", ["Member"])
    buddy_id = _create_user_with_roles(access_schema, "buddy", ["Member"])

    with pytest.raises(ValueError, match="buddy_id"):
        create_buddy_relationship(access_schema, member_id, buddy_id)
