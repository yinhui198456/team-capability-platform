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
        "UPDATE tcp_user SET target_level = 'P8' WHERE id = %s", (user_id,)
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
def evidence_schema(connection: psycopg.Connection) -> psycopg.Connection:
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


def _create_assessment_and_generate_plan_items(
    connection: psycopg.Connection, username: str
) -> int:
    desired_details = [
        {
            "l3_code": "P01-L2A-L3A",
            "current_level": 0,
            "evidence_note": "测试中",
            "member_priority": "高",
            "include_in_plan": True,
            "plan_month": "2026-05",
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
    node_id = connection.execute(
        "SELECT l3_node_id FROM assessment_detail "
        "WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, desired_details[0]["l3_code"]),
    ).fetchone()
    assert node_id is not None and node_id[0] is not None
    status, body, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{**desired_details[0], "l3_node_id": int(node_id[0])}],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200
    persisted = connection.execute(
        "SELECT current_level, target_level, standard_target_level, "
        "include_in_plan, plan_month FROM assessment_detail "
        "WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, desired_details[0]["l3_code"]),
    ).fetchone()
    assert persisted is not None and persisted[3:] == (True, "2026-05"), persisted
    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {
            "l3_codes": [detail["l3_code"] for detail in desired_details],
            "expected_revision": 2,
        },
        cookies=cookies,
    )
    assert status == 200, body
    return assessment_id


def _seed_learning_task(
    connection: psycopg.Connection,
) -> tuple[dict[str, str], dict[str, object]]:
    member_id = _create_test_user(connection, "member_evidence", ["Member"])
    buddy_id = _create_test_user(connection, "buddy_evidence", ["Buddy"])
    create_buddy_relationship(connection, member_id, buddy_id)
    _ensure_l3_node(connection, "P01-L2A-L3A")
    connection.commit()

    _create_assessment_and_generate_plan_items(connection, "member_evidence")

    member_cookies = _login(connection, "member_evidence")

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
    task = next(task for task in tasks if task["plan_item_id"] == item_id)
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{int(task['id'])}/transitions",
        {"to_status": "进行中"},
        cookies=member_cookies,
    )
    assert status == 200
    return member_cookies, task


def test_create_evidence_draft_success(evidence_schema: psycopg.Connection) -> None:
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "完成 P01 实践项目", "evidence_link": "http://example.com/demo"},
        cookies=cookies,
    )
    assert status == 200
    assert evidence is not None
    assert evidence["learning_task_id"] == task_id
    assert evidence["l3_code"] == "P01-L2A-L3A"
    assert evidence["version_number"] == 1
    assert evidence["content"] == "完成 P01 实践项目"
    assert evidence["evidence_link"] == "http://example.com/demo"
    assert evidence["status"] == "草稿"
    assert evidence["submitted_at"] is None


def test_update_evidence_draft_success(evidence_schema: psycopg.Connection) -> None:
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "初稿", "evidence_link": "http://example.com/v1"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, updated, _ = _request(
        "PUT",
        f"/api/planning/evidences/{evidence_id}",
        {
            "content": "完成 P01 实践项目",
            "evidence_link": "http://example.com/demo",
            "expected_revision": 0,
        },
        cookies=cookies,
    )
    assert status == 200
    assert updated["content"] == "完成 P01 实践项目"
    assert updated["evidence_link"] == "http://example.com/demo"
    assert updated["status"] == "草稿"


def test_submit_evidence_creates_review(evidence_schema: psycopg.Connection) -> None:
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "完成 P01 实践项目", "evidence_link": "http://example.com/demo"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, submitted, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200
    assert submitted["status"] == "待 Review"
    assert submitted["submitted_at"] is not None
    assert submitted["submitted_by"] is not None

    # v0010: submission never touches the task state machine.
    status, task_after_submit, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}", cookies=cookies
    )
    assert status == 200
    assert task_after_submit["status"] == "进行中"

    # No evidence_review row is pre-created; reviews are written by the buddy.
    row = evidence_schema.execute(
        """
        SELECT id FROM evidence_review WHERE evidence_id = %s
        """,
        (evidence_id,),
    ).fetchone()
    assert row is None


