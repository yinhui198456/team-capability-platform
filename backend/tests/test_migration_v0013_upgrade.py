"""Issue #65: v0013 plan_item.growth_goal_id schema-alignment upgrade proof.

The assessment-approval domain path deliberately creates plan items without
a growth goal: the v0009 approval-completeness CHECK excludes
growth_goal_id, the approval INSERT writes NULL, and the fresh bootstrap
schema (planning/schema.py) already defines the column nullable.  Databases
upgraded from the pre-v0009 schema kept the legacy NOT NULL because no
migration dropped it — observed in UAT as an uncontrolled HTTP 500 on
Member-B first-assessment approval (the transaction rolled back atomically
with zero partial writes).

This fixture rebuilds the supported legacy → v0012 upgrade path from the
FROZEN pre-v0009 DDL dump (reused from the v0009 upgrade test) and proves
the drift exists on the baseline.  The production runner then applies
v0013 and every post-condition is verified: nullability parity with a
fresh-bootstrap database, populated growth_goal_id values plus the FK and
UNIQUE constraints preserved, idempotent re-run, and a full production
first-assessment approval on the upgraded database creating
assessment-approval plan items with NULL growth_goal_id — the exact UAT
Member-B shape.
"""

from collections.abc import Iterator

import psycopg
import pytest

from tests.conftest import ADMIN_DATABASE_URL
from tests.review_support import ReviewTestBase
from tests.test_migration_v0009_upgrade import (
    _SCHEMA_SQL,
    _drop_everything,
    _run_runner,
    _seed_legacy_data,
    _seed_schema_migration_v0001_v0008,
)

V0013_VERSION = "0013_plan_item_growth_goal_nullable"


def _run_until_v0013(connection: psycopg.Connection) -> None:
    """Apply every migration up to (excluding) v0013 — the supported
    legacy → v0012 upgrade path a pre-v0013 database followed."""
    from app.migrations.versions import MIGRATIONS

    with connection.transaction():
        applied = {
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migration"
            ).fetchall()
        }
        for version, upgrade in MIGRATIONS:
            if version in applied:
                continue
            if version >= V0013_VERSION:
                break
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )


