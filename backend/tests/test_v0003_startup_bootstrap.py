"""Issue #62 7th review: the current backend must boot from a genuine
v0003-era database through the exact production startup order.

UAT evidence (#62 P1): a production database whose schema_migration ledger
is exactly 0001/0002/0003 crashes the new backend's lifespan BEFORE
run_migrations() — create_planning_schema() creates
uniq_plan_first_source_assessment on annual_growth_plan(source_assessment_id)
(planning/schema.py:298-303), a column that only migration v0009 adds to
pre-existing tables, so migrations 0004–0009 never get to run.

The fixture rebuilds that database shape from FROZEN v0003-era DDL
(``pre_v0003_schema.sql`` — dumped from the era's own schema helpers plus
the real v0001–v0003 migrations) and seeds realistic legacy business data.
It deliberately does NOT call the current schema helpers, which would
pre-create the v0009 columns and mask the startup defect.  The
buddy_relationship canonical-dates columns (effective_date/expiry_date) are
present, matching the UAT database whose access bootstrap demonstrably
passed before the crash at planning/schema.py:298-303.

The tests then run the production startup order of app.main.lifespan
(create_access_schema → create_assessment_schema → create_planning_schema →
run_migrations) and verify the full upgrade: a complete 0001–0014 ledger,
the v0009 columns/indexes/constraints/triggers, preserved legacy business
data and an idempotent second start.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.migrations import run_migrations
from app.planning.schema import create_planning_schema
from tests.review_support import _ALL_TABLES

_SCHEMA_SQL = (Path(__file__).resolve().parent / "pre_v0003_schema.sql").read_text(
    encoding="utf-8"
)

_EXPECTED_VERSIONS = (
    "0001_standard_targets",
    "0002_assessment_inheritance_revision",
    "0003_assessment_explicit_clear",
    "0004_legacy_draft_target_repair",
    "0005_capability_standard_versioning",
    "0006_assessment_scope_snapshots",
    "0007_assessment_plan_selection",
    "0008_plan_null_constraint",
    "0009_review_plan_atomic",
    "0010_learning_execution",
    "0011_monthly_review",
    "0012_team_analytics_indexes",
    "0013_plan_item_growth_goal_nullable",
    "0014_evidence_archive_backfill",
    "0015_plan_month_text",
    "0016_plan_item_later_assessment",
    "0017_task_requirement_decision",
)


def _drop_everything(connection: psycopg.Connection) -> None:
    with connection.transaction():
        for table in _ALL_TABLES:
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        connection.execute("DROP TABLE IF EXISTS assessment_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS tcp_system_config CASCADE")
        connection.execute(
            "DROP TABLE IF EXISTS assessment_draft_target_repair_audit CASCADE"
        )
        # The frozen dump defines these functions without OR REPLACE; drop the
        # copies the current schema helper may have left behind.
        for function in (
            "set_annual_growth_plan_default_dates()",
            "validate_capability_node_hierarchy()",
            "validate_capability_node_resource()",
        ):
            connection.execute(f"DROP FUNCTION IF EXISTS {function} CASCADE")


def _seed_ledger_v0001_v0003(connection: psycopg.Connection) -> None:
    """The dump carries an empty schema_migration table; record exactly the
    ledger a real v0003-era UAT database has."""
    for version in _EXPECTED_VERSIONS[:3]:
        connection.execute(
            "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
        )


def _seed_legacy_data(connection: psycopg.Connection) -> dict[str, int]:
    """Small but realistic v0003-era business data: members, a catalog model
    with an L3 node (v0004 publishes the Legacy Baseline from it), and a
    legacy plan → goal → item chain."""
    connection.execute(
        """
        INSERT INTO tcp_role (code, name)
        VALUES ('Member', 'Member'), ('Buddy', 'Buddy'),
               ('Leader', 'Leader'), ('Admin', 'Admin')
        ON CONFLICT (code) DO NOTHING
        """
    )
    member = connection.execute(
        """
        INSERT INTO tcp_user (username, full_name, password_hash,
                              current_level, target_level)
        VALUES ('v3-member', 'V3 Member', 'secret', 'P4', 'P5')
        RETURNING id
        """
    ).fetchone()
    member_id = int(member[0])
    connection.execute(
        """
        INSERT INTO tcp_user_role (user_id, role_id)
        SELECT %s, id FROM tcp_role WHERE code = 'Member'
        """,
        (member_id,),
    )
    buddy = connection.execute(
        """
        INSERT INTO tcp_user (username, full_name, password_hash,
                              current_level, target_level)
        VALUES ('v3-buddy', 'V3 Buddy', 'secret', 'P4', 'P5')
        RETURNING id
        """
    ).fetchone()
    buddy_id = int(buddy[0])
    connection.execute(
        """
        INSERT INTO tcp_user_role (user_id, role_id)
        SELECT %s, id FROM tcp_role WHERE code = 'Buddy'
        """,
        (buddy_id,),
    )
    model = connection.execute(
        """
        INSERT INTO capability_model (code, name, version, source_workbook,
                                      source_sheet, source_row)
        VALUES ('P01', '技术', 'v1.0', '技术架构与开发_角色能力模型.xlsx',
                'Sheet1', 1)
        RETURNING id
        """
    ).fetchone()
    model_id = int(model[0])
    l1 = connection.execute(
        """
        INSERT INTO capability_node (model_id, code, name, node_type,
                                     sort_order, source_workbook,
                                     source_sheet, source_row)
        VALUES (%s, 'P01-L1', '域一', 'L1', 1, 'legacy.xlsx', 'Sheet1', 1)
        RETURNING id
        """,
        (model_id,),
    ).fetchone()
    l2 = connection.execute(
        """
        INSERT INTO capability_node (model_id, code, name, node_type,
                                     parent_node_id, sort_order,
                                     source_workbook, source_sheet, source_row)
        VALUES (%s, 'P01-L1-L2', '模块一', 'L2', %s, 1,
                'legacy.xlsx', 'Sheet1', 1)
        RETURNING id
        """,
        (model_id, int(l1[0])),
    ).fetchone()
    l3 = connection.execute(
        """
        INSERT INTO capability_node (model_id, code, name, node_type,
                                     parent_node_id, sort_order,
                                     recommended_start_level,
                                     source_workbook, source_sheet, source_row)
        VALUES (%s, 'P01-L1-L2-L3', '能力一', 'L3', %s, 1, 'P4',
                'legacy.xlsx', 'Sheet1', 1)
        RETURNING id
        """,
        (model_id, int(l2[0])),
    ).fetchone()
    l3_node_id = int(l3[0])
    assessment = connection.execute(
        """
        INSERT INTO assessment (member_id, year, assessment_type, status,
                                submitted_at, archived_at)
        VALUES (%s, 2024, '年度', '已归档', NOW() - INTERVAL '2 years',
                NOW() - INTERVAL '2 years')
        RETURNING id
        """,
        (member_id,),
    ).fetchone()
    assessment_id = int(assessment[0])
    gap = connection.execute(
        """
        INSERT INTO gap (assessment_id, l3_code, current_level, target_level,
                         gap_value, priority, plan_candidate)
        VALUES (%s, 'P01-L1-L2-L3', 2, 3, 1, '高', TRUE) RETURNING id
        """,
        (assessment_id,),
    ).fetchone()
    gap_id = int(gap[0])
    plan = connection.execute(
        """
        INSERT INTO annual_growth_plan (member_id, year, status)
        VALUES (%s, 2024, '已归档') RETURNING id
        """,
        (member_id,),
    ).fetchone()
    plan_id = int(plan[0])
    goal = connection.execute(
        """
        INSERT INTO growth_goal (gap_id, annual_growth_plan_id, l3_code, year,
                                 target_level, priority)
        VALUES (%s, %s, 'P01-L1-L2-L3', 2024, 3, '高') RETURNING id
        """,
        (gap_id, plan_id),
    ).fetchone()
    goal_id = int(goal[0])
    item = connection.execute(
        """
        INSERT INTO plan_item (annual_growth_plan_id, growth_goal_id, l3_code,
                               current_level, target_level, priority,
                               learning_material, learning_task_content)
        VALUES (%s, %s, 'P01-L1-L2-L3', 2, 3, DEFAULT, '材料一', '任务一')
        RETURNING id
        """,
        (plan_id, goal_id),
    ).fetchone()
    item_id = int(item[0])
    connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, 'P01-L1-L2-L3', '已完成')
        """,
        (item_id,),
    )
    connection.commit()
    return {
        "member_id": member_id,
        "buddy_id": buddy_id,
        "model_id": model_id,
        "l3_node_id": l3_node_id,
        "assessment_id": assessment_id,
        "plan_id": plan_id,
        "goal_id": goal_id,
        "item_id": item_id,
    }


