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
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
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


def test_legacy_goal_creation_blocked(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_empty", ["Member"])
    cookies = _login(planning_schema, "member_empty")

    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"
    status, body, _ = _request(
        "DELETE", "/api/planning/growth-goals/1", cookies=cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"


def test_goal_blocked_even_with_pending_review(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_pending", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_pending", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    planning_schema.commit()

    _create_and_submit_assessment(planning_schema, "member_pending")
    member_cookies = _login(planning_schema, "member_pending")

    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=member_cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"


def test_goal_blocked_after_approval_plan_comes_from_assessment(
    planning_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(planning_schema, "member_approve", ["Member"])
    buddy_id = _create_test_user(planning_schema, "buddy_approve", ["Buddy"])
    create_buddy_relationship(planning_schema, member_id, buddy_id)
    planning_schema.commit()

    assessment_id = _create_and_submit_assessment(planning_schema, "member_approve")
    # Approval atomically creates the plan; the manual goal lifecycle stays blocked.
    _approve_assessment(planning_schema, assessment_id, "buddy_approve")
    plan = planning_schema.execute(
        "SELECT COUNT(*) FROM annual_growth_plan WHERE member_id=%s",
        (member_id,),
    ).fetchone()[0]
    assert plan == 1
    items = planning_schema.execute(
        "SELECT COUNT(*) FROM plan_item WHERE source_assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    assert items == 2
    member_cookies = _login(planning_schema, "member_approve")
    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=member_cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"


def test_duplicate_goal_creation_blocked(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "member_dup", ["Member"])
    cookies = _login(planning_schema, "member_dup")
    status, body, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=cookies
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_planning_write_disabled"


def test_non_member_role_returns_403(
    planning_schema: psycopg.Connection,
) -> None:
    _create_test_user(planning_schema, "leader_only", ["Leader"])
    cookies = _login(planning_schema, "leader_only")
    status, _, _ = _request(
        "POST", "/api/planning/growth-goals", {"gap_id": 1}, cookies=cookies
    )
    assert status == 403
