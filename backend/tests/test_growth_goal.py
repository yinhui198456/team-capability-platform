import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.main import app
from app.planning.schema import create_planning_schema
from tests.standard_target_support import (
    ensure_capability_nodes,
    standard_target_payload,
)

SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS assessment_review")
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
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")
    create_assessment_schema(connection)


def _reset_planning_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
    create_planning_schema(connection)


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


@pytest.fixture
def planning_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    _reset_assessment_schema(connection)
    _reset_planning_schema(connection)
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


def test_no_submitted_assessment_returns_empty_and_blocks_creation(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_empty", ["Member"])
    cookies = _login(planning_schema, "member_empty")

    status, body, _ = _request("GET", "/api/planning/eligible-gaps", cookies=cookies)
    assert status == 200
    assert body == []

    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=cookies
    )
    assert status == 409


def test_pending_review_blocks_goal_creation(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_pending", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_pending", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    planning_schema.commit()

    _create_and_submit_assessment(planning_schema, "member_pending")
    member_cookies = _login(planning_schema, "member_pending")

    status, body, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert body == []

    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=member_cookies
    )
    assert status == 409


def test_approved_assessment_allows_goal_lifecycle(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_approve", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_approve", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_approve")
    _approve_assessment(planning_schema, assessment_id, "buddy_approve")

    member_cookies = _login(planning_schema, "member_approve")

    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    assert len(gaps) == 2
    gap_id = gaps[0]["id"]
    l3_code = gaps[0]["l3_code"]

    status, goal, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gap_id},
        cookies=member_cookies,
    )
    assert status == 200
    assert goal["l3_code"] == l3_code
    assert goal["year"] == 2026
    assert goal["target_level"] == gaps[0]["target_level"]
    assert goal["priority"] == gaps[0]["priority"]

    status, goals, _ = _request(
        "GET", "/api/planning/growth-goals", cookies=member_cookies
    )
    assert status == 200
    assert len(goals) == 1
    goal_id = goals[0]["id"]

    status, _, _ = _request(
        "DELETE", f"/api/planning/growth-goals/{goal_id}", cookies=member_cookies
    )
    assert status == 204

    status, goals, _ = _request(
        "GET", "/api/planning/growth-goals", cookies=member_cookies
    )
    assert status == 200
    assert goals == []

    status, goal, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gap_id},
        cookies=member_cookies,
    )
    assert status == 200


def test_duplicate_goal_for_same_l3_returns_409(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_dup", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_dup", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_dup")
    _approve_assessment(planning_schema, assessment_id, "buddy_dup")

    member_cookies = _login(planning_schema, "member_dup")
    status, gaps, _ = _request(
        "GET", "/api/planning/eligible-gaps", cookies=member_cookies
    )
    assert status == 200
    gap_id = gaps[0]["id"]

    status, _, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gap_id},
        cookies=member_cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/planning/growth-goals",
        {"gap_id": gap_id},
        cookies=member_cookies,
    )
    assert status == 409


def test_non_member_role_returns_403(planning_schema: psycopg.Connection) -> None:
    _create_test_user(planning_schema, "buddy_only", ["Buddy"])
    cookies = _login(planning_schema, "buddy_only")

    status, _, _ = _request("GET", "/api/planning/eligible-gaps", cookies=cookies)
    assert status == 403

    status, _, _ = _request("GET", "/api/planning/growth-goals", cookies=cookies)
    assert status == 403

    status, _, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=cookies
    )
    assert status == 403

    status, _, _ = _request("DELETE", "/api/planning/growth-goals/1", cookies=cookies)
    assert status == 403
