"""PR #81 round 1 — staged self-assessment workflow: backend contract tests.

The decoupling contract (confirmed business semantics):

1. Formal submission requires a valid assessment outcome only for
   current-role REQUIRED capabilities (``scope_type=current_required``).
   ADVANCED (``scope_type=target_progressive``) items may stay unassessed;
   they must not block submission and must appear as follow-up work.
2. Submission never requires Gap plan decisions (member_priority /
   include_in_plan / plan_quarter / plan_month): a fully-assessed REQUIRED
   scope with undecided planning submits; undecided Gaps become the growth
   backlog after review.
3. The strict plan-selection contract still guards plan generation at Buddy
   approval (``validate_plan_selection``), so items the member selected into
   the annual plan keep priority and plan-time validation.
4. Approval creates plan items only for selected items; unselected backlog
   Gaps produce no plan items; idempotent retries create no duplicates.
5. The member dashboard exposes accurate follow-up counts for the four
   personal-workspace categories.
6. Owner/non-owner boundaries and zero-write direct-API behaviour are kept.

On the baseline (before the decoupling fix) tests 1, 3, 5, 7 are RED: the
submit gate requires plan decisions for every positive gap and assesses
every applicable item, so the same scenarios are rejected with 422.
"""

import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import get_assessment
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.main import app
from app.migrations import run_migrations
from app.planning.schema import create_planning_schema
from tests.review_support import ReviewTestBase
from tests.standard_target_support import create_scoped_draft
from tests.test_assessment_plan_selection import _login

_L3 = "P01-L2A-L3A"


@pytest.fixture
def staged_schema(connection: psycopg.Connection) -> psycopg.Connection:
    """Scope-v1 schema with the real imported standard matrix + migrations."""
    with connection.transaction():
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment_idempotency_key")
        connection.execute("DROP TABLE IF EXISTS assessment_draft_target_repair_audit")
        connection.execute("DROP TABLE IF EXISTS assessment")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    create_assessment_schema(connection)
    connection.execute("DROP TABLE IF EXISTS schema_migration CASCADE")
    connection.execute("DROP TABLE IF EXISTS capability_standard_item CASCADE")
    connection.execute(
        "DROP TABLE IF EXISTS capability_standard_planning_snapshot CASCADE"
    )
    connection.execute("DROP TABLE IF EXISTS capability_standard_version CASCADE")
    import_catalog(resolve_workbook_dir(), connection)
    create_planning_schema(connection)
    run_migrations(connection)
    connection.commit()
    return connection


# ── HTTP helpers (mirror test_assessment_plan_selection) ────────────────


def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    import asyncio

    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""

    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(body_bytes)).encode("utf-8")))

    if cookies:
        cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
        headers.append((b"cookie", cookie_header.encode("utf-8")))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    async def _run() -> None:
        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": urlsplit(path).path,
                "raw_path": urlsplit(path).path.encode("utf-8"),
                "query_string": urlsplit(path).query.encode("utf-8"),
                "headers": headers,
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )

    asyncio.run(_run())

    status_message = next(message for message in messages if "status" in message)
    payload = next(
        (
            message
            for message in messages
            if message.get("type") == "http.response.body"
        ),
        None,
    )
    body_out = None
    if payload is not None and payload.get("body"):
        raw = payload["body"]
        body_out = json.loads(raw.decode("utf-8")) if isinstance(raw, bytes) else raw
    return int(status_message["status"]), body_out


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any]:
    return _asgi_request(method, path, body, cookies)


def _create_test_user(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
) -> int:
    user_id = create_user(connection, username, username, "secret")
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P8' WHERE id = %s",
        (user_id,),
    )
    connection.commit()
    return user_id


