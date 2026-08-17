"""Issue #194: v0015 plan_month INT → TEXT 'YYYY-MM' upgrade proof.

Contract upgrade (docs/01_Product.md §"Issue #187 故事合同"): plan_month 的
canonical 值升级为 TEXT 'YYYY-MM'（单一月份输入），plan_quarter 成为由
plan_month 推导的兼容列（一致性约束保护，不接受前端输入）。三张表同步：
assessment_detail / plan_item / annual_plan_change_proposal_detail。

转换规则：旧 INT 仅可用所属 assessment / annual_growth_plan / change_proposal
的明确 year 确定性转换（'YYYY-MM'）；NULL 保持 NULL；无法确定（属主缺失）则
loud fail，绝不伪造。同时：
- 删除 plan_time_required（include_in_plan=TRUE 且 plan_month NULL = 待补月份，合法）；
- 新增 plan_month 格式 CHECK（^[0-9]{4}-(0[1-9]|1[0-2])$）；
- 新增 plan_quarter 一致性 CHECK（有 month 时 quarter 必须等于派生值）；
- 不删除 plan_quarter 列、不回填历史业务对象。

覆盖：upgrade / fresh / idempotency / non-target preservation。
"""

from collections.abc import Iterator

import psycopg
import pytest

from app.migrations.runner import run_migrations
from app.migrations.versions import MIGRATIONS
from tests.conftest import (
    TEST_DATABASE_URL,
    _clear_assessment,
    _clear_catalog,
)

V0015_VERSION = "0015_plan_month_text"

PLAN_MONTH_TABLES = (
    "assessment_detail",
    "plan_item",
    "annual_plan_change_proposal_detail",
)


def _bootstrap(connection: psycopg.Connection, *, through_v0014: bool) -> None:
    """Create all schemas + catalog, apply migrations up to (but not
    including) v0015 when through_v0014, else the full chain."""
    from app.access.schema import create_access_schema
    from app.assessment.schema import create_assessment_schema
    from app.catalog.importer import import_catalog, resolve_workbook_dir
    from app.planning.schema import create_planning_schema

    create_access_schema(connection)
    create_assessment_schema(connection)
    import_catalog(resolve_workbook_dir(), connection)
    create_planning_schema(connection)
    connection.commit()

    if through_v0014:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migration (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        for version, upgrade in MIGRATIONS:
            if version == V0015_VERSION:
                continue
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )
    else:
        run_migrations(connection)
    connection.commit()


def _ensure_migration_user(connection: psycopg.Connection) -> int:
    from app.access.repository import assign_role, create_user

    row = connection.execute(
        "SELECT id FROM tcp_user WHERE username = 'migration_test'"
    ).fetchone()
    if row is None:
        user_id = create_user(connection, "migration_test", "migration_test", "secret")
        assign_role(connection, user_id, "Member")
        connection.commit()
        row = connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'migration_test'"
        ).fetchone()
    user_id = int(row[0])
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P8' "
        "WHERE id = %s",
        (user_id,),
    )
    connection.commit()
    return user_id


