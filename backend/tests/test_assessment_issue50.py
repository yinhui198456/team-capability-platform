from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import (
    AssessmentValidationError,
    _evidence_is_valid,
    batch_fill_l2,
    get_assessment,
    get_latest_approved_assessment_for_member,
    patch_assessment_draft,
    submit_assessment,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.migrations import run_migrations
from app.settings import settings
from tests.standard_target_support import create_scoped_draft


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
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P5' WHERE id = %s",
        (user_id,),
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


def _with_node_ids(
    connection: psycopg.Connection,
    assessment_id: int,
    details: list[dict[str, object]],
) -> list[dict[str, object]]:
    """scope-v1: every PATCH detail must carry its stable l3_node_id."""
    rows = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail WHERE assessment_id = %s",
        (assessment_id,),
    ).fetchall()
    node_by_code = {str(row[0]): row[1] for row in rows}
    return [{"l3_node_id": node_by_code[str(d["l3_code"])], **d} for d in details]


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
               inherited_from_assessment_id, inherited_current_level,
               current_level_explicitly_cleared
        FROM assessment_detail WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchone()
    assert detail == (4, 2, "legacy_preserved", None, None, False)
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
    older = create_scoped_draft(connection, member_id, 2024, "晋升复核")
    newer = create_scoped_draft(connection, member_id, 2025, "年中更新")
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
    previous = create_scoped_draft(connection, member_id, 2024, "年度")
    previous_details = get_assessment(connection, previous)["details"]
    patch_assessment_draft(
        connection,
        previous,
        member_id,
        1,
        _with_node_ids(
            connection,
            previous,
            [
                {
                    "l3_code": codes[0],
                    "current_level": 1,
                    "evidence_note": "旧依据",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q3",
                    "plan_month": 7,
                },
                {"l3_code": codes[1], "current_level": 1, "evidence_note": "另一依据"},
            ],
        ),
    )
    _mark_approved(connection, previous, "2025-01-01T00:00:00Z")

    current = create_scoped_draft(connection, member_id, 2026, "年度")
    details = {
        row["l3_code"]: row for row in get_assessment(connection, current)["details"]
    }
    assert details[codes[0]]["current_level"] == 1
    assert details[codes[0]]["evidence_note"] == "旧依据"
    assert details[codes[0]]["member_priority"] is None
    assert details[codes[0]]["include_in_plan"] is None
    assert details[codes[0]]["target_adjusted"] is False
    assert details[codes[0]]["inherited_from_assessment_id"] == previous
    assert details[codes[0]]["inherited_current_level"] == 1
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
    assessment_id = create_scoped_draft(connection, member_id, 2026)

    response = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        _with_node_ids(
            connection, assessment_id, [{"l3_code": codes[0], "current_level": 2}]
        ),
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
            _with_node_ids(
                connection, assessment_id, [{"l3_code": codes[1], "current_level": 1}]
            ),
        )


@pytest.mark.parametrize("same_l3", [True, False])
def test_concurrent_patches_allow_one_revision_and_do_not_lose_or_cross_write(
    issue50_schema: psycopg.Connection, same_l3: bool
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_scoped_draft(connection, member_id, 2026)

    first_code = codes[0]
    second_code = codes[0] if same_l3 else codes[1]
    node_rows = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail WHERE assessment_id = %s",
        (assessment_id,),
    ).fetchall()
    node_by_code = {str(row[0]): row[1] for row in node_rows}

    def write(code: str, level: int) -> tuple[str, object]:
        try:
            with psycopg.connect(settings.database_url) as concurrent_connection:
                return (
                    "ok",
                    patch_assessment_draft(
                        concurrent_connection,
                        assessment_id,
                        member_id,
                        1,
                        [
                            {
                                "l3_node_id": node_by_code[code],
                                "l3_code": code,
                                "current_level": level,
                            }
                        ],
                    ),
                )
        except ValueError as exc:
            return ("error", str(exc))

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(
            executor.map(
                lambda item: write(*item),
                [(first_code, 1), (second_code, 2)],
            )
        )

    assert [result[0] for result in results].count("ok") == 1
    assert [result[0] for result in results].count("error") == 1
    assert any(result[1] == "revision conflict" for result in results)
    assessment = get_assessment(connection, assessment_id)
    assert assessment is not None
    assert assessment["revision"] == 2
    saved = {row["l3_code"]: row["current_level"] for row in assessment["details"]}
    if same_l3:
        assert saved[first_code] in (1, 2)
    else:
        assert (saved[first_code], saved[second_code]) in ((1, None), (None, 2))


