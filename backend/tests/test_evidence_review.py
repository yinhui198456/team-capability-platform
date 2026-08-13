import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.main import app
from app.planning.schema import create_planning_schema
from tests.standard_target_support import (
    ensure_capability_nodes,
    record_submitted_history_state,
    standard_target_payload,
)

SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS task_transition_history")
        connection.execute("DROP TABLE IF EXISTS learning_task")
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS plan_item")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)


def _reset_assessment_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS task_transition_history")
        connection.execute("DROP TABLE IF EXISTS learning_task")
        connection.execute("DROP TABLE IF EXISTS plan_item")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")
    create_assessment_schema(connection)


def _reset_planning_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS task_transition_history")
        connection.execute("DROP TABLE IF EXISTS learning_task")
        connection.execute("DROP TABLE IF EXISTS plan_item")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
    create_planning_schema(connection)


def _reset_catalog_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute(
            "DROP TABLE IF EXISTS capability_standard_planning_snapshot CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
        connection.execute("DROP TABLE IF EXISTS capability_standard_target_override")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")
    create_catalog_schema(connection)


def _create_test_user(
    connection: psycopg.Connection, username: str, roles: list[str]
) -> int:
    user_id = create_user(connection, username, username, "secret")
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P5', target_level = 'P8' WHERE id = %s",
        (user_id,),
    )
    connection.commit()
    return user_id


def _ensure_l3_node(
    connection: psycopg.Connection,
    l3_code: str,
    materials_text: str = "test materials",
    expected_output: str = "test output",
    estimated_hours: str = "10",
) -> None:
    model = connection.execute(
        """
        INSERT INTO capability_model (
            code, name, version, source_workbook, source_sheet, source_row
        )
        VALUES ('test-model', 'Test Model', '1.0', 'test.xlsx', 'sheet', 1)
        ON CONFLICT (code) DO UPDATE SET code = capability_model.code
        RETURNING id
        """
    ).fetchone()
    assert model is not None
    model_id = model[0]
    l1 = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, node_type, code, name, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'test.xlsx', 'sheet', 2)
        ON CONFLICT (model_id, code) DO UPDATE SET code = capability_node.code
        RETURNING id
        """,
        (model_id,),
    ).fetchone()
    assert l1 is not None
    l2 = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, parent_node_id, node_type, code, name, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, %s, 'L2', 'P01-L2A', 'Item', 1, 'test.xlsx', 'sheet', 3)
        ON CONFLICT (model_id, code) DO UPDATE SET code = capability_node.code
        RETURNING id
        """,
        (model_id, l1[0]),
    ).fetchone()
    assert l2 is not None
    connection.execute(
        """
        INSERT INTO capability_node (
            model_id, parent_node_id, node_type, code, name, sort_order,
            materials_text, expected_output, estimated_hours,
            recommended_start_level,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, %s, 'L3', %s, 'Leaf', 1, %s, %s, %s, 'P4',
                'test.xlsx', 'sheet', 4)
        ON CONFLICT (model_id, code) DO UPDATE SET
            materials_text = EXCLUDED.materials_text,
            expected_output = EXCLUDED.expected_output,
            estimated_hours = EXCLUDED.estimated_hours
        """,
        (model_id, l2[0], l3_code, materials_text, expected_output, estimated_hours),
    )


@pytest.fixture
def evidence_review_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    _reset_assessment_schema(connection)
    _reset_planning_schema(connection)
    _reset_catalog_schema(connection)
    return connection


async def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
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

    parsed = urlsplit(path)
    scope_path = parsed.path
    query_string = parsed.query.encode("utf-8")

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": scope_path,
            "raw_path": scope_path.encode("utf-8"),
            "query_string": query_string,
            "headers": headers,
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )

    status_message = next(message for message in messages if "status" in message)
    status_code = status_message["status"]
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None

    response_headers: dict[bytes, list[str]] = {}
    for message in messages:
        for name, value in message.get("headers", []):
            response_headers.setdefault(name, []).append(value.decode("utf-8"))

    return status_code, parsed_body, response_headers


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    return asyncio.run(_asgi_request(method, path, body, cookies))


