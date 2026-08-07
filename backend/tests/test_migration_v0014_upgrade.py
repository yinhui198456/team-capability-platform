"""Issue #65: v0014 evidence archive backfill upgrade proof.

Commit ef404a5 added atomic archiving (通过 → 已归档) when a task
transitions to 已完成.  Databases that already had completed tasks
with 通过 evidence before that commit will never re-trigger the
transition, leaving Member/Buddy/Profile/analytics views inconsistent.

This migration is a pure forward data alignment:
  UPDATE evidence SET status = '已归档'
  WHERE learning_task_id IN (SELECT id FROM learning_task WHERE status = '已完成')
    AND status = '通过'

Non-completed tasks (进行中/延期/未开始/暂停/取消) and non-通过 evidence
(草稿/待 Review/需补充/驳回/已归档) are untouched.
"""

from collections.abc import Iterator

import psycopg
import pytest

from tests.test_migration_v0009_upgrade import _run_runner

V0014_VERSION = "0014_evidence_archive_backfill"


def _bootstrap(connection: psycopg.Connection) -> None:
    """One-time: create all schemas, a test user, run all migrations,
    then remove v0014 from the ledger."""
    from app.access.schema import create_access_schema
    from app.assessment.schema import create_assessment_schema
    from app.catalog.schema import create_catalog_schema
    from app.planning.schema import create_planning_schema

    create_access_schema(connection)
    create_assessment_schema(connection)
    create_catalog_schema(connection)
    create_planning_schema(connection)
    connection.commit()

    # Ensure a test user exists (FK target for annual_growth_plan.member_id).
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
    connection._test_user_id = row[0]

    from app.migrations.runner import run_migrations

    run_migrations(connection)
    connection.commit()

    connection.execute(
        "DELETE FROM schema_migration WHERE version = %s",
        (V0014_VERSION,),
    )
    connection.commit()


_seed_counter = 0


def _seed_completed_task_evidence(
    connection: psycopg.Connection,
    task_status: str,
    evidence_status: str,
) -> tuple[int, int]:
    """Insert a minimal task + evidence row directly, returning (task_id, ev_id)."""
    global _seed_counter
    _seed_counter += 1
    tag = f"P01-L2A-T{_seed_counter}"
    l3_code = f"P01-L2A-L3{chr(64 + _seed_counter)}"  # L3A, L3B, ...

    member_id = connection._test_user_id
    plan = connection.execute(
        """
        INSERT INTO annual_growth_plan (member_id, year)
        VALUES (%s, 2026)
        ON CONFLICT DO NOTHING
        RETURNING id
        """,
        (member_id,),
    ).fetchone()
    if plan is None:
        plan = connection.execute(
            "SELECT id FROM annual_growth_plan WHERE member_id = %s AND year = 2026",
            (member_id,),
        ).fetchone()
    plan_id = plan[0]

    item = connection.execute(
        """
        INSERT INTO plan_item (
            annual_growth_plan_id, l3_code, l3_name,
            l1_code, l1_name, l2_code, l2_name,
            current_level, target_level, priority,
            plan_start_date, plan_end_date, status
        ) VALUES (%s, %s, %s,
                  'P01', 'domain', 'P01-L2A', 'item',
                  2, 3, '中',
                  '2026-01-01', '2026-12-31', %s)
        RETURNING id
        """,
        (plan_id, l3_code, tag, task_status),
    ).fetchone()
    item_id = item[0]

    task = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, %s)
        RETURNING id
        """,
        (item_id, l3_code, task_status),
    ).fetchone()
    task_id = task[0]

    ev = connection.execute(
        """
        INSERT INTO evidence (
            learning_task_id, l3_code, version_number, status,
            content, evidence_link
        ) VALUES (%s, %s, 1, %s, 'test', 'http://x')
        RETURNING id
        """,
        (task_id, l3_code, evidence_status),
    ).fetchone()
    connection.commit()
    return task_id, ev[0]


@pytest.fixture
def pre_v0014_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A database with v0001–v0013 and a completed task + 通过 evidence,
    but v0014 NOT applied."""
    _bootstrap(connection)

    task_id, ev_id = _seed_completed_task_evidence(connection, "已完成", "通过")
    connection.evidence_id = ev_id
    connection.task_id = task_id

    yield connection


# ---------------------------------------------------------------------------
# Red: pre-v0014, completed-task 通过 evidence is NOT archived
# ---------------------------------------------------------------------------


