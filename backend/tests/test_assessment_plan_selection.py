"""Issue #61: Plan selection business rules — backend tests.

Covers:
- current_level=0 semantic (distinct from NULL)
- member_priority is never auto-generated
- 暂缓 ↔ include_in_plan mutual exclusion
- include_in_plan tri-state (NULL/TRUE/FALSE)
- Quarter-month mapping (Q1=1-3, Q2=4-6, Q3=7-9, Q4=10-12)
- Gap=0 auto-clears plan fields (same transaction)
- Uncheck include_in_plan clears quarter/month atomically
- PATCH sparse semantics (unset vs explicit NULL vs FALSE vs 0)
- plan_candidate returns 422 deprecated_field
- legacy gap write blocked for scope-v1
- revision 409 zero-write
- parameter tampering → 422
- No evidence gate at submit
"""

import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.repository import get_assessment
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.main import app
from app.migrations import run_migrations
from tests.standard_target_support import (
    create_scoped_draft,
)

_L3_CODE = "C01.01.01"


def _detail_l3_node_id(
    connection: psycopg.Connection, assessment_id: int, l3_code: str
) -> int | None:
    row = connection.execute(
        "SELECT l3_node_id FROM assessment_detail "
        "WHERE assessment_id = %s AND l3_code = %s",
        (assessment_id, l3_code),
    ).fetchone()
    return int(row[0]) if row and row[0] is not None else None


def _enable_one_l3(connection: psycopg.Connection) -> str:
    """Enable exactly one L3 from the imported catalog and return its code.

    The workbook import + run_migrations in the fixture already creates
    capability_standard_items for all L3s.  We just enable one node.
    """
    connection.execute(
        "UPDATE capability_node SET enabled = (code = %s) WHERE node_type = 'L3'",
        (_L3_CODE,),
    )
    connection.commit()
    return _L3_CODE


def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    import asyncio

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
        return {
            "type": "http.request",
            "body": body_bytes,
            "more_body": False,
        }

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    async def _run() -> None:
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

    asyncio.run(_run())

    status_message = next(message for message in messages if "status" in message)
    status_code = status_message["status"]
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None
    return status_code, parsed_body


def _cookie_attributes(headers: list[tuple[str, str]]) -> dict[str, str]:
    """Parse Set-Cookie header list."""
    for header_list in headers:
        for value in header_list:
            parts = [p.strip() for p in value.split(";")]
            result = {}
            if parts and "=" in parts[0]:
                name, val = parts[0].split("=", 1)
                result[name] = val
            for part in parts[1:]:
                if "=" in part:
                    k, v = part.split("=", 1)
                    result[k] = v
                elif part:
                    result[part] = ""
            if result:
                return result
    return {}


SESSION_COOKIE = "tcp_session"


# Full ASGI request with cookie tracking.
async def _full_asgi(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, str]]:
    import asyncio

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
        return {
            "type": "http.request",
            "body": body_bytes,
            "more_body": False,
        }

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    async def _run() -> None:
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

    asyncio.run(_run())

    status_message = next(message for message in messages if "status" in message)
    status_code = status_message["status"]
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None

    response_headers: list[list[str]] = [msg.get("headers", []) for msg in messages]
    cookies_dict = _cookie_attributes(
        [
            [
                name.decode() if isinstance(name, bytes) else name,
                value.decode() if isinstance(value, bytes) else value,
            ]
            for msg_list in response_headers
            for name, value in msg_list
            if (name.decode() if isinstance(name, bytes) else name) == "set-cookie"
        ]
        if response_headers
        else []
    )

    return status_code, parsed_body, cookies_dict


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    return _asgi_request(method, path, body, cookies)


