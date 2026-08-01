import psycopg
import pytest

from app.access.schema import create_access_schema


def _drop_access_tables(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")


def test_access_schema_creation_is_idempotent(connection: psycopg.Connection) -> None:
    _drop_access_tables(connection)

    create_access_schema(connection)
    create_access_schema(connection)

    rows = connection.execute(
        "SELECT code, name FROM tcp_role ORDER BY code"
    ).fetchall()
    roles = {code: name for code, name in rows}
    assert roles == {
        "Admin": "Admin",
        "Buddy": "Buddy",
        "Leader": "Leader",
        "Member": "Member",
    }


def test_session_uses_token_hash_only(connection: psycopg.Connection) -> None:
    _drop_access_tables(connection)
    create_access_schema(connection)

    columns = connection.execute(
        """
        SELECT column_name
        FROM information_schema.columns
        WHERE table_name = 'tcp_session'
        """
    ).fetchall()
    column_names = {col[0] for col in columns}

    assert "token_hash" in column_names
    assert "token" not in column_names


def test_primary_buddy_unique_index(connection: psycopg.Connection) -> None:
    _drop_access_tables(connection)
    create_access_schema(connection)

    with connection.transaction():
        connection.execute(
            """
            INSERT INTO tcp_user (username, full_name, password_hash)
            VALUES ('member', 'Member User', 'hash')
            """
        )
        connection.execute(
            """
            INSERT INTO tcp_user (username, full_name, password_hash)
            VALUES ('buddy', 'Buddy User', 'hash')
            """
        )
        member_id = connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'member'"
        ).fetchone()[0]
        buddy_id = connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'buddy'"
        ).fetchone()[0]
        member_role_id = connection.execute(
            "SELECT id FROM tcp_role WHERE code = 'Member'"
        ).fetchone()[0]
        buddy_role_id = connection.execute(
            "SELECT id FROM tcp_role WHERE code = 'Buddy'"
        ).fetchone()[0]
        connection.execute(
            "INSERT INTO tcp_user_role (user_id, role_id) VALUES (%s, %s)",
            (member_id, member_role_id),
        )
        connection.execute(
            "INSERT INTO tcp_user_role (user_id, role_id) VALUES (%s, %s)",
            (buddy_id, buddy_role_id),
        )
        connection.execute(
            """
            INSERT INTO buddy_relationship (
                member_id, buddy_id, is_primary, effective_to
            )
            VALUES (%s, %s, TRUE, NULL)
            """,
            (member_id, buddy_id),
        )

    with pytest.raises(psycopg.errors.UniqueViolation):
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO buddy_relationship (
                    member_id, buddy_id, is_primary, effective_to
                )
                VALUES (%s, %s, TRUE, NULL)
                """,
                (member_id, buddy_id),
            )


def test_member_cannot_be_own_buddy(connection: psycopg.Connection) -> None:
    _drop_access_tables(connection)
    create_access_schema(connection)

    with connection.transaction():
        connection.execute(
            """
            INSERT INTO tcp_user (username, full_name, password_hash)
            VALUES ('solo', 'Solo User', 'hash')
            """
        )
        user_id = connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'solo'"
        ).fetchone()[0]

    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO buddy_relationship (
                    member_id, buddy_id, is_primary, effective_to
                )
                VALUES (%s, %s, TRUE, NULL)
                """,
                (user_id, user_id),
            )