def _seed_legacy_rows(connection: psycopg.Connection, user_id: int) -> dict[str, int]:
    """Seed pre-v0015 rows in the old INT contract: detail + plan_item +
    proposal_detail all carry plan_month=7 / plan_quarter='Q3'."""
    from tests.standard_target_support import create_scoped_draft

    connection.execute(
        "UPDATE capability_node SET enabled = "
        "(code IN ('C01.01.01', 'C01.01.02')) "
        "WHERE node_type = 'L3'"
    )
    connection.commit()
    assessment_id = create_scoped_draft(connection, user_id, 2026)
    l3_code = "C01.01.01"
    detail = connection.execute(
        "SELECT l3_code FROM assessment_detail "
        "WHERE assessment_id = %s AND l3_code = %s",
        (assessment_id, l3_code),
    ).fetchone()
    assert detail is not None, "scoped draft must include C01.01.01"

    # Old contract: include_in_plan=TRUE requires quarter+month both set.
    connection.execute(
        "UPDATE assessment_detail SET include_in_plan = TRUE, "
        "plan_quarter = 'Q3', plan_month = 7, current_level = 2, "
        "member_priority = '高' "
        "WHERE assessment_id = %s AND l3_code = %s",
        (assessment_id, l3_code),
    )
    # NULL preservation row: another detail stays not-in-plan, month NULL.
    connection.execute(
        "UPDATE assessment_detail SET include_in_plan = FALSE, "
        "plan_quarter = NULL, plan_month = NULL "
        "WHERE assessment_id = %s AND l3_code != %s",
        (assessment_id, l3_code),
    )
    connection.commit()

    plan_id = connection.execute(
        "INSERT INTO annual_growth_plan (member_id, year, status, "
        "source_assessment_id, planning_source_type) "
        "VALUES (%s, %s, '执行中', %s, 'assessment_approval') RETURNING id",
        (user_id, 2026, assessment_id),
    ).fetchone()[0]

    # Full frozen-source snapshot columns, mirroring the real generation
    # path (_insert_plan_item_and_task) so plan_item_approval_completeness
    # holds on the pre-v0015 state.
    plan_item_id = connection.execute(
        """
        INSERT INTO plan_item (
            annual_growth_plan_id, l3_code, current_level, target_level,
            priority, source_assessment_id, source_assessment_detail_id,
            capability_standard_version_id, planning_snapshot_id, l3_node_id,
            l1_code, l1_name, l2_code, l2_name, l3_name, scope_type,
            standard_target_level, adjusted_target_level,
            effective_target_level, standard_job_level_snapshot,
            member_current_level_snapshot, member_target_level_snapshot,
            plan_quarter, plan_month, planning_source_type,
            assessment_revision, gap_value, include_in_plan
        )
        SELECT
            %s, ad.l3_code, ad.current_level,
            COALESCE(ad.adjusted_target_level, ad.standard_target_level),
            ad.member_priority, a.id, ad.id, a.capability_standard_version_id,
            s.id, ad.l3_node_id, ad.l1_code, ad.l1_name, ad.l2_code, ad.l2_name,
            ad.l3_name, ad.scope_type, ad.standard_target_level,
            ad.adjusted_target_level,
            COALESCE(ad.adjusted_target_level, ad.standard_target_level),
            ad.standard_job_level_snapshot, a.member_current_level_snapshot,
            a.member_target_level_snapshot, 'Q3', 7, 'assessment_approval',
            a.version, COALESCE(ad.gap_value, 3), TRUE
        FROM assessment_detail ad
        JOIN assessment a ON a.id = ad.assessment_id
        LEFT JOIN capability_standard_planning_snapshot s
            ON s.capability_standard_version_id = a.capability_standard_version_id
               AND s.l3_node_id = ad.l3_node_id
        WHERE ad.assessment_id = %s AND ad.l3_code = %s
        RETURNING id
        """,
        (int(plan_id), assessment_id, l3_code),
    ).fetchone()[0]
    connection.commit()

    # A change proposal's source must NOT be the target plan's first source
    # assessment (v0009 trigger guard): use a second assessment (年中更新).
    second_assessment_id = create_scoped_draft(connection, user_id, 2026, "年中更新")
    second_code = connection.execute(
        "SELECT l3_code FROM assessment_detail "
        "WHERE assessment_id = %s ORDER BY l3_code LIMIT 1",
        (second_assessment_id,),
    ).fetchone()[0]
    connection.execute(
        "UPDATE assessment_detail SET include_in_plan = TRUE, "
        "plan_quarter = 'Q3', plan_month = 7, current_level = 2, "
        "member_priority = '高' "
        "WHERE assessment_id = %s AND l3_code = %s",
        (second_assessment_id, second_code),
    )
    connection.commit()
    proposal_id = connection.execute(
        "INSERT INTO annual_plan_change_proposal (member_id, year, "
        "source_assessment_id, target_annual_growth_plan_id, status, "
        "created_by, summary) "
        "VALUES (%s, %s, %s, %s, '待处理', %s, '{}'::jsonb) RETURNING id",
        (user_id, 2026, second_assessment_id, int(plan_id), user_id),
    ).fetchone()[0]
    # Mirror _approve_with_proposal's snapshot columns so
    # proposal_detail_approval_completeness holds pre-v0015.
    proposal_detail_id = connection.execute(
        """
        INSERT INTO annual_plan_change_proposal_detail (
            proposal_id, source_assessment_detail_id, assessment_id,
            l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
            l3_name, scope_type, current_level, standard_target_level,
            adjusted_target_level, effective_target_level, gap_value,
            member_priority, include_in_plan, plan_quarter, plan_month,
            standard_job_level_snapshot, member_current_level_snapshot,
            member_target_level_snapshot, capability_standard_version_id,
            planning_snapshot_id, assessment_revision
        )
        SELECT
            p.id, ad.id, ad.assessment_id, ad.l3_node_id, ad.l1_code,
            ad.l1_name, ad.l2_code, ad.l2_name, ad.l3_code, ad.l3_name,
            ad.scope_type, ad.current_level, ad.standard_target_level,
            ad.adjusted_target_level,
            COALESCE(ad.adjusted_target_level, ad.standard_target_level),
            COALESCE(ad.gap_value, 3), ad.member_priority, TRUE,
            'Q3', 7, ad.standard_job_level_snapshot,
            a.member_current_level_snapshot, a.member_target_level_snapshot,
            a.capability_standard_version_id, s.id, a.version
        FROM annual_plan_change_proposal p
        JOIN assessment a ON a.id = p.source_assessment_id
        JOIN assessment_detail ad
             ON ad.assessment_id = a.id AND ad.l3_code = %s
        LEFT JOIN capability_standard_planning_snapshot s
            ON s.capability_standard_version_id = a.capability_standard_version_id
               AND s.l3_node_id = ad.l3_node_id
        WHERE p.id = %s
        RETURNING id
        """,
        (second_code, int(proposal_id)),
    ).fetchone()[0]
    connection.commit()
    return {
        "assessment_id": int(assessment_id),
        "plan_id": int(plan_id),
        "plan_item_id": int(plan_item_id),
        "proposal_id": int(proposal_id),
        "proposal_detail_id": int(proposal_detail_id),
        "user_id": user_id,
        "l3_code": l3_code,
    }


