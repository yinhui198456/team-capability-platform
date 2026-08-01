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
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
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
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
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
def progress_log_schema(connection: psycopg.Connection) -> psycopg.Connection:
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
        },
        {
            "l3_code": "P01-L2A-L3B",
            "current_level": 1,
            "target_level": 3,
            "evidence_note": "测试中",
            "member_priority": "高",
            "include_in_plan": True,
            "plan_quarter": "Q2",
            "plan_month": 5,
        },
    ]
    ensure_capability_nodes(connection, ["P01-L2A-L3A", "P01-L2A-L3B"])
    from app.migrations import run_migrations

    run_migrations(connection)
    connection.commit()
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
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200


def _seed_plan_with_tasks(
    connection: psycopg.Connection,
) -> tuple[dict[str, str], list[dict[str, object]]]:
    member_id = _create_test_user(connection, "member_progress", ["Member"])
    buddy_id = _create_test_user(connection, "buddy_progress", ["Buddy"])
    create_buddy_relationship(connection, member_id, buddy_id)
    _ensure_l3_node(connection, "P01-L2A-L3A")
    _ensure_l3_node(connection, "P01-L2A-L3B")
    connection.commit()

    assessment_id = _create_and_submit_assessment(connection, "member_progress")
    _approve_assessment(connection, assessment_id, "buddy_progress")

    member_cookies = _login(connection, "member_progress")

    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    assert len(plan["items"]) == 2

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    assert {task["plan_item_id"] for task in tasks} == {
        item["id"] for item in plan["items"]
    }

    return member_cookies, tasks


def test_create_and_list_progress_log_success(
    progress_log_schema: psycopg.Connection,
) -> None:
    cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_id = int(tasks[0]["id"])

    status, log, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 3, "note": "阅读文档"},
        cookies=cookies,
    )
    assert status == 200
    assert log is not None
    assert log["task_id"] == task_id
    assert log["record_date"] == "2026-07-10"
    assert log["actual_hours"] == 3
    assert log["note"] == "阅读文档"

    status, logs, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        cookies=cookies,
    )
    assert status == 200
    assert len(logs) == 1
    assert logs[0]["id"] == log["id"]


def test_update_and_delete_progress_log_success(
    progress_log_schema: psycopg.Connection,
) -> None:
    cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_id = int(tasks[0]["id"])

    status, log, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 2, "note": "初稿"},
        cookies=cookies,
    )
    assert status == 200
    log_id = int(log["id"])

    status, updated, _ = _request(
        "PUT",
        f"/api/planning/progress-logs/{log_id}",
        {"record_date": "2026-07-11", "actual_hours": 4, "note": "修订"},
        cookies=cookies,
    )
    assert status == 200
    assert updated["record_date"] == "2026-07-11"
    assert updated["actual_hours"] == 4
    assert updated["note"] == "修订"

    status, _, _ = _request(
        "DELETE",
        f"/api/planning/progress-logs/{log_id}",
        cookies=cookies,
    )
    assert status == 204

    status, logs, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        cookies=cookies,
    )
    assert status == 200
    assert logs == []


def test_progress_log_for_other_member_task_returns_403(
    progress_log_schema: psycopg.Connection,
) -> None:
    member_cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_id = int(tasks[0]["id"])

    _create_test_user(progress_log_schema, "other_member_progress", ["Member"])
    progress_log_schema.commit()
    other_cookies = _login(progress_log_schema, "other_member_progress")

    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 1},
        cookies=other_cookies,
    )
    assert status == 403
    assert body == {"detail": "learning task does not belong to member"}

    status, body, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        cookies=other_cookies,
    )
    assert status == 403
    assert body == {"detail": "learning task does not belong to member"}


def test_delete_other_member_progress_log_returns_403(
    progress_log_schema: psycopg.Connection,
) -> None:
    member_cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_id = int(tasks[0]["id"])

    status, log, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 1},
        cookies=member_cookies,
    )
    assert status == 200
    log_id = int(log["id"])

    _create_test_user(progress_log_schema, "other_member_progress", ["Member"])
    progress_log_schema.commit()
    other_cookies = _login(progress_log_schema, "other_member_progress")

    status, body, _ = _request(
        "DELETE",
        f"/api/planning/progress-logs/{log_id}",
        cookies=other_cookies,
    )
    assert status == 403
    assert body == {"detail": "progress log does not belong to member"}


def test_update_progress_log_invalid_or_negative_hours_returns_422(
    progress_log_schema: psycopg.Connection,
) -> None:
    cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_id = int(tasks[0]["id"])

    status, body, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": -1},
        cookies=cookies,
    )
    assert status == 422
    assert body == {"detail": "actual_hours must be a non-negative integer"}

    status, log, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 2},
        cookies=cookies,
    )
    assert status == 200
    log_id = int(log["id"])

    status, body, _ = _request(
        "PUT",
        f"/api/planning/progress-logs/{log_id}",
        {"actual_hours": "not-a-number"},
        cookies=cookies,
    )
    assert status == 422
    assert body == {"detail": "actual_hours must be a non-negative integer"}


def test_get_monthly_hours_aggregates_across_tasks_and_months(
    progress_log_schema: psycopg.Connection,
) -> None:
    cookies, tasks = _seed_plan_with_tasks(progress_log_schema)
    task_a_id = int(tasks[0]["id"])
    task_b_id = int(tasks[1]["id"])

    _request(
        "POST",
        f"/api/planning/learning-tasks/{task_a_id}/progress-logs",
        {"record_date": "2026-06-15", "actual_hours": 2},
        cookies=cookies,
    )
    _request(
        "POST",
        f"/api/planning/learning-tasks/{task_a_id}/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 3},
        cookies=cookies,
    )
    _request(
        "POST",
        f"/api/planning/learning-tasks/{task_b_id}/progress-logs",
        {"record_date": "2026-07-20", "actual_hours": 5},
        cookies=cookies,
    )

    status, summary, _ = _request(
        "GET",
        "/api/planning/progress-logs/monthly?year=2026",
        cookies=cookies,
    )
    assert status == 200
    assert summary == [{"month": 6, "total_hours": 2}, {"month": 7, "total_hours": 8}]


def test_progress_log_endpoints_require_member_role(
    progress_log_schema: psycopg.Connection,
) -> None:
    _create_test_user(progress_log_schema, "buddy_progress_only", ["Buddy"])
    progress_log_schema.commit()
    cookies = _login(progress_log_schema, "buddy_progress_only")

    status, _, _ = _request(
        "GET",
        "/api/planning/learning-tasks/1/progress-logs",
        cookies=cookies,
    )
    assert status == 403

    status, _, _ = _request(
        "POST",
        "/api/planning/learning-tasks/1/progress-logs",
        {"record_date": "2026-07-10", "actual_hours": 1},
        cookies=cookies,
    )
    assert status == 403

    status, _, _ = _request(
        "PUT",
        "/api/planning/progress-logs/1",
        {"actual_hours": 1},
        cookies=cookies,
    )
    assert status == 403

    status, _, _ = _request(
        "DELETE",
        "/api/planning/progress-logs/1",
        cookies=cookies,
    )
    assert status == 403

    status, _, _ = _request(
        "GET",
        "/api/planning/progress-logs/monthly?year=2026",
        cookies=cookies,
    )
    assert status == 403
