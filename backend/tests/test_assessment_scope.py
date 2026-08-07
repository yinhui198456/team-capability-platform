"""#60 assessment scope snapshots: contract-freeze coverage."""

import asyncio
import json
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from typing import Any

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import create_assessment_draft, get_assessment
from app.assessment.schema import create_assessment_schema
from app.assessment.scope import (
    AssessmentScopeError,
    compute_assessment_scope,
)
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.main import app
from app.migrations import run_migrations
from app.migrations.versions.v0006_assessment_scope_snapshots import (
    upgrade as upgrade_v0006,
)
from tests.conftest import TEST_DATABASE_URL
from tests.standard_target_support import create_scoped_draft

SESSION_COOKIE = "tcp_session"


@pytest.fixture
def scope_schema(connection: psycopg.Connection) -> psycopg.Connection:
    with connection.transaction():
        for table in (
            "schema_migration",
            "assessment_draft_target_repair_audit",
            "assessment_idempotency_key",
            "assessment_review",
            "gap",
            "assessment_detail",
            "assessment",
            "buddy_relationship",
            "tcp_session",
            "tcp_user_role",
            "tcp_role",
            "tcp_user",
            "capability_standard_version_audit",
            "capability_standard_item",
            "capability_standard_version",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_assessment_schema(connection)
    from app.planning.schema import create_planning_schema

    create_planning_schema(connection)
    import_catalog(resolve_workbook_dir(), connection)
    run_migrations(connection)
    connection.commit()
    return connection


def _member(
    connection: psycopg.Connection,
    current_level: str | None,
    target_level: str | None,
    username: str = "member",
) -> int:
    user_id = create_user(connection, username, username, "secret")
    assign_role(connection, user_id, "Member")
    connection.execute(
        "UPDATE tcp_user SET current_level = %s, target_level = %s WHERE id = %s",
        (current_level, target_level, user_id),
    )
    connection.commit()
    return user_id


def _expected_classification(
    connection: psycopg.Connection, current: str, target: str
) -> dict[str, set[int]]:
    rows = connection.execute(
        """
        SELECT n.id, ic.applicable, it.applicable
        FROM capability_node n
        JOIN capability_standard_version v ON v.status = '已发布'
        JOIN capability_standard_item ic
          ON ic.version_id = v.id AND ic.l3_node_id = n.id AND ic.job_level = %s
        JOIN capability_standard_item it
          ON it.version_id = v.id AND it.l3_node_id = n.id AND it.job_level = %s
        WHERE n.node_type = 'L3' AND n.enabled = TRUE
        """,
        (current, target),
    ).fetchall()
    required: set[int] = set()
    progressive: set[int] = set()
    for node_id, c_applicable, t_applicable in rows:
        if bool(c_applicable):
            required.add(int(node_id))
        elif bool(t_applicable):
            progressive.add(int(node_id))
    return {"current_required": required, "target_progressive": progressive}


def _published_counts(connection: psycopg.Connection) -> dict[str, int]:
    rows = connection.execute(
        """
        SELECT i.job_level, COUNT(*) FILTER (WHERE i.applicable)
        FROM capability_standard_item i
        JOIN capability_standard_version v ON v.id = i.version_id
        WHERE v.status = '已发布'
        GROUP BY i.job_level
        """
    ).fetchall()
    return {str(level): int(count) for level, count in rows}


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


# --- deterministic classification -------------------------------------------


def test_scope_classification_same_level(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P4")
    scope = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    expected = _expected_classification(connection, "P4", "P4")
    summary = scope["summary"]
    assert summary["target_progressive"] == 0
    assert summary["current_required"] == len(expected["current_required"])
    assert {item["l3_node_id"] for item in scope["items"]} == expected[
        "current_required"
    ]
    assert scope["empty_scope"] is False


def test_scope_classification_p4_to_p5(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    scope = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    expected = _expected_classification(connection, "P4", "P5")
    by_type: dict[str, set[int]] = {
        "current_required": set(),
        "target_progressive": set(),
    }
    for item in scope["items"]:
        by_type[str(item["scope_type"])].add(int(item["l3_node_id"]))
    assert by_type == expected
    summary = scope["summary"]
    assert summary["total"] == len(expected["current_required"]) + len(
        expected["target_progressive"]
    )
    assert summary["current_required"] == len(expected["current_required"])
    assert summary["target_progressive"] == len(expected["target_progressive"])
    # spot check known nodes
    p4_node, _ = _node_at_start(connection, "P4")
    p6_node, _ = _node_at_start(connection, "P6")
    assert p4_node in expected["current_required"]
    assert p6_node not in expected["current_required"]
    assert p6_node not in expected["target_progressive"]


def test_scope_classification_multi_level_only_compares_endpoints(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P7")
    scope = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    expected = _expected_classification(connection, "P4", "P7")
    by_type: dict[str, set[int]] = {
        "current_required": set(),
        "target_progressive": set(),
    }
    for item in scope["items"]:
        by_type[str(item["scope_type"])].add(int(item["l3_node_id"]))
    assert by_type == expected
    # P5/P6-start L3s are progressive; P8-start L3s are excluded
    p5_node, _ = _node_at_start(connection, "P5")
    p6_node, _ = _node_at_start(connection, "P6")
    p8_node, _ = _node_at_start(connection, "P8")
    assert p5_node in expected["target_progressive"]
    assert p6_node in expected["target_progressive"]
    assert p8_node not in expected["current_required"]
    assert p8_node not in expected["target_progressive"]


def test_scope_classification_p4_to_p8(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P8")
    scope = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    counts = _published_counts(connection)
    assert scope["summary"]["total"] == counts["P8"]


# --- invalid inputs: structured errors, zero writes --------------------------


def _draft_count(connection) -> int:
    return int(connection.execute("SELECT COUNT(*) FROM assessment").fetchone()[0])


def test_missing_current_level_422_zero_write(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, None, "P5")
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "invalid_member_level"
    assert _draft_count(connection) == 0


def test_invalid_target_level_422_zero_write(scope_schema) -> None:
    connection = scope_schema
    # the production CHECK makes bad values unreachable; validate defense in depth
    constraint = connection.execute(
        """
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'tcp_user'::regclass AND conname = 'target_level_check'
        """
    ).fetchone()
    if constraint is not None:
        connection.execute('ALTER TABLE tcp_user DROP CONSTRAINT "target_level_check"')
    member_id = _member(connection, "P4", "P9")
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "invalid_member_level"
    assert _draft_count(connection) == 0


def test_regression_levels_422_zero_write(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P7", "P5")
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "member_level_regression"
    assert error.value.status_code == 422
    assert _draft_count(connection) == 0


def test_missing_published_version_422(scope_schema) -> None:
    connection = scope_schema
    connection.execute(
        "UPDATE capability_standard_version SET status = '已归档' "
        "WHERE status = '已发布'"
    )
    member_id = _member(connection, "P4", "P5")
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "published_standard_not_found"
    assert _draft_count(connection) == 0


def test_incomplete_matrix_422_zero_write(scope_schema) -> None:
    connection = scope_schema
    connection.execute(
        """
        DELETE FROM capability_standard_item
        WHERE l3_node_id = (SELECT MIN(l3_node_id) FROM capability_standard_item)
          AND job_level = 'P5'
        """
    )
    member_id = _member(connection, "P4", "P5")
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "published_standard_incomplete"
    assert _draft_count(connection) == 0


def test_empty_scope_preview_and_create(scope_schema) -> None:
    connection = scope_schema
    # Make every P8 cell non-applicable so a P8→P8 member has an empty scope.
    connection.execute(
        """
        UPDATE capability_standard_item
        SET applicable = FALSE, target_level = NULL
        WHERE job_level = 'P8'
        """
    )
    member_id = _member(connection, "P8", "P8")
    scope = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    assert scope["empty_scope"] is True
    assert scope["summary"]["total"] == 0
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "assessment_scope_empty"
    assert error.value.status_code == 422
    assert _draft_count(connection) == 0


# --- preview/create consistency and races ------------------------------------


def test_preview_matches_create_exactly(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    result = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
    )
    assert result["summary"] == preview["summary"]
    assert result["scope_token"] == preview["scope_token"]
    assert result["standard_version"] == preview["standard_version"]
    assessment = get_assessment(connection, int(result["id"]))
    assert assessment is not None
    assert assessment["assessment_scope_version"] == "scope-v1"
    assert assessment["scope_summary"] == preview["summary"]


def test_preview_is_read_only(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    before = _draft_count(connection)
    compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    assert _draft_count(connection) == before
    assert (
        int(
            connection.execute(
                "SELECT COUNT(*) FROM assessment_idempotency_key"
            ).fetchone()[0]
        )
        == 0
    )


def test_token_change_after_new_version_publish_409_zero_write(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    # publish a second standard version between preview and create
    connection.execute(
        "UPDATE capability_standard_version SET status = '已归档' "
        "WHERE status = '已发布'"
    )
    old_version_id = int(preview["standard_version"]["id"])
    connection.execute(
        """
        INSERT INTO capability_standard_version (
            model_id, version_no, label, status, revision, published_at
        )
        SELECT model_id, version_no + 1, '标准版本 v2', '已发布', 1, NOW()
        FROM capability_standard_version WHERE id = %s
        """,
        (old_version_id,),
    )
    new_version_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version WHERE status = '已发布'"
        ).fetchone()[0]
    )
    connection.execute(
        """
        INSERT INTO capability_standard_item (
            version_id, l3_node_id, l1_code, l1_name, l2_code, l2_name,
            l3_code, l3_name, job_level, applicable, target_level, source
        )
        SELECT %s, l3_node_id, l1_code, l1_name, l2_code, l2_name,
               l3_code, l3_name, job_level, applicable, target_level, 'copied'
        FROM capability_standard_item WHERE version_id = %s
        """,
        (new_version_id, old_version_id),
    )
    with pytest.raises(AssessmentScopeError) as error:
        create_assessment_draft(
            connection,
            member_id,
            2026,
            "年度",
            scope_token=str(preview["scope_token"]),
        )
    assert error.value.code == "assessment_scope_changed"
    assert error.value.status_code == 409
    assert error.value.summary is not None
    assert _draft_count(connection) == 0
    assert (
        int(
            connection.execute(
                "SELECT COUNT(*) FROM assessment_idempotency_key"
            ).fetchone()[0]
        )
        == 0
    )


def test_token_change_after_level_change_409_zero_write(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    connection.execute(
        "UPDATE tcp_user SET target_level = 'P6' WHERE id = %s", (member_id,)
    )
    with pytest.raises(AssessmentScopeError) as error:
        create_assessment_draft(
            connection,
            member_id,
            2026,
            "年度",
            scope_token=str(preview["scope_token"]),
        )
    assert error.value.code == "assessment_scope_changed"
    assert _draft_count(connection) == 0


def test_same_count_different_item_set_changes_fingerprint(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    first = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    # Disable one current_required L3 and enable... instead flip one cell:
    # pick one P4-applicable L3 and mark its P4 cell non-applicable; the count
    # stays identical only if we also flip another one the opposite way.
    rows = connection.execute(
        """
        SELECT l3_node_id FROM capability_standard_item i
        JOIN capability_standard_version v ON v.id = i.version_id
        WHERE v.status = '已发布' AND i.job_level = 'P4' AND i.applicable
        ORDER BY l3_node_id LIMIT 1
        """
    ).fetchall()
    a = int(rows[0][0])
    version_id = int(first["standard_version"]["id"])
    connection.execute(
        """
        UPDATE capability_standard_item SET applicable = FALSE, target_level = NULL
        WHERE version_id = %s AND l3_node_id = %s AND job_level = 'P4'
        """,
        (version_id, a),
    )
    # keep the total count identical by making another P4 cell applicable that
    # was not applicable before and whose P5 cell is applicable
    candidate = connection.execute(
        """
        SELECT l3_node_id FROM capability_standard_item
        WHERE version_id = %s AND job_level = 'P5' AND applicable
          AND l3_node_id <> %s
          AND l3_node_id NOT IN (
              SELECT l3_node_id FROM capability_standard_item
              WHERE version_id = %s AND job_level = 'P4' AND applicable
          )
        ORDER BY l3_node_id LIMIT 1
        """,
        (version_id, a, version_id),
    ).fetchone()
    assert candidate is not None
    c = int(candidate[0])
    connection.execute(
        """
        UPDATE capability_standard_item SET applicable = TRUE, target_level = 2
        WHERE version_id = %s AND l3_node_id = %s AND job_level = 'P4'
        """,
        (version_id, c),
    )
    second = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    # identical total, but a different L3 set must change the fingerprint
    assert second["summary"]["total"] == first["summary"]["total"]
    assert second["scope_token"] != first["scope_token"]
    with pytest.raises(AssessmentScopeError) as error:
        create_assessment_draft(
            connection,
            member_id,
            2026,
            "年度",
            scope_token=str(first["scope_token"]),
        )
    assert error.value.code == "assessment_scope_changed"
    assert _draft_count(connection) == 0


def test_token_year_mismatch_409(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    with pytest.raises(AssessmentScopeError) as error:
        create_assessment_draft(
            connection,
            member_id,
            2027,
            "年度",
            scope_token=str(preview["scope_token"]),
        )
    assert error.value.code == "assessment_scope_changed"
    assert _draft_count(connection) == 0


# --- idempotency and open-draft business key ---------------------------------


def test_same_idempotency_key_same_payload_returns_first(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    first = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="key-1",
    )
    second = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="key-1",
    )
    assert second == first
    assert _draft_count(connection) == 1


def test_same_idempotency_key_different_payload_409(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="key-1",
    )
    with pytest.raises(AssessmentScopeError) as error:
        create_assessment_draft(
            connection,
            member_id,
            2027,
            "年度",
            scope_token=str(preview["scope_token"]),
            idempotency_key="key-1",
        )
    assert error.value.code == "idempotency_key_reused"
    assert error.value.status_code == 409
    # only the first assessment exists; no second row, no wrong-year result
    rows = connection.execute(
        "SELECT year FROM assessment WHERE member_id = %s", (member_id,)
    ).fetchall()
    assert [int(row[0]) for row in rows] == [2026]


def test_open_draft_business_key_allows_different_year_and_type(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    first = create_scoped_draft(connection, member_id, 2026, "年度")
    second = create_scoped_draft(connection, member_id, 2027, "年度")
    third = create_scoped_draft(connection, member_id, 2026, "晋升复核")
    assert len({first, second, third}) == 3
    assert _draft_count(connection) == 3


def test_open_draft_business_key_conflict_409(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    first = create_scoped_draft(connection, member_id, 2026)
    with pytest.raises(AssessmentScopeError) as error:
        create_scoped_draft(connection, member_id, 2026)
    assert error.value.code == "open_draft_exists"
    assert error.value.status_code == 409
    assert error.value.issues == [{"assessment_id": first}]
    assert _draft_count(connection) == 1


def test_concurrent_create_same_business_key_one_winner(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    connection.commit()
    barrier = Barrier(2)

    def attempt() -> str:
        with psycopg.connect(TEST_DATABASE_URL) as second:
            barrier.wait()
            try:
                create_scoped_draft(second, member_id, 2026)
                second.commit()
                return "created"
            except AssessmentScopeError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = sorted(executor.map(lambda _: attempt(), range(2)))
    assert outcomes[0] == "created"
    assert outcomes[1] == "open_draft_exists", f"unexpected outcomes: {outcomes}"
    assert _draft_count(connection) == 1


# --- frozen snapshots ---------------------------------------------------------


def test_detail_snapshots_and_unique_node_identity(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    rows = connection.execute(
        """
        SELECT scope_type, standard_job_level_snapshot, standard_target_applicable,
               standard_target_level, l3_node_id, l1_code, l2_code, l3_name
        FROM assessment_detail WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchall()
    assert rows
    for (
        scope_type,
        job_level_snapshot,
        applicable,
        target_level,
        node_id,
        l1_code,
        l2_code,
        l3_name,
    ) in rows:
        assert applicable is True
        assert target_level is not None
        assert node_id is not None
        assert l1_code and l2_code and l3_name
        if scope_type == "current_required":
            assert job_level_snapshot == "P4"
        else:
            assert scope_type == "target_progressive"
            assert job_level_snapshot == "P5"
    # partial unique index enforced
    dup = rows[0]
    assessment = get_assessment(connection, assessment_id)
    assert assessment is not None
    dup_code = assessment["details"][0]["l3_code"]
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(
            """
            INSERT INTO assessment_detail (
                assessment_id, l3_code, target_level, l3_node_id,
                scope_type, standard_job_level_snapshot
            )
            VALUES (%s, %s, 1, %s, 'current_required', 'P4')
            """,
            (assessment_id, f"{dup_code}.dup", dup[4]),
        )


def test_history_frozen_after_catalog_rename_and_move(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    assessment_id = create_scoped_draft(connection, member_id, 2026)
    before = get_assessment(connection, assessment_id)
    assert before is not None
    detail = before["details"][0]
    node_id = int(detail["l3_node_id"])
    original_name = str(detail["l3_name"])
    original_l2 = str(detail["l2_code"])

    other_l2 = connection.execute(
        """
        SELECT id FROM capability_node
        WHERE node_type = 'L2' AND code <> %s ORDER BY code LIMIT 1
        """,
        (original_l2,),
    ).fetchone()
    assert other_l2 is not None
    connection.execute(
        "UPDATE capability_node SET name = '改名后的路径', "
        "parent_node_id = %s WHERE id = %s",
        (int(other_l2[0]), node_id),
    )
    connection.commit()

    after = get_assessment(connection, assessment_id)
    assert after is not None
    frozen = next(
        item for item in after["details"] if int(item["l3_node_id"]) == node_id
    )
    assert frozen["l3_name"] == original_name
    assert frozen["l2_code"] == original_l2
    assert after["scope_summary"] == before["scope_summary"]
    frozen_group = next(
        group for group in after["l2_groups"] if group["l2_code"] == original_l2
    )
    assert any(int(item["l3_node_id"]) == node_id for item in frozen_group["details"])


# --- legacy compatibility ------------------------------------------------------


def test_legacy_310_draft_stays_legacy_and_filters_not_applicable(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    # simulate a legacy (pre-#60) draft: details from the target-level column
    # (P5), scope columns NULL — includes not-applicable rows
    version_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version WHERE status = '已发布'"
        ).fetchone()[0]
    )
    assessment_id = int(
        connection.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status,
                member_current_level_snapshot, member_target_level_snapshot,
                capability_standard_version_id
            )
            VALUES (%s, 2026, 1, '年度', '草稿', 'P4', 'P5', %s)
            RETURNING id
            """,
            (member_id, version_id),
        ).fetchone()[0]
    )
    connection.execute(
        """
        INSERT INTO assessment_detail (
            assessment_id, l3_code, target_level, standard_target_applicable,
            standard_target_level, target_snapshot_source
        )
        SELECT %s, n.code, i.target_level, i.applicable, i.target_level,
               'legacy'
        FROM capability_node n
        JOIN capability_standard_item i
          ON i.l3_node_id = n.id AND i.version_id = %s AND i.job_level = 'P5'
        WHERE n.node_type = 'L3' AND n.enabled = TRUE
        """,
        (assessment_id, version_id),
    )
    legacy = get_assessment(connection, assessment_id)
    assert legacy is not None
    assert legacy["assessment_scope_version"] is None
    assert legacy["scope_summary"] is None
    assert all(detail["scope_type"] is None for detail in legacy["details"])
    # legacy read path must still hide not-applicable details from progress
    applicable = [
        detail
        for detail in legacy["details"]
        if detail["standard_target_applicable"] is True
    ]
    not_applicable = [
        detail
        for detail in legacy["details"]
        if detail["standard_target_applicable"] is False
    ]
    assert not_applicable, "legacy draft must contain not-applicable details"
    assert len(applicable) < len(legacy["details"])


def test_migration_preflight_duplicate_open_rolls_back(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    # simulate the pre-v0006 shape: no scope column, no open-draft index
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS scope_type")
    connection.execute("DROP INDEX IF EXISTS assessment_one_open_per_scope")
    for version in (1, 2):
        connection.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type, status)
            VALUES (%s, 2026, %s, '年度', '草稿')
            """,
            (member_id, version),
        )
    duplicate_ids = sorted(
        int(row[0])
        for row in connection.execute(
            "SELECT id FROM assessment WHERE member_id = %s", (member_id,)
        ).fetchall()
    )
    with pytest.raises(ValueError, match="duplicate open assessments") as error:
        with connection.transaction():
            upgrade_v0006(connection)
    for assessment_id in duplicate_ids:
        assert str(assessment_id) in str(error.value)
    # DDL fully rolled back: column and index stay absent
    assert (
        connection.execute(
            """
            SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name = 'assessment_detail' AND column_name = 'scope_type'
            """
        ).fetchone()[0]
        == 0
    )
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM pg_indexes "
            "WHERE indexname = 'assessment_one_open_per_scope'"
        ).fetchone()[0]
        == 0
    )
    # and the duplicate data is left untouched for a human decision
    assert len(duplicate_ids) == 2


# --- API contract --------------------------------------------------------------


async def _asgi_request(
    method: str,
    path: str,
    *,
    query: str = "",
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
    headers: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    messages: list[dict[str, Any]] = []
    raw_headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""
    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        raw_headers.append((b"content-type", b"application/json"))
        raw_headers.append((b"content-length", str(len(body_bytes)).encode()))
    if cookies:
        raw_headers.append(
            (
                b"cookie",
                "; ".join(f"{k}={v}" for k, v in cookies.items()).encode(),
            )
        )
    for name, value in (headers or {}).items():
        raw_headers.append((name.lower().encode(), value.encode()))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": query.encode(),
            "headers": raw_headers,
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )
    status_code = next(m["status"] for m in messages if "status" in m)
    raw = b"".join(m["body"] for m in messages if m["type"] == "http.response.body")
    return status_code, json.loads(raw) if raw else None


def _request(
    method: str,
    path: str,
    **kwargs: Any,
) -> tuple[int, Any | None]:
    return asyncio.run(_asgi_request(method, path, **kwargs))


def _login(connection: psycopg.Connection, username: str) -> dict[str, str]:
    messages: list[dict[str, Any]] = []

    async def receive() -> dict[str, Any]:
        body = json.dumps({"username": username, "password": "secret"}).encode()
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    body_bytes = json.dumps({"username": username, "password": "secret"}).encode()
    asyncio.run(
        app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/auth/login",
                "raw_path": b"/api/auth/login",
                "query_string": b"",
                "headers": [
                    (b"content-type", b"application/json"),
                    (b"content-length", str(len(body_bytes)).encode()),
                ],
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
    )
    status_code = next(m["status"] for m in messages if "status" in m)
    assert status_code == 200
    set_cookies = [
        value.decode()
        for m in messages
        for name, value in m.get("headers", [])
        if name == b"set-cookie"
    ]
    assert set_cookies
    cookie_pair = set_cookies[0].split(";")[0]
    name, value = cookie_pair.split("=", 1)
    return {name: value}


def test_api_preview_create_and_scope_changed(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    cookies = _login(connection, "member")

    status, preview = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026&assessment_type=%E5%B9%B4%E5%BA%A6",
        cookies=cookies,
    )
    assert status == 200
    assert preview["member_current_level"] == "P4"
    assert preview["member_target_level"] == "P5"
    assert preview["summary"]["total"] > 0
    assert preview["empty_scope"] is False
    assert preview["scope_version"] == "scope-v1"
    assert preview["open_draft_id"] is None
    direct = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    assert preview["scope_token"] == direct["scope_token"], (
        f"api={preview['scope_token']} direct={direct['scope_token']} "
        f"api_year={preview['year']!r} api_type={preview['assessment_type']!r}"
    )

    status, created = _request(
        "POST",
        "/api/assessments",
        body={
            "year": 2026,
            "assessment_type": "年度",
            "scope_token": preview["scope_token"],
        },
        cookies=cookies,
    )
    assert status == 200, f"create failed: {created}"
    assert created["summary"] == preview["summary"]
    assert created["revision"] == 1

    # open draft reported by a later preview
    status, second_preview = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026&assessment_type=%E5%B9%B4%E5%BA%A6",
        cookies=cookies,
    )
    assert status == 200
    assert second_preview["open_draft_id"] == created["id"]

    # stale token rejected with the fresh summary attached
    connection.execute(
        "UPDATE tcp_user SET target_level = 'P6' WHERE id = %s", (member_id,)
    )
    connection.commit()
    status, changed = _request(
        "POST",
        "/api/assessments",
        body={
            "year": 2026,
            "assessment_type": "年度",
            "scope_token": preview["scope_token"],
        },
        cookies=cookies,
    )
    assert status == 409
    assert changed["detail"]["code"] == "assessment_scope_changed"
    assert changed["detail"]["summary"]["member_target_level"] == "P6"
    rows = connection.execute(
        "SELECT COUNT(*) FROM assessment WHERE member_id = %s", (member_id,)
    ).fetchone()
    assert int(rows[0]) == 1


def test_api_create_forbidden_for_non_member(scope_schema) -> None:
    connection = scope_schema
    leader_id = create_user(connection, "leader", "leader", "secret")
    assign_role(connection, leader_id, "Leader")
    connection.commit()
    cookies = _login(connection, "leader")
    status, _ = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026",
        cookies=cookies,
    )
    assert status == 403
    status, _ = _request(
        "POST",
        "/api/assessments",
        body={"year": 2026, "scope_token": "0" * 64},
        cookies=cookies,
    )
    assert status == 403


def test_api_list_returns_snapshot_fields(scope_schema) -> None:
    connection = scope_schema
    _member(connection, "P4", "P5")
    create_scoped_draft(
        connection,
        int(
            connection.execute(
                "SELECT id FROM tcp_user WHERE username = 'member'"
            ).fetchone()[0]
        ),
        2026,
    )
    connection.commit()
    cookies = _login(connection, "member")
    status, assessments = _request("GET", "/api/assessments", cookies=cookies)
    assert status == 200
    assert len(assessments) == 1
    item = assessments[0]
    assert item["member_current_level_snapshot"] == "P4"
    assert item["member_target_level_snapshot"] == "P5"
    assert item["assessment_scope_version"] == "scope-v1"
    assert item["standard_version_label"]


def test_api_idempotency_key_header_replay(scope_schema) -> None:
    connection = scope_schema
    _member(connection, "P4", "P5")
    cookies = _login(connection, "member")
    status, preview = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026&assessment_type=%E5%B9%B4%E5%BA%A6",
        cookies=cookies,
    )
    assert status == 200
    body = {
        "year": 2026,
        "assessment_type": "年度",
        "scope_token": preview["scope_token"],
    }
    status, first = _request(
        "POST",
        "/api/assessments",
        body=body,
        cookies=cookies,
        headers={"Idempotency-Key": "idem-1"},
    )
    assert status == 200
    status, replay = _request(
        "POST",
        "/api/assessments",
        body=body,
        cookies=cookies,
        headers={"Idempotency-Key": "idem-1"},
    )
    assert status == 200
    assert replay["id"] == first["id"]
    status, reused = _request(
        "POST",
        "/api/assessments",
        body={**body, "year": 2027},
        cookies=cookies,
        headers={"Idempotency-Key": "idem-1"},
    )
    assert status == 409
    assert reused["detail"]["code"] == "idempotency_key_reused"


# --- P1-2: idempotency replay survives level/version/matrix changes ----------


def test_idempotency_replay_survives_level_change(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    first = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-level",
    )
    # Change member target level after the first create
    connection.execute(
        "UPDATE tcp_user SET target_level = 'P6' WHERE id = %s", (member_id,)
    )
    connection.commit()
    # Replay with same key + same scope_token must return the first response
    replay = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-level",
    )
    assert replay["id"] == first["id"]
    assert replay["summary"] == first["summary"]
    assert _draft_count(connection) == 1


def test_idempotency_replay_survives_version_change(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    first = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-version",
    )
    # Archive published version and publish a new one
    old_version_id = int(first["standard_version"]["id"])
    connection.execute(
        "UPDATE capability_standard_version SET status = '已归档' WHERE id = %s",
        (old_version_id,),
    )
    connection.execute(
        """
        INSERT INTO capability_standard_version (model_id, version_no, label, status,
            revision, published_at)
        SELECT model_id, version_no + 1, 'v2', '已发布', 1, NOW()
        FROM capability_standard_version WHERE id = %s
        """,
        (old_version_id,),
    )
    new_version_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version WHERE status = '已发布'"
        ).fetchone()[0]
    )
    connection.execute(
        """
        INSERT INTO capability_standard_item (version_id, l3_node_id, l1_code,
            l1_name, l2_code, l2_name, l3_code, l3_name, job_level, applicable,
            target_level, source)
        SELECT %s, l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
               job_level, applicable, target_level, 'copied'
        FROM capability_standard_item WHERE version_id = %s
        """,
        (new_version_id, old_version_id),
    )
    connection.commit()
    replay = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-version",
    )
    assert replay["id"] == first["id"]
    assert _draft_count(connection) == 1


def test_idempotency_replay_survives_matrix_change(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    first = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-matrix",
    )
    # Flip a cell in the matrix so the scope token would differ
    version_id = int(first["standard_version"]["id"])
    connection.execute(
        """
        UPDATE capability_standard_item
        SET applicable = FALSE, target_level = NULL
        WHERE version_id = %s AND job_level = 'P4' AND applicable
          AND l3_node_id = (
              SELECT l3_node_id FROM capability_standard_item
              WHERE version_id = %s AND job_level = 'P4' AND applicable
              ORDER BY l3_node_id LIMIT 1
          )
        """,
        (version_id, version_id),
    )
    connection.commit()
    replay = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(preview["scope_token"]),
        idempotency_key="idem-matrix",
    )
    assert replay["id"] == first["id"]
    assert _draft_count(connection) == 1


# --- P1-1: lifespan order test ------------------------------------------------


def test_lifespan_v0006_preflight_handles_duplicate_open_drafts(
    connection: psycopg.Connection,
) -> None:
    """Simulate pre-v0006 DB with duplicates and exercise the real lifespan."""
    from app.access.schema import create_access_schema
    from app.assessment.schema import create_assessment_schema
    from app.catalog.importer import import_catalog, resolve_workbook_dir
    from app.main import lifespan
    from app.planning.schema import create_planning_schema

    with connection.transaction():
        for table in (
            "schema_migration",
            "assessment_idempotency_key",
            "assessment_draft_target_repair_audit",
            "assessment_review",
            "gap",
            "assessment_detail",
            "assessment",
            "tcp_session",
            "tcp_user_role",
            "tcp_role",
            "tcp_user",
            "capability_standard_version_audit",
            "capability_standard_item",
            "capability_standard_version",
            "capability_node_resource",
            "learning_resource",
            "capability_node",
            "capability_model",
            "buddy_relationship",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")

    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    import_catalog(resolve_workbook_dir(), connection)
    connection.commit()

    # Simulate pre-v0006: drop v0006 columns and indexes, insert duplicates
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS scope_type")
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l3_node_id")
    connection.execute(
        "ALTER TABLE assessment_detail DROP COLUMN IF EXISTS "
        "standard_job_level_snapshot"
    )
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l1_code")
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l1_name")
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l2_code")
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l2_name")
    connection.execute("ALTER TABLE assessment_detail DROP COLUMN IF EXISTS l3_name")
    connection.execute(
        "ALTER TABLE assessment DROP COLUMN IF EXISTS assessment_scope_version"
    )
    connection.execute("DROP INDEX IF EXISTS assessment_one_open_per_scope")
    connection.execute("DROP INDEX IF EXISTS assessment_detail_node_identity")
    connection.execute("DROP TABLE IF EXISTS assessment_idempotency_key")
    # Create schema_migration table and insert pre-v0006 markers
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migration (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    for version in (
        "0001_standard_targets",
        "0002_assessment_inheritance_revision",
        "0003_assessment_explicit_clear",
        "0004_legacy_draft_target_repair",
        "0005_capability_standard_versioning",
    ):
        connection.execute(
            "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
        )
    connection.commit()

    member_id = _member(connection, "P4", "P5")
    for version in (1, 2):
        connection.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type, status)
            VALUES (%s, 2026, %s, '年度', '草稿')
            """,
            (member_id, version),
        )
    duplicate_ids = sorted(
        int(row[0])
        for row in connection.execute(
            "SELECT id FROM assessment WHERE member_id = %s", (member_id,)
        ).fetchall()
    )
    assert len(duplicate_ids) == 2
    connection.commit()

    # lifespan runs in its own connection; it must see our committed duplicates.
    # We borrow the lifespan async context manager and drive it synchronously.
    import asyncio
    import os

    original_url = os.environ.get("DATABASE_URL")
    try:
        os.environ["DATABASE_URL"] = TEST_DATABASE_URL

        async def drive() -> None:
            async with lifespan(app) as _:
                pass

        with pytest.raises(ValueError, match="duplicate open assessments"):
            asyncio.run(drive())
    finally:
        if original_url is not None:
            os.environ["DATABASE_URL"] = original_url

    # v0006 DDL must not have landed: index, marker, idempotency table
    with psycopg.connect(TEST_DATABASE_URL) as verify:
        assert (
            verify.execute(
                "SELECT COUNT(*) FROM pg_indexes "
                "WHERE indexname = 'assessment_one_open_per_scope'"
            ).fetchone()[0]
            == 0
        )
        assert (
            verify.execute(
                "SELECT COUNT(*) FROM schema_migration "
                "WHERE version = '0006_assessment_scope_snapshots'"
            ).fetchone()[0]
            == 0
        )
        assert (
            verify.execute(
                "SELECT 1 FROM information_schema.tables "
                "WHERE table_name = 'assessment_idempotency_key'"
            ).fetchone()
            is None
        )
        # Conflict data preserved
        remaining = sorted(
            int(row[0])
            for row in verify.execute(
                "SELECT id FROM assessment WHERE member_id = %s", (member_id,)
            ).fetchall()
        )
        assert remaining == duplicate_ids


# --- P1-4: API-layer concurrent create test ----------------------------------


def test_api_concurrent_create_one_200_one_409(scope_schema) -> None:
    connection = scope_schema
    _member(connection, "P4", "P5")
    cookies = _login(connection, "member")
    status, preview = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026&assessment_type=%E5%B9%B4%E5%BA%A6",
        cookies=cookies,
    )
    assert status == 200
    body = {
        "year": 2026,
        "assessment_type": "年度",
        "scope_token": preview["scope_token"],
    }

    barrier = Barrier(2)
    outcomes: list[tuple[int, dict[str, object] | None]] = []

    def attempt() -> None:
        import asyncio as aio

        async def go() -> None:
            barrier.wait()
            messages: list[dict[str, object]] = []
            body_bytes = json.dumps(body).encode()

            async def receive() -> dict[str, Any]:
                return {
                    "type": "http.request",
                    "body": body_bytes,
                    "more_body": False,
                }

            async def send(message: dict[str, Any]) -> None:
                messages.append(message)

            await app(
                {
                    "type": "http",
                    "asgi": {"version": "3.0"},
                    "http_version": "1.1",
                    "method": "POST",
                    "scheme": "http",
                    "path": "/api/assessments",
                    "raw_path": b"/api/assessments",
                    "query_string": b"",
                    "headers": [
                        (b"content-type", b"application/json"),
                        (b"content-length", str(len(body_bytes)).encode()),
                        (
                            b"cookie",
                            "; ".join(f"{k}={v}" for k, v in cookies.items()).encode(),
                        ),
                    ],
                    "client": ("testclient", 50000),
                    "server": ("testserver", 80),
                },
                receive,
                send,
            )
            sc = next(m["status"] for m in messages if "status" in m)
            raw = b"".join(
                m["body"] for m in messages if m["type"] == "http.response.body"
            )
            outcomes.append((sc, json.loads(raw) if raw else None))

        aio.run(go())

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(attempt),
            executor.submit(attempt),
        ]
        for f in futures:
            f.result()

    statuses = sorted(code for code, _ in outcomes)
    assert statuses == [200, 409], f"unexpected statuses: {statuses}"
    success = next(
        ((code, payload) for code, payload in outcomes if code == 200),
        None,
    )
    assert success is not None
    assert success[1] is not None
    assessment_id = int(success[1]["id"])
    conflict = next(
        ((code, payload) for code, payload in outcomes if code == 409),
        None,
    )
    assert conflict is not None
    assert conflict[1]["detail"]["code"] == "open_draft_exists"
    assert conflict[1]["detail"]["issues"][0]["assessment_id"] == assessment_id
    assert (
        int(
            connection.execute(
                "SELECT COUNT(*) FROM assessment WHERE member_id = "
                "(SELECT id FROM tcp_user WHERE username = 'member')"
            ).fetchone()[0]
        )
        == 1
    )


# --- P1-5: invalid assessment_type API tests ---------------------------------


def test_api_scope_preview_invalid_assessment_type_422(scope_schema) -> None:
    connection = scope_schema
    _member(connection, "P4", "P5")
    cookies = _login(connection, "member")
    status, data = _request(
        "GET",
        "/api/assessments/scope-preview",
        query="year=2026&assessment_type=INVALID",
        cookies=cookies,
    )
    assert status == 422
    assert data["detail"]["code"] == "invalid_assessment_type"
    assert _draft_count(connection) == 0


def test_api_create_invalid_assessment_type_422_zero_write(scope_schema) -> None:
    connection = scope_schema
    _member(connection, "P4", "P5")
    cookies = _login(connection, "member")
    status, data = _request(
        "POST",
        "/api/assessments",
        body={
            "year": 2026,
            "assessment_type": "INVALID",
            "scope_token": "0" * 64,
        },
        cookies=cookies,
    )
    assert status == 422
    assert data["detail"]["code"] == "invalid_assessment_type"
    assert _draft_count(connection) == 0


# --- P1-7: l3_node_id inheritance tests --------------------------------------


def test_inheritance_matches_by_l3_node_id_not_code(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    # Create first approved assessment
    first_id = create_scoped_draft(connection, member_id, 2026)
    # Fill in a current_level for one L3 to be inherited
    l3_code = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail "
        "WHERE assessment_id = %s AND scope_type = 'current_required' "
        "ORDER BY l3_code LIMIT 1",
        (first_id,),
    ).fetchone()
    assert l3_code is not None
    first_l3_code, first_node_id = l3_code
    connection.execute(
        "UPDATE assessment_detail "
        "SET current_level = 3, evidence_note = 'inherited note' "
        "WHERE assessment_id = %s AND l3_code = %s",
        (first_id, str(first_l3_code)),
    )
    # Submit/review/approve
    connection.execute(
        "UPDATE assessment SET status = '已复核' WHERE id = %s", (first_id,)
    )
    connection.execute(
        """
        INSERT INTO assessment_review (assessment_id, sequence, buddy_id,
            status, conclusion, reviewed_at)
        VALUES (%s, 1, %s, '已闭环', '认可', NOW())
        """,
        (first_id, member_id),
    )
    connection.commit()

    # Rename the L3 in the catalog so code matching would fail
    connection.execute(
        "UPDATE capability_node SET name = 'renamed-node' WHERE id = %s",
        (int(first_node_id),),
    )
    connection.commit()

    # Create second draft — inheritance must still work via node_id
    second_preview = compute_assessment_scope(
        connection, member_id=member_id, year=2026, assessment_type="年度"
    )
    second_result = create_assessment_draft(
        connection,
        member_id,
        2026,
        "年度",
        scope_token=str(second_preview["scope_token"]),
    )
    second_assessment = get_assessment(connection, int(second_result["id"]))
    assert second_assessment is not None
    inherited_detail = next(
        (
            d
            for d in second_assessment["details"]
            if int(d["l3_node_id"]) == int(first_node_id)
        ),
        None,
    )
    assert inherited_detail is not None
    assert inherited_detail["inherited_from_assessment_id"] == first_id
    assert inherited_detail["inherited_current_level"] == 3


def test_inheritance_legacy_code_fallback_when_node_id_is_null(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    # Pick an existing L3 node from the catalog for the legacy draft
    l3_row = connection.execute(
        "SELECT code, id FROM capability_node WHERE node_type = 'L3' "
        "AND enabled = TRUE ORDER BY code LIMIT 1"
    ).fetchone()
    assert l3_row is not None
    legacy_l3_code = str(l3_row[0])

    # Legacy approved assessment with l3_node_id=NULL details
    legacy_id = int(
        connection.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type,
                status, member_current_level_snapshot, member_target_level_snapshot)
            VALUES (%s, 2026, 1, '年度', '已复核', 'P4', 'P5')
            RETURNING id
            """,
            (member_id,),
        ).fetchone()[0]
    )
    connection.execute(
        """
        INSERT INTO assessment_detail (assessment_id, l3_code, current_level,
            evidence_note, target_level, standard_target_applicable,
            standard_target_level, target_snapshot_source)
        VALUES (%s, %s, 3, 'legacy evidence', 4, TRUE, 4, 'legacy')
        """,
        (legacy_id, legacy_l3_code),
    )
    connection.execute(
        """
        INSERT INTO assessment_review (assessment_id, sequence, buddy_id,
            status, conclusion, reviewed_at)
        VALUES (%s, 1, %s, '已闭环', '认可', NOW())
        """,
        (legacy_id, member_id),
    )
    connection.commit()

    # New draft — should inherit from legacy via code fallback
    # (since legacy detail has l3_node_id=NULL)
    second_preview = compute_assessment_scope(
        connection, member_id=member_id, year=2027, assessment_type="年度"
    )
    second_result = create_assessment_draft(
        connection,
        member_id,
        2027,
        "年度",
        scope_token=str(second_preview["scope_token"]),
    )
    second_assessment = get_assessment(connection, int(second_result["id"]))
    assert second_assessment is not None
    inherited_detail = next(
        (d for d in second_assessment["details"] if d["l3_code"] == legacy_l3_code),
        None,
    )
    assert inherited_detail is not None
    assert inherited_detail["inherited_current_level"] == 3
    assert inherited_detail["inherited_evidence_note"] == "legacy evidence"


# --- P1-C: scope-v1 inheritance refuses code match when node id differs -----


def test_inheritance_refuses_code_match_when_node_id_differs(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")
    # First approved scope-v1 assessment
    first_id = create_scoped_draft(connection, member_id, 2026)
    # Get a scope-v1 detail with its node_id and code
    detail_row = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail "
        "WHERE assessment_id = %s AND scope_type = 'current_required' "
        "ORDER BY l3_code LIMIT 1",
        (first_id,),
    ).fetchone()
    assert detail_row is not None
    original_code = str(detail_row[0])
    original_node_id = int(detail_row[1])
    connection.execute(
        "UPDATE assessment_detail "
        "SET current_level = 3, evidence_note = 'scope-v1 inherited' "
        "WHERE assessment_id = %s AND l3_code = %s",
        (first_id, original_code),
    )
    # Submit/review/approve
    connection.execute(
        "UPDATE assessment SET status = '已复核' WHERE id = %s", (first_id,)
    )
    connection.execute(
        """
        INSERT INTO assessment_review (assessment_id, sequence, buddy_id,
            status, conclusion, reviewed_at)
        VALUES (%s, 1, %s, '已闭环', '认可', NOW())
        """,
        (first_id, member_id),
    )
    connection.commit()

    # NOW: rename a *different* L3 to reuse original_code, so that code match
    # would incorrectly inherit from the original node if it relied on code.
    other_l3 = connection.execute(
        "SELECT id, code FROM capability_node "
        "WHERE node_type = 'L3' AND id <> %s AND enabled = TRUE "
        "ORDER BY id LIMIT 1",
        (original_node_id,),
    ).fetchone()
    assert other_l3 is not None
    other_id, other_old_code = int(other_l3[0]), str(other_l3[1])

    # Temporarily swap codes so code-based matching would make node B appear
    # to match node A's heritage — scope-v1 must not fall for this.
    # 3-step swap to avoid UNIQUE(model_id, code) conflicts:
    tmp_code = original_code + "___tmp"
    connection.execute(
        "UPDATE capability_node SET code = %s WHERE id = %s",
        (tmp_code, original_node_id),
    )
    connection.execute(
        "UPDATE capability_node SET code = %s WHERE id = %s",
        (original_code, other_id),
    )
    connection.execute(
        "UPDATE capability_node SET code = %s WHERE id = %s",
        (other_old_code, original_node_id),
    )
    connection.commit()

    # Create second draft — inheritance must match by node_id, not code
    second_preview = compute_assessment_scope(
        connection, member_id=member_id, year=2027, assessment_type="年度"
    )
    second_result = create_assessment_draft(
        connection,
        member_id,
        2027,
        "年度",
        scope_token=str(second_preview["scope_token"]),
    )
    second_assessment = get_assessment(connection, int(second_result["id"]))
    assert second_assessment is not None

    # The original node (now with different code) must still inherit
    original_detail = next(
        (
            d
            for d in second_assessment["details"]
            if int(d["l3_node_id"]) == original_node_id
        ),
        None,
    )
    assert original_detail is not None
    assert original_detail["inherited_current_level"] == 3
    assert original_detail["inherited_evidence_note"] == "scope-v1 inherited"

    # The other node (now with the original code) must NOT inherit
    other_detail = next(
        (d for d in second_assessment["details"] if int(d["l3_node_id"]) == other_id),
        None,
    )
    assert other_detail is not None
    assert other_detail["inherited_current_level"] is None
    assert other_detail["inherited_evidence_note"] is None


# --- P1-B: INSERT-level UniqueViolation converted to 409 --------------------


def test_insert_unique_violation_converted_to_409(scope_schema) -> None:
    connection = scope_schema
    member_id = _member(connection, "P4", "P5")

    # Step 1: create a draft normally to establish the business key
    first_id = create_scoped_draft(connection, member_id, 2026)
    assert _draft_count(connection) == 1

    # Step 2: on a second connection, bypass all checks and attempt a raw
    # INSERT that conflicts on the partial unique index.  This exercises the
    # same code path that `create_assessment_draft`'s savepoint guards — a
    # UniqueViolation on INSERT must never escape as a 500.
    conn2 = psycopg.connect(TEST_DATABASE_URL)
    try:
        conn2.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status,
                member_current_level_snapshot, member_target_level_snapshot
            )
            VALUES (%s, 2026, 99, '年度', '草稿', 'P4', 'P5')
            """,
            (member_id,),
        )
        conn2.commit()
        pytest.fail("partial unique index must prevent duplicate open draft")
    except psycopg.errors.UniqueViolation:
        conn2.rollback()
    finally:
        conn2.close()

    # Only one open draft must exist
    rows = connection.execute(
        """
        SELECT id FROM assessment
        WHERE member_id = %s AND year = 2026 AND assessment_type = '年度'
          AND status IN ('草稿', '建议调整')
        ORDER BY id
        """,
        (member_id,),
    ).fetchall()
    assert [int(row[0]) for row in rows] == [first_id]