@pytest.fixture(scope="module")
def upgrade_db() -> Iterator[psycopg.Connection]:
    """Schema + migrations up to v0014, seeded with legacy INT rows."""
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()
        _bootstrap(connection, through_v0014=True)
        user_id = _ensure_migration_user(connection)
        connection._seed = _seed_legacy_rows(connection, user_id)
        yield connection
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()


def _plan_month_type(connection: psycopg.Connection, table: str) -> str:
    row = connection.execute(
        "SELECT data_type FROM information_schema.columns "
        "WHERE table_name = %s AND column_name = 'plan_month'",
        (table,),
    ).fetchone()
    assert row is not None, f"plan_month column missing on {table}"
    return row[0]


def _constraint_names(connection: psycopg.Connection, table: str) -> set[str]:
    rows = connection.execute(
        "SELECT conname FROM pg_constraint " "WHERE conrelid = %s::regclass",
        (table,),
    ).fetchall()
    return {r[0] for r in rows}


def test_pre_v0015_database_really_uses_int_month(
    upgrade_db: psycopg.Connection,
) -> None:
    """Red evidence: before v0015, plan_month is INT on all three tables and
    the old plan_time_required CHECK is present."""
    for table in PLAN_MONTH_TABLES:
        assert _plan_month_type(upgrade_db, table) == "integer"
    names = _constraint_names(upgrade_db, "assessment_detail")
    assert "assessment_detail_plan_time_required" in names
    # Release the snapshot locks so the fresh-chain test (own connection)
    # is not blocked by this module-scoped connection's open transaction.
    upgrade_db.commit()