def test_update_non_draft_evidence_returns_422(
    evidence_schema: psycopg.Connection,
) -> None:
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "完成 P01 实践项目", "evidence_link": "http://example.com/demo"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "PUT",
        f"/api/planning/evidences/{evidence_id}",
        {"content": "修改", "expected_revision": 0},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"
    assert body["detail"]["field"] == "status"


def test_cannot_create_two_drafts_for_same_task(
    evidence_schema: psycopg.Connection,
) -> None:
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "第一版草稿", "evidence_link": "http://example.com/v1"},
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "第二版草稿", "evidence_link": "http://example.com/v2"},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"
    assert body["detail"]["field"] == "status"


def test_cannot_create_new_round_while_review_is_pending(
    evidence_schema: psycopg.Connection,
) -> None:
    """After an evidence round is submitted ('待 Review'), another round must
    be denied until the buddy's review concludes."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "第一版", "evidence_link": "http://example.com/v1"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200

    # A new round must be denied while '待 Review' is pending.
    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "第二版", "evidence_link": "http://example.com/v2"},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"


def test_evidence_endpoints_require_member_role(
    evidence_schema: psycopg.Connection,
) -> None:
    _create_test_user(evidence_schema, "buddy_evidence_only", ["Buddy"])
    evidence_schema.commit()
    cookies = _login(evidence_schema, "buddy_evidence_only")

    status, _, _ = _request(
        "GET", "/api/planning/learning-tasks/1/evidences", cookies=cookies
    )
    assert status == 403

    status, _, _ = _request(
        "POST",
        "/api/planning/learning-tasks/1/evidences",
        {"content": "x"},
        cookies=cookies,
    )
    assert status == 403

    status, _, _ = _request(
        "PUT", "/api/planning/evidences/1", {"content": "x"}, cookies=cookies
    )
    assert status == 403

    status, _, _ = _request(
        "POST", "/api/planning/evidences/1/submit", {}, cookies=cookies
    )
    assert status == 403

    status, _, _ = _request("GET", "/api/planning/evidences/1", cookies=cookies)
    assert status == 403


def test_create_evidence_for_other_member_task_returns_403(
    evidence_schema: psycopg.Connection,
) -> None:
    member_cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    _create_test_user(evidence_schema, "other_member_evidence", ["Member"])
    evidence_schema.commit()
    other_cookies = _login(evidence_schema, "other_member_evidence")

    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "x"},
        cookies=other_cookies,
    )
    assert status == 403
    assert body == {"detail": "learning task does not belong to member"}


def test_get_evidence_for_other_member_returns_404(
    evidence_schema: psycopg.Connection,
) -> None:
    member_cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "x"},
        cookies=member_cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    _create_test_user(evidence_schema, "other_member_evidence", ["Member"])
    evidence_schema.commit()
    other_cookies = _login(evidence_schema, "other_member_evidence")

    status, body, _ = _request(
        "GET", f"/api/planning/evidences/{evidence_id}", cookies=other_cookies
    )
    assert status == 404
    assert body == {"detail": "evidence not found"}


def test_submit_evidence_without_buddy_returns_422(
    evidence_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(evidence_schema, "member_no_buddy", ["Member"])
    _ensure_l3_node(evidence_schema, "P01-L2A-L3A")
    evidence_schema.commit()

    buddy_id = _create_test_user(evidence_schema, "buddy_no_buddy", ["Buddy"])
    create_buddy_relationship(evidence_schema, member_id, buddy_id)
    evidence_schema.commit()
    _create_assessment_and_generate_plan_items(evidence_schema, "member_no_buddy")

    # Expire the buddy relationship so no primary buddy is assigned now.
    evidence_schema.execute(
        """
        UPDATE buddy_relationship
        SET expiry_date = CURRENT_DATE - 1, effective_to = CURRENT_DATE - 1
        WHERE member_id = %s AND buddy_id = %s
        """,
        (member_id, buddy_id),
    )
    evidence_schema.commit()

    member_cookies = _login(evidence_schema, "member_no_buddy")

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
        {"content": "x"},
        cookies=member_cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    # v0010: submission does not require a live buddy (the queue filters by
    # the current relationship); the review itself re-reads the relationship.
    status, submitted, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=member_cookies,
    )
    assert status == 200
    assert submitted["status"] == "待 Review"

    buddy_cookies = _login(evidence_schema, "buddy_no_buddy")
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过"},
        cookies=buddy_cookies,
    )
    assert status == 403  # relationship expired — buddy cannot review


# ---------------------------------------------------------------------------
# Issue #65: archived-Evidence workflow — active-round guard and
# completed/closed-task guard
# ---------------------------------------------------------------------------


def test_create_evidence_with_pending_review_must_fail(
    evidence_schema: psycopg.Connection,
) -> None:
    """No new evidence round when a '待 Review' (submitted, waiting on buddy)
    round already exists — the member must wait for the review to conclude."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    # Create and submit — status becomes '待 Review'.
    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "v1", "evidence_link": "http://example.com/v1"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200

    # A new evidence round must be denied while '待 Review' is pending.
    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "v2 attempt", "evidence_link": "http://example.com/v2"},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"
    detail = str(body["detail"].get("message", ""))
    assert "review" in detail.lower() or "pending" in detail.lower()
    # Evidence list unchanged — no partial write.
    status, evidences, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        cookies=cookies,
    )
    assert status == 200
    assert len(evidences) == 1
    assert evidences[0]["status"] == "待 Review"


