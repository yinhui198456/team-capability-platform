"""Issue #62 P1-6: real pre-v0009 upgrade proof.

The fixture builds a genuine v0008-era database from FROZEN DDL
(``pre_v0009_schema.sql``, dumped from Base 6c6f031's schema files plus the
v0004/v0005/v0006 migration-created tables) and seeds realistic legacy data.
It deliberately does NOT call the current schema helpers, which would pre-create
v0009 tables/columns/triggers.  The production migration runner then upgrades
v0008 → v0009, and every post-condition is verified: legacy capture, canonical
dates, constraint/trigger existence and enforcement, idempotent re-runs and
double lifespan startup.
"""

from collections.abc import Iterator
from pathlib import Path

import psycopg
import pytest

from app.catalog.standard_versions import planning_snapshot_hash
from tests.review_support import _ALL_TABLES

_SCHEMA_SQL = (Path(__file__).resolve().parent / "pre_v0009_schema.sql").read_text(
    encoding="utf-8"
)


def _drop_everything(connection: psycopg.Connection) -> None:
    with connection.transaction():
        for table in _ALL_TABLES:
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
        connection.execute("DROP TABLE IF EXISTS assessment_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS tcp_system_config CASCADE")
        # Tables the current schema helpers create that are NOT in _ALL_TABLES.
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


