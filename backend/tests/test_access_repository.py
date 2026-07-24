from datetime import timedelta

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_session,
    create_user,
    delete_expired_sessions,
    delete_session,
    get_assigned_members,
    get_primary_buddy,
    get_session_user,
    get_user_by_username,
    get_user_with_roles,
)
from app.access.schema import create_access_schema
from app.access.security import (
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)


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


def test_password_hashing_uses_unique_salts() -> None:
    password = "hunter2"
    hash_a = hash_password(password)
    hash_b = hash_password(password)

    assert hash_a != hash_b
    salt_a, digest_a = hash_a.split("$", 1)
    salt_b, digest_b = hash_b.split("$", 1)
    assert salt_a != salt_b
    assert len(salt_a) == 32
    assert len(digest_a) == 64


def test_password_verification_accepts_correct_password() -> None:
    password = "correct horse battery staple"
    hashed = hash_password(password)

    assert verify_password(password, hashed) is True


def test_password_verification_rejects_incorrect_password() -> None:
    password = "correct horse battery staple"
    hashed = hash_password(password)

    assert verify_password("wrong password", hashed) is False
    assert verify_password("", hashed) is False


def test_password_verification_rejects_malformed_hash() -> None:
    assert verify_password("password", "not-a-hash") is False


def test_session_token_is_high_entropy_and_unique() -> None:
    token_a = generate_session_token()
    token_b = generate_session_token()

    assert token_a != token_b
    assert len(token_a) >= 32


def test_session_token_hash_is_sha256_hex() -> None:
    token = "known-token"
    import hashlib

    assert hash_session_token(token) == hashlib.sha256(token.encode()).hexdigest()


def test_create_user_stores_hashed_password(access_schema: psycopg.Connection) -> None:
    user_id = create_user(access_schema, "alice", "Alice Smith", "secret")
    assert isinstance(user_id, int)

    row = access_schema.execute(
        """
        SELECT username, full_name, password_hash, is_active
        FROM tcp_user
        WHERE id = %s
        """,
        (user_id,),
    ).fetchone()
    assert row is not None
    username, full_name, password_hash, is_active = row
    assert username == "alice"
    assert full_name == "Alice Smith"
    assert is_active is True
    assert password_hash != "secret"
    assert "$" in password_hash
    assert verify_password("secret", password_hash) is True


def test_get_user_by_username(access_schema: psycopg.Connection) -> None:
    create_user(access_schema, "bob", "Bob Jones", "secret")

    user = get_user_by_username(access_schema, "bob")
    assert user is not None
    assert user["username"] == "bob"
    assert user["full_name"] == "Bob Jones"
    assert user["is_active"] is True
    assert "password_hash" in user
    assert user["roles"] == []

    assert get_user_by_username(access_schema, "missing") is None


def test_assign_role_is_idempotent_and_supports_many_to_many(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "carol", "Carol White", "secret")
    assign_role(access_schema, user_id, "Member")
    assign_role(access_schema, user_id, "Member")
    assign_role(access_schema, user_id, "Buddy")

    user = get_user_with_roles(access_schema, user_id)
    assert user is not None
    assert user["roles"] == ["Buddy", "Member"]


def test_get_user_with_roles_returns_sorted_roles(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "dave", "Dave Brown", "secret")
    assign_role(access_schema, user_id, "Leader")
    assign_role(access_schema, user_id, "Admin")
    assign_role(access_schema, user_id, "Member")

    user = get_user_with_roles(access_schema, user_id)
    assert user is not None
    assert user["username"] == "dave"
    assert user["roles"] == ["Admin", "Leader", "Member"]


