"""v0016 upgrade proof for later-assessment plan items.

The pre-v0016 schema rejects a new item sourced from a later assessment even
when the assessment belongs to the same member and year as the existing plan.
v0016 permits that valid case, preserves the exact detail/node provenance
foreign key, and still rejects cross-member or cross-year sources.
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

V0016_VERSION = "0016_plan_item_later_assessment"


def _run_until_v0015(connection: psycopg.Connection) -> None:
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
            if version >= V0016_VERSION:
                break
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )


@pytest.fixture
def pre_v0016_db(connection: psycopg.Connection) -> Iterator[psycopg.Connection]:
    _drop_everything(connection)
    connection.execute(_SCHEMA_SQL)
    connection.execute("SET search_path = public")
    connection.commit()
    _seed_schema_migration_v0001_v0008(connection)
    data = _seed_legacy_data(connection)
    _run_until_v0015(connection)
    connection.commit()
    connection.legacy_data = data
    yield connection


def _new_assessment_detail(
    connection: psycopg.Connection,
    *,
    member_id: int,
    year: int,
    l3_node_id: int,
    code: str,
) -> tuple[int, int]:
    assessment_id = int(
        connection.execute(
            "INSERT INTO assessment (member_id, year, assessment_type, status) "
            "VALUES (%s, %s, '年度', '草稿') RETURNING id",
            (member_id, year),
        ).fetchone()[0]
    )
    detail_id = int(
        connection.execute(
            "INSERT INTO assessment_detail (assessment_id, l3_code, l3_node_id) "
            "VALUES (%s, %s, %s) RETURNING id",
            (assessment_id, code, l3_node_id),
        ).fetchone()[0]
    )
    connection.commit()
    return assessment_id, detail_id


def _insert_item(
    connection: psycopg.Connection,
    *,
    plan_id: int,
    assessment_id: int,
    detail_id: int,
    l3_node_id: int,
    code: str,
) -> None:
    connection.execute(
        """
        INSERT INTO plan_item (
            annual_growth_plan_id, l3_code, current_level, target_level,
            priority, source_assessment_id, source_assessment_detail_id,
            l3_node_id
        )
        VALUES (%s, %s, 1, 2, '高', %s, %s, %s)
        """,
        (plan_id, code, assessment_id, detail_id, l3_node_id),
    )


def test_v0016_allows_later_same_member_year_and_preserves_scope_guard(
    pre_v0016_db: psycopg.Connection,
) -> None:
    connection = pre_v0016_db
    data = connection.legacy_data
    later_assessment, later_detail = _new_assessment_detail(
        connection,
        member_id=int(data["member_id"]),
        year=2024,
        l3_node_id=int(data["l3_node_id"]),
        code="P01-L1-L2-L3-LATER",
    )

    # Red proof: the v0009 composite FK incorrectly binds every item to the
    # plan's first assessment rather than to the same member/year scope.
    with pytest.raises(psycopg.errors.ForeignKeyViolation) as excinfo:
        with connection.transaction():
            _insert_item(
                connection,
                plan_id=int(data["plan_id"]),
                assessment_id=later_assessment,
                detail_id=later_detail,
                l3_node_id=int(data["l3_node_id"]),
                code="P01-L1-L2-L3-LATER",
            )
    assert excinfo.value.diag.constraint_name == "plan_item_plan_source_fk"

    _run_runner(connection)

    with connection.transaction():
        _insert_item(
            connection,
            plan_id=int(data["plan_id"]),
            assessment_id=later_assessment,
            detail_id=later_detail,
            l3_node_id=int(data["l3_node_id"]),
            code="P01-L1-L2-L3-LATER",
        )
    stored = connection.execute(
        "SELECT source_assessment_id, source_assessment_detail_id "
        "FROM plan_item WHERE l3_code='P01-L1-L2-L3-LATER'"
    ).fetchone()
    assert tuple(stored) == (later_assessment, later_detail)

    other_assessment, other_detail = _new_assessment_detail(
        connection,
        member_id=int(data["buddy_id"]),
        year=2024,
        l3_node_id=int(data["l3_node_id"]),
        code="P01-L1-L2-L3-WRONG-MEMBER",
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation) as wrong_member:
        with connection.transaction():
            _insert_item(
                connection,
                plan_id=int(data["plan_id"]),
                assessment_id=other_assessment,
                detail_id=other_detail,
                l3_node_id=int(data["l3_node_id"]),
                code="P01-L1-L2-L3-WRONG-MEMBER",
            )
    assert wrong_member.value.diag.constraint_name == (
        "plan_item_source_member_year_guard"
    )

    # Runner idempotency and non-target preservation.
    _run_runner(connection)
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM schema_migration WHERE version=%s",
            (V0016_VERSION,),
        ).fetchone()[0]
        == 1
    )
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM plan_item WHERE id=%s", (int(data["item_id"]),)
        ).fetchone()[0]
        == 1
    )
