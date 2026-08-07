import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import list_gaps
from app.assessment.schema import create_assessment_schema
from app.main import app
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
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")
    create_assessment_schema(connection)


def _create_test_user(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
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
def assessment_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    _reset_assessment_schema(connection)
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


def _create_and_submit_assessment(
    connection: psycopg.Connection,
    username: str,
    details: list[dict[str, object]] | None = None,
) -> int:
    desired_details = details or [
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
    ensure_capability_nodes(
        connection, [str(detail["l3_code"]) for detail in desired_details]
    )
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


def test_gap_generated_on_submit(assessment_schema: psycopg.Connection) -> None:
    member_id = _create_test_user(assessment_schema, "member_gap", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_gap", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_gap")

    gaps = list_gaps(assessment_schema, assessment_id=assessment_id)
    assert len(gaps) == 1
    assert gaps[0]["l3_code"] == "P01-L2A-L3A"
    assert gaps[0]["current_level"] == 2
    assert gaps[0]["target_level"] == 4
    assert gaps[0]["gap_value"] == 2
    assert gaps[0]["priority"] == "高"
    assert gaps[0]["plan_candidate"] is True


def test_gap_not_generated_when_gap_value_zero(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_zero", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_zero", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(
        assessment_schema,
        "member_zero",
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 4,
                "target_level": 4,
                "evidence_note": "无差距",
            }
        ],
    )

    gaps = list_gaps(assessment_schema, assessment_id=assessment_id)
    assert len(gaps) == 0


def test_member_update_gap_blocked_by_scope_v1(
    assessment_schema: psycopg.Connection,
) -> None:
    """#61: scope-v1 assessments disable legacy gap writes."""
    member_id = _create_test_user(assessment_schema, "member_update", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_update", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_update")
    gaps = list_gaps(assessment_schema, assessment_id=assessment_id)
    gap_id = int(gaps[0]["id"])

    cookies = _login(assessment_schema, "member_update")
    status, body, _ = _request(
        "PUT",
        f"/api/gaps/{gap_id}",
        {"priority": "高", "plan_candidate": True},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_gap_write_disabled"


def test_non_member_update_gap_blocked_by_scope_v1(
    assessment_schema: psycopg.Connection,
) -> None:
    """#61: scope-v1 block fires before permission check."""
    member_id = _create_test_user(assessment_schema, "member_owner", ["Member"])
    _create_test_user(assessment_schema, "member_other_gap", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_owner", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_owner")
    gaps = list_gaps(assessment_schema, assessment_id=assessment_id)
    gap_id = int(gaps[0]["id"])

    cookies = _login(assessment_schema, "member_other_gap")
    status, body, _ = _request(
        "PUT",
        f"/api/gaps/{gap_id}",
        {"priority": "高", "plan_candidate": True},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "legacy_gap_write_disabled"


def test_buddy_can_view_assigned_member_gaps(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_buddy_view", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_view", ["Buddy"])
    _create_test_user(assessment_schema, "buddy_other_gap", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(
        assessment_schema, "member_buddy_view"
    )

    buddy_cookies = _login(assessment_schema, "buddy_view")
    status, body, _ = _request(
        "GET", f"/api/gaps?assessment_id={assessment_id}", cookies=buddy_cookies
    )
    assert status == 200
    assert len(body) == 1

    other_cookies = _login(assessment_schema, "buddy_other_gap")
    status, body, _ = _request(
        "GET", f"/api/gaps?assessment_id={assessment_id}", cookies=other_cookies
    )
    assert status == 200
    assert len(body) == 0


def test_leader_can_view_all_gaps(assessment_schema: psycopg.Connection) -> None:
    _create_test_user(assessment_schema, "member_leader", ["Member"])
    _create_test_user(assessment_schema, "leader_gap", ["Leader"])
    _create_and_submit_assessment(assessment_schema, "member_leader")

    leader_cookies = _login(assessment_schema, "leader_gap")
    status, body, _ = _request("GET", "/api/gaps", cookies=leader_cookies)
    assert status == 200
    assert len(body) == 1


def test_resubmit_does_not_duplicate_gap(assessment_schema: psycopg.Connection) -> None:
    member_id = _create_test_user(assessment_schema, "member_resubmit", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_resubmit", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_resubmit")

    buddy_cookies = _login(assessment_schema, "buddy_resubmit")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    review_id = pending[0]["id"]

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "建议调整", "feedback": "请补充", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200

    member_cookies = _login(assessment_schema, "member_resubmit")
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": standard_target_payload(
                assessment_schema,
                assessment_id,
                [
                    {
                        "l3_code": "P01-L2A-L3A",
                        "current_level": 2,
                        "target_level": 5,
                        "evidence_note": "已补充",
                        "member_priority": "高",
                        "include_in_plan": True,
                        "plan_quarter": "Q2",
                        "plan_month": 5,
                    }
                ],
            ),
            "expected_revision": 4,
        },
        cookies=member_cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 5},
        cookies=member_cookies,
    )
    assert status == 200

    gaps = list_gaps(assessment_schema, assessment_id=assessment_id)
    assert len(gaps) == 1
    assert gaps[0]["target_level"] == 5
    assert gaps[0]["gap_value"] == 3