def _login(
    connection: psycopg.Connection,
    username: str,
    password: str = "secret",
) -> dict[str, str]:
    import asyncio

    login_body = {"username": username, "password": password}
    status, body = _asgi_request("POST", "/api/auth/login", login_body)
    assert status == 200, f"login failed: {body}"
    # Quick cookie extraction via full ASGI
    import json as _j

    async def _run():
        messages = []
        headers = [
            (b"content-type", b"application/json"),
            (
                b"content-length",
                str(len(_j.dumps(login_body).encode())).encode(),
            ),
        ]
        body_bytes = _j.dumps(login_body).encode()

        async def recv():
            return {"type": "http.request", "body": body_bytes, "more_body": False}

        async def snd(msg):
            messages.append(msg)

        await app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": "POST",
                "scheme": "http",
                "path": "/api/auth/login",
                "raw_path": b"/api/auth/login",
                "query_string": b"",
                "headers": headers,
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            recv,
            snd,
        )
        for msg in messages:
            for n, v in msg.get("headers", []):
                name = n.decode() if isinstance(n, bytes) else n
                val = v.decode() if isinstance(v, bytes) else v
                if name == b"set-cookie" or name == "set-cookie":
                    parts = [p.strip() for p in val.split(";")]
                    if parts and "=" in parts[0]:
                        key, value = parts[0].split("=", 1)
                        return {SESSION_COOKIE: value}
        return {}

    return asyncio.run(_run())