def test_historical_evidence_not_archived_before_v0014(
    pre_v0014_db: psycopg.Connection,
) -> None:
    """Red condition: a completed task's 通过 evidence is stuck."""
    row = pre_v0014_db.execute(
        "SELECT status FROM evidence WHERE id = %s",
        (pre_v0014_db.evidence_id,),
    ).fetchone()
    assert row is not None
    assert row[0] == "通过", f"expected 通过 (pre-v0014), got {row[0]}"

    task_row = pre_v0014_db.execute(
        "SELECT status FROM learning_task WHERE id = %s",
        (pre_v0014_db.task_id,),
    ).fetchone()
    assert task_row is not None
    assert task_row[0] == "已完成"


# ---------------------------------------------------------------------------
# Green: v0014 archives the historical record
# ---------------------------------------------------------------------------


def test_v0014_archives_historical_completed_task_evidence(
    pre_v0014_db: psycopg.Connection,
) -> None:
    """After the migration, the historical 通过 evidence is 已归档."""
    _run_runner(pre_v0014_db)

    row = pre_v0014_db.execute(
        "SELECT status FROM evidence WHERE id = %s",
        (pre_v0014_db.evidence_id,),
    ).fetchone()
    assert row is not None
    assert row[0] == "已归档", f"expected 已归档 after v0014, got {row[0]}"

    assert V0014_VERSION in [
        r[0]
        for r in pre_v0014_db.execute("SELECT version FROM schema_migration").fetchall()
    ]


def test_v0014_preserves_non_completed_task_evidence(
    pre_v0014_db: psycopg.Connection,
) -> None:
    """Evidence for non-completed tasks is untouched."""
    # Seed a second task (进行中) with 通过 evidence.
    task2_id, ev2_id = _seed_completed_task_evidence(pre_v0014_db, "进行中", "通过")

    # v0014 may have been applied by prior test — ensure it's removed.
    pre_v0014_db.execute(
        "DELETE FROM schema_migration WHERE version = %s",
        (V0014_VERSION,),
    )
    pre_v0014_db.commit()

    _run_runner(pre_v0014_db)

    # 进行中 task's 通过 evidence must NOT be archived.
    row = pre_v0014_db.execute(
        "SELECT status FROM evidence WHERE id = %s", (ev2_id,)
    ).fetchone()
    assert row[0] == "通过", f"non-completed task evidence must stay 通过, got {row[0]}"

    # Completed task's evidence IS archived.
    row = pre_v0014_db.execute(
        "SELECT status FROM evidence WHERE id = %s",
        (pre_v0014_db.evidence_id,),
    ).fetchone()
    assert row[0] == "已归档"


def test_v0014_runner_rerun_idempotent(
    pre_v0014_db: psycopg.Connection,
) -> None:
    _run_runner(pre_v0014_db)
    _run_runner(pre_v0014_db)
    count = pre_v0014_db.execute(
        "SELECT COUNT(*) FROM schema_migration WHERE version = %s",
        (V0014_VERSION,),
    ).fetchone()
    assert count is not None and int(count[0]) == 1
    row = pre_v0014_db.execute(
        "SELECT status FROM evidence WHERE id = %s",
        (pre_v0014_db.evidence_id,),
    ).fetchone()
    assert row[0] == "已归档"


def test_v0014_preserves_non_hit_statuses(
    pre_v0014_db: psycopg.Connection,
) -> None:
    """Draft, 待 Review, 需补充, 驳回, 已归档 are untouched."""
    conn = pre_v0014_db
    task_id = pre_v0014_db.task_id

    for idx, status in enumerate(
        ["草稿", "待 Review", "需补充", "驳回", "已归档"], start=2
    ):
        conn.execute(
            """
            INSERT INTO evidence (
                learning_task_id, l3_code, version_number, status,
                content, evidence_link
            ) VALUES (%s, 'P01-L2A-L3A', %s, %s, 'test', 'http://x')
            """,
            (task_id, idx, status),
        )
    conn.commit()

    conn.execute(
        "DELETE FROM schema_migration WHERE version = %s",
        (V0014_VERSION,),
    )
    conn.commit()

    _run_runner(conn)

    rows = conn.execute(
        """
        SELECT version_number, status FROM evidence
        WHERE learning_task_id = %s ORDER BY version_number
        """,
        (task_id,),
    ).fetchall()
    by_version = {r[0]: r[1] for r in rows}
    assert by_version[1] == "已归档"  # the historical hit
    assert by_version[2] == "草稿"
    assert by_version[3] == "待 Review"
    assert by_version[4] == "需补充"
    assert by_version[5] == "驳回"
    assert by_version[6] == "已归档"  # already archived, unchanged