@pytest.fixture
def pre_v0013_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A genuine v0012-upgraded database: frozen pre-v0009 DDL, seeded legacy
    data (including a growth-goal-linked plan item), migrations applied
    through v0012 — v0013 must not exist yet."""
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_schema_migration_v0001_v0008(connection)
    data = _seed_legacy_data(connection)
    # Complete the published standard matrix: the v0009 seed only carries a
    # P4 row per L3, while scope computation requires both the current and
    # the target job-level rows (P4→P5 member).  Real published versions
    # carry complete matrices; at v0008-era the immutability trigger does
    # not exist yet, so this mirrors a complete legacy publication.
    connection.execute(
        """
        INSERT INTO capability_standard_item (
            version_id, l1_code, l1_name, l2_code, l2_name, l3_code,
            l3_name, job_level, applicable, target_level, source,
            l3_node_id, updated_by, updated_at
        )
        VALUES (%s, 'P01-L1', '域一', 'P01-L1-L2', '模块一',
                'P01-L1-L2-L3', '能力一', 'P5', TRUE, 3, 'explicit',
                %s, %s, NOW())
        """,
        (data["published_version_id"], data["l3_node_id"], data["buddy_id"]),
    )
    _run_until_v0013(connection)
    versions = [
        row[0]
        for row in connection.execute("SELECT version FROM schema_migration").fetchall()
    ]
    assert "0012_team_analytics_indexes" in versions
    assert V0013_VERSION not in versions
    connection.commit()
    connection.legacy_data = data
    yield connection


def _growth_goal_nullable(connection: psycopg.Connection) -> str:
    row = connection.execute(
        """
        SELECT is_nullable FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'plan_item'
          AND column_name = 'growth_goal_id'
        """
    ).fetchone()
    assert row is not None
    return str(row[0])


def _applied_versions(connection: psycopg.Connection) -> list[str]:
    return [
        row[0]
        for row in connection.execute("SELECT version FROM schema_migration").fetchall()
    ]


def test_legacy_upgrade_path_keeps_obsolete_not_null(
    pre_v0013_db: psycopg.Connection,
) -> None:
    """Fixture sanity: the supported legacy → v0012 upgrade path really
    reproduces the upgraded-UAT shape — the obsolete NOT NULL is still
    present before v0013 (fresh bootstrap databases never had it)."""
    assert _growth_goal_nullable(pre_v0013_db) == "NO"


def test_v0013_nullability_matches_fresh_bootstrap(
    pre_v0013_db: psycopg.Connection,
) -> None:
    """After the production runner, the upgraded database must agree with a
    fresh-bootstrap database on plan_item.growth_goal_id nullability, and
    v0013 must be recorded in the migration ledger."""
    _run_runner(pre_v0013_db)
    assert V0013_VERSION in _applied_versions(pre_v0013_db)
    upgraded = _growth_goal_nullable(pre_v0013_db)

    fresh_db = "tcp_test_v0013_fresh"
    with psycopg.connect(ADMIN_DATABASE_URL, autocommit=True) as admin:
        admin.execute(f"DROP DATABASE IF EXISTS {fresh_db}")
        admin.execute(f"CREATE DATABASE {fresh_db}")
    try:
        fresh_url = ADMIN_DATABASE_URL.rsplit("/", 1)[0] + f"/{fresh_db}"
        with psycopg.connect(fresh_url) as fresh:
            from app.access.schema import create_access_schema
            from app.assessment.schema import create_assessment_schema
            from app.catalog.schema import create_catalog_schema
            from app.planning.schema import create_planning_schema

            create_access_schema(fresh)
            create_assessment_schema(fresh)
            create_catalog_schema(fresh)
            create_planning_schema(fresh)
            fresh.commit()
            bootstrap = _growth_goal_nullable(fresh)
    finally:
        with psycopg.connect(ADMIN_DATABASE_URL, autocommit=True) as admin:
            admin.execute(f"DROP DATABASE IF EXISTS {fresh_db}")
    assert bootstrap == "YES"
    assert upgraded == bootstrap


def test_v0013_preserves_populated_goal_and_constraints(
    pre_v0013_db: psycopg.Connection,
) -> None:
    """Schema alignment only: already-valid populated growth_goal_id values
    are unchanged, and the FK and UNIQUE constraints survive the upgrade."""
    data = pre_v0013_db.legacy_data
    before = pre_v0013_db.execute(
        "SELECT growth_goal_id FROM plan_item WHERE id=%s", (data["item_id"],)
    ).fetchone()
    assert before is not None and int(before[0]) == int(data["goal_id"])

    _run_runner(pre_v0013_db)
    assert V0013_VERSION in _applied_versions(pre_v0013_db)

    after = pre_v0013_db.execute(
        "SELECT growth_goal_id FROM plan_item WHERE id=%s", (data["item_id"],)
    ).fetchone()
    assert after == before
    constraints = {
        row[0]
        for row in pre_v0013_db.execute(
            "SELECT conname FROM pg_constraint "
            "WHERE conrelid = 'plan_item'::regclass"
        ).fetchall()
    }
    assert "plan_item_growth_goal_id_key" in constraints  # UNIQUE
    assert "plan_item_growth_goal_id_fkey" in constraints  # FK → growth_goal


def test_v0013_runner_rerun_idempotent(pre_v0013_db: psycopg.Connection) -> None:
    _run_runner(pre_v0013_db)
    _run_runner(pre_v0013_db)
    count = pre_v0013_db.execute(
        "SELECT COUNT(*) FROM schema_migration WHERE version=%s", (V0013_VERSION,)
    ).fetchone()
    assert count is not None and int(count[0]) == 1
    assert _growth_goal_nullable(pre_v0013_db) == "YES"


def test_first_assessment_approval_on_upgraded_database(
    pre_v0013_db: psycopg.Connection,
) -> None:
    """The UAT Member-B shape: on a database upgraded through the supported
    legacy path, a production first-assessment approval must atomically
    create the initial plan, one item (growth_goal_id NULL by domain
    design) and one task — never an uncontrolled NOT NULL violation.
    Duplicate approval stays rejected with zero duplicate rows, and the
    legacy growth-goal-linked item is untouched."""
    _run_runner(pre_v0013_db)
    data = pre_v0013_db.legacy_data
    member_id = int(data["member_id"])
    buddy_id = int(data["buddy_id"])
    base = ReviewTestBase()
    assessment_id = base.submit(
        pre_v0013_db,
        member_id,
        2026,
        [
            {
                "l3_code": "P01-L1-L2-L3",
                "current_level": 2,
                "target_level": 4,
                "member_priority": "高",
                "include_in_plan": True,
                "plan_quarter": "Q2",
                "plan_month": 5,
            }
        ],
    )
    result = base.approve(pre_v0013_db, assessment_id, buddy_id)
    assert result["assessment_status"] == "已归档"
    assert result["plan"]["items_created"] == 1
    assert result["plan"]["tasks_created"] == 1

    item = pre_v0013_db.execute(
        """
        SELECT growth_goal_id, planning_source_type FROM plan_item
        WHERE source_assessment_id=%s
        """,
        (assessment_id,),
    ).fetchone()
    assert item is not None
    assert item[0] is None  # assessment-approval items have no growth goal
    assert item[1] == "assessment_approval"
    task_count = pre_v0013_db.execute(
        """
        SELECT COUNT(*) FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.source_assessment_id=%s
        """,
        (assessment_id,),
    ).fetchone()
    assert task_count is not None and int(task_count[0]) == 1

    # Duplicate approval is rejected; nothing is duplicated.
    from app.assessment.repository import ReviewError, submit_assessment_review

    review_id = pre_v0013_db.execute(
        "SELECT id FROM assessment_review WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    with pytest.raises(ReviewError) as excinfo:
        submit_assessment_review(
            pre_v0013_db,
            int(review_id),
            buddy_id,
            "认可",
            "重复",
            expected_revision=3,
            assessment_id_from_url=assessment_id,
        )
    assert excinfo.value.code == "assessment_already_reviewed"
    plan_count = pre_v0013_db.execute(
        "SELECT COUNT(*) FROM annual_growth_plan WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan_count is not None and int(plan_count[0]) == 1

    # The legacy growth-goal-linked item survived the whole flow.
    legacy = pre_v0013_db.execute(
        "SELECT growth_goal_id FROM plan_item WHERE id=%s", (data["item_id"],)
    ).fetchone()
    assert legacy is not None and int(legacy[0]) == int(data["goal_id"])
