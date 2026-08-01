import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)
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
        connection.execute("DROP TABLE IF EXISTS capability_profile")
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
        connection.execute("DROP TABLE IF EXISTS capability_profile")
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
def profile_schema(connection: psycopg.Connection) -> psycopg.Connection:
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

    parsed = urlsplit(path)
    scope_path = parsed.path
    query_string = parsed.query.encode("utf-8")

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
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200


def _build_full_profile(
    connection: psycopg.Connection,
    member_username: str = "member_profile",
    buddy_username: str = "buddy_profile",
) -> tuple[int, dict[str, str]]:
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
    assert len(plan["items"]) == 1
    plan_item_id = plan["items"][0]["id"]

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task_id = next(task["id"] for task in tasks if task["plan_item_id"] == plan_item_id)

    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2026-03-15", "actual_hours": 5, "note": "学习日志"},
        cookies=member_cookies,
    )
    assert status == 200

    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "Evidence 内容", "evidence_link": "http://example.com"},
        cookies=member_cookies,
    )
    assert status == 200
    evidence_id = evidence["id"]

    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=member_cookies,
    )
    assert status == 200

    buddy_cookies = _login(connection, buddy_username)
    status, pending, _ = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    assert len(pending) == 1
    review_id = pending[0]["id"]
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidence-reviews/{review_id}",
        {"conclusion": "通过", "feedback": "符合要求"},
        cookies=buddy_cookies,
    )
    assert status == 200

    return member_id, member_cookies


def test_member_views_own_profile_with_aggregation(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert body is not None
    assert body["member_id"] == body["member"]["id"]
    assert body["year"] == 2026
    assert body["status"] == "已生成"

    assert len(body["assessments"]) == 1
    assessment = body["assessments"][0]
    assert assessment["status"] == "已归档"
    assert assessment["submitted_at"] is not None
    assert len(assessment["reviews"]) == 1
    assert assessment["reviews"][0]["conclusion"] == "认可"

    assert body["annual_plan"] is not None
    assert body["annual_plan"]["year"] == 2026
    assert len(body["annual_plan"]["items"]) == 1
    item = body["annual_plan"]["items"][0]
    assert item["l3_code"] == "P01-L2A-L3A"
    assert item["l2_code"] == "P01-L2A"
    assert item["l3_name"] == "Leaf"

    task = item["learning_task"]
    assert task is not None
    assert task["l3_code"] == "P01-L2A-L3A"
    assert task["l2_code"] == "P01-L2A"
    assert len(task["progress_logs"]) == 1
    assert task["progress_logs"][0]["actual_hours"] == 5

    assert len(task["evidences"]) == 1
    evidence = task["evidences"][0]
    assert evidence["status"] == "已归档"
    assert evidence["l2_code"] == "P01-L2A"
    assert evidence["review"] is not None
    assert evidence["review"]["conclusion"] == "通过"

    stats = body["statistics"]
    assert stats["total_learning_hours"] == 5
    assert stats["total_planned_hours"] == 10
    assert stats["evidence_count_by_status"]["已归档"] == 1


def test_buddy_views_assigned_member_profile(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, _ = _build_full_profile(profile_schema, "member_buddy_ok", "buddy_ok")
    buddy_cookies = _login(profile_schema, "buddy_ok")

    status, body, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={member_id}&year=2026",
        cookies=buddy_cookies,
    )
    assert status == 200
    assert body is not None
    assert body["member"]["username"] == "member_buddy_ok"


def test_buddy_cannot_view_unassigned_member_profile(
    profile_schema: psycopg.Connection,
) -> None:
    _build_full_profile(profile_schema, "member_private", "buddy_assigned")
    other_member_id = _create_test_user(profile_schema, "member_other", ["Member"])
    profile_schema.commit()
    buddy_cookies = _login(profile_schema, "buddy_assigned")

    status, body, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={other_member_id}&year=2026",
        cookies=buddy_cookies,
    )
    assert status == 403