@pytest.fixture
def pre_v0003_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A genuine v0003-era database: frozen era DDL, seeded legacy data, the
    ledger at 0001–0003 — nothing from v0004+ exists, and the plan tables
    lack the source columns v0009 adds."""
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    # The dump empties the search path; restore it for unqualified names.
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_ledger_v0001_v0003(connection)
    data = _seed_legacy_data(connection)
    # Proof the fixture really is v0003-era (with the UAT buddy_relationship
    # shape): plan/plan_item lack the source columns, no proposal/snapshot
    # tables, but buddy_relationship carries the canonical-dates columns.
    plan_missing = connection.execute(
        """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'annual_growth_plan'
          AND column_name = 'source_assessment_id'
        """
    ).fetchone()[0]
    item_missing = connection.execute(
        """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'plan_item'
          AND column_name = 'source_assessment_detail_id'
        """
    ).fetchone()[0]
    proposals = connection.execute(
        """
        SELECT COUNT(*) FROM information_schema.tables
        WHERE table_name = 'annual_plan_change_proposal'
        """
    ).fetchone()[0]
    ledger = connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0]
    expiry = connection.execute(
        """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'buddy_relationship' AND column_name = 'expiry_date'
        """
    ).fetchone()[0]
    assert (plan_missing, item_missing, proposals, ledger, expiry) == (0, 0, 0, 3, 1)
    connection.commit()
    connection.legacy_data = data
    yield connection


def _full_startup_order(connection: psycopg.Connection) -> None:
    """The exact bootstrap order of app.main.lifespan: create_catalog_schema
    (what ensure_catalog_initialized does before the workbook import) →
    create_access_schema → create_assessment_schema → create_planning_schema
    → run_migrations.  The workbook import and demo seeds are omitted: they
    need the workbook and are not part of the failing path."""
    from app.catalog.schema import create_catalog_schema

    create_catalog_schema(connection)
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    run_migrations(connection)
    connection.commit()


def _assert_v0009_objects(connection: psycopg.Connection) -> None:
    for table, column in (
        ("annual_growth_plan", "source_assessment_id"),
        ("annual_growth_plan", "planning_source_type"),
        ("plan_item", "source_assessment_id"),
        ("plan_item", "source_assessment_detail_id"),
        ("plan_item", "planning_snapshot_id"),
        ("assessment_review", "reviewed_by_buddy_id"),
    ):
        row = connection.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name=%s AND column_name=%s",
            (table, column),
        ).fetchone()
        assert row is not None, (table, column)
    for index in (
        "uniq_plan_first_source_assessment",
        "uniq_plan_item_source_detail",
        "uniq_active_primary_buddy_v2",
    ):
        row = connection.execute(
            "SELECT 1 FROM pg_indexes WHERE indexname=%s", (index,)
        ).fetchone()
        assert row is not None, index
    for trigger, table in (
        ("trg_proposal_source_not_plan_first_source", "annual_plan_change_proposal"),
        ("trg_plan_source_not_proposal_source", "annual_growth_plan"),
    ):
        row = connection.execute(
            "SELECT 1 FROM pg_trigger WHERE tgname=%s AND tgrelid=%s::regclass",
            (trigger, table),
        ).fetchone()
        assert row is not None, (trigger, table)


def test_v0003_database_boots_through_full_startup_order(
    pre_v0003_db: psycopg.Connection,
) -> None:
    """The UAT reproduction: a real v0003-era database must boot the current
    backend through the production startup order without a manual migration
    pre-run.  On the broken baseline this fails with UndefinedColumn
    'source_assessment_id' at planning/schema.py:298-303 — before any
    migration runs."""
    connection = pre_v0003_db
    data = connection.legacy_data
    counts_before = {
        table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in (
            "annual_growth_plan",
            "growth_goal",
            "plan_item",
            "learning_task",
            "tcp_user",
            "capability_node",
        )
    }
    _full_startup_order(connection)
    # Ledger: exactly 0001–0014, once each, in order.
    rows = connection.execute(
        "SELECT version FROM schema_migration ORDER BY version"
    ).fetchall()
    assert [row[0] for row in rows] == list(_EXPECTED_VERSIONS)
    # v0009 columns, indexes and guards exist after the upgrade.
    _assert_v0009_objects(connection)
    # Legacy business data preserved, values intact, old plan stays legacy.
    for table, expected in counts_before.items():
        actual = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        assert actual == expected, table
    plan = connection.execute(
        "SELECT source_assessment_id, planning_source_type, status "
        "FROM annual_growth_plan WHERE id=%s",
        (data["plan_id"],),
    ).fetchone()
    assert (plan[0], plan[1], plan[2]) == (None, None, "已归档")
    item = connection.execute(
        "SELECT priority, l3_code, current_level, target_level "
        "FROM plan_item WHERE id=%s",
        (data["item_id"],),
    ).fetchone()
    assert item == ("中", "P01-L1-L2-L3", 2, 3)
    task = connection.execute(
        "SELECT l3_code, status FROM learning_task WHERE plan_item_id=%s",
        (data["item_id"],),
    ).fetchone()
    assert task == ("P01-L1-L2-L3", "已完成")
    # Second startup: idempotent — no re-migration, no duplicate-object
    # errors, ledger unchanged, data untouched.
    _full_startup_order(connection)
    rows = connection.execute(
        "SELECT version FROM schema_migration ORDER BY version"
    ).fetchall()
    assert [row[0] for row in rows] == list(_EXPECTED_VERSIONS)
    for table, expected in counts_before.items():
        actual = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        assert actual == expected, table


def test_fresh_database_full_startup_order_idempotent(
    connection: psycopg.Connection,
) -> None:
    """The fresh-install leg of 'at least fresh, v0003, v0008': an empty
    database booted through the production startup order lands on the same
    v0009 contract and boots again without duplicate-index/constraint
    errors."""
    _drop_everything(connection)
    _full_startup_order(connection)
    rows = connection.execute(
        "SELECT version FROM schema_migration ORDER BY version"
    ).fetchall()
    assert [row[0] for row in rows] == list(_EXPECTED_VERSIONS)
    _assert_v0009_objects(connection)
    _full_startup_order(connection)
    rows = connection.execute(
        "SELECT version FROM schema_migration ORDER BY version"
    ).fetchall()
    assert [row[0] for row in rows] == list(_EXPECTED_VERSIONS)
