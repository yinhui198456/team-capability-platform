"""Issue #63: v0010 learning-execution upgrade proof.

Builds a genuine v0008-era database from the FROZEN pre-v0009 DDL dump
(reused from the v0009 upgrade test), runs the production runner through
v0009, seeds realistic legacy execution data (a ``待 Evidence Review`` task,
free-text completion_quality, a 0-hour log, multi-version evidence with a
closed review), then upgrades v0009 → v0010 and verifies every backfill,
constraint and idempotent re-run.
"""

from collections.abc import Iterator

import psycopg
import pytest

from tests.test_migration_v0009_upgrade import (
    _SCHEMA_SQL,
    _drop_everything,
    _run_runner,
    _seed_legacy_data,
    _seed_schema_migration_v0001_v0008,
)

V0010_VERSION = "0010_learning_execution"
LATEST_VERSION = "0015_plan_draft_pending_month"


def _run_until_v0009(connection: psycopg.Connection) -> None:
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
            if version >= V0010_VERSION:
                break
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )


@pytest.fixture
def pre_v0010_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A genuine v0009 database with legacy execution data seeded before v0010."""
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_schema_migration_v0001_v0008(connection)
    data = _seed_legacy_data(connection)
    _run_until_v0009(connection)  # v0009 only — v0010 must not exist yet
    assert V0010_VERSION not in [
        r[0]
        for r in connection.execute("SELECT version FROM schema_migration").fetchall()
    ]
    _seed_v0010_legacy_data(connection, data)
    connection.commit()
    connection.legacy_data = data
    yield connection


def _seed_v0010_legacy_data(
    connection: psycopg.Connection, data: dict[str, int]
) -> None:
    member_id = int(data["member_id"])
    plan_id = int(data["plan_id"])
    assessment_id = int(data["assessment_id"])
    # A second legacy plan item + task with the to-be-removed status, free-text
    # completion_quality, no plan dates and a legacy target_month.
    gap2 = connection.execute(
        """
        INSERT INTO gap (assessment_id, l3_code, current_level, target_level,
                         gap_value, priority, plan_candidate)
        VALUES (%s, 'P01-L1-L2-L4', 2, 3, 1, '高', TRUE)
        RETURNING id
        """,
        (assessment_id,),
    ).fetchone()
    goal2 = connection.execute(
        """
        INSERT INTO growth_goal (gap_id, annual_growth_plan_id, l3_code, year,
                                 target_level, priority)
        VALUES (%s, %s, 'P01-L1-L2-L4', 2024, 3, '高')
        RETURNING id
        """,
        (int(gap2[0]), plan_id),
    ).fetchone()
    item2 = connection.execute(
        """
        INSERT INTO plan_item (annual_growth_plan_id, growth_goal_id, l3_code,
                               current_level, target_level, priority,
                               target_month)
        VALUES (%s, %s, 'P01-L1-L2-L4', 2, 3, '高', 5)
        RETURNING id
        """,
        (plan_id, int(goal2[0])),
    ).fetchone()
    item2_id = int(item2[0])
    task2 = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status,
                                   completion_quality, review_conclusion,
                                   next_action)
        VALUES (%s, 'P01-L1-L2-L4', '待 Evidence Review', '自由文本旧值',
                '旧复盘', '旧下步')
        RETURNING id
        """,
        (item2_id,),
    ).fetchone()
    task2_id = int(task2[0])
    data["item2_id"] = item2_id
    data["task2_id"] = task2_id

    # A December item/task: the month-end backfill must survive month=12.
    gap3 = connection.execute(
        """
        INSERT INTO gap (assessment_id, l3_code, current_level, target_level,
                         gap_value, priority, plan_candidate)
        VALUES (%s, 'P01-L1-L2-L5', 1, 3, 2, '中', TRUE)
        RETURNING id
        """,
        (assessment_id,),
    ).fetchone()
    goal3 = connection.execute(
        """
        INSERT INTO growth_goal (gap_id, annual_growth_plan_id, l3_code, year,
                                 target_level, priority)
        VALUES (%s, %s, 'P01-L1-L2-L5', 2024, 3, '中')
        RETURNING id
        """,
        (int(gap3[0]), plan_id),
    ).fetchone()
    item3 = connection.execute(
        """
        INSERT INTO plan_item (annual_growth_plan_id, growth_goal_id, l3_code,
                               current_level, target_level, priority,
                               target_month)
        VALUES (%s, %s, 'P01-L1-L2-L5', 1, 3, '中', 12)
        RETURNING id
        """,
        (plan_id, int(goal3[0])),
    ).fetchone()
    item3_id = int(item3[0])
    task3 = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status,
                                   completion_quality, review_conclusion,
                                   next_action)
        VALUES (%s, 'P01-L1-L2-L5', '未开始', '十二月历史质量',
                '旧复盘二', '旧下步二')
        RETURNING id
        """,
        (item3_id,),
    ).fetchone()
    data["item3_id"] = int(item3[0])
    data["task3_id"] = int(task3[0])
    connection.execute(
        """
        INSERT INTO learning_progress_log (task_id, record_date, actual_hours,
                                           note, recorder_id)
        VALUES (%s, '2024-05-10', 0, '旧零小时日志', %s)
        """,
        (task2_id, member_id),
    )
    # Legacy evidence versions + one closed review — must survive untouched.
    for version_number, status in ((1, "待 Review"), (2, "草稿")):
        connection.execute(
            """
            INSERT INTO evidence (learning_task_id, l3_code, version_number,
                                  content, evidence_link, status, submitted_at)
            VALUES (%s, 'P01-L1-L2-L4', %s, '旧证据', 'http://legacy',
                    %s, NOW())
            """,
            (task2_id, version_number, status),
        )
    evidence_id = connection.execute(
        "SELECT id FROM evidence WHERE learning_task_id=%s AND version_number=1",
        (task2_id,),
    ).fetchone()[0]
    connection.execute(
        """
        INSERT INTO evidence_review (evidence_id, buddy_id, status, conclusion,
                                     feedback, reviewed_at)
        VALUES (%s, %s, '已闭环', '通过', '历史评审', NOW())
        """,
        (evidence_id, data["buddy_id"]),
    )


def _status_check_exists(connection: psycopg.Connection) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'learning_task'::regclass
          AND conname = 'learning_task_status_check'
          AND pg_get_constraintdef(oid) NOT LIKE '%待 Evidence Review%'
        """
    ).fetchone()
    return row is not None