def test_create_session_returns_raw_token_and_stores_only_hash(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "eve", "Eve Black", "secret")
    token = create_session(access_schema, user_id, max_age_seconds=3600)

    assert isinstance(token, str)
    assert len(token) >= 32

    token_hash = hash_session_token(token)
    rows = access_schema.execute(
        "SELECT token_hash, user_id FROM tcp_session"
    ).fetchall()
    assert len(rows) == 1
    assert rows[0][0] == token_hash
    assert rows[0][1] == user_id

    columns = access_schema.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'tcp_session'
        """
    ).fetchall()
    column_names = {col[0] for col in columns}
    assert "token_hash" in column_names
    assert "token" not in column_names


def test_get_session_user_returns_user_for_valid_token(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "frank", "Frank Green", "secret")
    assign_role(access_schema, user_id, "Member")
    token = create_session(access_schema, user_id, max_age_seconds=3600)

    session_user = get_session_user(access_schema, token)
    assert session_user is not None
    assert session_user["id"] == user_id
    assert session_user["username"] == "frank"
    assert session_user["roles"] == ["Member"]


def test_get_session_user_returns_none_for_unknown_token(
    access_schema: psycopg.Connection,
) -> None:
    assert get_session_user(access_schema, "totally-made-up") is None


def test_expired_session_does_not_authenticate(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "grace", "Grace Grey", "secret")
    token = create_session(access_schema, user_id, max_age_seconds=-1)

    assert get_session_user(access_schema, token) is None


def test_get_session_user_returns_none_for_inactive_user(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(
        access_schema, "inactive", "Inactive User", "secret", is_active=False
    )
    token = create_session(access_schema, user_id, max_age_seconds=3600)

    assert get_session_user(access_schema, token) is None


def test_delete_session_removes_only_target_session(
    access_schema: psycopg.Connection,
) -> None:
    user_a = create_user(access_schema, "a", "A", "secret")
    user_b = create_user(access_schema, "b", "B", "secret")
    token_a = create_session(access_schema, user_a, max_age_seconds=3600)
    token_b = create_session(access_schema, user_b, max_age_seconds=3600)

    delete_session(access_schema, token_a)

    assert get_session_user(access_schema, token_a) is None
    assert get_session_user(access_schema, token_b) is not None


def test_delete_expired_sessions(access_schema: psycopg.Connection) -> None:
    user_id = create_user(access_schema, "heidi", "Heidi Blue", "secret")
    expired_token = create_session(access_schema, user_id, max_age_seconds=-1)
    valid_token = create_session(access_schema, user_id, max_age_seconds=3600)

    delete_expired_sessions(access_schema)

    assert get_session_user(access_schema, expired_token) is None
    assert get_session_user(access_schema, valid_token) is not None


def test_create_buddy_relationship_and_get_primary_buddy(
    access_schema: psycopg.Connection,
) -> None:
    member_id = create_user(access_schema, "member", "Member One", "secret")
    assign_role(access_schema, member_id, "Member")
    buddy_id = create_user(access_schema, "buddy", "Buddy One", "secret")
    assign_role(access_schema, buddy_id, "Buddy")
    relationship_id = create_buddy_relationship(
        access_schema, member_id, buddy_id, is_primary=True
    )
    assert isinstance(relationship_id, int)

    primary_buddy = get_primary_buddy(access_schema, member_id)
    assert primary_buddy is not None
    assert primary_buddy["id"] == buddy_id
    assert primary_buddy["username"] == "buddy"
    assert primary_buddy["full_name"] == "Buddy One"


def test_get_assigned_members(access_schema: psycopg.Connection) -> None:
    buddy_id = create_user(access_schema, "buddy", "Buddy One", "secret")
    assign_role(access_schema, buddy_id, "Buddy")
    member_one_id = create_user(access_schema, "member1", "Member One", "secret")
    assign_role(access_schema, member_one_id, "Member")
    member_two_id = create_user(access_schema, "member2", "Member Two", "secret")
    assign_role(access_schema, member_two_id, "Member")
    create_buddy_relationship(access_schema, member_one_id, buddy_id)
    create_buddy_relationship(access_schema, member_two_id, buddy_id)

    assigned = get_assigned_members(access_schema, buddy_id)
    usernames = {member["username"] for member in assigned}
    assert usernames == {"member1", "member2"}


def test_primary_buddy_unique_index_enforced(
    access_schema: psycopg.Connection,
) -> None:
    member_id = create_user(access_schema, "member", "Member One", "secret")
    assign_role(access_schema, member_id, "Member")
    buddy_id = create_user(access_schema, "buddy", "Buddy One", "secret")
    assign_role(access_schema, buddy_id, "Buddy")
    create_buddy_relationship(access_schema, member_id, buddy_id)

    msg = "该成员在所选日期区间内已有主 Buddy 关系，日期不可重叠。"
    with pytest.raises(ValueError, match=msg):
        create_buddy_relationship(access_schema, member_id, buddy_id)


def test_member_cannot_be_own_buddy(access_schema: psycopg.Connection) -> None:
    user_id = create_user(access_schema, "solo", "Solo User", "secret")
    assign_role(access_schema, user_id, "Member")
    assign_role(access_schema, user_id, "Buddy")

    msg = "member_id and buddy_id cannot be the same user"
    with pytest.raises(ValueError, match=msg):
        create_buddy_relationship(access_schema, user_id, user_id)


def test_create_buddy_relationship_rejects_inactive_buddy(
    access_schema: psycopg.Connection,
) -> None:
    member_id = create_user(access_schema, "member", "Member One", "secret")
    assign_role(access_schema, member_id, "Member")
    buddy_id = create_user(
        access_schema, "buddy", "Buddy One", "secret", is_active=False
    )
    assign_role(access_schema, buddy_id, "Buddy")

    with pytest.raises(ValueError, match="buddy_id .* is inactive"):
        create_buddy_relationship(access_schema, member_id, buddy_id)


def test_create_buddy_relationship_rejects_nonexistent_member(
    access_schema: psycopg.Connection,
) -> None:
    buddy_id = create_user(access_schema, "buddy", "Buddy One", "secret")
    assign_role(access_schema, buddy_id, "Buddy")

    with pytest.raises(ValueError, match="member_id .* does not exist"):
        create_buddy_relationship(access_schema, 99999, buddy_id)


def test_create_buddy_relationship_rejects_nonexistent_buddy(
    access_schema: psycopg.Connection,
) -> None:
    member_id = create_user(access_schema, "member", "Member One", "secret")
    assign_role(access_schema, member_id, "Member")

    with pytest.raises(ValueError, match="buddy_id .* does not exist"):
        create_buddy_relationship(access_schema, member_id, 99999)


def test_create_buddy_relationship_rejects_date_inversion(
    access_schema: psycopg.Connection,
) -> None:
    from datetime import date as _date

    member_id = create_user(access_schema, "member", "Member One", "secret")
    assign_role(access_schema, member_id, "Member")
    buddy_id = create_user(access_schema, "buddy", "Buddy One", "secret")
    assign_role(access_schema, buddy_id, "Buddy")

    with pytest.raises(ValueError, match="生效日期不得晚于失效日期"):
        create_buddy_relationship(
            access_schema,
            member_id,
            buddy_id,
            effective_date=_date.today(),
            expiry_date=_date.today() - timedelta(days=1),
        )
