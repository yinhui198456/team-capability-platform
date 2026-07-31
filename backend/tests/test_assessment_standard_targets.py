from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeoutError
from threading import Event

import psycopg
import pytest
from pydantic import ValidationError

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.api import DetailItem
from app.assessment.repository import (
    get_assessment,
    save_assessment_draft,
    submit_assessment,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.migrations import run_migrations
from tests.conftest import TEST_DATABASE_URL
from tests.standard_target_support import create_scoped_draft


@pytest.fixture
def standard_target_schema(connection: psycopg.Connection) -> psycopg.Connection:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS schema_migration")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    create_assessment_schema(connection)
    import_catalog(resolve_workbook_dir(), connection)
    run_migrations(connection)
    connection.commit()
    return connection


def _member(connection: psycopg.Connection, target_level: str | None) -> int:
    user_id = create_user(connection, "member", "Member", "secret")
    assign_role(connection, user_id, "Member")
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = %s WHERE id = %s",
        (target_level, user_id),
    )
    connection.commit()
    return user_id


def _node_at_start(connection: psycopg.Connection, start: str) -> tuple[int, str]:
    row = connection.execute(
        """
        SELECT id, code FROM capability_node
        WHERE node_type = 'L3' AND recommended_start_level = %s
        ORDER BY code LIMIT 1
        """,
        (start,),
    ).fetchone()
    assert row is not None
    return int(row[0]), str(row[1])


def test_create_requires_member_target_level(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, None)

    with pytest.raises(ValueError, match="member target_level is required"):
        create_scoped_draft(standard_target_schema, member_id, 2026)

    assert (
        standard_target_schema.execute("SELECT count(*) FROM assessment").fetchone()[0]
        == 0
    )


def test_create_snapshots_published_matrix_and_scope_exclusion(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P5")
    _, override_code = _node_at_start(standard_target_schema, "P4")
    _, below_start_code = _node_at_start(standard_target_schema, "P6")

    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)
    assessment = get_assessment(standard_target_schema, assessment_id)
    assert assessment is not None
    details = {detail["l3_code"]: detail for detail in assessment["details"]}

    # P4-start L3 for a P4→P5 member: current_required with the P4 cell
    assert details[override_code]["standard_target_applicable"] is True
    assert details[override_code]["standard_target_level"] == 2
    assert details[override_code]["target_level"] == 2
    assert details[override_code]["scope_type"] == "current_required"
    assert details[override_code]["standard_job_level_snapshot"] == "P4"
    assert details[override_code]["target_snapshot_source"].endswith(":legacy_derived")

    # P6-start L3 is outside the P4→P5 scope: no detail is created at all
    assert below_start_code not in details


def test_snapshot_is_immutable_after_model_and_member_changes(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P4")
    node_id, code = _node_at_start(standard_target_schema, "P4")
    standard_target_schema.execute(
        "UPDATE capability_node SET enabled = (id = %s)", (node_id,)
    )
    standard_target_schema.commit()
    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)

    standard_target_schema.execute(
        "UPDATE capability_node SET recommended_start_level = 'P6' WHERE id = %s",
        (node_id,),
    )
    standard_target_schema.execute(
        "UPDATE tcp_user SET target_level = 'P8' WHERE id = %s", (member_id,)
    )
    standard_target_schema.commit()

    detail = get_assessment(standard_target_schema, assessment_id)["details"][0]
    assert detail["l3_code"] == code
    assert detail["standard_target_level"] == 2
    assert detail["target_level"] == 2
    assert detail["target_snapshot_source"].endswith(":legacy_derived")


def test_save_uses_snapshot_and_requires_reason_for_adjustment(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P4")
    node_id, code = _node_at_start(standard_target_schema, "P4")
    standard_target_schema.execute(
        "UPDATE capability_node SET enabled = (id = %s)", (node_id,)
    )
    standard_target_schema.commit()
    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)

    with pytest.raises(ValueError, match="adjustment reason is required"):
        save_assessment_draft(
            standard_target_schema,
            assessment_id,
            member_id,
            [
                {
                    "l3_code": code,
                    "current_level": 1,
                    "target_adjusted": True,
                    "adjusted_target_level": 4,
                    "target_adjustment_reason": " ",
                }
            ],
            expected_revision=1,
        )

    save_assessment_draft(
        standard_target_schema,
        assessment_id,
        member_id,
        [
            {
                "l3_code": code,
                "current_level": 1,
                "target_adjusted": True,
                "adjusted_target_level": 4,
                "target_adjustment_reason": "岗位项目要求",
                "evidence_note": "已完成基础练习",
                "member_priority": "高",
                "include_in_plan": True,
                "plan_quarter": "Q2",
                "plan_month": 5,
            }
        ],
        expected_revision=1,
    )

    detail = get_assessment(standard_target_schema, assessment_id)["details"][0]
    assert detail["standard_target_level"] == 2
    assert detail["adjusted_target_level"] == 4
    assert detail["target_level"] == 4
    assert detail["gap_value"] == 3