def _seed_schema_migration_v0001_v0008(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE schema_migration (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    for version in (
        "0001_standard_targets",
        "0002_assessment_inheritance_revision",
        "0003_assessment_explicit_clear",
        "0004_legacy_draft_target_repair",
        "0005_capability_standard_versioning",
        "0006_assessment_scope_snapshots",
        "0007_assessment_plan_selection",
        "0008_plan_null_constraint",
    ):
        connection.execute(
            "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
        )


def _seed_legacy_data(connection: psycopg.Connection) -> dict[str, int]:
    from app.access.repository import assign_role, create_user

    connection.execute(
        """
        INSERT INTO tcp_role (code, name)
        VALUES ('Member', 'Member'), ('Buddy', 'Buddy'),
               ('Leader', 'Leader'), ('Admin', 'Admin')
        ON CONFLICT (code) DO NOTHING
        """
    )

    member_id = create_user(connection, "legacy-member", "Legacy Member", "secret")
    assign_role(connection, member_id, "Member")
    buddy_id = create_user(connection, "legacy-buddy", "Legacy Buddy", "secret")
    assign_role(connection, buddy_id, "Buddy")
    connection.execute(
        "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
        (member_id,),
    )
    # Legacy buddy relationships: only effective_from/effective_to exist.
    connection.execute(
        """
        INSERT INTO buddy_relationship (member_id, buddy_id, is_primary,
                                        effective_from, effective_to)
        VALUES (%s, %s, TRUE, '2024-01-01', '2025-12-31')
        """,
        (member_id, buddy_id),
    )
    connection.execute(
        """
        INSERT INTO buddy_relationship (member_id, buddy_id, is_primary,
                                        effective_from, effective_to)
        VALUES (%s, %s, TRUE, '2026-01-01', NULL)
        """,
        (member_id, buddy_id),
    )
    # Catalog model + one L3 node.
    model_row = connection.execute(
        """
        INSERT INTO capability_model (code, name, version, source_workbook,
                                      source_sheet, source_row)
        VALUES ('P01', '技术', 'v1.0', '技术架构与开发_角色能力模型.xlsx', 'Sheet1', 1)
        RETURNING id
        """
    ).fetchone()
    model_id = int(model_row[0])
    l1 = connection.execute(
        """
        INSERT INTO capability_node (model_id, code, name, node_type, sort_order,
                                     source_workbook, source_sheet, source_row)
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
                                     source_workbook, source_sheet, source_row)
        VALUES (%s, 'P01-L1-L2-L3', '能力一', 'L3', %s, 1,
                'legacy.xlsx', 'Sheet1', 1)
        RETURNING id
        """,
        (model_id, int(l2[0])),
    ).fetchone()
    l3_node_id = int(l3[0])
    # Published + archived standard versions with their items.
    archived = connection.execute(
        """
        INSERT INTO capability_standard_version (
            model_id, version_no, label, status, revision, created_by,
            published_by, created_at, published_at, archived_at
        )
        VALUES (%s, 1, 'legacy v1', '已归档', 2, %s, %s,
                NOW() - INTERVAL '2 years', NOW() - INTERVAL '2 years',
                NOW() - INTERVAL '1 year')
        RETURNING id
        """,
        (model_id, buddy_id, buddy_id),
    ).fetchone()
    archived_id = int(archived[0])
    published = connection.execute(
        """
        INSERT INTO capability_standard_version (
            model_id, version_no, label, status, revision, created_by,
            published_by, created_at, published_at
        )
        VALUES (%s, 2, 'legacy v2', '已发布', 3, %s, %s,
                NOW() - INTERVAL '1 year', NOW() - INTERVAL '1 year')
        RETURNING id
        """,
        (model_id, buddy_id, buddy_id),
    ).fetchone()
    published_id = int(published[0])
    for version_id in (archived_id, published_id):
        connection.execute(
            """
            INSERT INTO capability_standard_item (
                version_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                l3_name, job_level, applicable, target_level, source,
                l3_node_id, updated_by, updated_at
            )
            VALUES (%s, 'P01-L1', '域一', 'P01-L1-L2', '模块一',
                    'P01-L1-L2-L3', '能力一', 'P4', TRUE, 3, 'explicit',
                    %s, %s, NOW())
            """,
            (version_id, l3_node_id, buddy_id),
        )
    # Archived historical assessment + closed review + detail.
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
    connection.execute(
        """
        INSERT INTO assessment_detail (
            assessment_id, l3_code, current_level, target_level,
            standard_target_applicable, standard_target_level, gap_value,
            evidence_note, plan_candidate, l3_node_id
        )
        VALUES (%s, 'P01-L1-L2-L3', 2, 3, TRUE, 3, 1, '历史依据', TRUE, %s)
        """,
        (assessment_id, l3_node_id),
    )
    connection.execute(
        """
        INSERT INTO assessment_review (
            assessment_id, sequence, buddy_id, conclusion, feedback,
            reviewed_at, status
        )
        VALUES (%s, 1, %s, '认可', '历史闭环', NOW() - INTERVAL '2 years', '已闭环')
        """,
        (assessment_id, buddy_id),
    )
    connection.execute(
        """
        INSERT INTO gap (assessment_id, l3_code, current_level, target_level,
                         gap_value, priority, plan_candidate)
        VALUES (%s, 'P01-L1-L2-L3', 2, 3, 1, '高', TRUE)
        """,
        (assessment_id,),
    )
    # Legacy annual plan: plan → goal → item (priority DEFAULT '中') → task.
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
        (
            connection.execute(
                "SELECT id FROM gap WHERE assessment_id=%s", (assessment_id,)
            ).fetchone()[0],
            plan_id,
        ),
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
        "archived_version_id": archived_id,
        "published_version_id": published_id,
        "assessment_id": assessment_id,
        "plan_id": plan_id,
        "goal_id": goal_id,
        "item_id": item_id,
    }


@pytest.fixture
def pre_v0009_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A genuine v0008-era database: frozen DDL, seeded legacy data, the
    schema_migration ledger at v0008 — nothing from v0009 exists."""
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    # The dump empties the search path; restore it for unqualified names.
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_schema_migration_v0001_v0008(connection)
    data = _seed_legacy_data(connection)
    # Proof the fixture really is pre-v0009.
    missing = connection.execute(
        """
        SELECT (SELECT COUNT(*) FROM information_schema.tables
                WHERE table_name = 'capability_standard_planning_snapshot'),
               (SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'buddy_relationship'
                  AND column_name = 'effective_date'),
               (SELECT COUNT(*) FROM information_schema.columns
                WHERE table_name = 'plan_item'
                  AND column_name = 'planning_snapshot_id'),
               (SELECT COUNT(*) FROM information_schema.tables
                WHERE table_name = 'annual_plan_change_proposal')
        """
    ).fetchone()
    assert tuple(missing) == (0, 0, 0, 0)
    priority_default = connection.execute(
        "SELECT column_default FROM information_schema.columns "
        "WHERE table_name='plan_item' AND column_name='priority'"
    ).fetchone()[0]
    assert "中" in str(priority_default)
    connection.commit()
    connection.legacy_data = data
    yield connection


def _run_runner(connection: psycopg.Connection) -> None:
    from app.migrations import run_migrations

    run_migrations(connection)
    connection.commit()


def test_pre_v0009_database_really_lacks_new_contract(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    for table in (
        "capability_standard_planning_snapshot",
        "annual_plan_change_proposal",
        "annual_plan_change_proposal_detail",
        "review_idempotency_key",
    ):
        row = connection.execute(
            "SELECT 1 FROM information_schema.tables WHERE table_name=%s",
            (table,),
        ).fetchone()
        assert row is None, table
    for table, column in (
        ("buddy_relationship", "effective_date"),
        ("buddy_relationship", "expiry_date"),
        ("plan_item", "planning_source_type"),
        ("plan_item", "source_assessment_id"),
        ("assessment_review", "reviewed_by_buddy_id"),
        ("annual_growth_plan", "planning_source_type"),
    ):
        row = connection.execute(
            "SELECT 1 FROM information_schema.columns "
            "WHERE table_name=%s AND column_name=%s",
            (table, column),
        ).fetchone()
        assert row is None, (table, column)


def test_v0009_applies_once_and_keeps_legacy_data(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    data = connection.legacy_data
    counts_before = {
        "assessment": int(
            connection.execute("SELECT COUNT(*) FROM assessment").fetchone()[0]
        ),
        "assessment_detail": int(
            connection.execute("SELECT COUNT(*) FROM assessment_detail").fetchone()[0]
        ),
        "annual_growth_plan": int(
            connection.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[0]
        ),
        "growth_goal": int(
            connection.execute("SELECT COUNT(*) FROM growth_goal").fetchone()[0]
        ),
        "plan_item": int(
            connection.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0]
        ),
        "learning_task": int(
            connection.execute("SELECT COUNT(*) FROM learning_task").fetchone()[0]
        ),
        "buddy_relationship": int(
            connection.execute("SELECT COUNT(*) FROM buddy_relationship").fetchone()[0]
        ),
    }
    _run_runner(connection)
    # 0009 recorded exactly once.
    rows = connection.execute(
        "SELECT COUNT(*) FROM schema_migration WHERE version='0009_review_plan_atomic'"
    ).fetchone()
    assert rows[0] == 1
    # No legacy data lost; old plan is NOT faked as assessment_approval.
    for table, expected in counts_before.items():
        actual = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        assert actual == expected, table
    plan = connection.execute(
        "SELECT planning_source_type, source_assessment_id, status "
        "FROM annual_growth_plan WHERE id=%s",
        (data["plan_id"],),
    ).fetchone()
    assert plan[0] is None
    assert plan[1] is None
    assert plan[2] == "已归档"
    item = connection.execute(
        "SELECT planning_source_type, source_assessment_id, priority, l3_code, "
        "current_level, target_level FROM plan_item WHERE id=%s",
        (data["item_id"],),
    ).fetchone()
    assert item[0] is None
    assert item[1] is None
    assert item[2] == "中"  # the old default was preserved
    assert item[3] == "P01-L1-L2-L3"
    task = connection.execute(
        "SELECT l3_code, status FROM learning_task WHERE plan_item_id=%s",
        (data["item_id"],),
    ).fetchone()
    assert task[0] == "P01-L1-L2-L3" and task[1] == "已完成"


def test_legacy_capture_for_published_and_archived(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    for version_id in (data["published_version_id"], data["archived_version_id"]):
        rows = connection.execute(
            """
            SELECT l3_node_id, l3_code, l3_name, materials_text,
                   resource_snapshot, expected_output, estimated_hours,
                   output_type, notes, source_workbook, source_sheet,
                   source_row, source_type, source_hash, captured_at
            FROM capability_standard_planning_snapshot
            WHERE capability_standard_version_id=%s
            """,
            (version_id,),
        ).fetchall()
        assert len(rows) == 1, version_id
        (
            node_id,
            l3_code,
            l3_name,
            materials,
            resources,
            expected_output,
            estimated_hours,
            output_type,
            notes,
            workbook,
            sheet,
            row_no,
            source_type,
            source_hash,
            captured_at,
        ) = rows[0]
        assert source_type == "legacy_catalog_capture_v0009"
        assert captured_at is not None
        resources = (
            __import__("json").loads(resources)
            if isinstance(resources, str)
            else resources
        )
        recomputed = planning_snapshot_hash(
            l3_node_id=int(node_id),
            l3_code=str(l3_code),
            l3_name=str(l3_name),
            materials_text=materials,
            resources=resources,
            expected_output=expected_output,
            estimated_hours=estimated_hours,
            output_type=output_type,
            notes=notes,
            source_workbook=workbook,
            source_sheet=sheet,
            source_row=row_no,
            source_type=str(source_type),
        )
        assert recomputed == str(source_hash)


def test_buddy_canonical_dates_backfilled_and_synced(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    rows = connection.execute(
        """
        SELECT effective_from, effective_to, effective_date, expiry_date
        FROM buddy_relationship WHERE member_id=%s ORDER BY effective_from
        """,
        (data["member_id"],),
    ).fetchall()
    assert len(rows) == 2
    first, second = rows
    assert first[0] == first[2]  # effective_date == effective_from
    assert first[1] == first[3]  # expiry_date == effective_to
    assert second[0] == second[2]
    assert second[1] == second[3]  # NULL == NULL (open-ended current)
    # The canonical helper sees the CURRENT relationship as responsible.
    from app.access.repository import is_current_responsible_buddy

    assert is_current_responsible_buddy(connection, data["member_id"], data["buddy_id"])


def test_new_constraints_and_guards_exist_and_enforce(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    # Constraints exist.
    for table, constraint in (
        ("plan_item", "plan_item_approval_completeness"),
        ("plan_item", "plan_item_source_detail_assessment_node_fk"),
        ("plan_item", "plan_item_snapshot_version_node_fk"),
        ("annual_plan_change_proposal", "proposal_target_plan_member_year_fk"),
        ("annual_plan_change_proposal", "proposal_source_assessment_member_year_fk"),
        (
            "annual_plan_change_proposal_detail",
            "proposal_detail_snapshot_version_node_fk",
        ),
        (
            "annual_plan_change_proposal_detail",
            "proposal_detail_source_assessment_node_fk",
        ),
    ):
        row = connection.execute(
            "SELECT 1 FROM pg_constraint WHERE conrelid=%s::regclass " "AND conname=%s",
            (table, constraint),
        ).fetchone()
        assert row is not None, (table, constraint)
    # Snapshot INSERT/UPDATE/DELETE all rejected for the published version.
    snapshot = connection.execute(
        "SELECT id, l3_node_id, l3_code FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s",
        (data["published_version_id"],),
    ).fetchone()
    assert snapshot is not None
    with pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                source_type, source_hash
            )
            VALUES (%s, %s, %s, 'x', 'version_publish', 'deadbeef')
            """,
            (data["published_version_id"], int(snapshot[1]), str(snapshot[2])),
        )
    connection.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            "UPDATE capability_standard_planning_snapshot SET notes='x' WHERE id=%s",
            (int(snapshot[0]),),
        )
    connection.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            "DELETE FROM capability_standard_planning_snapshot WHERE id=%s",
            (int(snapshot[0]),),
        )
    connection.rollback()
    # Legacy data still readable.
    row = connection.execute(
        "SELECT l3_code, priority FROM plan_item WHERE id=%s",
        (data["item_id"],),
    ).fetchone()
    assert row == ("P01-L1-L2-L3", "中")


