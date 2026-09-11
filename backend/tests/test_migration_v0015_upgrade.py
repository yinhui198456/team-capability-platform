"""Issue #178: v0015 rebuilds assessment_detail_plan_time_required.

Pre-v0015 databases (upgraded via v0007) carry the named CHECK requiring
plan_quarter+plan_month whenever include_in_plan=TRUE, so a draft could not
persist 待补计划月份 — violating the #187 contract (草稿允许退出后继续).
v0015 rebuilds the CHECK: pending (both NULL) is allowed; half-filled
(exactly one set) stays invalid; every previously-legal row stays legal.

Proves:
- upgrade path — a database carrying the old named constraint ends at the
  new definition with seeded rows preserved;
- fresh path — the full migration chain on fresh DDL reaches the same
  terminal definition;
- idempotency — re-running the chain / the migration itself is a no-op;
- non-target preservation — the other assessment_detail CHECKs survive.
"""

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.migrations import run_migrations
from app.planning.schema import create_planning_schema

_CONSTRAINT = "assessment_detail_plan_time_required"
_NON_TARGET = (
    "assessment_detail_quarter_month_consistent",
    "assessment_detail_hold_plan_mutex",
    "assessment_detail_no_plan_time_when_false",
    "assessment_detail_no_plan_time_when_null",
)


def _constraint_def(connection: psycopg.Connection, name: str) -> str | None:
    row = connection.execute(
        "SELECT pg_get_constraintdef(oid) FROM pg_constraint "
        "WHERE conrelid = 'assessment_detail'::regclass AND conname = %s",
        (name,),
    ).fetchone()
    return row[0] if row else None


def _fresh_schema(connection: psycopg.Connection) -> None:
    create_access_schema(connection)
    create_assessment_schema(connection)
    import_catalog(resolve_workbook_dir(), connection)
    create_planning_schema(connection)
    connection.commit()


def _seed_rows(connection: psycopg.Connection) -> int:
    """One include_in_plan=FALSE row and one TRUE row with complete timing —
    both legal under the old constraint; must survive v0015 untouched."""
    member_id = create_user(connection, "mig15", "Mig15", "secret")
    assign_role(connection, member_id, "Member")
    assessment_id = connection.execute(
        "INSERT INTO assessment (member_id, year, assessment_type, status) "
        "VALUES (%s, 2026, '年度', '草稿') RETURNING id",
        (member_id,),
    ).fetchone()[0]
    connection.execute(
        "INSERT INTO assessment_detail (assessment_id, l3_code, include_in_plan) "
        "VALUES (%s, 'C01.01.01', FALSE)",
        (assessment_id,),
    )
    connection.execute(
        "INSERT INTO assessment_detail (assessment_id, l3_code, include_in_plan, "
        "plan_quarter, plan_month, member_priority) "
        "VALUES (%s, 'C01.01.02', TRUE, 'Q1', 2, '高')",
        (assessment_id,),
    )
    connection.commit()
    return assessment_id


def _insert_detail(
    connection: psycopg.Connection,
    assessment_id: int,
    code: str,
    quarter: str | None,
    month: int | None,
) -> None:
    connection.execute(
        "INSERT INTO assessment_detail (assessment_id, l3_code, include_in_plan, "
        "plan_quarter, plan_month, member_priority) "
        "VALUES (%s, %s, TRUE, %s, %s, '高')",
        (assessment_id, code, quarter, month),
    )


def test_v0015_upgrade_path(connection: psycopg.Connection) -> None:
    """Old named constraint present → rebuilt to allow pending month."""
    _fresh_schema(connection)
    # Simulate a pre-v0015 upgraded database: v0007 added the named CHECK
    # with the old predicate (fresh inline CHECKs are unnamed).
    connection.execute(
        "ALTER TABLE assessment_detail ADD CONSTRAINT "
        f"{_CONSTRAINT} CHECK ("
        "include_in_plan IS DISTINCT FROM TRUE "
        "OR (plan_quarter IS NOT NULL AND plan_month IS NOT NULL))"
    )
    connection.commit()
    assessment_id = _seed_rows(connection)

    old_def = _constraint_def(connection, _CONSTRAINT)
    assert old_def is not None
    assert "IS NULL" not in old_def

    # Pre-migration: pending month is rejected by the old guard.
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        _insert_detail(connection, assessment_id, "C01.01.03", None, None)

    run_migrations(connection)
    connection.commit()

    new_def = _constraint_def(connection, _CONSTRAINT)
    assert new_def is not None
    assert "plan_quarter IS NULL" in new_def, new_def

    # Pending month now persists.
    _insert_detail(connection, assessment_id, "C01.01.03", None, None)
    # Half-filled timing stays rejected by the rebuilt CHECK.
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        _insert_detail(connection, assessment_id, "C01.01.04", "Q3", None)
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        _insert_detail(connection, assessment_id, "C01.01.05", None, 8)
    connection.commit()

    # Seeded rows preserved verbatim.
    rows = connection.execute(
        "SELECT l3_code, include_in_plan, plan_quarter, plan_month "
        "FROM assessment_detail WHERE assessment_id = %s ORDER BY l3_code",
        (assessment_id,),
    ).fetchall()
    assert rows[:2] == [
        ("C01.01.01", False, None, None),
        ("C01.01.02", True, "Q1", 2),
    ]
    assert rows[2] == ("C01.01.03", True, None, None)

    # Non-target constraints untouched.
    for name in _NON_TARGET:
        assert _constraint_def(connection, name) is not None, name

    # Idempotency: ledger skip plus a direct second upgrade call.
    run_migrations(connection)
    from app.migrations.versions.v0015_plan_draft_pending_month import (
        upgrade as upgrade_v0015,
    )

    upgrade_v0015(connection)
    connection.commit()
    assert _constraint_def(connection, _CONSTRAINT) == new_def


def test_v0015_fresh_path(connection: psycopg.Connection) -> None:
    """Full chain on fresh DDL reaches the same terminal definition."""
    _fresh_schema(connection)
    run_migrations(connection)
    connection.commit()

    new_def = _constraint_def(connection, _CONSTRAINT)
    assert new_def is not None
    assert "plan_quarter IS NULL" in new_def, new_def

    member_id = create_user(connection, "mig15f", "Mig15F", "secret")
    assign_role(connection, member_id, "Member")
    assessment_id = connection.execute(
        "INSERT INTO assessment (member_id, year, assessment_type, status) "
        "VALUES (%s, 2026, '年度', '草稿') RETURNING id",
        (member_id,),
    ).fetchone()[0]
    _insert_detail(connection, assessment_id, "C01.01.01", None, None)
    with pytest.raises(psycopg.errors.CheckViolation), connection.transaction():
        _insert_detail(connection, assessment_id, "C01.01.02", "Q2", None)
    connection.commit()
