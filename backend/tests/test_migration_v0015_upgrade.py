"""v0015 draft-partial plan-time upgrade proof.

Builds a genuine v0014-era database (frozen pre-v0009 DDL + production
runner through 0014), proves the v0007 plan-time CHECK
(assessment_detail_plan_time_required) still blocks the draft partial
state, applies v0015, proves the same UPDATE now succeeds, the named
constraint is gone, the other plan constraints survive, and a re-run is a
no-op.

This is the migration red test: on the pre-v0015 chain the partial-state
UPDATE raises CheckViolation; with v0015 it succeeds.  The app-layer
submit gate stays authoritative (locked via the real API in
test_assessment_plan_selection.py::test_draft_allows_partial_plan_state_
save_reload_submit_gate).
"""

from collections.abc import Iterator

import psycopg
import pytest

from tests.test_migration_v0009_upgrade import (
    _SCHEMA_SQL,
    _drop_everything,
    _run_runner,
    _seed_schema_migration_v0001_v0008,
)

V0015_VERSION = "0015_draft_partial_plan_time"


def _run_until_v0014(connection: psycopg.Connection) -> None:
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
            if version >= V0015_VERSION:
                break
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )


@pytest.fixture
def pre_v0015_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    """A genuine v0014-era database: v0015 must not exist yet."""
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_schema_migration_v0001_v0008(connection)
    _run_until_v0014(connection)
    assert V0015_VERSION not in [
        row[0]
        for row in connection.execute("SELECT version FROM schema_migration").fetchall()
    ]
    yield connection


def _plan_time_check_count(connection: psycopg.Connection) -> int:
    """Count CHECKs matching the v0007 plan-time-required predicate.

    The constraint may carry the v0007 name or an auto-named duplicate from
    the frozen base DDL, so match by definition — same as migration v0015.
    """
    return connection.execute(
        "SELECT COUNT(*) FROM pg_constraint "
        "WHERE conrelid = 'assessment_detail'::regclass AND contype = 'c' "
        "AND pg_get_constraintdef(oid) LIKE '%IS DISTINCT FROM true%' "
        "AND pg_get_constraintdef(oid) LIKE '%plan_quarter IS NOT NULL%'"
    ).fetchone()[0]


def test_v0015_drops_plan_time_check_and_partial_state_saves(
    pre_v0015_db: psycopg.Connection,
) -> None:
    connection = pre_v0015_db
    member_id = int(
        connection.execute(
            "INSERT INTO tcp_user (username, full_name, password_hash, "
            "current_level, target_level) "
            "VALUES ('v15-member', 'V15 Member', 'secret', 'P4', 'P5') "
            "RETURNING id"
        ).fetchone()[0]
    )
    assessment_id = int(
        connection.execute(
            "INSERT INTO assessment (member_id, year, assessment_type, status) "
            "VALUES (%s, 2025, '年度', '草稿') RETURNING id",
            (member_id,),
        ).fetchone()[0]
    )
    with connection.transaction():
        connection.execute(
            "INSERT INTO assessment_detail (assessment_id, l3_code, "
            "current_level, plan_candidate) VALUES (%s, 'V15.TEST.01', 2, FALSE)",
            (assessment_id,),
        )
    detail_id = int(
        connection.execute(
            "SELECT id FROM assessment_detail WHERE l3_code = 'V15.TEST.01'"
        ).fetchone()[0]
    )

    # Pre-v0015: the plan-time CHECK blocks the draft partial state.
    assert _plan_time_check_count(connection) >= 1
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                "UPDATE assessment_detail SET include_in_plan = TRUE " "WHERE id = %s",
                (detail_id,),
            )

    # Apply v0015 through the production runner.
    _run_runner(connection)
    assert V0015_VERSION in [
        row[0]
        for row in connection.execute("SELECT version FROM schema_migration").fetchall()
    ]

    # The same partial state now saves and is representable as-is.
    with connection.transaction():
        connection.execute(
            "UPDATE assessment_detail SET include_in_plan = TRUE WHERE id = %s",
            (detail_id,),
        )
    row = connection.execute(
        "SELECT include_in_plan, plan_quarter, plan_month "
        "FROM assessment_detail WHERE id = %s",
        (detail_id,),
    ).fetchone()
    assert row == (True, None, None)
    assert _plan_time_check_count(connection) == 0

    # Other plan constraints still hold at the DB layer:
    # contradictory quarter+month rejected…
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                "UPDATE assessment_detail SET plan_quarter = 'Q1', "
                "plan_month = 6 WHERE id = %s",
                (detail_id,),
            )
    # …include=FALSE with timing rejected…
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                "UPDATE assessment_detail SET include_in_plan = FALSE, "
                "plan_quarter = 'Q2', plan_month = 6 WHERE id = %s",
                (detail_id,),
            )
    # …and 暂缓 + include=TRUE rejected.
    with pytest.raises(psycopg.errors.CheckViolation):
        with connection.transaction():
            connection.execute(
                "UPDATE assessment_detail SET include_in_plan = TRUE, "
                "member_priority = '暂缓' WHERE id = %s",
                (detail_id,),
            )

    # Idempotent re-run is a no-op (ledger skips; nothing to drop).
    _run_runner(connection)
    assert _plan_time_check_count(connection) == 0