def _cookie_attributes(headers: dict[str, list[str]]) -> dict[str, str]:
    set_cookie = headers.get(b"set-cookie", [""])[0]
    attributes: dict[str, str] = {}
    parts = [part.strip() for part in set_cookie.split(";")]
    if parts and "=" in parts[0]:
        name, value = parts[0].split("=", 1)
        attributes[name] = value
    for part in parts[1:]:
        if "=" in part:
            key, val = part.split("=", 1)
            attributes[key] = val
        elif part:
            attributes[part] = ""
    return attributes


def _login(
    connection: psycopg.Connection, username: str, password: str = "secret"
) -> dict[str, str]:
    status, body, headers = _request(
        "POST", "/api/auth/login", {"username": username, "password": password}
    )
    assert status == 200, f"login failed: {body}"
    return {SESSION_COOKIE: _cookie_attributes(headers)[SESSION_COOKIE]}


def _create_and_submit_assessment(connection: psycopg.Connection, username: str) -> int:
    desired_details = [
        {
            "l3_code": "P01-L2A-L3A",
            "current_level": 2,
            "evidence_note": "测试中",
            "member_priority": "高",
            "include_in_plan": True,
            "plan_quarter": "Q2",
            "plan_month": 5,
        }
    ]
    ensure_capability_nodes(connection, ["P01-L2A-L3A"])
    cookies = _login(connection, username)
    status, preview, _ = _request(
        "GET", "/api/assessments/scope-preview?year=2026", cookies=cookies
    )

    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/assessments",
        {"year": 2026, "scope_token": preview["scope_token"]},
        cookies=cookies,
    )
    assert status == 200
    assert body is not None
    assessment_id = body["id"]
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": standard_target_payload(
                connection, assessment_id, desired_details
            ),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200
    # Submit is retired (#178); build the historical submitted state
    # (待复核 + review row + revision bump + gaps/plan/tasks) directly.
    record_submitted_history_state(connection, assessment_id)
    connection.commit()
    return assessment_id


def _approve_assessment(
    connection: psycopg.Connection, assessment_id: int, buddy_username: str
) -> None:
    buddy_cookies = _login(connection, buddy_username)
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    review_id = pending[0]["id"]  # evidence id (v0010 queue)
    status, _, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200


def _seed_submitted_evidence(
    connection: psycopg.Connection,
    member_username: str = "member_review",
    buddy_username: str = "buddy_review",
) -> tuple[dict[str, str], dict[str, str], int, int]:
    member_id = _create_test_user(connection, member_username, ["Member"])
    buddy_id = _create_test_user(connection, buddy_username, ["Buddy"])
    create_buddy_relationship(connection, member_id, buddy_id)
    _ensure_l3_node(connection, "P01-L2A-L3A")
    connection.commit()

    assessment_id = _create_and_submit_assessment(connection, member_username)
    _approve_assessment(connection, assessment_id, buddy_username)

    member_cookies = _login(connection, member_username)

    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None

    item_id = int(plan["items"][0]["id"])
    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task_id = int(next(task for task in tasks if task["plan_item_id"] == item_id)["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "进行中"},
        cookies=member_cookies,
    )
    assert status == 200

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "完成 P01 实践项目", "evidence_link": "http://example.com/demo"},
        cookies=member_cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, submitted, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=member_cookies,
    )
    assert status == 200
    assert submitted["status"] == "待 Review"

    buddy_cookies = _login(connection, buddy_username)
    return member_cookies, buddy_cookies, task_id, evidence_id


