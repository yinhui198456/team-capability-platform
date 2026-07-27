import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import (
    batch_fill_l2,
    create_assessment_draft,
    get_assessment,
    get_latest_approved_assessment_for_member,
    patch_assessment_draft,
    submit_assessment,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.migrations import run_migrations


@pytest.fixture
def issue50_schema(connection: psycopg.Connection) -> psycopg.Connection:
    with connection.transaction():
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


def _member(connection: psycopg.Connection) -> int:
    user_id = create_user(connection, "issue50-member", "Issue 50 Member", "secret")
    assign_role(connection, user_id, "Member")
    connection.execute(
        "UPDATE tcp_user SET target_level = 'P5' WHERE id = %s", (user_id,)
    )
    connection.commit()
    return user_id


def _enable_two_nodes(connection: psycopg.Connection) -> list[str]:
    rows = connection.execute(
        "SELECT code FROM capability_node WHERE node_type = 'L3' ORDER BY code LIMIT 2"
    ).fetchall()
    codes = [str(row[0]) for row in rows]
    connection.execute(
        "UPDATE capability_node SET enabled = (code = ANY(%s)) WHERE node_type = 'L3'",
        (codes,),
    )
    connection.commit()
    return codes


def _mark_approved(
    connection: psycopg.Connection,
    assessment_id: int,
    reviewed_at: str,
    conclusion: str = "认可",
) -> None:
    connection.execute(
        "UPDATE assessment SET status = '已归档' WHERE id = %s", (assessment_id,)
    )
    connection.execute(
        """
        INSERT INTO assessment_review
            (assessment_id, sequence, conclusion, feedback, reviewed_at, status)
        VALUES (%s, 1, %s, 'feedback', %s, '已闭环')
        """,
        (assessment_id, conclusion, reviewed_at),
    )
    connection.commit()


def test_v0002_is_idempotent_and_preserves_legacy_rows(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    first = connection.execute(
        "SELECT revision FROM assessment ORDER BY id LIMIT 1"
    ).fetchone()
    assert first is None
    member_id = _member(connection)
    assessment_row = connection.execute(
        """
        INSERT INTO assessment (member_id, year, version, assessment_type, status)
        VALUES (%s, 2025, 1, '年度', '已归档')
        RETURNING id
        """,
        (member_id,),
    )
    assessment_id = assessment_row.fetchone()[0]
    connection.execute(
        """
        INSERT INTO assessment_detail
            (assessment_id, l3_code, target_level, gap_value, target_snapshot_source)
        VALUES (%s, 'P01.01.01', 4, 2, 'legacy_preserved')
        """,
        (assessment_id,),
    )
    connection.commit()
    run_migrations(connection)
    connection.commit()
    detail = connection.execute(
        """
        SELECT target_level, gap_value, target_snapshot_source,
               inherited_from_assessment_id, inherited_current_level
        FROM assessment_detail WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchone()
    assert detail == (4, 2, "legacy_preserved", None, None)
    assert (
        connection.execute(
            """
            SELECT count(*)
            FROM schema_migration
            WHERE version = '0002_assessment_inheritance_revision'
            """
        ).fetchone()[0]
        == 1
    )


def test_history_source_is_cross_year_cross_type_and_review_time_ordered(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    older = create_assessment_draft(connection, member_id, 2024, "晋升复核")
    newer = create_assessment_draft(connection, member_id, 2025, "年中更新")
    _mark_approved(connection, older, "2025-01-01T00:00:00Z")
    _mark_approved(connection, newer, "2025-06-01T00:00:00Z")

    source = get_latest_approved_assessment_for_member(connection, member_id)
    assert source is not None
    assert source["id"] == newer


def test_new_assessment_inherits_values_but_not_targets_or_candidates(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    previous = create_assessment_draft(connection, member_id, 2024, "年度")
    previous_details = get_assessment(connection, previous)["details"]
    patch_assessment_draft(
        connection,
        previous,
        member_id,
        1,
        [
            {
                "l3_code": codes[0],
                "current_level": 2,
                "evidence_note": "旧依据",
                "plan_candidate": True,
            },
            {"l3_code": codes[1], "current_level": 1, "evidence_note": "另一依据"},
        ],
    )
    _mark_approved(connection, previous, "2025-01-01T00:00:00Z")

    current = create_assessment_draft(connection, member_id, 2026, "年度")
    details = {
        row["l3_code"]: row for row in get_assessment(connection, current)["details"]
    }
    assert details[codes[0]]["current_level"] == 2
    assert details[codes[0]]["evidence_note"] == "旧依据"
    assert details[codes[0]]["plan_candidate"] is False
    assert details[codes[0]]["target_adjusted"] is False
    assert details[codes[0]]["inherited_from_assessment_id"] == previous
    assert details[codes[0]]["inherited_current_level"] == 2
    assert details[codes[0]]["inherited_evidence_note"] == "旧依据"
    assert (
        details[codes[0]]["target_level"] == details[codes[0]]["standard_target_level"]
    )
    assert len(previous_details) == 2


def test_patch_requires_revision_and_preserves_omitted_details(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_assessment_draft(connection, member_id, 2026)

    response = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        [{"l3_code": codes[0], "current_level": 2}],
    )
    assert response["revision"] == 2
    details = {
        row["l3_code"]: row
        for row in get_assessment(connection, assessment_id)["details"]
    }
    assert details[codes[0]]["current_level"] == 2
    assert details[codes[1]]["current_level"] is None

    with pytest.raises(ValueError, match="revision conflict"):
        patch_assessment_draft(
            connection,
            assessment_id,
            member_id,
            1,
            [{"l3_code": codes[1], "current_level": 1}],
        )


def test_batch_fill_only_writes_empty_l2_values_and_uses_single_revision(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_assessment_draft(connection, member_id, 2026)
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        [{"l3_code": codes[0], "current_level": 2}],
    )
    l2_code = codes[0].rsplit(".", 1)[0]
    result = batch_fill_l2(connection, assessment_id, member_id, l2_code, 1, 2)
    assert result["revision"] == 3
    assert result["updated_l3_codes"] == [codes[1]]
    assert result["skipped_l3_codes"] == [codes[0]]
    assert get_assessment(connection, assessment_id)["revision"] == 3


def test_invalid_candidate_is_rejected_and_existing_candidate_is_auto_cancelled(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_assessment_draft(connection, member_id, 2026)
    with pytest.raises(ValueError, match="invalid plan candidate"):
        patch_assessment_draft(
            connection,
            assessment_id,
            member_id,
            1,
            [{"l3_code": codes[0], "plan_candidate": True}],
        )
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        [{"l3_code": codes[0], "current_level": 1, "plan_candidate": True}],
    )
    result = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        2,
        [{"l3_code": codes[0], "current_level": 4}],
    )
    assert result["auto_cancelled_plan_candidates"] == [codes[0]]
    detail = next(
        row
        for row in get_assessment(connection, assessment_id)["details"]
        if row["l3_code"] == codes[0]
    )
    assert detail["plan_candidate"] is False
    assert detail["gap_value"] == 0


def test_submit_enforces_full_detail_and_evidence_gate(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_assessment_draft(connection, member_id, 2026)
    with pytest.raises(ValueError, match="requires current level"):
        submit_assessment(connection, assessment_id, member_id, expected_revision=1)
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        [
            {"l3_code": codes[0], "current_level": 3},
            {"l3_code": codes[1], "current_level": 2},
        ],
    )
    with pytest.raises(ValueError, match="requires evidence"):
        submit_assessment(connection, assessment_id, member_id, expected_revision=2)