def test_upgrade_converts_to_text_yyyy_mm(
    upgrade_db: psycopg.Connection,
) -> None:
    """v0015: INT → TEXT 'YYYY-MM' derived from the owner's explicit year;
    NULL stays NULL; quarter kept as derived compat value."""
    run_migrations(upgrade_db)
    upgrade_db.commit()

    for table in PLAN_MONTH_TABLES:
        assert _plan_month_type(upgrade_db, table) == "text"

    seed = upgrade_db._seed
    # assessment_detail: year 2026 + month 7 → '2026-07'; quarter 'Q3' intact.
    row = upgrade_db.execute(
        "SELECT plan_month, plan_quarter FROM assessment_detail "
        "WHERE assessment_id = %s AND l3_code = %s",
        (seed["assessment_id"], seed["l3_code"]),
    ).fetchone()
    assert row[0] == "2026-07", f"detail conversion wrong: {row[0]!r}"
    assert row[1] == "Q3"

    # NULL preserved on the not-in-plan detail.
    row = upgrade_db.execute(
        "SELECT COUNT(*) FROM assessment_detail "
        "WHERE assessment_id = %s AND plan_month IS NULL AND plan_quarter IS NULL",
        (seed["assessment_id"],),
    ).fetchone()
    assert row[0] >= 1, "NULL plan_month must stay NULL"

    # plan_item + proposal_detail converted from the same 2026 owner year.
    row = upgrade_db.execute(
        "SELECT plan_month, plan_quarter FROM plan_item WHERE id = %s",
        (seed["plan_item_id"],),
    ).fetchone()
    assert row[0] == "2026-07" and row[1] == "Q3"
    row = upgrade_db.execute(
        "SELECT plan_month FROM annual_plan_change_proposal_detail " "WHERE id = %s",
        (seed["proposal_detail_id"],),
    ).fetchone()
    assert row[0] == "2026-07"

    # Constraints replaced: format + quarter consistency in, plan_time_required out.
    detail_constraints = _constraint_names(upgrade_db, "assessment_detail")
    assert "assessment_detail_plan_time_required" not in detail_constraints
    assert any("plan_month_format" in n for n in detail_constraints)
    assert any("plan_quarter_matches_month" in n for n in detail_constraints)
    plan_item_constraints = _constraint_names(upgrade_db, "plan_item")
    assert any("plan_month_format" in n for n in plan_item_constraints)
    assert any("plan_quarter_matches_month" in n for n in plan_item_constraints)
    proposal_constraints = _constraint_names(
        upgrade_db, "annual_plan_change_proposal_detail"
    )
    assert any("plan_month_format" in n for n in proposal_constraints)
    assert any("plan_quarter_matches_month" in n for n in proposal_constraints)


def test_upgrade_idempotent_and_ledger_once(
    upgrade_db: psycopg.Connection,
) -> None:
    """Re-running the runner is a no-op: single ledger row, data unchanged."""
    run_migrations(upgrade_db)
    run_migrations(upgrade_db)
    upgrade_db.commit()
    rows = upgrade_db.execute(
        "SELECT COUNT(*) FROM schema_migration WHERE version = %s",
        (V0015_VERSION,),
    ).fetchone()
    assert rows[0] == 1
    seed = upgrade_db._seed
    row = upgrade_db.execute(
        "SELECT plan_month FROM assessment_detail WHERE assessment_id = %s "
        "AND l3_code = %s",
        (seed["assessment_id"], seed["l3_code"]),
    ).fetchone()
    assert row[0] == "2026-07", "idempotent rerun must not change data"


def test_upgrade_non_target_preserved(upgrade_db: psycopg.Connection) -> None:
    """Columns/rows outside the declared scope are untouched."""
    seed = upgrade_db._seed
    row = upgrade_db.execute(
        "SELECT current_level, member_priority, include_in_plan, target_adjusted "
        "FROM assessment_detail WHERE assessment_id = %s AND l3_code = %s",
        (seed["assessment_id"], seed["l3_code"]),
    ).fetchone()
    assert row[0] == 2 and row[1] == "高" and row[2] is True
    row = upgrade_db.execute(
        "SELECT target_month FROM plan_item WHERE id = %s",
        (seed["plan_item_id"],),
    ).fetchone()
    assert row[0] is None, "target_month is out of scope and must stay INT NULL"
    row = upgrade_db.execute(
        "SELECT year, status FROM assessment WHERE id = %s",
        (seed["assessment_id"],),
    ).fetchone()
    assert row[0] == 2026 and row[1] == "草稿"
    # plan_quarter column still exists (compat, not deleted).
    row = upgrade_db.execute(
        "SELECT COUNT(*) FROM information_schema.columns "
        "WHERE table_name = 'assessment_detail' AND column_name = 'plan_quarter'"
    ).fetchone()
    assert row[0] == 1
    # Release snapshot locks before the fresh-chain test (own connection).
    upgrade_db.commit()


def test_fresh_chain_yields_text_plan_month() -> None:
    """Fresh path: the full migration chain on an empty database."""
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()
        _bootstrap(connection, through_v0014=False)
        for table in PLAN_MONTH_TABLES:
            assert _plan_month_type(connection, table) == "text"
        detail_constraints = _constraint_names(connection, "assessment_detail")
        assert "assessment_detail_plan_time_required" not in detail_constraints
        # v0015 registered exactly once in the fresh ledger.
        rows = connection.execute(
            "SELECT COUNT(*) FROM schema_migration WHERE version = %s",
            (V0015_VERSION,),
        ).fetchone()
        assert rows[0] == 1
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()