def _detail_l3_node_id(
    connection: psycopg.Connection, assessment_id: int, l3_code: str
) -> int | None:
    row = connection.execute(
        "SELECT l3_node_id FROM assessment_detail "
        "WHERE assessment_id = %s AND l3_code = %s",
        (assessment_id, l3_code),
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _scope_type(
    connection: psycopg.Connection, assessment_id: int, l3_code: str
) -> str | None:
    row = connection.execute(
        "SELECT scope_type FROM assessment_detail "
        "WHERE assessment_id = %s AND l3_code = %s",
        (assessment_id, l3_code),
    ).fetchone()
    return row[0] if row else None


def _pick_required_and_advanced(
    connection: psycopg.Connection,
) -> tuple[str, str]:
    """One code applicable at P4 (current_required) and one applicable only
    at P8 (target_progressive), derived from the imported matrix so the tests
    stay valid if the workbook rows change."""
    required = connection.execute(
        """
        SELECT i.l3_code
        FROM capability_standard_item i
        WHERE i.job_level = 'P4' AND i.applicable = TRUE
        ORDER BY i.l3_code
        LIMIT 1
        """,
    ).fetchone()
    advanced = connection.execute(
        """
        SELECT i.l3_code
        FROM capability_standard_item i
        WHERE i.job_level = 'P4' AND i.applicable = FALSE
          AND EXISTS (
              SELECT 1 FROM capability_standard_item j
              WHERE j.l3_code = i.l3_code AND j.job_level = 'P8'
                AND j.applicable = TRUE
          )
        ORDER BY i.l3_code
        LIMIT 1
        """,
    ).fetchone()
    assert required is not None and advanced is not None
    return str(required[0]), str(advanced[0])


def _enable_only(connection: psycopg.Connection, codes: list[str]) -> None:
    connection.execute(
        "UPDATE capability_node SET enabled = (code = ANY(%s)) "
        "WHERE node_type = 'L3'",
        (codes,),
    )
    connection.commit()


def _full_batch(
    connection: psycopg.Connection,
    assessment_id: int,
    updates: dict[str, dict[str, object]],
) -> list[dict[str, object]]:
    """PUT payload covering every assessment detail (batch_coverage rule);
    per-row fields are merged from ``updates`` by l3_code."""
    rows = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail "
        "WHERE assessment_id = %s ORDER BY l3_code",
        (assessment_id,),
    ).fetchall()
    payload: list[dict[str, object]] = []
    for code, node_id in rows:
        item: dict[str, object] = {"l3_code": code}
        if node_id is not None:
            item["l3_node_id"] = int(node_id)
        if code in updates:
            item.update(updates[code])
        payload.append(item)
    return payload


# ── 1. Fully-assessed REQUIRED scope, undecided Gap planning → submits ───