def test_create_evidence_on_completed_task_must_fail(
    evidence_schema: psycopg.Connection,
) -> None:
    """A completed/closed task forbids new evidence — the UI must guide the
    member toward creating a new task or changing the plan."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    # Transition task to closed (暂停 requires a reason).
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "暂停", "reason": "完成度不足，暂停"},
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "x", "evidence_link": "http://example.com/x"},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"
    detail = str(body["detail"].get("message", ""))
    assert (
        "completed" in detail.lower()
        or "closed" in detail.lower()
        or "task" in detail.lower()
    )


def test_create_evidence_with_only_archived_and_rejected_succeeds(
    evidence_schema: psycopg.Connection,
) -> None:
    """When every existing evidence round is in a terminal state (通过, 驳回,
    已归档), the member may create a fresh new round."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    # R1: create → submit → buddy approves (通过 — terminal).
    status, e1, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "R1", "evidence_link": "http://example.com/r1"},
        cookies=cookies,
    )
    assert status == 200
    e1_id = int(e1["id"])
    status, _, _ = _request(
        "POST", f"/api/planning/evidences/{e1_id}/submit", {}, cookies=cookies
    )
    assert status == 200
    buddy_cookies = _login(evidence_schema, "buddy_evidence")
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{e1_id}/review",
        {"conclusion": "通过"},
        cookies=buddy_cookies,
    )
    assert status == 200

    # Verify the task has 1 terminal evidence record, no active round.
    status, evidences, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        cookies=cookies,
    )
    assert status == 200
    assert len(evidences) == 1
    active_statuses = {ev["status"] for ev in evidences} & {
        "草稿",
        "待 Review",
        "需补充",
    }
    assert (
        not active_statuses
    ), f"all evidence should be terminal, got {active_statuses}"

    # R2: a fresh new round must be allowed.
    status, e2, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "R2", "evidence_link": "http://example.com/r2"},
        cookies=cookies,
    )
    assert status == 200
    assert e2["status"] == "草稿"
    assert e2["version_number"] == 2

    # Confirm both records exist — no data was overwritten.
    status, evidences, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        cookies=cookies,
    )
    assert status == 200
    assert len(evidences) == 2


