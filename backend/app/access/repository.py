from datetime import date, timedelta
from typing import Any

import psycopg

from .security import hash_password, hash_session_token

_BUDDY_LOCK_KEYSPACE = 1  # namespace for pg_advisory_xact_lock on member_id


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
        "current_level": row[6] if len(row) > 6 else None,
        "target_level": row[7] if len(row) > 7 else None,
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
        SELECT id, username, full_name, password_hash, is_active, created_at,
               current_level, target_level
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
        SELECT id, username, full_name, password_hash, is_active, created_at,
               current_level, target_level
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
        JOIN tcp_user u ON u.id = s.user_id
        WHERE s.token_hash = %s
          AND s.expires_at > NOW()
          AND u.is_active = TRUE
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


def _require_role(
    connection: psycopg.Connection, user_id: int, role_code: str, param_name: str
) -> None:
    roles = _fetch_user_roles(connection, user_id)
    if role_code not in roles:
        raise ValueError(f"{param_name} {user_id} does not have the {role_code} role")


def _require_user_exists(
    connection: psycopg.Connection, user_id: int, param_name: str
) -> None:
    row = connection.execute(
        "SELECT 1 FROM tcp_user WHERE id = %s", (user_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"{param_name} {user_id} does not exist")


def _require_active_user(
    connection: psycopg.Connection, user_id: int, param_name: str
) -> None:
    row = connection.execute(
        "SELECT is_active FROM tcp_user WHERE id = %s", (user_id,)
    ).fetchone()
    if row is None:
        raise ValueError(f"{param_name} {user_id} does not exist")
    if not row[0]:
        raise ValueError(f"{param_name} {user_id} is inactive")


def _advisory_lock_member(connection: psycopg.Connection, member_id: int) -> None:
    # ponytail: member-level serialization for create/update/end overlap checks.
    key = (_BUDDY_LOCK_KEYSPACE << 32) | member_id
    connection.execute("SELECT pg_advisory_xact_lock(%s)", (key,))


def _validate_buddy_relationship_dates(
    effective_date: date, expiry_date: date | None
) -> None:
    if expiry_date is not None and effective_date > expiry_date:
        raise ValueError("生效日期不得晚于失效日期。")


def _effective_today_condition(alias: str = "") -> str:
    # ponytail: closed interval; expiry_date IS NULL = open-ended
    prefix = f"{alias}." if alias else ""
    return (
        f"{prefix}effective_date <= CURRENT_DATE"
        f" AND ({prefix}expiry_date IS NULL OR {prefix}expiry_date >= CURRENT_DATE)"
    )


def _check_buddy_relationship_overlap(
    connection: psycopg.Connection,
    member_id: int,
    effective_date: date,
    expiry_date: date | None,
    exclude_id: int | None = None,
) -> None:
    """Reject if interval overlaps an existing primary relationship for this member."""
    if expiry_date is not None:
        overlap_sql = (
            "SELECT 1 FROM buddy_relationship"
            " WHERE member_id = %s AND is_primary = TRUE"
            "  AND effective_date <= %s"
            "  AND (expiry_date IS NULL OR expiry_date >= %s)"
        )
        params: tuple[Any, ...] = (member_id, expiry_date, effective_date)
    else:
        overlap_sql = (
            "SELECT 1 FROM buddy_relationship"
            " WHERE member_id = %s AND is_primary = TRUE"
            "  AND (expiry_date IS NULL OR expiry_date >= %s)"
        )
        params = (member_id, effective_date)
    if exclude_id is not None:
        overlap_sql += " AND id <> %s"
        params += (exclude_id,)
    row = connection.execute(overlap_sql, params).fetchone()
    if row is not None:
        raise ValueError("该成员在所选日期区间内已有主 Buddy 关系，日期不可重叠。")


def _buddy_relationship_row(row: Any) -> dict[str, object]:
    return {
        "id": row[0],
        "member_id": row[1],
        "buddy_id": row[2],
        "effective_from": row[3],
        "effective_to": row[4],
        "is_primary": row[5],
        "effective_date": row[6],
        "expiry_date": row[7],
        "created_at": row[8],
        "updated_at": row[9],
    }


def create_buddy_relationship(
    connection: psycopg.Connection,
    member_id: int,
    buddy_id: int,
    effective_date: date | None = None,
    expiry_date: date | None = None,
    is_primary: bool = True,
) -> int:
    if effective_date is None:
        effective_date = date.today()
    if member_id == buddy_id:
        raise ValueError("member_id and buddy_id cannot be the same user")
    _validate_buddy_relationship_dates(effective_date, expiry_date)
    _require_user_exists(connection, member_id, "member_id")
    _require_user_exists(connection, buddy_id, "buddy_id")
    _require_role(connection, member_id, "Member", "member_id")
    _require_role(connection, buddy_id, "Buddy", "buddy_id")
    _require_active_user(connection, buddy_id, "buddy_id")
    with connection.transaction():
        _advisory_lock_member(connection, member_id)
        _check_buddy_relationship_overlap(
            connection, member_id, effective_date, expiry_date
        )
        row = connection.execute(
            """INSERT INTO buddy_relationship
               (member_id, buddy_id, effective_from, effective_date,
                effective_to, expiry_date, is_primary)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               RETURNING id""",
            (
                member_id,
                buddy_id,
                effective_date,
                effective_date,
                expiry_date,
                expiry_date,
                is_primary,
            ),
        ).fetchone()
    assert row is not None
    return row[0]


def get_primary_buddy(
    connection: psycopg.Connection, member_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        f"""SELECT u.id, u.username, u.full_name, u.is_active
            FROM tcp_user u
            JOIN buddy_relationship br ON br.buddy_id = u.id
            WHERE br.member_id = %s AND br.is_primary = TRUE
              AND {_effective_today_condition('br')}
            LIMIT 1""",
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
        f"""SELECT u.id, u.username, u.full_name, u.is_active
            FROM tcp_user u
            JOIN buddy_relationship br ON br.member_id = u.id
            WHERE br.buddy_id = %s AND br.is_primary = TRUE
              AND {_effective_today_condition('br')}
            ORDER BY u.username""",
        (buddy_id,),
    ).fetchall()
    return [
        {"id": r[0], "username": r[1], "full_name": r[2], "is_active": r[3]}
        for r in rows
    ]


def is_member_assigned_to_buddy(
    connection: psycopg.Connection, member_id: int, buddy_id: int
) -> bool:
    row = connection.execute(
        f"""SELECT 1 FROM buddy_relationship br
            WHERE br.member_id = %s AND br.buddy_id = %s
              AND br.is_primary = TRUE AND {_effective_today_condition('br')}""",
        (member_id, buddy_id),
    ).fetchone()
    return row is not None


def list_buddy_relationships(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """SELECT br.id, br.member_id, br.buddy_id, br.effective_from,
                  br.effective_to, br.is_primary,
                  br.effective_date, br.expiry_date,
                  br.created_at, br.updated_at,
                  u.full_name as buddy_name
           FROM buddy_relationship br
           JOIN tcp_user u ON u.id = br.buddy_id
           WHERE br.member_id = %s
           ORDER BY br.effective_date DESC, br.id DESC""",
        (member_id,),
    ).fetchall()
    return [
        {
            "id": r[0],
            "member_id": r[1],
            "buddy_id": r[2],
            "effective_date": r[6],
            "expiry_date": r[7],
            "is_primary": r[5],
            "buddy_name": r[10],
            "created_at": r[8],
            "updated_at": r[9],
        }
        for r in rows
    ]


def _fetch_buddy_relationship(
    connection: psycopg.Connection, relationship_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """SELECT br.id, br.member_id, br.buddy_id,
                  br.effective_date, br.expiry_date,
                  br.is_primary, br.created_at, br.updated_at,
                  u.full_name as buddy_name
           FROM buddy_relationship br
           JOIN tcp_user u ON u.id = br.buddy_id
           WHERE br.id = %s""",
        (relationship_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "member_id": row[1],
        "buddy_id": row[2],
        "effective_date": row[3],
        "expiry_date": row[4],
        "is_primary": row[5],
        "created_at": row[6],
        "updated_at": row[7],
        "buddy_name": row[8],
    }


def update_buddy_relationship(
    connection: psycopg.Connection,
    relationship_id: int,
    buddy_id: int,
    effective_date: date,
    expiry_date: date | None,
) -> dict[str, object]:
    _validate_buddy_relationship_dates(effective_date, expiry_date)
    _require_user_exists(connection, buddy_id, "buddy_id")
    _require_role(connection, buddy_id, "Buddy", "buddy_id")
    _require_active_user(connection, buddy_id, "buddy_id")
    with connection.transaction():
        existing = connection.execute(
            "SELECT member_id, buddy_id FROM buddy_relationship WHERE id = %s",
            (relationship_id,),
        ).fetchone()
        if existing is None:
            raise KeyError("relationship not found")
        member_id = existing[0]
        if member_id == buddy_id:
            raise ValueError("member_id and buddy_id cannot be the same user")
        _advisory_lock_member(connection, member_id)
        _check_buddy_relationship_overlap(
            connection,
            member_id,
            effective_date,
            expiry_date,
            relationship_id,
        )
        connection.execute(
            """UPDATE buddy_relationship
               SET buddy_id = %s, effective_date = %s, expiry_date = %s,
                   effective_from = %s, effective_to = %s, updated_at = NOW()
               WHERE id = %s""",
            (buddy_id, effective_date, expiry_date, effective_date, expiry_date, relationship_id),
        )
    rel = _fetch_buddy_relationship(connection, relationship_id)
    assert rel is not None
    return rel


def end_buddy_relationship(
    connection: psycopg.Connection, relationship_id: int, end_date: date
) -> dict[str, object]:
    with connection.transaction():
        existing = connection.execute(
            """SELECT member_id, effective_date, expiry_date
               FROM buddy_relationship WHERE id = %s""",
            (relationship_id,),
        ).fetchone()
        if existing is None:
            raise KeyError("relationship not found")
        member_id = existing[0]
        effective_date = existing[1]
        current_expiry = existing[2]
        if end_date < effective_date:
            raise ValueError("结束日期不得早于生效日期。")
        if current_expiry is not None and end_date > current_expiry:
            raise ValueError("结束日期不得晚于当前失效日期，不能延长关系。")
        _advisory_lock_member(connection, member_id)
        _check_buddy_relationship_overlap(
            connection, member_id, effective_date, end_date, relationship_id
        )
        connection.execute(
            """UPDATE buddy_relationship
               SET expiry_date = %s, effective_to = %s, updated_at = NOW()
               WHERE id = %s""",
            (end_date, end_date, relationship_id),
        )
    rel = _fetch_buddy_relationship(connection, relationship_id)
    assert rel is not None
    return rel


def list_available_buddies(
    connection: psycopg.Connection,
) -> list[dict[str, object]]:
    rows = connection.execute(
        """SELECT u.id, u.username, u.full_name
           FROM tcp_user u
           JOIN tcp_user_role ur ON ur.user_id = u.id
           JOIN tcp_role r ON r.id = ur.role_id
           WHERE r.code = 'Buddy' AND u.is_active = TRUE
           ORDER BY u.username"""
    ).fetchall()
    return [{"id": r[0], "username": r[1], "full_name": r[2]} for r in rows]


_ROLE_CODES = {"Member", "Buddy", "Leader", "Admin"}
_VALID_LEVELS = {"P4", "P5", "P6", "P7", "P8"}


def list_users(connection: psycopg.Connection) -> list[dict[str, object]]:
    rows = connection.execute("SELECT id FROM tcp_user ORDER BY username").fetchall()
    return [user for row in rows if (user := get_user_with_roles(connection, row[0]))]


def create_user_admin(
    connection: psycopg.Connection,
    username: str,
    full_name: str,
    password: str,
    is_active: bool,
    roles: list[str],
    current_level: str | None = None,
    target_level: str | None = None,
) -> dict[str, object]:
    if not roles or not set(roles).issubset(_ROLE_CODES):
        raise ValueError("roles must be selected from the fixed role list")
    _validate_level(current_level, "current_level")
    _validate_level(target_level, "target_level")
    if get_user_by_username(connection, username) is not None:
        raise ValueError("username already exists")

    with connection.transaction():
        user_id = create_user(connection, username, full_name, password, is_active)
        return update_user_admin(
            connection,
            user_id,
            full_name,
            is_active,
            roles,
            current_level,
            target_level,
        )


def _validate_level(value: str | None, field: str) -> None:
    if value is not None:
        if not isinstance(value, str) or value not in _VALID_LEVELS:
            raise ValueError(
                f"{field} must be one of P4, P5, P6, P7, P8 or null, got {value!r}"
            )


def update_user_admin(
    connection: psycopg.Connection,
    user_id: int,
    full_name: str,
    is_active: bool,
    roles: list[str],
    current_level: str | None = None,
    target_level: str | None = None,
) -> dict[str, object]:
    if not roles or not set(roles).issubset(_ROLE_CODES):
        raise ValueError("roles must be selected from the fixed role list")
    _validate_level(current_level, "current_level")
    _validate_level(target_level, "target_level")
    with connection.transaction():
        updated = connection.execute(
            """UPDATE tcp_user SET full_name = %s, is_active = %s,
               current_level = %s, target_level = %s
            WHERE id = %s RETURNING id""",
            (full_name, is_active, current_level, target_level, user_id),
        ).fetchone()
        if updated is None:
            raise KeyError("user not found")
        connection.execute("DELETE FROM tcp_user_role WHERE user_id = %s", (user_id,))
        for role_code in roles:
            connection.execute(
                """INSERT INTO tcp_user_role (user_id, role_id)
                SELECT %s, id FROM tcp_role WHERE code = %s""",
                (user_id, role_code),
            )
    user = get_user_with_roles(connection, user_id)
    assert user is not None
    return user


def list_system_configs(connection: psycopg.Connection) -> list[dict[str, object]]:
    rows = connection.execute(
        """SELECT code, name, value, value_type, description, enabled
        FROM tcp_system_config ORDER BY code"""
    ).fetchall()
    return [
        {
            "code": row[0],
            "name": row[1],
            "value": row[2],
            "value_type": row[3],
            "description": row[4],
            "enabled": row[5],
        }
        for row in rows
    ]


def update_system_config(
    connection: psycopg.Connection, code: str, value: str, enabled: bool
) -> dict[str, object]:
    row = connection.execute(
        """UPDATE tcp_system_config
        SET value = %s, enabled = %s, updated_at = NOW()
        WHERE code = %s
        RETURNING code, name, value, value_type, description, enabled""",
        (value, enabled, code),
    ).fetchone()
    if row is None:
        raise KeyError("system config not found")
    return {
        "code": row[0],
        "name": row[1],
        "value": row[2],
        "value_type": row[3],
        "description": row[4],
        "enabled": row[5],
    }
