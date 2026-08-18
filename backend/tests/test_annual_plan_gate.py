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
from tests.review_support import submit_review
from tests.standard_target_support import (
    ensure_capability_nodes,
    publish_test_standard,
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
    connection: psycopg.Connection, username: str, roles: list[str]
) -> int:
    user_id = create_user(connection, username, username, "secret")
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P8' WHERE id = %s",
        (user_id,),
    )
    connection.commit()
    return user_id


@pytest.fixture
def assessment_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    _reset_assessment_schema(connection)
    # Issue #194: current-state schema (plan_month TEXT) needs the migration chain.
    from app.migrations import run_migrations
    from app.planning.schema import create_planning_schema

    create_planning_schema(connection)
    run_migrations(connection)
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
            "plan_month": "2026-05",
        }
    ]
    ensure_capability_nodes(connection, ["P01-L2A-L3A"])
    publish_test_standard(connection, ["P01-L2A-L3A"])
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
    # Issue #194: the API submit is retired; the review/approval machinery
    # is seeded through the retained repository-level path.
    from app.assessment.repository import submit_assessment

    member_id = int(
        connection.execute(
            "SELECT member_id FROM assessment WHERE id = %s", (assessment_id,)
        ).fetchone()[0]
    )
    submit_assessment(connection, assessment_id, member_id, 2)
    connection.commit()
    return assessment_id


def test_no_submitted_assessment_blocks_gate(
    assessment_schema: psycopg.Connection,
) -> None:
    _create_test_user(assessment_schema, "member_empty", ["Member"])
    cookies = _login(assessment_schema, "member_empty")

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=cookies
    )
    assert status == 200
    assert body == {"eligible": False, "reason": "暂无已提交的能力评估"}


def test_pending_review_does_not_block_gate(
    assessment_schema: psycopg.Connection,
) -> None:
    # Issue #82+#194: the gate only requires a submitted assessment; the
    # review outcome no longer gates eligibility (plans are generated at
    # submit / explicit generation, review is not a gate).
    member_id = _create_test_user(assessment_schema, "member_pending", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_pending", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    _create_and_submit_assessment(assessment_schema, "member_pending")
    member_cookies = _login(assessment_schema, "member_pending")

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=member_cookies
    )
    assert status == 200
    assert body == {"eligible": True, "reason": None}


def test_rejected_review_does_not_block_gate(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_reject", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_reject", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_reject")
    # Issue #194 P1-3: the review POST API is retired (410) — repository path.
    submit_review(
        assessment_schema,
        assessment_id,
        "buddy_reject",
        conclusion="建议调整",
        feedback="需补充",
    )

    member_cookies = _login(assessment_schema, "member_reject")
    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=member_cookies
    )
    assert status == 200
    assert body == {"eligible": True, "reason": None}


def test_approved_review_unblocks_gate(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_approve", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_approve", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_approve")
    # Issue #194 P1-3: the review POST API is retired (410) — repository path.
    submit_review(assessment_schema, assessment_id, "buddy_approve")

    member_cookies = _login(assessment_schema, "member_approve")
    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=member_cookies
    )
    assert status == 200
    assert body == {"eligible": True, "reason": None}


def test_new_pending_version_does_not_block_gate_again(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_reversion", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_reversion", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_reversion")
    # Issue #194 P1-3: the review POST API is retired (410) — repository path.
    submit_review(assessment_schema, assessment_id, "buddy_reversion")

    member_cookies = _login(assessment_schema, "member_reversion")
    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=member_cookies
    )
    assert status == 200
    assert body == {"eligible": True, "reason": None}

    # Create a new version after rejection flow is unavailable; create draft directly
    # then submit via API after saving details.
    status, preview, _ = _request(
        "GET", "/api/assessments/scope-preview?year=2026", cookies=member_cookies
    )

    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/assessments",
        {"year": 2026, "scope_token": preview["scope_token"]},
        cookies=member_cookies,
    )
    assert status == 200
    new_id = body["id"]
    status, _, _ = _request(
        "PUT",
        f"/api/assessments/{new_id}/draft",
        {
            "details": standard_target_payload(
                assessment_schema,
                new_id,
                [
                    {
                        "l3_code": "P01-L2A-L3A",
                        "current_level": 2,
                        "target_level": 5,
                        "evidence_note": "更新",
                        "member_priority": "高",
                        "include_in_plan": True,
                        "plan_month": "2026-05",
                    }
                ],
            ),
            "expected_revision": 1,
        },
        cookies=member_cookies,
    )
    assert status == 200
    # Issue #194: the API submit is retired; seed through the retained path.
    from app.assessment.repository import submit_assessment

    member_id = int(
        assessment_schema.execute(
            "SELECT member_id FROM assessment WHERE id = %s", (new_id,)
        ).fetchone()[0]
    )
    submit_assessment(assessment_schema, new_id, member_id, 2)
    assessment_schema.commit()

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=member_cookies
    )
    assert status == 200
    # A newer submitted assessment keeps eligibility (gate is review-free).
    assert body == {"eligible": True, "reason": None}


def test_non_member_role_returns_403(assessment_schema: psycopg.Connection) -> None:
    _create_test_user(assessment_schema, "buddy_only", ["Buddy"])
    cookies = _login(assessment_schema, "buddy_only")

    status, body, _ = _request(
        "GET", "/api/planning/annual-plan-eligibility", cookies=cookies
    )
    assert status == 403

    status, body, _ = _request(
        "POST", "/api/planning/annual-plan-dry-run", {}, cookies=cookies
    )
    assert status == 403


def test_dry_run_returns_409_when_blocked(
    assessment_schema: psycopg.Connection,
) -> None:
    _create_test_user(assessment_schema, "member_dry_blocked", ["Member"])
    cookies = _login(assessment_schema, "member_dry_blocked")

    status, body, _ = _request(
        "POST", "/api/planning/annual-plan-dry-run", {}, cookies=cookies
    )
    assert status == 409
    assert body == {"detail": "暂无已提交的能力评估"}


def test_dry_run_returns_ok_when_eligible(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_dry_ok", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_dry_ok", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_dry_ok")
    buddy_cookies = _login(assessment_schema, "buddy_dry_ok")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200

    # Issue #194 P1-3: the review POST API is retired (410) — repository path.
    submit_review(assessment_schema, assessment_id, "buddy_dry_ok")

    member_cookies = _login(assessment_schema, "member_dry_ok")
    status, body, _ = _request(
        "POST", "/api/planning/annual-plan-dry-run", {}, cookies=member_cookies
    )
    assert status == 200
    assert body == {"ok": True}