def test_runner_rerun_and_double_lifespan_idempotent(
    pre_v0009_db: psycopg.Connection,
) -> None:
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    count_after_first = int(
        connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0]
    )
    _run_runner(connection)
    count_after_second = int(
        connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0]
    )
    assert count_after_second == count_after_first
    # Lifespan startup (migrations + seed) twice — both idempotent.
    import asyncio

    from app.main import lifespan

    for _ in range(2):
        asyncio.run(_boot_lifespan(lifespan))
    # Historical data still readable after both boots.
    plan = connection.execute(
        "SELECT status FROM annual_growth_plan WHERE id=%s", (data["plan_id"],)
    ).fetchone()
    assert plan == ("已归档",)
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM plan_item WHERE planning_source_type IS NULL"
        ).fetchone()[0]
        == 1
    )
    assert (
        connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0]
        == count_after_first
    )


async def _boot_lifespan(lifespan) -> None:
    async with lifespan(None):
        pass


def test_full_startup_order_boots_v0008_database(
    pre_v0009_db: psycopg.Connection,
) -> None:
    """7th review: the v0008 leg of 'at least fresh, v0003, v0008' — the
    production bootstrap order (catalog/access/assessment/planning schemas
    then run_migrations, exactly like app.main.lifespan) must boot a real
    v0008-era database.  On the broken baseline the access bootstrap
    references the v0009-only expiry_date column and crashes before the
    migration runner runs."""
    connection = pre_v0009_db
    data = connection.legacy_data
    counts_before = {
        table: int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        for table in (
            "assessment",
            "annual_growth_plan",
            "plan_item",
            "buddy_relationship",
        )
    }
    from app.access.schema import create_access_schema
    from app.assessment.schema import create_assessment_schema
    from app.catalog.schema import create_catalog_schema
    from app.migrations import run_migrations
    from app.planning.schema import create_planning_schema

    create_catalog_schema(connection)
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    run_migrations(connection)
    connection.commit()
    rows = connection.execute(
        "SELECT version FROM schema_migration ORDER BY version"
    ).fetchall()
    assert [row[0] for row in rows] == [
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
        "0017_requirement_decisions",
    ]
    # Legacy data preserved through the full startup path.
    for table, expected in counts_before.items():
        actual = int(connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0])
        assert actual == expected, table
    row = connection.execute(
        "SELECT l3_code, priority FROM plan_item WHERE id=%s",
        (data["item_id"],),
    ).fetchone()
    assert row == ("P01-L1-L2-L3", "中")
    # v0009 indexes installed through the full path.
    for index in (
        "uniq_plan_first_source_assessment",
        "uniq_plan_item_source_detail",
        "uniq_active_primary_buddy_v2",
    ):
        row = connection.execute(
            "SELECT 1 FROM pg_indexes WHERE indexname=%s", (index,)
        ).fetchone()
        assert row is not None, index
    # Second boot: idempotent.
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    run_migrations(connection)
    connection.commit()
    assert (
        connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0] == 17
    )