def test_batch_fill_only_writes_empty_l2_values_and_uses_single_revision(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        _with_node_ids(
            connection, assessment_id, [{"l3_code": codes[0], "current_level": 2}]
        ),
    )
    l2_code = codes[0].rsplit(".", 1)[0]
    result = batch_fill_l2(connection, assessment_id, member_id, l2_code, 1, 2)
    assert result["revision"] == 3
    assert result["updated_l3_codes"] == [codes[1]]
    assert result["skipped_l3_codes"] == [codes[0]]
    assert (
        result["gap_summary"]
        == get_assessment(connection, assessment_id)["gap_summary"]
    )
    assert get_assessment(connection, assessment_id)["revision"] == 3


def test_batch_fill_does_not_refill_explicitly_cleared_or_inherited_values(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        _with_node_ids(
            connection,
            assessment_id,
            [{"l3_code": codes[0], "current_level": None}],
        ),
    )
    result = batch_fill_l2(
        connection,
        assessment_id,
        member_id,
        codes[0].rsplit(".", 1)[0],
        2,
        2,
    )
    assert result["updated_l3_codes"] == [codes[1]]
    assert result["skipped_l3_codes"] == [codes[0]]
    assert result["revision"] == 3
    assert (
        result["gap_summary"]
        == get_assessment(connection, assessment_id)["gap_summary"]
    )
    detail = next(
        row
        for row in get_assessment(connection, assessment_id)["details"]
        if row["l3_code"] == codes[0]
    )
    assert detail["current_level"] is None
    assert detail["current_level_explicitly_cleared"] is True


def test_evidence_validator_covers_optional_levels_and_all_increases() -> None:
    assert _evidence_is_valid(1, None, None, None)
    assert _evidence_is_valid(1, "old", 1, "old")
    assert _evidence_is_valid(2, "old", 1, "old") is False
    assert _evidence_is_valid(2, "new", 1, "old")
    assert _evidence_is_valid(4, "old", 3, "old") is False
    assert _evidence_is_valid(4, "new", 3, "old")
    assert _evidence_is_valid(3, "", None, None) is False


@pytest.mark.parametrize("inherited_level,current_level", [(1, 2), (3, 4)])
def test_plan_fields_work_with_inherited_level_increase(
    issue50_schema: psycopg.Connection,
    inherited_level: int,
    current_level: int,
) -> None:
    """Plan fields (include_in_plan) survive inherited level bump (no evidence gate)."""
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    previous = create_scoped_draft(connection, member_id, 2025, "年度")
    patch_assessment_draft(
        connection,
        previous,
        member_id,
        1,
        _with_node_ids(
            connection,
            previous,
            [
                {
                    "l3_code": codes[0],
                    "current_level": inherited_level,
                    "evidence_note": "继承依据",
                },
                {"l3_code": codes[1], "current_level": 1},
            ],
        ),
    )
    _mark_approved(connection, previous, "2026-01-01T00:00:00Z")
    current = create_scoped_draft(connection, member_id, 2026, "晋升复核")

    # Level increase without new evidence is now allowed (#61).
    # Need adjusted target to create positive gap for plan fields.
    accepted = patch_assessment_draft(
        connection,
        current,
        member_id,
        1,
        _with_node_ids(
            connection,
            current,
            [
                {
                    "l3_code": codes[0],
                    "current_level": current_level,
                    "evidence_note": "继承依据",
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "晋升目标",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 3,
                },
                {"l3_code": codes[1], "current_level": 1},
            ],
        ),
    )
    assert accepted["revision"] == 2


