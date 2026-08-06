import psycopg
import pytest

from app.access import seed
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
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.migrations import run_migrations
from app.planning.schema import create_planning_schema

_DEMO_USERNAMES = ("admin", "leader", "buddy", "member", "member2")

# Explicit test-only credential. It is used solely to exercise seeding inside
# tests and is deliberately not a repository-known runtime default.
_TEST_DEMO_PASSWORD = "test-only-demo-password"


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
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert user["username"] == username


def test_seed_passwords_verify_with_explicit_password(
    access_schema: psycopg.Connection,
) -> None:
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert verify_password(_TEST_DEMO_PASSWORD, user["password_hash"]) is True
        # The retired repository-known default must never verify.
        assert verify_password("123456", user["password_hash"]) is False


def test_seed_passwords_are_not_stored_in_plaintext(
    access_schema: psycopg.Connection,
) -> None:
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert _TEST_DEMO_PASSWORD not in user["password_hash"]
        assert user["password_hash"] != _TEST_DEMO_PASSWORD


def test_seed_skips_when_password_missing(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema, None)

    assert _row_counts(access_schema) == {
        "users": 0,
        "user_roles": 0,
        "buddy_relationships": 0,
    }


def test_seed_skips_when_password_blank(access_schema: psycopg.Connection) -> None:
    for blank_value in ("", "   "):
        _reset_access_schema(access_schema)
        seed_demo_accounts(access_schema, blank_value)

        assert _row_counts(access_schema) == {
            "users": 0,
            "user_roles": 0,
            "buddy_relationships": 0,
        }


def test_seed_skips_when_password_is_known_insecure(
    access_schema: psycopg.Connection,
) -> None:
    for insecure_value in seed._KNOWN_INSECURE_DEMO_PASSWORDS:
        _reset_access_schema(access_schema)
        seed_demo_accounts(access_schema, insecure_value)

        assert _row_counts(access_schema) == {
            "users": 0,
            "user_roles": 0,
            "buddy_relationships": 0,
        }


def test_seed_skips_when_password_shorter_than_minimum(
    access_schema: psycopg.Connection,
) -> None:
    for short_value in ("short", "123456789012345"):
        _reset_access_schema(access_schema)
        seed_demo_accounts(access_schema, short_value)

        assert _row_counts(access_schema) == {
            "users": 0,
            "user_roles": 0,
            "buddy_relationships": 0,
        }


def test_seed_accepts_exactly_sixteen_raw_characters(
    access_schema: psycopg.Connection,
) -> None:
    boundary = "x" * 16
    seed_demo_accounts(access_schema, boundary)

    assert _row_counts(access_schema)["users"] == 5
    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert verify_password(boundary, user["password_hash"]) is True


def test_seed_preserves_unicode_and_whitespace_exactly(
    access_schema: psycopg.Connection,
) -> None:
    tricky = "  密码 password 16chars \n"
    assert len(tricky) >= 16
    seed_demo_accounts(access_schema, tricky)

    for username in _DEMO_USERNAMES:
        user = get_user_by_username(access_schema, username)
        assert user is not None
        assert verify_password(tricky, user["password_hash"]) is True
        assert user["password_hash"] != tricky


def test_seed_short_password_warning_never_logs_the_value(
    access_schema: psycopg.Connection,
    caplog: pytest.LogCaptureFixture,
) -> None:
    short_value = "SHORT-not-16"
    seed_demo_accounts(access_schema, short_value)

    assert "demo seeding skipped" in caplog.text
    assert short_value not in caplog.text


def test_seed_skip_warning_never_logs_the_password(
    access_schema: psycopg.Connection, caplog: pytest.LogCaptureFixture
) -> None:
    seed_demo_accounts(access_schema, None)

    assert "demo seeding skipped" in caplog.text
    assert _TEST_DEMO_PASSWORD not in caplog.text
    assert "123456" not in caplog.text


def test_seed_assigns_expected_roles(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

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
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

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
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    buddy = get_user_by_username(access_schema, "buddy")
    assert buddy is not None
    assigned = get_assigned_members(access_schema, buddy["id"])
    usernames = {member["username"] for member in assigned}
    assert usernames == {"member", "member2"}


def test_seed_is_idempotent(access_schema: psycopg.Connection) -> None:
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)
    first_counts = _row_counts(access_schema)

    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)
    second_counts = _row_counts(access_schema)

    assert first_counts == second_counts
    assert second_counts["users"] == 5
    assert second_counts["user_roles"] == 9
    assert second_counts["buddy_relationships"] == 2


def test_seed_skips_when_any_user_exists(access_schema: psycopg.Connection) -> None:
    existing_id = create_user(access_schema, "existing", "Existing User", "secret")
    assign_role(access_schema, existing_id, "Member")

    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    counts = _row_counts(access_schema)
    assert counts["users"] == 1
    assert counts["user_roles"] == 1
    assert counts["buddy_relationships"] == 0


def test_seed_business_data_builds_repeatable_core_loop(
    access_schema: psycopg.Connection,
) -> None:
    create_assessment_schema(access_schema)
    create_planning_schema(access_schema)
    create_catalog_schema(access_schema)
    model_id = access_schema.execute(
        """INSERT INTO capability_model
        (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('demo-model', 'Demo', '1.0', 'demo.xlsx', 'sheet', 1)
        RETURNING id"""
    ).fetchone()[0]
    l1_id = access_schema.execute(
        """INSERT INTO capability_node
        (model_id, node_type, code, name, sort_order,
         source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'demo.xlsx', 'sheet', 2)
        RETURNING id""",
        (model_id,),
    ).fetchone()[0]
    l2_id = access_schema.execute(
        """INSERT INTO capability_node
        (model_id, parent_node_id, node_type, code, name, sort_order,
         source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P01-L2A', 'Item', 1, 'demo.xlsx', 'sheet', 3)
        RETURNING id""",
        (model_id, l1_id),
    ).fetchone()[0]
    access_schema.execute(
        """INSERT INTO capability_node
        (model_id, parent_node_id, node_type, code, name, sort_order,
         recommended_start_level, source_workbook, source_sheet, source_row)
        VALUES (
            %s, %s, 'L3', 'P01-L2A-L3A', 'Leaf', 1,
            'P4', 'demo.xlsx', 'sheet', 4
        )""",
        (model_id, l2_id),
    )
    run_migrations(access_schema)
    seed_demo_accounts(access_schema, _TEST_DEMO_PASSWORD)

    seed.seed_demo_business_data(access_schema)

    counts = {
        table: access_schema.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in (
            "assessment",
            "gap",
            "growth_goal",
            "plan_item",
            "learning_task",
            "learning_progress_log",
            "evidence",
            "evidence_review",
            "capability_profile",
        )
    }
    assert counts == dict.fromkeys(counts, 1)
    assert (
        access_schema.execute("SELECT conclusion FROM evidence_review").fetchone()[0]
        == "通过"
    )

    seed.seed_demo_business_data(access_schema)
    repeated = {
        table: access_schema.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
        for table in counts
    }
    assert repeated == counts
