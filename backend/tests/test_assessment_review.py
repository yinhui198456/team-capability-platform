import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import (
    get_assessment,
    get_assessment_reviews,
)
from app.assessment.schema import create_assessment_schema
from app.main import app
from tests.standard_target_support import (
    ensure_capability_nodes,
    record_submitted_history_state,
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


def _create_and_submit_assessment(
    connection: psycopg.Connection, username: str, year: int = 2026
) -> int:
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
        "GET", f"/api/assessments/scope-preview?year={year}", cookies=cookies
    )

    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/assessments",
        {"year": year, "scope_token": preview["scope_token"]},
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
    # Submit is retired (#178); build the historical submitted state
    # (待复核 + review row + revision bump + gaps/plan/tasks) directly.
    record_submitted_history_state(connection, assessment_id)
    connection.commit()
    return assessment_id


def test_buddy_approve_archives_assessment(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_approve", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_approve", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_approve")

    buddy_cookies = _login(assessment_schema, "buddy_approve")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    assert len(pending) == 1
    review_id = pending[0]["id"]

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200
    assert body is not None
    assert body["assessment_status"] == "已归档"
    assert body["plan"]["created"] is True
    assert body["plan"]["items_created"] == 1
    assert body["plan"]["tasks_created"] == 1

    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "已归档"
    assert assessment["archived_at"] is not None

    reviews = get_assessment_reviews(assessment_schema, assessment_id)
    assert len(reviews) == 1
    assert reviews[0]["status"] == "已闭环"
    assert reviews[0]["conclusion"] == "认可"
    assert reviews[0]["feedback"] == "符合预期"
    assert reviews[0]["reviewed_at"] is not None


def test_buddy_request_adjustment_and_resubmit(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_adjust", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_adjust", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_adjust")

    buddy_cookies = _login(assessment_schema, "buddy_adjust")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    review_id = pending[0]["id"]

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {
            "conclusion": "建议调整",
            "feedback": "请补充 P01-L2A-L3A 的项目实践依据",
            "expected_revision": 3,
        },
        cookies=buddy_cookies,
    )
    assert status == 200

    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "建议调整"

    member_cookies = _login(assessment_schema, "member_adjust")
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
                        "target_level": 4,
                        "evidence_note": "已补充项目实践依据",
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

    # The submit write path is retired (#178); rebuild the historical
    # submitted state directly and re-review it.
    record_submitted_history_state(assessment_schema, assessment_id)
    assessment_schema.commit()

    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    assert status == 200
    assert len(pending) == 1
    review_id2 = pending[0]["id"]
    assert review_id2 != review_id

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id2}",
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 7},
        cookies=buddy_cookies,
    )
    assert status == 200

    reviews = get_assessment_reviews(assessment_schema, assessment_id)
    assert len(reviews) == 2
    assert reviews[0]["status"] == "已闭环"
    assert reviews[0]["conclusion"] == "建议调整"
    assert reviews[1]["status"] == "已闭环"
    assert reviews[1]["conclusion"] == "认可"


def test_non_assigned_buddy_cannot_review(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_other", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_assigned", ["Buddy"])
    _create_test_user(assessment_schema, "buddy_other", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_other")

    assigned_cookies = _login(assessment_schema, "buddy_assigned")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=assigned_cookies
    )
    review_id = pending[0]["id"]

    other_cookies = _login(assessment_schema, "buddy_other")
    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "expected_revision": 3},
        cookies=other_cookies,
    )
    assert status == 403


def test_member_cannot_submit_review(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_review", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_review", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_review")

    buddy_cookies = _login(assessment_schema, "buddy_review")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]

    member_cookies = _login(assessment_schema, "member_review")
    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "expected_revision": 3},
        cookies=member_cookies,
    )
    assert status == 403