def test_v0010_upgrades_real_v0009_database(
    pre_v0010_db: psycopg.Connection,
) -> None:
    connection = pre_v0010_db
    data = connection.legacy_data
    item2_id = int(data["item2_id"])
    task2_id = int(data["task2_id"])

    _run_runner(connection)  # v0009 → v0010

    # Task status backfill + new columns.
    task = connection.execute(
        """
        SELECT status, completion_quality, revision, actual_started_at,
               actual_completed_at, delay_reason, pause_reason, cancel_reason,
               revised_due_date
        FROM learning_task WHERE id = %s
        """,
        (task2_id,),
    ).fetchone()
    assert task[0] == "进行中"  # legacy 待 Evidence Review backfilled
    assert task[1] is None  # legacy free-text quality moved to legacy column
    assert task[2] == 0  # revision default
    assert task[3:] == (None, None, None, None, None, None)

    # Legacy free-text quality is preserved losslessly in the legacy column.
    legacy_quality = connection.execute(
        "SELECT completion_quality_legacy FROM learning_task WHERE id = %s",
        (task2_id,),
    ).fetchone()[0]
    assert legacy_quality == "自由文本旧值"

    # Legacy completed task stays untouched.
    completed = connection.execute(
        "SELECT status, completion_quality FROM learning_task "
        "WHERE plan_item_id = %s",
        (data["item_id"],),
    ).fetchone()
    assert completed[0] == "已完成"
    assert completed[1] is None

    # 0-hour log backfilled to 1 with a visible marker.
    log = connection.execute(
        """
        SELECT actual_hours, note, created_at, invalidated_at, invalidated_by,
               correction_of_log_id, idempotency_key
        FROM learning_progress_log
        WHERE task_id = %s
        """,
        (task2_id,),
    ).fetchone()
    assert log[0] == 1
    assert "backfilled" in log[1]
    assert log[2] is not None

    # Legacy evidence versions + closed review survive untouched.
    evidences = connection.execute(
        "SELECT version_number, status FROM evidence "
        "WHERE learning_task_id=%s ORDER BY version_number",
        (task2_id,),
    ).fetchall()
    assert [(r[0], r[1]) for r in evidences] == [(1, "待 Review"), (2, "草稿")]
    review = connection.execute(
        "SELECT status, conclusion, feedback FROM evidence_review"
    ).fetchone()
    assert review == ("已闭环", "通过", "历史评审")

    # Plan dates backfilled from legacy target_month (2024-05).
    dates = connection.execute(
        "SELECT plan_start_date, plan_end_date FROM plan_item WHERE id=%s",
        (item2_id,),
    ).fetchone()
    assert str(dates[0]) == "2024-05-01"
    assert str(dates[1]) == "2024-05-31"

    # Transition history exists and is empty for legacy data.
    assert (
        connection.execute("SELECT COUNT(*) FROM task_transition_history").fetchone()[0]
        == 0
    )