def test_submit_succeeds_with_required_assessed_and_undecided_gaps(
    staged_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(staged_schema, "st_m_undecided", ["Member"])
    required_code, advanced_code = _pick_required_and_advanced(staged_schema)
    _enable_only(staged_schema, [required_code, advanced_code])
    assessment_id = create_scoped_draft(staged_schema, member_id, 2026)
    cookies = _login(staged_schema, "st_m_undecided")
    assert (
        _scope_type(staged_schema, assessment_id, required_code) == "current_required"
    )
    assert (
        _scope_type(staged_schema, assessment_id, advanced_code) == "target_progressive"
    )

    # Assess both capabilities; leave EVERY plan field undecided.
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": _full_batch(
                staged_schema,
                assessment_id,
                {
                    required_code: {"current_level": 3},
                    advanced_code: {"current_level": 3},
                },
            ),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"draft save failed: {body}"

    # The 91-gap-style blocker: positive gaps with no priority / no plan
    # decision / no plan month must NOT block submission.
    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200, f"undecided-plan submit must succeed, got {status}: {body}"
    assessment = get_assessment(staged_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "待复核"
    assert int(assessment["revision"]) == 3


# ── 2. Missing REQUIRED assessment blocks with precise location ──────────


def test_submit_blocks_on_missing_required_with_precise_location(
    staged_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(staged_schema, "st_m_missing_req", ["Member"])
    required_code, advanced_code = _pick_required_and_advanced(staged_schema)
    _enable_only(staged_schema, [required_code, advanced_code])
    assessment_id = create_scoped_draft(staged_schema, member_id, 2026)
    cookies = _login(staged_schema, "st_m_missing_req")

    # Advanced assessed; the REQUIRED item stays NULL (unassessed).
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": _full_batch(
                staged_schema,
                assessment_id,
                {advanced_code: {"current_level": 3}},
            ),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"draft save failed: {body}"

    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 422, f"missing REQUIRED must block, got {status}: {body}"
    assert body["detail"]["reason"] == "requires_current_level"
    assert body["detail"]["l3_code"] == required_code
    assert body["detail"]["field"] == "current_level"
    assessment = get_assessment(staged_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "草稿"
    assert int(assessment["revision"]) == 2


# ── 3. Missing ADVANCED assessment does not block; becomes follow-up ──────


def test_submit_allows_unassessed_advanced(
    staged_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(staged_schema, "st_m_adv_later", ["Member"])
    required_code, advanced_code = _pick_required_and_advanced(staged_schema)
    _enable_only(staged_schema, [required_code, advanced_code])
    assessment_id = create_scoped_draft(staged_schema, member_id, 2026)
    cookies = _login(staged_schema, "st_m_adv_later")

    # REQUIRED assessed; the ADVANCED item stays unassessed.
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": _full_batch(
                staged_schema,
                assessment_id,
                {required_code: {"current_level": 3}},
            ),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"draft save failed: {body}"

    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200, f"unassessed ADVANCED must not block, got {status}: {body}"
    assessment = get_assessment(staged_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "待复核"


# ── 4. Legacy drafts (no scope_type) keep requiring every applicable item ──


def test_legacy_draft_unassessed_applicable_still_blocks(
    staged_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(staged_schema, "st_m_legacy", ["Member"])
    assessment_id = create_scoped_draft(staged_schema, member_id, 2026)
    cookies = _login(staged_schema, "st_m_legacy")
    code = staged_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()[0]
    # Simulate a pre-scope draft: drop the scope snapshot and classification.
    staged_schema.execute(
        "UPDATE assessment SET assessment_scope_version = NULL, "
        "member_current_level_snapshot = NULL, member_target_level_snapshot = NULL "
        "WHERE id = %s",
        (assessment_id,),
    )
    staged_schema.execute(
        "UPDATE assessment_detail SET scope_type = NULL, "
        "standard_job_level_snapshot = NULL WHERE assessment_id = %s",
        (assessment_id,),
    )
    staged_schema.commit()

    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 1},
        cookies=cookies,
    )
    assert status == 422, f"legacy unassessed must still block, got {status}: {body}"
    assert body["detail"]["reason"] == "requires_current_level"
    assert body["detail"]["l3_code"] == code


# ── 5. Personal-workspace follow-up counts (draft → submitted) ────────────


def test_dashboard_follow_up_counts(
    staged_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(staged_schema, "st_m_dash", ["Member"])
    required_code, advanced_code = _pick_required_and_advanced(staged_schema)
    _enable_only(staged_schema, [required_code, advanced_code])
    assessment_id = create_scoped_draft(staged_schema, member_id, 2026)
    cookies = _login(staged_schema, "st_m_dash")

    # Draft state: REQUIRED assessed at level 0 (guaranteed positive gap),
    # ADVANCED unassessed, Gaps undecided.
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": _full_batch(
                staged_schema,
                assessment_id,
                {required_code: {"current_level": 0}},
            ),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"draft save failed: {body}"

    status, body = _request(
        "GET",
        "/api/planning/member-dashboard?year=2026",
        cookies=cookies,
    )
    assert status == 200, f"dashboard failed: {body}"
    follow_up = body["follow_up"]
    assert follow_up["assessment_id"] == assessment_id
    assert follow_up["assessment_status"] == "草稿"
    assert follow_up["required_incomplete"] == 0
    assert follow_up["advanced_unassessed"] == 1
    assert follow_up["gaps_waiting_planning"] >= 1
    assert follow_up["review_return"] is False

    # After submit the same categories track review/return work.
    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200, f"submit failed: {body}"
    status, body = _request(
        "GET",
        "/api/planning/member-dashboard?year=2026",
        cookies=cookies,
    )
    assert status == 200
    follow_up = body["follow_up"]
    assert follow_up["assessment_status"] == "待复核"
    assert follow_up["review_return"] is True
    assert follow_up["required_incomplete"] == 0
    assert follow_up["advanced_unassessed"] == 1
    assert follow_up["gaps_waiting_planning"] >= 1


# ── 6. Non-owner direct submit → 403 with zero writes ─────────────────────


def test_non_owner_submit_403_zero_write(
    staged_schema: psycopg.Connection,
) -> None:
    owner_id = _create_test_user(staged_schema, "st_m_owner", ["Member"])
    intruder_id = _create_test_user(staged_schema, "st_m_intruder", ["Member"])
    assert owner_id != intruder_id
    required_code, _advanced_code = _pick_required_and_advanced(staged_schema)
    _enable_only(staged_schema, [required_code])
    assessment_id = create_scoped_draft(staged_schema, owner_id, 2026)
    owner_cookies = _login(staged_schema, "st_m_owner")
    intruder_cookies = _login(staged_schema, "st_m_intruder")

    # Owner assesses the only scope item.
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": _full_batch(
                staged_schema,
                assessment_id,
                {required_code: {"current_level": 3}},
            ),
            "expected_revision": 1,
        },
        cookies=owner_cookies,
    )
    assert status == 200, f"draft save failed: {body}"

    # Intruder (Member, not the owner) must get 403 with zero writes.
    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=intruder_cookies,
    )
    assert status == 403, f"non-owner submit must be 403, got {status}: {body}"
    assessment = get_assessment(staged_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "草稿"
    assert int(assessment["revision"]) == 2
    reviews = staged_schema.execute(
        "SELECT COUNT(*) FROM assessment_review WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    assert reviews == 0


# ── 7/8. Approval: strict plan selection for included items; undecided
#         Gaps become backlog with no plan items and no duplicates ────────


class TestStagedApproval(ReviewTestBase):
    def test_approval_undecided_gap_backlog_no_duplicate_plan(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [{"l3_code": _L3, "current_level": 1}],
        )
        # Fully-assessed REQUIRED scope with an undecided Gap: approval must
        # succeed, create a plan shell only, and leave the Gap as backlog.
        result = self.approve(
            review_schema,
            assessment_id,
            buddy_id,
            idempotency_key="staged-backlog-approve",
        )
        assert result["plan"]["created"] is True
        plans = review_schema.execute(
            "SELECT COUNT(*) FROM annual_growth_plan"
        ).fetchone()[0]
        assert plans == 1
        items = review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0]
        assert items == 0
        tasks = review_schema.execute("SELECT COUNT(*) FROM learning_task").fetchone()[
            0
        ]
        assert tasks == 0
        backlog = review_schema.execute(
            """
            SELECT gap_value, plan_candidate FROM gap
            WHERE assessment_id = %s AND l3_code = %s
            """,
            (assessment_id, _L3),
        ).fetchone()
        assert backlog is not None
        assert int(backlog[0]) > 0
        assert backlog[1] is False

        # Idempotent retry with the same key creates no duplicates.
        result2 = self.approve(
            review_schema,
            assessment_id,
            buddy_id,
            idempotency_key="staged-backlog-approve",
        )
        assert result2["idempotent_replayed"] is True
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 0
        )

    def test_approval_keeps_strict_plan_selection_validation(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])

        # Scenario A: member selects the item into the plan but leaves
        # priority/plan time undecided — submission is fine, approval must
        # reject with the strict plan contract and zero plan writes.
        assessment_a = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 1,
                    "include_in_plan": True,
                }
            ],
        )
        with pytest.raises(Exception) as exc_info:
            self.approve(review_schema, assessment_a, buddy_id)
        # AssessmentValidationError carries the semantic code in .reason.
        assert getattr(exc_info.value, "reason", "") == "priority_required"
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 0
        )

        # Scenario B: complete selection (priority + quarter + month) still
        # approves and creates exactly one item + one task.
        assessment_b = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 1,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 2,
                }
            ],
        )
        result = self.approve(review_schema, assessment_b, buddy_id)
        assert result["plan"]["created"] is True
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM learning_task").fetchone()[0]
            == 1
        )