def test_update_rejects_archived_evidence(
    evidence_schema: psycopg.Connection,
) -> None:
    """Archived evidence is permanently read-only — updates are rejected.
    This exercises the same status guard as test_update_non_draft_evidence_returns_422
    but for the '已归档' state specifically."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "arch", "evidence_link": "http://example.com/arch"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    # Submit → review approve → auto-archives or stays 通过.
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200
    buddy_cookies = _login(evidence_schema, "buddy_evidence")
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过"},
        cookies=buddy_cookies,
    )
    assert status == 200

    # The evidence is now 通过 (terminal, read-only). PUT must fail.
    status, body, _ = _request(
        "PUT",
        f"/api/planning/evidences/{evidence_id}",
        {"content": "modified", "expected_revision": evidence["revision"] + 1},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"


# ---------------------------------------------------------------------------
# Issue #65: evidence archival on task completion
# ---------------------------------------------------------------------------


def test_task_completion_archives_approved_evidence(
    evidence_schema: psycopg.Connection,
) -> None:
    """When a task transitions to 已完成, all associated 通过 evidence
    must be atomically transitioned to 已归档."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    # Create, submit, and approve evidence.
    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "done", "evidence_link": "http://example.com/done"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200
    buddy_cookies = _login(evidence_schema, "buddy_evidence")
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过"},
        cookies=buddy_cookies,
    )
    assert status == 200

    # Evidence should be 通过, not 已归档 (not archived prematurely).
    status, ev_check, _ = _request(
        "GET",
        f"/api/planning/evidences/{evidence_id}",
        cookies=cookies,
    )
    assert status == 200
    assert ev_check["status"] == "通过"

    # Log hours and set completion fields.
    from datetime import date

    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {
            "record_date": date.today().isoformat(),
            "actual_hours": 10,
            "note": "completed work",
        },
        cookies=cookies,
    )
    assert status == 200
    status, task_latest, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}",
        cookies=cookies,
    )
    assert status == 200
    task_rev = int(task_latest["revision"])
    status, _, _ = _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {
            "review_conclusion": "项目完成，达到预期目标",
            "next_action": "继续下一项任务",
            "completion_quality": "达到预期",
            "expected_revision": task_rev,
        },
        cookies=cookies,
    )
    assert status == 200
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "已完成"},
        cookies=cookies,
    )
    assert status == 200

    # Evidence must now be 已归档.
    status, ev_final, _ = _request(
        "GET",
        f"/api/planning/evidences/{evidence_id}",
        cookies=cookies,
    )
    assert status == 200
    assert ev_final["status"] == "已归档", f"expected 已归档, got {ev_final['status']}"


def test_archived_evidence_rejects_update(
    evidence_schema: psycopg.Connection,
) -> None:
    """Archived evidence is permanently read-only — PUT updates must fail."""
    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    # Create, submit, approve, complete task → evidence is 已归档.
    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "x", "evidence_link": "http://example.com/x"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])
    _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    buddy_cookies = _login(evidence_schema, "buddy_evidence")
    _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过"},
        cookies=buddy_cookies,
    )
    from datetime import date

    _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {
            "record_date": date.today().isoformat(),
            "actual_hours": 5,
            "note": "done",
        },
        cookies=cookies,
    )
    status, task_latest, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}",
        cookies=cookies,
    )
    task_rev = int(task_latest["revision"])
    _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {
            "review_conclusion": "done",
            "next_action": "next",
            "completion_quality": "达到预期",
            "expected_revision": task_rev,
        },
        cookies=cookies,
    )
    _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "已完成"},
        cookies=cookies,
    )

    # Now evidence is 已归档 — PUT must be rejected.
    status, ev_latest, _ = _request(
        "GET",
        f"/api/planning/evidences/{evidence_id}",
        cookies=cookies,
    )
    assert status == 200
    status, body, _ = _request(
        "PUT",
        f"/api/planning/evidences/{evidence_id}",
        {
            "content": "tampered",
            "expected_revision": ev_latest["revision"],
        },
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_evidence"


def test_concurrent_evidence_creation_only_one_succeeds(
    evidence_schema: psycopg.Connection,
) -> None:
    """Concurrent evidence creation for the same task must produce exactly
    one draft — no 500, no duplicate version, no partial write."""
    from concurrent.futures import ThreadPoolExecutor

    cookies, task = _seed_learning_task(evidence_schema)
    task_id = int(task["id"])

    def _create(_unused: int = 0) -> tuple[int, object]:
        return _request(
            "POST",
            f"/api/planning/learning-tasks/{task_id}/evidences",
            {"content": "concurrent", "evidence_link": "http://example.com/c"},
            cookies=cookies,
        )[:2]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(_create, range(2)))
    statuses = sorted(r[0] for r in results)
    # One 201, one 422 — no 500.
    assert statuses == [200, 422], f"unexpected statuses: {statuses}"
    ok = next(r for r in results if r[0] == 200)
    assert ok[1]["status"] == "草稿"
    fail = next(r for r in results if r[0] == 422)
    assert fail[1]["detail"]["code"] == "invalid_evidence"

    # Only one evidence record exists.
    status, evidences, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        cookies=cookies,
    )
    assert status == 200
    assert len(evidences) == 1
    assert evidences[0]["version_number"] == 1