def test_v0010_constraints_are_enforced(
    pre_v0010_db: psycopg.Connection,
) -> None:
    connection = pre_v0010_db
    data = connection.legacy_data
    _run_runner(connection)

    def _expect_check_violation(statement: str, params: tuple[object, ...]) -> None:
        try:
            connection.execute(statement, params)
        except psycopg.errors.CheckViolation:
            connection.rollback()
            return
        connection.rollback()
        raise AssertionError(f"expected CheckViolation for: {statement}")

    _expect_check_violation(
        "UPDATE learning_task SET status = '待 Evidence Review' WHERE id = %s",
        (data["task2_id"],),
    )
    _expect_check_violation(
        "UPDATE learning_task SET completion_quality = '未知质量' WHERE id = %s",
        (data["task2_id"],),
    )
    _expect_check_violation(
        "INSERT INTO learning_progress_log "
        "(task_id, record_date, actual_hours, note, recorder_id) "
        "VALUES (%s, '2024-05-11', 0, 'x', %s)",
        (data["task2_id"], data["member_id"]),
    )
    # Illegal plan date order rejected.
    _expect_check_violation(
        "UPDATE plan_item SET plan_start_date='2024-06-01', "
        "plan_end_date='2024-05-01' WHERE id=%s",
        (data["item2_id"],),
    )


def test_v0010_december_dates_and_legacy_quality_are_preserved(
    pre_v0010_db: psycopg.Connection,
) -> None:
    """P1: month=12 must backfill 12-01/12-31 (cross-year-safe month end) and
    legacy free-text completion_quality must stay readable losslessly."""
    connection = pre_v0010_db
    data = connection.legacy_data
    _run_runner(connection)

    dates = connection.execute(
        "SELECT plan_start_date, plan_end_date FROM plan_item WHERE id=%s",
        (data["item3_id"],),
    ).fetchone()
    assert str(dates[0]) == "2024-12-01"
    assert str(dates[1]) == "2024-12-31"

    task3 = connection.execute(
        """
        SELECT completion_quality, completion_quality_legacy
        FROM learning_task WHERE id = %s
        """,
        (data["task3_id"],),
    ).fetchone()
    assert task3[0] is None
    assert task3[1] == "十二月历史质量"

    # Re-run stays idempotent with the legacy column in place.
    _run_runner(connection)
    task3_again = connection.execute(
        """
        SELECT completion_quality, completion_quality_legacy
        FROM learning_task WHERE id = %s
        """,
        (data["task3_id"],),
    ).fetchone()
    assert task3_again[1] == "十二月历史质量"


def test_v0010_rerun_is_idempotent(
    pre_v0010_db: psycopg.Connection,
) -> None:
    connection = pre_v0010_db
    _run_runner(connection)
    _run_runner(connection)  # second pass — no-op
    versions = [
        r[0]
        for r in connection.execute(
            "SELECT version FROM schema_migration ORDER BY version"
        ).fetchall()
    ]
    assert versions[-1] == LATEST_VERSION
    assert len(versions) == len(set(versions))
    assert _status_check_exists(connection)


def test_v0010_fresh_install_reaches_all_versions(
    connection: psycopg.Connection,
) -> None:
    from app.access.schema import create_access_schema
    from app.assessment.schema import create_assessment_schema
    from app.catalog.schema import create_catalog_schema
    from app.planning.schema import create_planning_schema

    for fn in (
        create_access_schema,
        create_catalog_schema,
        create_assessment_schema,
        create_planning_schema,
    ):
        fn(connection)
    _run_runner(connection)
    versions = [
        r[0]
        for r in connection.execute(
            "SELECT version FROM schema_migration ORDER BY version"
        ).fetchall()
    ]
    assert versions[-1] == LATEST_VERSION
    assert len(versions) == 15
    # Helper schema and migration agree on the tightened status dictionary.
    assert _status_check_exists(connection)