def test_batch_fill_excludes_na_compatibility_inherited_and_cleared_items(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    l2_row = connection.execute(
        """
        SELECT l2.code, array_agg(l3.code ORDER BY l3.code)
        FROM capability_node l2
        JOIN capability_node l3 ON l3.parent_node_id = l2.id
        WHERE l2.node_type = 'L2' AND l3.node_type = 'L3'
        GROUP BY l2.code
        HAVING count(*) >= 4
        ORDER BY l2.code
        LIMIT 1
        """
    ).fetchone()
    assert l2_row is not None
    l2_code, codes = str(l2_row[0]), [str(code) for code in l2_row[1][:4]]
    connection.execute(
        "UPDATE capability_node SET enabled = (code = ANY(%s)) WHERE node_type = 'L3'",
        (codes,),
    )
    connection.commit()
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    connection.execute(
        """
        UPDATE assessment_detail
        SET standard_target_applicable = FALSE,
            standard_target_level = NULL,
            target_level = NULL
        WHERE assessment_id = %s AND l3_code = %s
        """,
        (assessment_id, codes[0]),
    )
    connection.execute(
        """
        UPDATE assessment_detail
        SET target_compatibility_error = 'legacy target error'
        WHERE assessment_id = %s AND l3_code = %s
        """,
        (assessment_id, codes[1]),
    )
    connection.execute(
        """
        UPDATE assessment_detail
        SET current_level = 2,
            inherited_current_level = 2,
            inherited_evidence_note = '历史依据',
            evidence_note = '历史依据'
        WHERE assessment_id = %s AND l3_code = %s
        """,
        (assessment_id, codes[2]),
    )
    connection.commit()

    result = batch_fill_l2(
        connection, assessment_id, member_id, l2_code, 1, expected_revision=1
    )
    assert result["updated_l3_codes"] == [codes[3]]
    assert set(result["skipped_l3_codes"]) == set(codes[:3])


def test_plan_fields_auto_cleared_when_gap_becomes_zero(
    issue50_schema: psycopg.Connection,
) -> None:
    """When current_level reaches target (gap=0), plan fields auto-cleared."""
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    # Set current_level=1 for gap>0 with plan fields.
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        _with_node_ids(
            connection,
            assessment_id,
            [
                {
                    "l3_code": codes[0],
                    "current_level": 1,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 3,
                }
            ],
        ),
    )
    # Now set current_level to match target → gap=0, plan fields auto-cleared.
    result = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        2,
        _with_node_ids(
            connection, assessment_id, [{"l3_code": codes[0], "current_level": 5}]
        ),
    )
    assert len(result["auto_cleared"]) == 1
    assert result["auto_cleared"][0]["l3_code"] == codes[0]
    assert set(result["auto_cleared"][0]["fields"]) == {
        "member_priority",
        "include_in_plan",
        "plan_quarter",
        "plan_month",
    }
    detail = next(
        row
        for row in get_assessment(connection, assessment_id)["details"]
        if row["l3_code"] == codes[0]
    )
    assert detail["member_priority"] is None
    assert detail["include_in_plan"] is None
    assert detail["gap_value"] == 0


def test_submit_requires_priority_for_positive_gap(
    issue50_schema: psycopg.Connection,
) -> None:
    connection = issue50_schema
    member_id = _member(connection)
    codes = _enable_two_nodes(connection)
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    with pytest.raises(ValueError, match="requires current level"):
        submit_assessment(connection, assessment_id, member_id, expected_revision=1)
    patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        1,
        _with_node_ids(
            connection,
            assessment_id,
            [
                {
                    "l3_code": codes[0],
                    "current_level": 3,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                },
                {"l3_code": codes[1], "current_level": 2},
            ],
        ),
    )
    with pytest.raises(AssessmentValidationError) as error:
        submit_assessment(connection, assessment_id, member_id, expected_revision=2)
    assert error.value.code == "assessment_validation_failed"
    assert error.value.l3_code == codes[0]
    assert error.value.reason == "priority_required"
    assert error.value.field == "member_priority"