def test_leader_and_admin_can_view_any_member_profile(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, _ = _build_full_profile(
        profile_schema, "member_leader_view", "buddy_leader"
    )
    _create_test_user(profile_schema, "leader_user", ["Leader"])
    _create_test_user(profile_schema, "admin_user", ["Admin"])
    profile_schema.commit()

    leader_cookies = _login(profile_schema, "leader_user")
    status, body, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={member_id}&year=2026",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body["member"]["username"] == "member_leader_view"

    admin_cookies = _login(profile_schema, "admin_user")
    status, body, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={member_id}&year=2026",
        cookies=admin_cookies,
    )
    assert status == 200
    assert body["member"]["username"] == "member_leader_view"


def test_member_cannot_view_other_member_profile(
    profile_schema: psycopg.Connection,
) -> None:
    _create_test_user(profile_schema, "member_self", ["Member"])
    other_member_id = _create_test_user(profile_schema, "member_other_view", ["Member"])
    profile_schema.commit()
    cookies = _login(profile_schema, "member_self")

    status, _, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={other_member_id}&year=2026",
        cookies=cookies,
    )
    assert status == 403


def test_profile_for_missing_member_returns_404(
    profile_schema: psycopg.Connection,
) -> None:
    _create_test_user(profile_schema, "admin_404", ["Admin"])
    profile_schema.commit()
    cookies = _login(profile_schema, "admin_404")

    status, _, _ = _request(
        "GET",
        "/api/planning/profiles?member_id=99999&year=2026",
        cookies=cookies,
    )
    assert status == 404


def test_unauthenticated_and_roleless_are_rejected(
    profile_schema: psycopg.Connection,
) -> None:
    _create_test_user(profile_schema, "member_roleless", [])
    profile_schema.commit()

    status, _, _ = _request("GET", "/api/planning/profiles?year=2026")
    assert status == 401

    roleless_cookies = _login(profile_schema, "member_roleless")
    status, _, _ = _request(
        "GET",
        "/api/planning/profiles?year=2026",
        cookies=roleless_cookies,
    )
    assert status == 403


def test_profile_auto_creates_record(
    profile_schema: psycopg.Connection,
) -> None:
    _create_test_user(profile_schema, "member_auto", ["Member"])
    profile_schema.commit()
    cookies = _login(profile_schema, "member_auto")

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["status"] == "已生成"
    assert body["annual_plan"] is None
    assert body["assessments"] == []
    assert body["statistics"]["total_learning_hours"] == 0
    assert body["statistics"]["total_planned_hours"] == 0