def test_pending_queue_only_returns_assigned_members(
    assessment_schema: psycopg.Connection,
) -> None:
    member_a = _create_test_user(assessment_schema, "member_a", ["Member"])
    member_b = _create_test_user(assessment_schema, "member_b", ["Member"])
    buddy_a = _create_test_user(assessment_schema, "buddy_a", ["Buddy"])
    buddy_b = _create_test_user(assessment_schema, "buddy_b", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_a, buddy_a)
    create_buddy_relationship(assessment_schema, member_b, buddy_b)
    assessment_schema.commit()

    _create_and_submit_assessment(assessment_schema, "member_a")
    _create_and_submit_assessment(assessment_schema, "member_b")

    cookies_a = _login(assessment_schema, "buddy_a")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=cookies_a
    )
    assert status == 200
    assert len(pending) == 1
    assert pending[0]["member_id"] == member_a

    cookies_b = _login(assessment_schema, "buddy_b")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=cookies_b
    )
    assert status == 200
    assert len(pending) == 1
    assert pending[0]["member_id"] == member_b


def test_invalid_conclusion_rejected(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_invalid", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_invalid", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_invalid")

    buddy_cookies = _login(assessment_schema, "buddy_invalid")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "拒绝", "expected_revision": 2},
        cookies=buddy_cookies,
    )
    assert status == 422


def _summary(
    connection: psycopg.Connection, username: str, year: int
) -> tuple[int, dict[str, int] | None]:
    cookies = _login(connection, username)
    status, body, _ = _request(
        "GET", f"/api/assessments/reviews/summary?year={year}", cookies=cookies
    )
    return status, body


def test_assessment_review_summary_counts_pending_and_completed(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_summary", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_summary", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    assessment_id = _create_and_submit_assessment(assessment_schema, "member_summary")

    status, body = _summary(assessment_schema, "buddy_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}

    buddy_cookies = _login(assessment_schema, "buddy_summary")
    status, pending, _ = _request(
        "GET", "/api/assessments/reviews/pending", cookies=buddy_cookies
    )
    review_id = pending[0]["id"]
    status, _, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/reviews/{review_id}",
        {"conclusion": "认可", "feedback": "符合预期", "expected_revision": 3},
        cookies=buddy_cookies,
    )
    assert status == 200

    status, body = _summary(assessment_schema, "buddy_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 0, "completed_count": 1}


def test_assessment_review_summary_filters_by_year(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_year", ["Member"])
    buddy_id = _create_test_user(assessment_schema, "buddy_year", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_id, buddy_id)
    assessment_schema.commit()

    _create_and_submit_assessment(assessment_schema, "member_year", year=2025)
    _create_and_submit_assessment(assessment_schema, "member_year", year=2026)

    status, body = _summary(assessment_schema, "buddy_year", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}

    status, body = _summary(assessment_schema, "buddy_year", 2025)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}


def test_assessment_review_summary_requires_buddy_role(
    assessment_schema: psycopg.Connection,
) -> None:
    _create_test_user(assessment_schema, "member_summary_role", ["Member"])
    assessment_schema.commit()

    status, body = _summary(assessment_schema, "member_summary_role", 2026)
    assert status == 403


def test_assessment_review_summary_only_includes_assigned_members(
    assessment_schema: psycopg.Connection,
) -> None:
    member_a = _create_test_user(assessment_schema, "member_a_summary", ["Member"])
    member_b = _create_test_user(assessment_schema, "member_b_summary", ["Member"])
    buddy_a = _create_test_user(assessment_schema, "buddy_a_summary", ["Buddy"])
    buddy_b = _create_test_user(assessment_schema, "buddy_b_summary", ["Buddy"])
    create_buddy_relationship(assessment_schema, member_a, buddy_a)
    create_buddy_relationship(assessment_schema, member_b, buddy_b)
    assessment_schema.commit()

    _create_and_submit_assessment(assessment_schema, "member_a_summary")
    _create_and_submit_assessment(assessment_schema, "member_b_summary")

    status, body = _summary(assessment_schema, "buddy_a_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}

    status, body = _summary(assessment_schema, "buddy_b_summary", 2026)
    assert status == 200
    assert body == {"pending_count": 1, "completed_count": 0}