def test_buddy_pending_queue_includes_assigned_member(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _, buddy_cookies, _, evidence_id = _seed_submitted_evidence(evidence_review_schema)

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    assert len(pending) == 1
    assert pending[0]["id"] == evidence_id  # v0010: queue yields evidence rows
    assert pending[0]["member_id"] is not None
    assert pending[0]["username"] is not None
    assert pending[0]["l3_code"] == "P01-L2A-L3A"
    assert pending[0]["version_number"] == 1


def test_buddy_pending_queue_excludes_other_buddy_members(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _seed_submitted_evidence(evidence_review_schema, "member_a", "buddy_a")

    buddy_b_id = _create_test_user(evidence_review_schema, "buddy_b", ["Buddy"])
    member_b_id = _create_test_user(evidence_review_schema, "member_b", ["Member"])
    create_buddy_relationship(evidence_review_schema, member_b_id, buddy_b_id)
    evidence_review_schema.commit()

    buddy_b_cookies = _login(evidence_review_schema, "buddy_b")
    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_b_cookies
    )
    assert status == 200
    assert pending == []


def test_submit_review_approved_archives_evidence(
    evidence_review_schema: psycopg.Connection,
) -> None:
    member_cookies, buddy_cookies, task_id, evidence_id = _seed_submitted_evidence(
        evidence_review_schema
    )

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)

    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )
    assert status == 200
    assert body["conclusion"] == "通过"

    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{evidence_id}", cookies=member_cookies
    )
    assert status == 200
    assert evidence["status"] == "通过"

    # v0010: approval never auto-completes the task — the transition gate does.
    status, task, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}", cookies=member_cookies
    )
    assert status == 200
    assert task["status"] == "进行中"

    status, history, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidence-reviews",
        cookies=member_cookies,
    )
    assert status == 200
    assert len(history) == 1
    assert history[0]["conclusion"] == "通过"

    status, buddy_history, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidence-reviews",
        cookies=buddy_cookies,
    )
    assert status == 200
    assert len(buddy_history) == 1
    assert buddy_history[0]["conclusion"] == "通过"
    assert history[0]["feedback"] == "符合预期"
    assert history[0]["reviewed_at"] is not None


def test_submit_review_rejected_sets_evidence_status_and_reopens_task(
    evidence_review_schema: psycopg.Connection,
) -> None:
    member_cookies, buddy_cookies, task_id, evidence_id = _seed_submitted_evidence(
        evidence_review_schema
    )

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "需补充", "feedback": "请补充说明"},
        cookies=buddy_cookies,
    )
    assert status == 200

    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{evidence_id}", cookies=member_cookies
    )
    assert status == 200
    assert evidence["status"] == "需补充"

    status, task, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}", cookies=member_cookies
    )
    assert status == 200
    assert task["status"] == "进行中"


def test_submit_review_rejects_unknown_conclusion(
    evidence_review_schema: psycopg.Connection,
) -> None:
    member_cookies, buddy_cookies, _, evidence_id = _seed_submitted_evidence(
        evidence_review_schema
    )

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)

    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "驳回", "feedback": "不符合要求"},
        cookies=buddy_cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_review"

    # Evidence untouched — zero partial write.
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{evidence_id}", cookies=member_cookies
    )
    assert status == 200
    assert evidence["status"] == "待 Review"


def test_non_assigned_buddy_cannot_submit_review(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _, buddy_cookies, task_id, _ = _seed_submitted_evidence(
        evidence_review_schema, "member_owned", "buddy_assigned"
    )

    _create_test_user(evidence_review_schema, "other_buddy", ["Buddy"])
    evidence_review_schema.commit()

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)

    other_buddy_cookies = _login(evidence_review_schema, "other_buddy")
    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "越权"},
        cookies=other_buddy_cookies,
    )
    assert status in (403, 404)

    status, _, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidence-reviews",
        cookies=other_buddy_cookies,
    )
    assert status in (403, 404)


def test_duplicate_submit_review_returns_conflict(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _, buddy_cookies, _, _ = _seed_submitted_evidence(
        evidence_review_schema, "member_dup", "buddy_dup"
    )

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "重复提交"},
        cookies=buddy_cookies,
    )
    assert status in (409, 422)


def test_evidence_review_endpoints_require_buddy_role(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _create_test_user(evidence_review_schema, "member_only_review", ["Member"])
    evidence_review_schema.commit()
    cookies = _login(evidence_review_schema, "member_only_review")

    status, _, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=cookies
    )
    assert status == 403

    status, _, _ = _request(
        "POST",
        "/api/planning/evidences/1/review",
        {"conclusion": "通过", "feedback": "x"},
        cookies=cookies,
    )
    assert status == 403


def test_member_can_view_own_task_review_history(
    evidence_review_schema: psycopg.Connection,
) -> None:
    member_cookies, buddy_cookies, task_id, _ = _seed_submitted_evidence(
        evidence_review_schema, "member_history", "buddy_history"
    )

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)
    _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )

    status, history, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidence-reviews",
        cookies=member_cookies,
    )
    assert status == 200
    assert len(history) == 1
    assert history[0]["conclusion"] == "通过"


