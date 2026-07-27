import asyncio
import json
from typing import Any

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import (
    create_assessment_draft,
    get_assessment,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.main import app

SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
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
    import_catalog(resolve_workbook_dir(), connection)
    connection.commit()
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
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
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


def test_create_draft_save_details_submit_review(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_a", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_a", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.execute(
        """
        UPDATE capability_node
        SET enabled = (code = 'C01.01.01')
        WHERE node_type = 'L3'
        """
    )
    assessment_schema.commit()

    cookies = _login(assessment_schema, "member_a")

    status, body, _ = _request(
        "POST", "/api/assessments", {"year": 2026}, cookies=cookies
    )
    assert status == 200
    assert body is not None
    assessment_id = body["id"]

    # Auto-populated: all enabled L3s are pre-filled (in test DB without catalog,
    # this may be 0 rows — both cases are valid).
    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "草稿"

    # Save with a single real L3 code.
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": "C01.01.01",
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 4,
                    "target_adjustment_reason": "岗位项目要求",
                    "evidence_note": "测试中",
                    "plan_candidate": True,
                }
            ]
        },
        cookies=cookies,
    )
    assert status == 200

    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "草稿"
    details = assessment["details"]
    assert len(details) == 1
    assert details[0]["gap_value"] == 2

    status, body, _ = _request(
        "POST", f"/api/assessments/{assessment_id}/submit", {}, cookies=cookies
    )
    assert status == 200

    status, body, _ = _request(
        "GET", f"/api/assessments/{assessment_id}", cookies=cookies
    )
    assert status == 200
    assert body["status"] == "待复核"
    assert body["submitted_at"] is not None

    status, history, _ = _request(
        "GET", f"/api/assessments/{assessment_id}/history", cookies=cookies
    )
    assert status == 200
    assert len(history) == 1
    assert history[0]["status"] == "待复核"
    assert history[0]["buddy_id"] == buddy_id
    assert history[0]["conclusion"] is None


def test_member_cannot_view_or_edit_other_draft(
    assessment_schema: psycopg.Connection,
) -> None:
    member_a = _create_test_user(assessment_schema, "member_a2", ["Member"])
    _create_test_user(assessment_schema, "member_b2", ["Member"])
    assessment_id = create_assessment_draft(assessment_schema, member_a, 2026)
    assessment_schema.commit()

    cookies_b = _login(assessment_schema, "member_b2")

    status, body, _ = _request(
        "GET", f"/api/assessments/{assessment_id}", cookies=cookies_b
    )
    assert status == 403

    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {"details": []},
        cookies=cookies_b,
    )
    assert status == 403


def test_buddy_can_view_assigned_member_assessment(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_a3", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_a3", ["Buddy"])
    _create_test_user(assessment_schema, "buddy_b3", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_id = create_assessment_draft(assessment_schema, member_id, 2026)
    assessment_schema.commit()

    cookies_buddy = _login(assessment_schema, "buddy_a3")
    status, body, _ = _request(
        "GET", f"/api/assessments/{assessment_id}", cookies=cookies_buddy
    )
    assert status == 200

    cookies_other = _login(assessment_schema, "buddy_b3")
    status, body, _ = _request(
        "GET", f"/api/assessments/{assessment_id}", cookies=cookies_other
    )
    assert status == 403


def test_version_increments_for_same_member_year(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_a4", ["Member"])
    id1 = create_assessment_draft(assessment_schema, member_id, 2026)
    id2 = create_assessment_draft(assessment_schema, member_id, 2026)
    assessment_schema.commit()

    a1 = get_assessment(assessment_schema, id1)
    a2 = get_assessment(assessment_schema, id2)
    assert a1["version"] == 1
    assert a2["version"] == 2


def test_cannot_save_after_submit(assessment_schema: psycopg.Connection) -> None:
    member_id = _create_test_user(assessment_schema, "member_a5", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_a5", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_id = create_assessment_draft(assessment_schema, member_id, 2026)
    from app.assessment.repository import submit_assessment

    submit_assessment(assessment_schema, assessment_id, member_id)
    assessment_schema.commit()

    cookies = _login(assessment_schema, "member_a5")
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {"details": []},
        cookies=cookies,
    )
    assert status == 400
