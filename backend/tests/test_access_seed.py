import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_user,
    get_assigned_members,
    get_primary_buddy,
    get_user_by_username,
)
from app.access.schema import create_access_schema
from app.access.security import verify_password
from app.access.seed import seed_demo_accounts

_DEMO_USERNAMES = ("admin", "leader", "buddy", "member", "member2")


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


def _row_counts(connection: psycopg.Connection) -> dict[str, int]:
    return {
        "users": connection.execute("SELECT COUNT(*) FROM tcp_user").fetchone()[0],
        "user_roles": connection.execute(
            "SELECT COUNT(*) FROM tcp_user_role"
        ).fetchone()[0],
        "buddy_relationships": connection.execute(
            "SELECT COUNT(*) FROM buddy_relationship"
        ).fetchone()[0],
    }


def test_seed_creates_all_demo_accounts(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert user["username"] == username


def test_seed_passwords_verify_with_default(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert verify_password("123456", user["password_hash"]) is True


def test_seed_passwords_are_not_stored_in_plaintext(
    access_schema: psycopg.Connection,
) -> None:
    seed_demo_accounts(access_schema)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert "123456" not in user["password_hash"]
        assert user["password_hash"] != "123456"


def test_seed_assigns_expected_roles(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)

    expected_roles = {
        "admin": {"Admin", "Leader", "Member"},
        "leader": {"Leader", "Member"},
        "buddy": {"Buddy", "Member"},
        "member": {"Member"},
        "member2": {"Member"},
    }
    for username, expected in expected_roles.items():
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert set(user["roles"]) == expected


def test_seed_creates_primary_buddy_links(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)

    member = get_user_by_username(access_schema, "member")
    assert member is not None
    primary = get_primary_buddy(access_schema, member["id"])
    assert primary is not None
    assert primary["username"] == "buddy"

    member2 = get_user_by_username(access_schema, "member2")
    assert member2 is not None
    primary2 = get_primary_buddy(access_schema, member2["id"])
    assert primary2 is not None
    assert primary2["username"] == "buddy"


def test_seed_buddy_has_assigned_members(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)

    buddy = get_user_by_username(access_schema, "buddy")
    assert buddy is not None
    assigned = get_assigned_members(access_schema, buddy["id"])
    usernames = {member["username"] for member in assigned}
    assert usernames == {"member", "member2"}


def test_seed_is_idempotent(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema)
    first_counts = _row_counts(access_schema)

    seed_demo_accounts(access_schema)
    second_counts = _row_counts(access_schema)

    assert first_counts == second_counts
    assert second_counts["users"] == 5
    assert second_counts["user_roles"] == 9
    assert second_counts["buddy_relationships"] == 2


def test_seed_skips_when_any_user_exists(access_schema: psycopg.Connection) -> None:
    existing_id = create_user(access_schema, "existing", "Existing User", "secret")
    assign_role(access_schema, existing_id, "Member")

    seed_demo_accounts(access_schema)

    counts = _row_counts(access_schema)
    assert counts["users"] == 1
    assert counts["user_roles"] == 1
    assert counts["buddy_relationships"] == 0