def test_member_cannot_view_other_member_task_review_history(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _, _, other_task_id, _ = _seed_submitted_evidence(
        evidence_review_schema, "other_member_history", "other_buddy_history"
    )

    _create_test_user(evidence_review_schema, "own_member_history", ["Member"])
    evidence_review_schema.commit()
    own_cookies = _login(evidence_review_schema, "own_member_history")

    status, body, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{other_task_id}/evidence-reviews",
        cookies=own_cookies,
    )
    assert status in (403, 404)


def test_dual_role_buddy_can_view_assigned_member_task_review_history(
    evidence_review_schema: psycopg.Connection,
) -> None:
    """Production seeds assign BOTH Buddy and Member roles to buddy accounts;
    the history endpoint must resolve the buddy relationship, not 403 on the
    member-only path."""
    _, buddy_cookies, task_id, evidence_id = _seed_submitted_evidence(
        evidence_review_schema, "member_dual_role", "buddy_dual_role"
    )
    buddy_id = evidence_review_schema.execute(
        "SELECT id FROM tcp_user WHERE username = %s", ("buddy_dual_role",)
    ).fetchone()[0]
    assign_role(evidence_review_schema, buddy_id, "Member")
    evidence_review_schema.commit()
    buddy_cookies = _login(evidence_review_schema, "buddy_dual_role")

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )
    assert status == 200

    status, history, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidence-reviews",
        cookies=buddy_cookies,
    )
    assert status == 200
    assert len(history) == 1
    assert history[0]["conclusion"] == "通过"


def test_dual_role_buddy_cannot_view_unassigned_member_task_review_history(
    evidence_review_schema: psycopg.Connection,
) -> None:
    """The dual-role fallback must not widen access: a buddy with the Member
    role still cannot read another member's task history."""
    _, _, other_task_id, _ = _seed_submitted_evidence(
        evidence_review_schema, "member_unassigned", "buddy_unassigned"
    )

    _create_test_user(evidence_review_schema, "stranger_dual_role", ["Buddy", "Member"])
    evidence_review_schema.commit()
    stranger_cookies = _login(evidence_review_schema, "stranger_dual_role")

    status, _, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{other_task_id}/evidence-reviews",
        cookies=stranger_cookies,
    )
    assert status in (403, 404)


def _summary(
    connection: psycopg.Connection, username: str, year: int
) -> tuple[int, dict[str, int] | None]:
    cookies = _login(connection, username)
    status, body, _ = _request(
        "GET",
        f"/api/planning/evidence-reviews/summary?year={year}",
        cookies=cookies,
    )
    return status, body


def test_evidence_review_summary_counts_pending_and_completed(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _, buddy_cookies, task_id, _ = _seed_submitted_evidence(
        evidence_review_schema, "member_ev_summary", "buddy_ev_summary"
    )

    status, body = _summary(evidence_review_schema, "buddy_ev_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}

    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]  # evidence id (v0010 queue)
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{review_id}/review",
        {"conclusion": "通过", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )
    assert status == 200

    status, body = _summary(evidence_review_schema, "buddy_ev_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 0, "completed_count": 1}


def test_evidence_review_summary_filters_by_year(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _seed_submitted_evidence(evidence_review_schema, "member_ev_year", "buddy_ev_year")

    status, body = _summary(evidence_review_schema, "buddy_ev_year", 2025)
    assert status == 200
    assert body == {"pending_count": 0, "completed_count": 0}

    status, body = _summary(evidence_review_schema, "buddy_ev_year", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}


def test_evidence_review_summary_requires_buddy_role(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _create_test_user(evidence_review_schema, "member_ev_summary_role", ["Member"])
    evidence_review_schema.commit()

    status, body = _summary(evidence_review_schema, "member_ev_summary_role", 2026)
    assert status == 403


def test_evidence_review_summary_only_includes_assigned_members(
    evidence_review_schema: psycopg.Connection,
) -> None:
    _seed_submitted_evidence(evidence_review_schema, "member_ev_a", "buddy_ev_a")
    _seed_submitted_evidence(evidence_review_schema, "member_ev_b", "buddy_ev_b")

    status, body = _summary(evidence_review_schema, "buddy_ev_a", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}

    status, body = _summary(evidence_review_schema, "buddy_ev_b", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}