def test_planned_hours_aggregated_by_plan_year(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert body is not None
    assert body["statistics"]["total_planned_hours"] == 10
    assert body["statistics"]["total_planned_hours_min"] == 10
    assert body["statistics"]["total_planned_hours_max"] == 10
    assert body["statistics"]["total_planned_hours_has_unparsed"] is False


def test_cross_year_hours_filtered_by_record_date(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(
        profile_schema, "member_cross", "buddy_cross"
    )

    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task_id = tasks[0]["id"]

    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {"record_date": "2025-12-20", "actual_hours": 4, "note": "跨年日志"},
        cookies=member_cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2025", cookies=member_cookies
    )
    assert status == 200
    assert body is not None
    assert body["statistics"]["total_learning_hours"] == 4
    assert body["statistics"]["total_planned_hours"] == 0
    assert body["annual_plan"] is None

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert body is not None
    assert body["statistics"]["total_learning_hours"] == 5
    assert body["statistics"]["total_planned_hours"] == 10


def test_selectable_members_for_member_returns_only_self(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "member_select", ["Member"])
    profile_schema.execute(
        "UPDATE tcp_user SET target_level = NULL WHERE id = %s", (member_id,)
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "member_select")

    status, body, _ = _request(
        "GET", "/api/planning/profiles/selectable-members?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["members"] == [
        {
            "id": member_id,
            "username": "member_select",
            "full_name": "member_select",
            "current_level": None,
            "target_level": None,
        }
    ]


def test_selectable_members_for_buddy_returns_assigned(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, _ = _build_full_profile(
        profile_schema, "member_buddy_select", "buddy_select"
    )
    buddy_cookies = _login(profile_schema, "buddy_select")

    status, body, _ = _request(
        "GET",
        "/api/planning/profiles/selectable-members?year=2026",
        cookies=buddy_cookies,
    )
    assert status == 200
    assert body is not None
    assert len(body["members"]) == 1
    assert body["members"][0]["id"] == member_id
    assert body["members"][0]["username"] == "member_buddy_select"


def test_selectable_members_for_buddy_excludes_unassigned(
    profile_schema: psycopg.Connection,
) -> None:
    _build_full_profile(
        profile_schema, "member_assigned_select", "buddy_assigned_select"
    )
    _create_test_user(profile_schema, "member_unassigned_select", ["Member"])
    profile_schema.commit()
    buddy_cookies = _login(profile_schema, "buddy_assigned_select")

    status, body, _ = _request(
        "GET",
        "/api/planning/profiles/selectable-members?year=2026",
        cookies=buddy_cookies,
    )
    assert status == 200
    assert body is not None
    assert [m["username"] for m in body["members"]] == ["member_assigned_select"]


def test_selectable_members_for_leader_returns_members(
    profile_schema: psycopg.Connection,
) -> None:
    member_a = _create_test_user(profile_schema, "member_a_select", ["Member"])
    member_b = _create_test_user(profile_schema, "member_b_select", ["Member"])
    _create_test_user(profile_schema, "leader_select", ["Leader"])
    profile_schema.commit()
    leader_cookies = _login(profile_schema, "leader_select")

    status, body, _ = _request(
        "GET",
        "/api/planning/profiles/selectable-members?year=2026",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body is not None
    ids = {m["id"] for m in body["members"]}
    assert ids == {member_a, member_b}


def test_selectable_members_for_admin_returns_all_active(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "member_admin_select", ["Member"])
    buddy_id = _create_test_user(profile_schema, "buddy_admin_select", ["Buddy"])
    admin_id = _create_test_user(profile_schema, "admin_select", ["Admin"])
    profile_schema.commit()
    admin_cookies = _login(profile_schema, "admin_select")

    status, body, _ = _request(
        "GET",
        "/api/planning/profiles/selectable-members?year=2026",
        cookies=admin_cookies,
    )
    assert status == 200
    assert body is not None
    ids = {m["id"] for m in body["members"]}
    assert ids == {member_id, buddy_id, admin_id}


def test_member_overreach_with_member_id_is_rejected(
    profile_schema: psycopg.Connection,
) -> None:
    _create_test_user(profile_schema, "member_overreach", ["Member"])
    other_member_id = _create_test_user(
        profile_schema, "member_other_overreach", ["Member"]
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "member_overreach")

    status, _, _ = _request(
        "GET",
        f"/api/planning/profiles?member_id={other_member_id}&year=2026",
        cookies=cookies,
    )
    assert status == 403


def test_member_profile_includes_levels(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "profile_levels", ["Member"])
    profile_schema.execute(
        "UPDATE tcp_user SET current_level = %s, target_level = %s WHERE id = %s",
        ("P6", "P7", member_id),
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "profile_levels")

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["member"]["current_level"] == "P6"
    assert body["member"]["target_level"] == "P7"


def test_member_profile_levels_null(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "profile_none", ["Member"])
    profile_schema.execute(
        "UPDATE tcp_user SET target_level = NULL WHERE id = %s", (member_id,)
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "profile_none")

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["member"]["current_level"] is None
    assert body["member"]["target_level"] is None


def test_member_profile_level_only_target(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "profile_target", ["Member"])
    profile_schema.execute(
        "UPDATE tcp_user SET target_level = %s WHERE id = %s", ("P7", member_id)
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "profile_target")

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["member"]["current_level"] is None
    assert body["member"]["target_level"] == "P7"


def test_member_profile_level_only_current(
    profile_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(profile_schema, "profile_current", ["Member"])
    profile_schema.execute(
        "UPDATE tcp_user SET current_level = %s, target_level = NULL WHERE id = %s",
        ("P6", member_id),
    )
    profile_schema.commit()
    cookies = _login(profile_schema, "profile_current")

    status, body, _ = _request(
        "GET", "/api/planning/profiles?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["member"]["current_level"] == "P6"
    assert body["member"]["target_level"] is None