def test_proposal_source_guard_after_upgrade_legacy_preserved(
    pre_v0009_db: psycopg.Connection,
) -> None:
    """4th review: after a genuine v0008 → v0009 upgrade the proposal-source
    guard is installed and enforced, legacy double-NULL provenance survives,
    and a legal subsequent-assessment proposal still works."""
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    # 1. the trigger is installed by the upgrade (both sides)
    for trigger, table in (
        ("trg_proposal_source_not_plan_first_source", "annual_plan_change_proposal"),
        ("trg_plan_source_not_proposal_source", "annual_growth_plan"),
    ):
        row = connection.execute(
            "SELECT 1 FROM pg_trigger WHERE tgname=%s AND tgrelid=%s::regclass",
            (trigger, table),
        ).fetchone()
        assert row is not None, (trigger, table)
    # 2. legacy double-NULL plan provenance is preserved and readable
    row = connection.execute(
        "SELECT source_assessment_id, planning_source_type "
        "FROM annual_growth_plan WHERE id=%s",
        (data["plan_id"],),
    ).fetchone()
    assert (row[0], row[1]) == (None, None)
    # 3. legal legacy backfill of the plan's first source (NULL → non-NULL)
    connection.execute(
        "UPDATE annual_growth_plan SET source_assessment_id=%s, "
        "planning_source_type='assessment_approval' WHERE id=%s",
        (data["assessment_id"], data["plan_id"]),
    )
    connection.commit()
    # 4. a proposal reusing the plan's first source is rejected
    with pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            """
            INSERT INTO annual_plan_change_proposal (
                member_id, year, source_assessment_id,
                target_annual_growth_plan_id, status, created_by, summary
            )
            VALUES (%s, 2024, %s, %s, '待处理', %s, '{}')
            """,
            (
                data["member_id"],
                data["assessment_id"],
                data["plan_id"],
                data["member_id"],
            ),
        )
    connection.rollback()
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM annual_plan_change_proposal"
        ).fetchone()[0]
        == 0
    )
    # 5. a legal subsequent assessment proposal still works
    second = connection.execute(
        """
        INSERT INTO assessment (member_id, year, version, assessment_type, status)
        VALUES (%s, 2024, 2, '年度', '已复核') RETURNING id
        """,
        (data["member_id"],),
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO annual_plan_change_proposal (
            member_id, year, source_assessment_id,
            target_annual_growth_plan_id, status, created_by, summary
        )
        VALUES (%s, 2024, %s, %s, '待处理', %s, '{}')
        """,
        (data["member_id"], second, data["plan_id"], data["member_id"]),
    )
    connection.commit()
    # 6. legacy data untouched
    row = connection.execute(
        "SELECT l3_code, priority FROM plan_item WHERE id=%s",
        (data["item_id"],),
    ).fetchone()
    assert row == ("P01-L1-L2-L3", "中")


def test_plan_source_drift_to_proposal_source_guarded_after_upgrade(
    pre_v0009_db: psycopg.Connection,
) -> None:
    """4th review: the plan-side guard closes the concurrent window — a plan
    with NULL provenance cannot later claim as its first source an assessment
    that an existing proposal of the same plan already uses."""
    connection = pre_v0009_db
    data = connection.legacy_data
    _run_runner(connection)
    # legal proposal on the legacy plan while its provenance is still NULL
    second = connection.execute(
        """
        INSERT INTO assessment (member_id, year, version, assessment_type, status)
        VALUES (%s, 2024, 2, '年度', '已复核') RETURNING id
        """,
        (data["member_id"],),
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO annual_plan_change_proposal (
            member_id, year, source_assessment_id,
            target_annual_growth_plan_id, status, created_by, summary
        )
        VALUES (%s, 2024, %s, %s, '待处理', %s, '{}')
        """,
        (data["member_id"], second, data["plan_id"], data["member_id"]),
    )
    connection.commit()
    # the plan may not later claim that same assessment as its first source
    with pytest.raises(psycopg.errors.RaiseException):
        connection.execute(
            "UPDATE annual_growth_plan SET source_assessment_id=%s WHERE id=%s",
            (second, data["plan_id"]),
        )
    connection.rollback()
    # the plan's provenance is still NULL and the proposal is untouched
    row = connection.execute(
        "SELECT source_assessment_id FROM annual_growth_plan WHERE id=%s",
        (data["plan_id"],),
    ).fetchone()
    assert row[0] is None
    row = connection.execute(
        "SELECT source_assessment_id, target_annual_growth_plan_id "
        "FROM annual_plan_change_proposal WHERE source_assessment_id=%s",
        (second,),
    ).fetchone()
    assert int(row[1]) == data["plan_id"]