def test_not_applicable_item_rejects_adjustment(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P5")
    _, code = _node_at_start(standard_target_schema, "P6")
    # legacy (pre-#60) draft carrying a not-applicable detail; the save path
    # must keep rejecting adjustments on it
    assessment_id = int(
        standard_target_schema.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type, status)
            VALUES (%s, 2026, 1, '年度', '草稿') RETURNING id
            """,
            (member_id,),
        ).fetchone()[0]
    )
    standard_target_schema.execute(
        """
        INSERT INTO assessment_detail (
            assessment_id, l3_code, standard_target_applicable,
            standard_target_level, target_level
        )
        VALUES (%s, %s, FALSE, NULL, NULL)
        """,
        (assessment_id, code),
    )
    standard_target_schema.commit()

    with pytest.raises(ValueError, match="not applicable"):
        save_assessment_draft(
            standard_target_schema,
            assessment_id,
            member_id,
            [
                {
                    "l3_code": code,
                    "current_level": None,
                    "target_adjusted": True,
                    "adjusted_target_level": 3,
                    "target_adjustment_reason": "提前适用",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
            expected_revision=1,
        )


def test_batch_save_is_atomic_and_requires_every_snapshot_row(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P8")
    rows = standard_target_schema.execute(
        """
        SELECT id, code FROM capability_node
        WHERE node_type = 'L3' ORDER BY code LIMIT 2
        """
    ).fetchall()
    assert len(rows) == 2
    ids = [row[0] for row in rows]
    standard_target_schema.execute(
        "UPDATE capability_node SET enabled = (id = ANY(%s))", (ids,)
    )
    standard_target_schema.commit()
    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)

    with pytest.raises(ValueError, match="must include every assessment detail"):
        save_assessment_draft(
            standard_target_schema,
            assessment_id,
            member_id,
            [{"l3_code": rows[0][1], "current_level": 2}],
            expected_revision=1,
        )

    details = get_assessment(standard_target_schema, assessment_id)["details"]
    assert all(detail["current_level"] is None for detail in details)


def test_concurrent_save_waits_for_assessment_row_lock(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P4")
    node_id, code = _node_at_start(standard_target_schema, "P4")
    standard_target_schema.execute(
        "UPDATE capability_node SET enabled = (id = %s)", (node_id,)
    )
    standard_target_schema.commit()
    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)
    started = Event()

    def save_from_second_connection() -> None:
        started.set()
        with psycopg.connect(TEST_DATABASE_URL) as second_connection:
            save_assessment_draft(
                second_connection,
                assessment_id,
                member_id,
                [{"l3_code": code, "current_level": 2}],
                expected_revision=1,
            )

    executor = ThreadPoolExecutor(max_workers=1)
    try:
        with standard_target_schema.transaction():
            standard_target_schema.execute(
                "SELECT id FROM assessment WHERE id = %s FOR UPDATE",
                (assessment_id,),
            )
            future = executor.submit(save_from_second_connection)
            assert started.wait(timeout=1)
            with pytest.raises(FutureTimeoutError):
                future.result(timeout=0.2)

        future.result(timeout=2)
    finally:
        executor.shutdown(wait=True)

    detail = get_assessment(standard_target_schema, assessment_id)["details"][0]
    assert detail["current_level"] == 2


def test_unresolved_legacy_draft_cannot_be_submitted(
    standard_target_schema: psycopg.Connection,
) -> None:
    member_id = _member(standard_target_schema, "P4")
    node_id, code = _node_at_start(standard_target_schema, "P4")
    standard_target_schema.execute(
        "UPDATE capability_node SET enabled = (id = %s)", (node_id,)
    )
    standard_target_schema.commit()
    assessment_id = create_scoped_draft(standard_target_schema, member_id, 2026)
    standard_target_schema.execute(
        """
        UPDATE assessment_detail
        SET target_compatibility_error = '历史明细缺少目标快照'
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    )
    standard_target_schema.commit()

    with pytest.raises(ValueError, match="requires compatibility repair"):
        submit_assessment(
            standard_target_schema, assessment_id, member_id, expected_revision=1
        )

    status = standard_target_schema.execute(
        "SELECT status FROM assessment WHERE id = %s", (assessment_id,)
    ).fetchone()[0]
    assert status == "草稿"


def test_member_payload_cannot_submit_final_or_standard_target() -> None:
    for field in ("target_level", "standard_target_level"):
        with pytest.raises(ValidationError):
            DetailItem.model_validate(
                {
                    "l3_code": "P01.01.01",
                    "current_level": 2,
                    field: 5,
                }
            )
