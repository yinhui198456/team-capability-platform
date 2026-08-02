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
            recommended_start_level,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, %s, 'L3', %s, 'Leaf', 1, %s, %s, %s, 'P4',
                'test.xlsx', 'sheet', 4)
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


def test_legacy_generate_endpoint_blocked(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_no_assess", ["Member"])
    cookies = _login(planning_schema, "member_no_assess")

    status, body, _ = _request(
        "POST", "/api/planning/annual-plan/generate", {}, cookies=cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"


def test_approval_creates_plan_items_and_is_idempotent(
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
    # The approval atomically created the plan, items and tasks.
    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    assert plan["planning_source_type"] == "assessment_approval"
    assert plan["source_assessment_id"] == assessment_id
    items = plan["items"]
    assert len(items) == 2
    for item in items:
        assert item["source_assessment_detail_id"] is not None
        assert item["planning_source_type"] == "assessment_approval"

    status, plan2, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert len(plan2["items"]) == 2

    # re-approval (without key) is rejected; nothing is duplicated
    from app.assessment.repository import ReviewError, submit_assessment_review

    review_id = planning_schema.execute(
        "SELECT id FROM assessment_review WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    try:
        submit_assessment_review(
            planning_schema,
            int(review_id),
            buddy_id,
            "认可",
            "重复",
            expected_revision=3,
            assessment_id_from_url=assessment_id,
        )
        raise AssertionError("duplicate approval should be rejected")
    except ReviewError as exc:
        assert exc.code == "assessment_already_reviewed"

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    assert len(tasks) == 2


def test_approval_plan_item_parses_hour_suffix_ranges(
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
    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    item = plan["items"][0]
    # frozen snapshot copied the node's hour text at generation time
    assert item["estimated_hours"] == "4–6h"
    assert item["estimated_hours_parsed"] == {
        "raw": "4–6h",
        "min_hours": 4.0,
        "max_hours": 6.0,
        "is_valid": True,
        "is_range": True,
    }
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
    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=cookies
    )
    assert status == 200
    item_id = int(plan["items"][0]["id"])

    # legacy target_month is frozen for assessment-approved items
    status, _, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {"target_month": 5},
        cookies=cookies,
    )
    assert status == 422

    status, item, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {
            "plan_start_date": "2026-04-01",
            "plan_end_date": "2026-05-31",
        },
        cookies=cookies,
    )
    assert status == 200
    assert item["plan_start_date"] == "2026-04-01"
    assert item["plan_end_date"] == "2026-05-31"

    # v0010: task status is machine-managed via the transition endpoint.
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=cookies)
    assert status == 200
    task_id = next(task for task in tasks if task["plan_item_id"] == item_id)["id"]
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "进行中"},
        cookies=cookies,
    )
    assert status == 200
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "暂停", "reason": "等待资源"},
        cookies=cookies,
    )
    assert status == 200
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=cookies)
    assert status == 200
    assert next(task for task in tasks if task["id"] == task_id)["status"] == "暂停"


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
    ensure_capability_nodes(planning_schema, ["P01-L2A-L3A"])
    from app.migrations import run_migrations

    run_migrations(planning_schema)
    planning_schema.commit()
    cookies = _login(planning_schema, "member_empty_plan")

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is None
