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
from app.migrations import run_migrations

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
    connection.execute("DROP TABLE IF EXISTS schema_migration CASCADE")
    connection.execute("DROP TABLE IF EXISTS capability_standard_item CASCADE")
    connection.execute("DROP TABLE IF EXISTS capability_standard_version CASCADE")
    import_catalog(resolve_workbook_dir(), connection)
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
            ],
            "expected_revision": 1,
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
        "POST",
        f"/api/assessments/{assessment_id}/submit",
        {"expected_revision": 2},
        cookies=cookies,
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


def test_assessment_returns_l2_context_and_hides_live_requirements_from_history(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_l2_context", ["Member"])
    assessment_schema.execute(
        """
        UPDATE tcp_user
        SET current_level = 'P6', target_level = 'P8'
        WHERE id = %s
        """,
        (member_id,),
    )
    assessment_id = create_assessment_draft(assessment_schema, member_id, 2026)

    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["member_current_level"] == "P6"
    assert assessment["member_target_level"] == "P8"
    groups = {group["l2_code"]: group for group in assessment["l2_groups"]}
    assert groups["P01.01"]["l1_code"] == "P01"
    assert groups["P01.01"]["requirements"]["P8"]
    assert groups["P02.07"]["details"] == []
    assert groups["P02.07"]["is_empty"] is True
    assert not {
        "p4_description",
        "p5_description",
        "p6_description",
        "p7_description",
        "p8_description",
    } & set(assessment["details"][0])

    assessment_schema.execute(
        "UPDATE assessment SET status = '已归档' WHERE id = %s",
        (assessment_id,),
    )
    assessment_schema.commit()
    historical = get_assessment(assessment_schema, assessment_id)
    assert historical is not None
    assert "requirements" not in historical["l2_groups"][0]


def test_assessment_groups_preserve_unmapped_historical_details(
    assessment_schema: psycopg.Connection,
) -> None:
    member_id = _create_test_user(assessment_schema, "member_legacy_detail", ["Member"])
    assessment_schema.execute(
        "UPDATE capability_node "
        "SET enabled = (code = 'C01.01.01') WHERE node_type = 'L3'"
    )
    assessment_schema.commit()
    assessment_id = create_assessment_draft(assessment_schema, member_id, 2026)
    assessment_schema.execute(
        """
        UPDATE assessment_detail
        SET l3_code = 'unknown-legacy-l3', current_level = 1, target_level = 4,
            gap_value = 3, evidence_note = '历史依据'
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    )
    assessment_schema.commit()

    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    details = assessment["details"]
    grouped = [
        detail for group in assessment["l2_groups"] for detail in group["details"]
    ]
    assert len(grouped) == len(details)
    assert {detail["id"] for detail in grouped} == {detail["id"] for detail in details}
    assert len({detail["id"] for detail in grouped}) == len(grouped)

    fallback = next(
        group for group in assessment["l2_groups"] if group["l2_code"] is None
    )
    assert fallback["l1_code"] is None
    assert fallback["l2_name"] == "未映射历史项"
    assert "requirements" not in fallback
    assert fallback["details"] == [
        {
            **fallback["details"][0],
            "l3_code": "unknown-legacy-l3",
            "current_level": 1,
            "target_level": 4,
            "gap_value": 3,
            "evidence_note": "历史依据",
        }
    ]


def test_assessment_writes_require_expected_revision_token(
    assessment_schema: psycopg.Connection,
) -> None:
    _create_test_user(assessment_schema, "member_revision_token", ["Member"])
    cookies = _login(assessment_schema, "member_revision_token")
    status, body, _ = _request(
        "POST", "/api/assessments", {"year": 2026}, cookies=cookies
    )
    assert status == 200
    assert body is not None
    assessment_id = body["id"]

    for method in ("PATCH", "PUT"):
        status, _, _ = _request(
            method,
            f"/api/assessments/{assessment_id}/draft",
            {"details": []},
            cookies=cookies,
        )
        assert status == 422
    status, _, _ = _request(
        "POST", f"/api/assessments/{assessment_id}/submit", {}, cookies=cookies
    )
    assert status == 422
    assessment = get_assessment(assessment_schema, assessment_id)
    assert assessment is not None
    assert assessment["status"] == "草稿"
    assert assessment["revision"] == 1


def test_submit_validation_returns_structured_l3_error(
    assessment_schema: psycopg.Connection,
) -> None:
    _create_test_user(assessment_schema, "member_structured_error", ["Member"])
    assessment_schema.execute(
        """
        UPDATE capability_node
        SET enabled = (code = 'C01.01.01')
        WHERE node_type = 'L3'
        """
    )
    assessment_schema.commit()
    cookies = _login(assessment_schema, "member_structured_error")
    status, body, _ = _request(
        "POST", "/api/assessments", {"year": 2026}, cookies=cookies
    )
    assert status == 200
    assessment_id = body["id"]

    status, _, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": [{"l3_code": "C01.01.01", "current_level": 3}],
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
    assert status == 400
    assert body["detail"] == {
        "code": "assessment_validation_failed",
        "l3_code": "C01.01.01",
        "reason": "requires_evidence",
        "message": "assessment detail C01.01.01 requires evidence",
    }


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
        {"details": [], "expected_revision": 1},
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
    assessment_schema.execute(
        "UPDATE assessment SET status = '待复核' WHERE id = %s", (assessment_id,)
    )
    assessment_schema.commit()

    cookies = _login(assessment_schema, "member_a5")
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {"details": [], "expected_revision": 1},
        cookies=cookies,
    )
    assert status == 400


def test_draft_target_repair_api_enforces_permissions_and_all_or_nothing(
    assessment_schema: psycopg.Connection,
) -> None:
    owner_id = _create_test_user(assessment_schema, "repair_owner", ["Member"])
    other_member_id = _create_test_user(
        assessment_schema, "repair_other_member", ["Member"]
    )
    buddy_id = _create_test_user(assessment_schema, "repair_buddy", ["Buddy"])
    leader_id = _create_test_user(assessment_schema, "repair_leader", ["Leader"])
    admin_id = _create_test_user(assessment_schema, "repair_admin", ["Admin"])
    assessment_schema.execute(
        "UPDATE tcp_user SET current_level = 'P4', target_level = 'P5' WHERE id = %s",
        (owner_id,),
    )
    assessment_id = create_assessment_draft(assessment_schema, owner_id, 2026)
    assessment_schema.execute(
        """
        UPDATE assessment
        SET member_current_level_snapshot = NULL,
            member_target_level_snapshot = NULL,
            capability_standard_version_id = NULL
        WHERE id = %s
        """,
        (assessment_id,),
    )
    assessment_schema.execute(
        """
        UPDATE assessment_detail
        SET target_snapshot_source = 'legacy_preserved',
            target_compatibility_error = '历史明细缺少目标快照'
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    )
    assessment_schema.commit()

    cookies = {
        "owner": _login(assessment_schema, "repair_owner"),
        "other_member": _login(assessment_schema, "repair_other_member"),
        "buddy": _login(assessment_schema, "repair_buddy"),
        "leader": _login(assessment_schema, "repair_leader"),
        "admin": _login(assessment_schema, "repair_admin"),
    }
    for role in ("other_member", "buddy", "leader"):
        status, body, _ = _request(
            "GET",
            f"/api/assessments/{assessment_id}/draft-target-repair/preview",
            cookies=cookies[role],
        )
        assert status == 403
        assert body["detail"]["code"] == "draft_repair_forbidden"

    status, preview, _ = _request(
        "GET",
        f"/api/assessments/{assessment_id}/draft-target-repair/preview",
        cookies=cookies["owner"],
    )
    assert status == 200
    assert preview["summary"]["unrepairable_count"] == 0
    assert (
        assessment_schema.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit"
        ).fetchone()[0]
        == 0
    )

    status, repaired, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/draft-target-repair",
        {"expected_revision": 1},
        cookies=cookies["owner"],
    )
    assert status == 200
    assert repaired["result"] == "repaired"

    status, noop, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/draft-target-repair",
        {"expected_revision": 2},
        cookies=cookies["admin"],
    )
    assert status == 200
    assert noop["result"] == "noop"

    blocked_id = create_assessment_draft(assessment_schema, owner_id, 2027)
    assessment_schema.execute(
        "UPDATE assessment_detail SET l3_code = 'legacy-unknown' "
        "WHERE id = (SELECT min(id) FROM assessment_detail WHERE assessment_id = %s)",
        (blocked_id,),
    )
    assessment_schema.commit()
    status, body, _ = _request(
        "POST",
        f"/api/assessments/{blocked_id}/draft-target-repair",
        {"expected_revision": 1},
        cookies=cookies["owner"],
    )
    assert status == 422
    assert body["detail"]["code"] == "draft_repair_has_unrepairable_details"
    assert (
        assessment_schema.execute(
            "SELECT revision FROM assessment WHERE id = %s", (blocked_id,)
        ).fetchone()[0]
        == 1
    )
    assert (
        assessment_schema.execute(
            "SELECT count(*) FROM assessment_draft_target_repair_audit "
            "WHERE assessment_id = %s",
            (blocked_id,),
        ).fetchone()[0]
        == 0
    )
    assert all(user_id for user_id in (other_member_id, buddy_id, leader_id, admin_id))
