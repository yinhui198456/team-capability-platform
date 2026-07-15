from datetime import timedelta
from typing import Any

import psycopg

from .security import hash_password, hash_session_token


def _now(connection: psycopg.Connection) -> Any:
    return connection.execute("SELECT NOW()").fetchone()[0]


def create_user(
    connection: psycopg.Connection,
    username: str,
    full_name: str,
    password: str,
    is_active: bool = True,
) -> int:
    password_hash = hash_password(password)
    with connection.transaction():
        row = connection.execute(
            """
            INSERT INTO tcp_user (username, full_name, password_hash, is_active)
            VALUES (%s, %s, %s, %s)
            RETURNING id
            """,
            (username, full_name, password_hash, is_active),
        ).fetchone()
    assert row is not None
    return row[0]


def assign_role(connection: psycopg.Connection, user_id: int, role_code: str) -> None:
    with connection.transaction():
        connection.execute(
            """
            INSERT INTO tcp_user_role (user_id, role_id)
            SELECT %s, id FROM tcp_role WHERE code = %s
            ON CONFLICT (user_id, role_id) DO NOTHING
            """,
            (user_id, role_code),
        )


def _row_to_user(row: Any) -> dict[str, object]:
    return {
        "id": row[0],
        "username": row[1],
        "full_name": row[2],
        "password_hash": row[3],
        "is_active": row[4],
        "created_at": row[5],
        "roles": [],
    }


def _fetch_user_roles(connection: psycopg.Connection, user_id: int) -> list[str]:
    rows = connection.execute(
        """
        SELECT r.code
        FROM tcp_role r
        JOIN tcp_user_role ur ON ur.role_id = r.id
        WHERE ur.user_id = %s
        ORDER BY r.code
        """,
        (user_id,),
    ).fetchall()
    return [row[0] for row in rows]


def get_user_with_roles(
    connection: psycopg.Connection, user_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, username, full_name, password_hash, is_active, created_at
        FROM tcp_user
        WHERE id = %s
        """,
        (user_id,),
    ).fetchone()
    if row is None:
        return None
    user = _row_to_user(row)
    user["roles"] = _fetch_user_roles(connection, user_id)
    return user


def get_user_by_username(
    connection: psycopg.Connection, username: str
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, username, full_name, password_hash, is_active, created_at
        FROM tcp_user
        WHERE username = %s
        """,
        (username,),
    ).fetchone()
    if row is None:
        return None
    user = _row_to_user(row)
    user["roles"] = _fetch_user_roles(connection, user["id"])
    return user


def create_session(
    connection: psycopg.Connection, user_id: int, max_age_seconds: int
) -> str:
    from .security import generate_session_token

    raw_token = generate_session_token()
    token_hash = hash_session_token(raw_token)
    expires_at = _now(connection) + timedelta(seconds=max_age_seconds)
    with connection.transaction():
        connection.execute(
            """
            INSERT INTO tcp_session (token_hash, user_id, expires_at)
            VALUES (%s, %s, %s)
            """,
            (token_hash, user_id, expires_at),
        )
    return raw_token


def get_session_user(
    connection: psycopg.Connection, token: str
) -> dict[str, object] | None:
    token_hash = hash_session_token(token)
    row = connection.execute(
        """
        SELECT s.user_id
        FROM tcp_session s
        WHERE s.token_hash = %s AND s.expires_at > NOW()
        """,
        (token_hash,),
    ).fetchone()
    if row is None:
        return None
    return get_user_with_roles(connection, row[0])


def delete_session(connection: psycopg.Connection, token: str) -> None:
    token_hash = hash_session_token(token)
    with connection.transaction():
        connection.execute(
            "DELETE FROM tcp_session WHERE token_hash = %s",
            (token_hash,),
        )


def delete_expired_sessions(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DELETE FROM tcp_session WHERE expires_at <= NOW()")


def create_buddy_relationship(
    connection: psycopg.Connection,
    member_id: int,
    buddy_id: int,
    is_primary: bool = True,
) -> int:
    with connection.transaction():
        row = connection.execute(
            """
            INSERT INTO buddy_relationship (member_id, buddy_id, is_primary)
            VALUES (%s, %s, %s)
            RETURNING id
            """,
            (member_id, buddy_id, is_primary),
        ).fetchone()
    assert row is not None
    return row[0]


def get_primary_buddy(
    connection: psycopg.Connection, member_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT u.id, u.username, u.full_name, u.is_active
        FROM tcp_user u
        JOIN buddy_relationship br ON br.buddy_id = u.id
        WHERE br.member_id = %s
          AND br.is_primary = TRUE
          AND br.effective_to IS NULL
        """,
        (member_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "username": row[1],
        "full_name": row[2],
        "is_active": row[3],
    }


def get_assigned_members(
    connection: psycopg.Connection, buddy_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT u.id, u.username, u.full_name, u.is_active
        FROM tcp_user u
        JOIN buddy_relationship br ON br.member_id = u.id
        WHERE br.buddy_id = %s
          AND br.is_primary = TRUE
          AND br.effective_to IS NULL
        ORDER BY u.username
        """,
        (buddy_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "username": row[1],
            "full_name": row[2],
            "is_active": row[3],
        }
        for row in rows
    ]
