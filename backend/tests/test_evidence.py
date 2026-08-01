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
    standard_target_payload,
)

SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS learning_task")
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
        connection.execute("DROP TABLE IF EXISTS learning_task")
        connection.execute("DROP TABLE IF EXISTS plan_item")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
    create_planning_schema(connection)


def _reset_catalog_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
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
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, %s, 'L3', %s, 'Leaf', 1, %s, %s, %s, 'test.xlsx', 'sheet', 4)
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


def _create_and_submit_assessment(connection: psycopg.Connection, username: str) -> int:
    desired_details = [
        {
            "l3_code": "P01-L2A-L3A",
            "current_level": 2,
            "target_level": 4,
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
    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200
    return assessment_id


def _approve_assessment(
    connection: psycopg.Connection, assessment_id: int, buddy_username: str
) -> None:
    buddy_cookies = _login(connection, buddy_username)
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    review_id = pending[0]["id"]
    status, _, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "feedback": "符合预期"},
        cookies=buddy_cookies,
    )
    assert status == 200


def _seed_learning_task(
    connection: psycopg.Connection,
) -> tuple[dict[str, str], dict[str, object]]:
    member_id = _create_test_user(connection, "member_evidence", ["Member"])
    buddy_id = _create_test_user(connection, "buddy_evidence", ["Buddy"])
    create_buddy_relationship(connection, member_id, buddy_id)
    _ensure_l3_node(connection, "P01-L2A-L3A")
    connection.commit()

    assessment_id = _create_and_submit_assessment(connection, "member_evidence")
    _approve_assessment(connection, assessment_id, "buddy_evidence")

    member_cookies = _login(connection, "member_evidence")

    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert len(gaps) == 1

    status, _, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gaps[0]["id"]},
        cookies=member_cookies,
    )
    assert status == 200

    status, result, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=member_cookies
    )
    assert status == 200
    assert result["created"] == 1

    item_id = int(result["items"][0]["id"])
    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task = next(task for task in tasks if task["plan_item_id"] == item_id)
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
        {"content": "完成 P01 实践项目", "evidence_link": "http://example.com/demo"},
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

    status, task_after_submit, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}", cookies=cookies
    )
    assert status == 200
    assert task_after_submit["status"] == "待 Evidence Review"

    status, reviews, _ = _request(
        "GET",
        f"/api/planning/evidences/{evidence_id}",
        cookies=cookies,
    )
    assert status == 200

    row = evidence_schema.execute(
        """
        SELECT id, evidence_id, buddy_id, status, conclusion, feedback
        FROM evidence_review
        WHERE evidence_id = %s
        """,
        (evidence_id,),
    ).fetchone()
    assert row is not None
    assert row[2] is not None
    assert row[3] == "待 Review"
    assert row[4] is None
    assert row[5] is None


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
        {"content": "修改"},
        cookies=cookies,
    )
    assert status == 422
    assert body == {"detail": "only draft evidence can be updated"}


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
    assert status == 409
    assert body == {"detail": "draft evidence already exists for this task"}


def test_can_create_new_version_after_submit(
    evidence_schema: psycopg.Connection,
) -> None:
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

    status, new_draft, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "第二版", "evidence_link": "http://example.com/v2"},
        cookies=cookies,
    )
    assert status == 200
    assert new_draft["version_number"] == 2
    assert new_draft["status"] == "草稿"

    status, evidences, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        cookies=cookies,
    )
    assert status == 200
    assert len(evidences) == 2
    assert evidences[0]["version_number"] == 2
    assert evidences[1]["version_number"] == 1


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
    assessment_id = _create_and_submit_assessment(evidence_schema, "member_no_buddy")
    _approve_assessment(evidence_schema, assessment_id, "buddy_no_buddy")

    # Expire the buddy relationship so no primary buddy is assigned now.
    evidence_schema.execute(
        """
        UPDATE buddy_relationship
        SET effective_to = CURRENT_DATE
        WHERE member_id = %s AND buddy_id = %s
        """,
        (member_id, buddy_id),
    )
    evidence_schema.commit()

    member_cookies = _login(evidence_schema, "member_no_buddy")

    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert len(gaps) == 1

    status, _, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gaps[0]["id"]},
        cookies=member_cookies,
    )
    assert status == 200

    status, result, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=member_cookies
    )
    assert status == 200
    assert result["created"] == 1

    item_id = int(result["items"][0]["id"])
    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task_id = int(next(task for task in tasks if task["plan_item_id"] == item_id)["id"])

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "x"},
        cookies=member_cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])

    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=member_cookies,
    )
    assert status == 422
    assert body == {"detail": "no primary buddy assigned"}