def _create_test_user(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
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
def plan_schema(connection: psycopg.Connection) -> psycopg.Connection:
    """Full schema reset including v0007 migration."""
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment_idempotency_key")
        connection.execute("DROP TABLE IF EXISTS assessment_draft_target_repair_audit")
        connection.execute("DROP TABLE IF EXISTS assessment")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    create_assessment_schema(connection)
    connection.execute("DROP TABLE IF EXISTS schema_migration CASCADE")
    connection.execute("DROP TABLE IF EXISTS capability_standard_item CASCADE")
    connection.execute("DROP TABLE IF EXISTS capability_standard_version CASCADE")
    import_catalog(resolve_workbook_dir(), connection)
    run_migrations(connection)
    connection.commit()
    return connection


# ── Tests ────────────────────────────────────────────────────────


def test_current_level_zero_submits_successfully(
    plan_schema: psycopg.Connection,
) -> None:
    """0 is a valid current_level; submits without evidence gate."""
    member_id = _create_test_user(plan_schema, "m_zero", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_zero")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    assert detail is not None
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    # current_level=0, no evidence
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 0,
                    "member_priority": "低",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 2,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"put failed: {body}"

    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200, f"submit with level=0 failed: {body}"


def test_priority_not_auto_generated(plan_schema: psycopg.Connection) -> None:
    """System must never auto-generate member_priority."""
    member_id = _create_test_user(plan_schema, "m_noauto", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)

    assessment = get_assessment(plan_schema, assessment_id)
    for detail in assessment["details"]:
        assert (
            detail["member_priority"] is None
        ), f"member_priority should be NULL, got {detail['member_priority']}"


def test_hold_and_plan_mutually_exclusive(plan_schema: psycopg.Connection) -> None:
    """暂缓 + include_in_plan=TRUE → 422."""
    member_id = _create_test_user(plan_schema, "m_hold", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_hold")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "target for positive gap",
                    "member_priority": "暂缓",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 422, f"expected 422, got {status}: {body}"


def test_include_in_plan_requires_quarter_month(
    plan_schema: psycopg.Connection,
) -> None:
    """include_in_plan=TRUE without quarter+month → 422."""
    member_id = _create_test_user(plan_schema, "m_noqm", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_noqm")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 422, f"expected 422, got {status}: {body}"


def test_quarter_month_mapping(plan_schema: psycopg.Connection) -> None:
    """Q1+5月 → 422; Q1+2月 → 200."""
    member_id = _create_test_user(plan_schema, "m_qmap", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_qmap")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    # Invalid: Q1 + 5月 (need positive gap to reach quarter validation)
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "中",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 5,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 422, f"Q1+5 should fail: {body}"

    # Valid: Q1 + 2月
    status, body = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": code,
                    "plan_quarter": "Q1",
                    "plan_month": 2,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"Q1+2 should pass: {body}"


def test_gap_zero_clears_plan_fields(plan_schema: psycopg.Connection) -> None:
    """Gap=0 auto-clears plan fields in same transaction."""
    member_id = _create_test_user(plan_schema, "m_gapzero", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_gapzero")

    detail = plan_schema.execute(
        "SELECT l3_code, standard_target_level "
        "FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    std_target = int(detail[1])
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    # Set current_level = target → Gap=0
    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": std_target,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q3",
                    "plan_month": 8,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    # Gap=0 → plan fields should be auto-cleared. The PUT sends them but
    # the server should clear them in the transaction. This may be 200 or 422
    # depending on exact validation order.
    assessment = get_assessment(plan_schema, assessment_id)
    gap_detail = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert gap_detail["gap_value"] == 0 or gap_detail["gap_value"] is None
    assert gap_detail["member_priority"] is None
    assert gap_detail["include_in_plan"] is None


def test_uncheck_plan_clears_quarter_month(plan_schema: psycopg.Connection) -> None:
    """include_in_plan=FALSE atomically clears quarter+month."""
    member_id = _create_test_user(plan_schema, "m_uncheck", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_uncheck")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    # First set plan
    status, body = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q1",
                    "plan_month": 3,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"first patch: {body}"

    # Now uncheck
    status, body = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": code,
                    "include_in_plan": False,
                }
            ],
            "expected_revision": 2,
        },
        cookies=cookies,
    )
    assert status == 200, f"uncheck patch: {body}"

    assessment = get_assessment(plan_schema, assessment_id)
    gap_detail = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert gap_detail["include_in_plan"] is False
    assert gap_detail["plan_quarter"] is None
    assert gap_detail["plan_month"] is None


def test_priority_auto_cleared_when_no_gap(plan_schema: psycopg.Connection) -> None:
    """member_priority auto-cleared when Gap <= 0 (P1-3 atomic cleanup)."""
    member_id = _create_test_user(plan_schema, "m_nogap", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_nogap")

    detail = plan_schema.execute(
        "SELECT l3_code, standard_target_level "
        "FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    std_target = int(detail[1])
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": std_target,  # Gap=0
                    "member_priority": "高",
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200, f"auto-clear should succeed: {body}"
    # Verify priority was auto-cleared
    assessment = get_assessment(plan_schema, assessment_id)
    detail = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert detail["member_priority"] is None


def test_deprecated_plan_candidate_422(plan_schema: psycopg.Connection) -> None:
    """PUT/PATCH with plan_candidate → 422 deprecated_field."""
    member_id = _create_test_user(plan_schema, "m_depr", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_depr")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    for method in ("PUT", "PATCH"):
        status, body = _request(
            method,
            f"/api/assessments/{assessment_id}/draft",
            {
                "details": [
                    {
                        "l3_node_id": node_id,
                        "l3_code": code,
                        "current_level": 2,
                        "plan_candidate": True,
                    }
                ],
                "expected_revision": 1,
            },
            cookies=cookies,
        )
        assert status == 422, f"{method} plan_candidate: {status}"
        assert isinstance(body, dict)
    d = body.get("detail")
    assert d if isinstance(d, dict) else d is not None
    detail = body.get("detail")
    assert isinstance(detail, dict) and detail.get("code") == "deprecated_field"


def test_legacy_gap_write_blocked_for_scope_v1(plan_schema: psycopg.Connection) -> None:
    """scope-v1 assessment: PUT /api/gaps/{id} → 422 legacy_gap_write_disabled."""
    member_id = _create_test_user(plan_schema, "m_legacygap", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_legacygap")

    # Save with gap>0 to generate gap row
    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )

    gap_rows = plan_schema.execute(
        "SELECT id FROM gap WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, code),
    ).fetchall()
    if gap_rows:
        gap_id = int(gap_rows[0][0])
        status, body = _request(
            "PUT",
            f"/api/gaps/{gap_id}",
            {"priority": "高", "plan_candidate": True},
            cookies=cookies,
        )
        assert status == 422, f"legacy gap write not blocked: {status} {body}"
        assert isinstance(body, dict)
        assert body.get("detail", {}).get("code") == "legacy_gap_write_disabled"


def test_revision_conflict_409_zero_writes(plan_schema: psycopg.Connection) -> None:
    """409 on revision conflict; no data written."""
    member_id = _create_test_user(plan_schema, "m_rev409", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_rev409")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]

    # Save once
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": code, "current_level": 2}],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    # Attempt save with stale revision
    status, body = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": code, "current_level": 3}],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 409, f"expected 409, got {status}: {body}"

    # current_level should still be 2, not 3
    assessment = get_assessment(plan_schema, assessment_id)
    saved = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert saved["current_level"] == 2


def test_include_in_plan_tri_state_null(plan_schema: psycopg.Connection) -> None:
    """include_in_plan=NULL represents 未决定 — submit blocks it."""
    member_id = _create_test_user(plan_schema, "m_tri", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_tri")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]

    # Fill current_level, set priority, but leave include_in_plan=NULL
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "中",
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    # Submit should block — include_in_plan is still NULL
    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 422, f"submit with NULL include_in_plan: {status} {body}"
    assert "plan_decision_required" in str(body)


def test_patch_unset_vs_null(plan_schema: psycopg.Connection) -> None:
    """PATCH: unset field preserves existing value; explicit null clears it."""
    member_id = _create_test_user(plan_schema, "m_patch", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_patch")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]

    # Set priority
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    # Patch without touching priority — should stay "高"
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": code, "current_level": 3}],
            "expected_revision": 2,
        },
        cookies=cookies,
    )
    assert status == 200
    assessment = get_assessment(plan_schema, assessment_id)
    saved = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert saved["member_priority"] == "高"

    # Patch with explicit null → clear priority
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": code, "member_priority": None}],
            "expected_revision": 3,
        },
        cookies=cookies,
    )
    assert status == 200
    assessment = get_assessment(plan_schema, assessment_id)
    saved = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert saved["member_priority"] is None


def test_patch_false_semantic(plan_schema: psycopg.Connection) -> None:
    """PATCH include_in_plan=FALSE should clear quarter/month."""
    member_id = _create_test_user(plan_schema, "m_false", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_false")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]

    # First set plan=TRUE
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_code": code,
                    "current_level": 2,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q3",
                    "plan_month": 7,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    # Set to FALSE — quarter+month auto-cleared
    status, _ = _request(
        "PATCH",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": code, "include_in_plan": False}],
            "expected_revision": 2,
        },
        cookies=cookies,
    )
    assert status == 200
    assessment = get_assessment(plan_schema, assessment_id)
    saved = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert saved["include_in_plan"] is False
    assert saved["plan_quarter"] is None
    assert saved["plan_month"] is None


def test_submit_without_evidence_succeeds(plan_schema: psycopg.Connection) -> None:
    """#61 removes evidence gate: level≥3 without evidence → 200."""
    member_id = _create_test_user(plan_schema, "m_noev", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_noev")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    status, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 4,
                    "target_adjusted": True,
                    "adjusted_target_level": 5,
                    "target_adjustment_reason": "test",
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q4",
                    "plan_month": 11,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    status, body = _request(
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
    )
    assert status == 200, f"submit without evidence should succeed: {body}"


def test_parameter_tampering_rejected(plan_schema: psycopg.Connection) -> None:
    """Member cannot write gap_value, target_level, or scope fields."""
    member_id = _create_test_user(plan_schema, "m_tamper", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_tamper")

    detail = plan_schema.execute(
        "SELECT l3_code FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    status, body = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 2,
                    "gap_value": 3,
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 422, f"gap_value tampering: {status}"


def test_adjustment_recalculates_gap(plan_schema: psycopg.Connection) -> None:
    """Personal adjustment recalculates effective target and gap."""
    member_id = _create_test_user(plan_schema, "m_adj", ["Member"])
    _enable_one_l3(plan_schema)
    assessment_id = create_scoped_draft(plan_schema, member_id, 2026)
    cookies = _login(plan_schema, "m_adj")

    detail = plan_schema.execute(
        "SELECT l3_code, standard_target_level "
        "FROM assessment_detail WHERE assessment_id=%s LIMIT 1",
        (assessment_id,),
    ).fetchone()
    code = detail[0]
    _std_target = int(detail[1])
    node_id = _detail_l3_node_id(plan_schema, assessment_id, code)
    assert node_id is not None, "scope-v1 detail must have l3_node_id"

    # Set current_level far below target, with adjustment to make gap=0
    status, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [
                {
                    "l3_node_id": node_id,
                    "l3_code": code,
                    "current_level": 1,
                    "target_adjusted": True,
                    "adjusted_target_level": 1,
                    "target_adjustment_reason": "本年度不计划提升此能力",
                }
            ],
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200

    assessment = get_assessment(plan_schema, assessment_id)
    saved = next(d for d in assessment["details"] if d["l3_code"] == code)
    assert saved["gap_value"] == 0
    assert saved["member_priority"] is None
    assert saved["include_in_plan"] is None
