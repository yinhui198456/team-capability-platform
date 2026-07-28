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
        """,
        (model_id, l2[0], l3_code, materials_text, expected_output, estimated_hours),
    )


@pytest.fixture
def planning_schema(connection: psycopg.Connection) -> psycopg.Connection:
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
            "plan_candidate": True,
        },
        {
            "l3_code": "P01-L2A-L3B",
            "current_level": 1,
            "target_level": 3,
            "evidence_note": "测试中",
            "plan_candidate": True,
        },
    ]
    ensure_capability_nodes(connection, ["P01-L2A-L3A", "P01-L2A-L3B"])
    cookies = _login(connection, username)
    status, body, _ = _request(
        "POST", "/api/assessments", {"year": 2026}, cookies=cookies
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


def test_generate_without_submitted_assessment_returns_409(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_no_assess", ["Member"])
    cookies = _login(planning_schema, "member_no_assess")

    status, body, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=cookies
    )
    assert status == 409
    assert body == {"detail": "暂无已提交的能力评估"}


def test_generate_creates_plan_items_and_is_idempotent(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_plan", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_plan", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    _ensure_l3_node(planning_schema, "P01-L2A-L3A")
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_plan")
    _approve_assessment(planning_schema, assessment_id, "buddy_plan")

    member_cookies = _login(planning_schema, "member_plan")

    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert len(gaps) == 2
    for gap in gaps:
        status, _, _ = _request(
            "POST",
            "/api/planning/growth-goals",
            {"gap_id": gap["id"]},
            cookies=member_cookies,
        )
        assert status == 200

    status, result, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=member_cookies
    )
    assert status == 200
    assert result["created"] == 2
    items = result["items"]
    assert len(items) == 2
    items_by_code = {item["l3_code"]: item for item in items}
    assert "P01-L2A-L3A" in items_by_code
    assert "P01-L2A-L3B" in items_by_code
    item = items_by_code["P01-L2A-L3A"]
    assert item["l1_code"] == "P01"
    assert item["l2_code"] == "P01-L2A"
    assert item["l2_name"] is not None
    assert item["l3_name"] is not None
    assert item["current_level"] == 2
    assert item["target_level"] == 4
    assert item["priority"] == "中"
    assert item["learning_material"] == "test materials"
    assert item["expected_output"] == "test output"
    assert item["estimated_hours"] == "10"
    assert item["estimated_hours_parsed"] == {
        "raw": "10",
        "min_hours": 10.0,
        "max_hours": 10.0,
        "is_valid": True,
        "is_range": False,
    }
    assert item["status"] == "未开始"
    assert item["target_month"] is None

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    assert {task["plan_item_id"] for task in tasks} == {item["id"] for item in items}
    assert {task["status"] for task in tasks} == {"未开始"}
    assert (
        next(task for task in tasks if task["l3_code"] == "P01-L2A-L3A")["l2_code"]
        == "P01-L2A"
    )

    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    assert plan["year"] == 2026
    assert plan["estimated_hours_summary"] == {
        "min_hours": 10.0,
        "max_hours": 10.0,
        "has_values": True,
        "has_unparsed": False,
    }
    assert plan["status"] == "制定中"
    assert len(plan["items"]) == 2

    status, result, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=member_cookies
    )
    assert status == 200
    assert result["created"] == 0

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    assert len(tasks) == 2


def test_generate_plan_item_parses_hour_suffix_ranges(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_range", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_range", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    _ensure_l3_node(planning_schema, "P01-L2A-L3A", estimated_hours="4–6h")
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_range")
    _approve_assessment(planning_schema, assessment_id, "buddy_range")

    member_cookies = _login(planning_schema, "member_range")
    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert len(gaps) == 2
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
    item = result["items"][0]
    assert item["estimated_hours"] == "4–6h"
    assert item["estimated_hours_parsed"] == {
        "raw": "4–6h",
        "min_hours": 4.0,
        "max_hours": 6.0,
        "is_valid": True,
        "is_range": True,
    }

    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    assert plan["estimated_hours_summary"] == {
        "min_hours": 4.0,
        "max_hours": 6.0,
        "has_values": True,
        "has_unparsed": False,
    }


def test_member_can_adjust_own_plan_item_schedule_and_pause_execution(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_adjust_plan", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_adjust_plan", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    _ensure_l3_node(planning_schema, "P01-L2A-L3A")
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_adjust_plan")
    _approve_assessment(planning_schema, assessment_id, "buddy_adjust_plan")
    cookies = _login(planning_schema, "member_adjust_plan")
    status, gaps, _ = _request("GET", "/api/planning/eligible-gaps", cookies=cookies)
    assert status == 200
    status, _, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": gaps[0]["id"]}, cookies=cookies
    )
    assert status == 200
    status, generated, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=cookies
    )
    assert status == 200
    item_id = int(generated["items"][0]["id"])

    status, item, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {
            "plan_start_date": "2026-04-01",
            "plan_end_date": "2026-05-31",
            "target_month": 5,
            "status": "暂停",
        },
        cookies=cookies,
    )
    assert status == 200
    assert item["plan_start_date"] == "2026-04-01"
    assert item["plan_end_date"] == "2026-05-31"
    assert item["target_month"] == 5
    assert item["status"] == "暂停"

    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=cookies)
    assert status == 200
    assert (
        next(task for task in tasks if task["plan_item_id"] == item_id)["status"]
        == "暂停"
    )


def test_plan_items_list_and_annual_plan_are_member_only(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "buddy_only_plan", ["Buddy"])
    cookies = _login(planning_schema, "buddy_only_plan")

    status, _, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=cookies
    )
    assert status == 403

    status, _, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=cookies
    )
    assert status == 403

    status, _, _ = _request("GET", "/api/planning/plan-items", cookies=cookies)
    assert status == 403


def test_annual_plan_returns_null_when_missing(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_empty_plan", ["Member"])
    cookies = _login(planning_schema, "member_empty_plan")

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is None
