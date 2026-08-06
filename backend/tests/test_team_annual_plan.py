import asyncio
import json
from typing import Any
from urllib.parse import quote, urlsplit

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.main import app
from app.planning.repository import get_or_create_annual_plan
from app.planning.schema import create_planning_schema

SESSION_COOKIE = "tcp_session"


def _reset_team_annual_plan_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS team_annual_capability_plan_domain")
        connection.execute("DROP TABLE IF EXISTS team_annual_capability_plan")
        connection.execute("DROP TABLE IF EXISTS monthly_review_history")
        connection.execute("DROP TABLE IF EXISTS monthly_review")
        connection.execute("DROP TABLE IF EXISTS capability_profile")
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS task_transition_history")
        connection.execute("DROP TABLE IF EXISTS learning_task")
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS plan_item")
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
        connection.execute(
            "DROP TABLE IF EXISTS capability_standard_planning_snapshot CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
        connection.execute("DROP TABLE IF EXISTS capability_standard_target_override")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")


def _ensure_l1_domains(connection: psycopg.Connection) -> None:
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
    for index, code in enumerate(["P01", "P02", "P03", "C01", "C02", "C03"]):
        connection.execute(
            """
            INSERT INTO capability_node (
                model_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row, enabled
            )
            VALUES (
                %s, 'L1', %s, %s, %s,
                'test.xlsx', 'sheet', %s, TRUE
            )
            """,
            (model_id, code, f"Domain {code}", index + 1, index + 2),
        )
    # A disabled L1 domain used to validate rejection of disabled codes.
    connection.execute(
        """
        INSERT INTO capability_node (
            model_id, node_type, code, name, sort_order,
            source_workbook, source_sheet, source_row, enabled
        )
        VALUES (
            %s, 'L1', 'X01', 'Disabled Domain', 99,
            'test.xlsx', 'sheet', 99, FALSE
        )
        """,
        (model_id,),
    )


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
def team_annual_plan_schema(
    connection: psycopg.Connection,
) -> psycopg.Connection:
    _reset_team_annual_plan_schema(connection)
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_catalog_schema(connection)
    create_planning_schema(connection)
    _ensure_l1_domains(connection)
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


def _team_plan_body(
    year: int = 2027,
    focus_domain_codes: list[str] | None = None,
    resource_arrangement: str = "Q1 bootcamp + monthly sharing",
    description: str = "Team focus for the year",
) -> dict[str, object]:
    return {
        "year": year,
        "focus_domain_codes": focus_domain_codes or ["P01", "P02"],
        "resource_arrangement": resource_arrangement,
        "description": description,
    }


def test_create_and_get_team_annual_plan_as_leader(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    leader_id = _create_test_user(team_annual_plan_schema, "leader_plan", ["Leader"])
    cookies = _login(team_annual_plan_schema, "leader_plan")

    status, body, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(),
        cookies=cookies,
    )
    assert status == 200
    assert body is not None
    assert body["year"] == 2027
    assert body["status"] == "已发布"
    assert body["publisher_id"] == leader_id
    assert body["focus_domains"] == ["P01", "P02"]
    assert body["code"] == "TACP-2027"

    status, body, _ = _request(
        "GET", "/api/planning/team-annual-plan?year=2027", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["status"] == "已发布"
    assert body["focus_domains"] == ["P01", "P02"]


def test_year_uniqueness_returns_409(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_unique", ["Leader"])
    cookies = _login(team_annual_plan_schema, "leader_unique")

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(),
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(description="Second attempt"),
        cookies=cookies,
    )
    assert status == 409
    assert "already exists" in str(body.get("detail", ""))

    count = team_annual_plan_schema.execute(
        "SELECT COUNT(*) FROM team_annual_capability_plan WHERE year = 2027"
    ).fetchone()[0]
    assert count == 1


def test_focus_domain_validation_is_atomic(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_validate", ["Leader"])
    cookies = _login(team_annual_plan_schema, "leader_validate")

    status, body, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(focus_domain_codes=["P01", "X01", "P01-L2A", "UNKNOWN"]),
        cookies=cookies,
    )
    assert status == 422
    assert "invalid" in str(body.get("detail", "")).lower()

    plan_count = team_annual_plan_schema.execute(
        "SELECT COUNT(*) FROM team_annual_capability_plan"
    ).fetchone()[0]
    domain_count = team_annual_plan_schema.execute(
        "SELECT COUNT(*) FROM team_annual_capability_plan_domain"
    ).fetchone()[0]
    assert plan_count == 0
    assert domain_count == 0

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(focus_domain_codes=["P01", "P02"]),
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "PUT",
        "/api/planning/team-annual-plan",
        _team_plan_body(focus_domain_codes=["P03", "UNKNOWN"]),
        cookies=cookies,
    )
    assert status == 422
    assert "invalid" in str(body.get("detail", "")).lower()

    status, body, _ = _request(
        "GET", "/api/planning/team-annual-plan?year=2027", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["focus_domains"] == ["P01", "P02"]


def test_non_leader_roles_are_rejected(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "admin_only", ["Admin"])
    _create_test_user(team_annual_plan_schema, "member_only", ["Member"])
    _create_test_user(team_annual_plan_schema, "buddy_only", ["Buddy"])

    for username in ("admin_only", "member_only", "buddy_only"):
        cookies = _login(team_annual_plan_schema, username)
        status, _, _ = _request(
            "GET",
            "/api/planning/team-annual-plan?year=2027",
            cookies=cookies,
        )
        assert status == 403, f"{username} should not read team plan"

        status, _, _ = _request(
            "POST",
            "/api/planning/team-annual-plan",
            _team_plan_body(),
            cookies=cookies,
        )
        assert status == 403, f"{username} should not create team plan"

        status, _, _ = _request(
            "PUT",
            "/api/planning/team-annual-plan",
            _team_plan_body(),
            cookies=cookies,
        )
        assert status == 403, f"{username} should not update team plan"

        status, _, _ = _request(
            "POST",
            "/api/planning/team-annual-plan/archive",
            {"year": 2027},
            cookies=cookies,
        )
        assert status == 403, f"{username} should not archive team plan"


def test_update_only_while_published(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_update", ["Leader"])
    cookies = _login(team_annual_plan_schema, "leader_update")

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(),
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "PUT",
        "/api/planning/team-annual-plan",
        _team_plan_body(
            focus_domain_codes=["P03", "C01"],
            resource_arrangement="updated arrangement",
            description="updated description",
        ),
        cookies=cookies,
    )
    assert status == 200
    assert body is not None
    assert body["focus_domains"] == ["P03", "C01"]
    assert body["resource_arrangement"] == "updated arrangement"
    assert body["description"] == "updated description"
    assert body["status"] == "已发布"

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan/archive",
        {"year": 2027},
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "PUT",
        "/api/planning/team-annual-plan",
        _team_plan_body(description="after archive"),
        cookies=cookies,
    )
    assert status == 409
    assert "not published" in str(body.get("detail", ""))


def test_archive_lifecycle(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_archive", ["Leader"])
    cookies = _login(team_annual_plan_schema, "leader_archive")

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(),
        cookies=cookies,
    )
    assert status == 200

    status, body, _ = _request(
        "POST",
        "/api/planning/team-annual-plan/archive",
        {"year": 2027},
        cookies=cookies,
    )
    assert status == 200
    assert body == {"ok": True}

    status, body, _ = _request(
        "GET", "/api/planning/team-annual-plan?year=2027", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["status"] == "已归档"


def test_no_interference_with_member_annual_plan(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    leader_id = _create_test_user(
        team_annual_plan_schema, "leader_no_interfere", ["Leader"]
    )
    member_id = _create_test_user(
        team_annual_plan_schema, "member_no_interfere", ["Member"]
    )
    leader_cookies = _login(team_annual_plan_schema, "leader_no_interfere")

    status, _, _ = _request(
        "POST",
        "/api/planning/team-annual-plan",
        _team_plan_body(year=2028),
        cookies=leader_cookies,
    )
    assert status == 200

    member_plan = get_or_create_annual_plan(team_annual_plan_schema, member_id, 2028)
    team_annual_plan_schema.commit()

    status, body, _ = _request(
        "GET", "/api/planning/team-annual-plan?year=2028", cookies=leader_cookies
    )
    assert status == 200
    assert body is not None
    assert body["publisher_id"] == leader_id
    assert body["status"] == "已发布"

    assert int(member_plan["member_id"]) == member_id
    assert int(member_plan["year"]) == 2028
    assert member_plan["status"] == "制定中"


def _insert_plan_items(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    items: list[dict[str, object]],
) -> None:
    plan = get_or_create_annual_plan(connection, member_id, year)
    plan_id = int(plan["id"])
    for item in items:
        connection.execute(
            """
            INSERT INTO plan_item (
                annual_growth_plan_id, l3_code, current_level, target_level,
                priority, learning_material, learning_task_content, expected_output,
                estimated_hours, plan_start_date, plan_end_date, target_month,
                status, include_in_plan, plan_quarter, plan_month,
                l1_code, l1_name, l2_code, l2_name, l3_name
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s
            )
            """,
            (
                plan_id,
                item["l3_code"],
                item["current_level"],
                item["target_level"],
                item["priority"],
                item.get("learning_material"),
                item.get("learning_task_content"),
                item.get("expected_output"),
                item.get("estimated_hours"),
                item.get("plan_start_date"),
                item.get("plan_end_date"),
                item.get("target_month"),
                item.get("status", "未开始"),
                item.get("include_in_plan", True),
                item.get("plan_quarter"),
                item.get("plan_month"),
                item.get("l1_code"),
                item.get("l1_name"),
                item.get("l2_code"),
                item.get("l2_name"),
                item.get("l3_name"),
            ),
        )
    connection.commit()


def test_team_annual_plan_items_read_scope(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_items", ["Leader"])
    _create_test_user(team_annual_plan_schema, "admin_items", ["Admin"])
    member_a_id = _create_test_user(
        team_annual_plan_schema, "member_a_items", ["Member"]
    )
    member_b_id = _create_test_user(
        team_annual_plan_schema, "member_b_items", ["Member"]
    )

    _insert_plan_items(
        team_annual_plan_schema,
        member_a_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "priority": "高",
                "estimated_hours": "10",
                "plan_month": 3,
                "plan_quarter": "Q1",
                "status": "进行中",
                "l1_code": "P01",
                "l1_name": "Data Infra",
                "l2_code": "P01-L2A",
                "l2_name": "Data basics",
                "l3_name": "Data modeling",
            }
        ],
    )
    _insert_plan_items(
        team_annual_plan_schema,
        member_b_id,
        2026,
        [
            {
                "l3_code": "P02-L2B-L3A",
                "current_level": 1,
                "target_level": 3,
                "priority": "中",
                "estimated_hours": "8",
                "plan_month": 5,
                "plan_quarter": "Q2",
                "status": "未开始",
                "l1_code": "P02",
                "l1_name": "AI Infra",
                "l2_code": "P02-L2B",
                "l2_name": "AI basics",
                "l3_name": "Agent design",
            }
        ],
    )

    admin_cookies = _login(team_annual_plan_schema, "admin_items")
    status, body, _ = _request(
        "GET",
        "/api/planning/team-annual-plan/items?year=2026",
        cookies=admin_cookies,
    )
    assert status == 200
    assert body["meta"]["source"] == "team_annual_plan.items.v1"
    assert body["pagination"]["total_count"] == 2
    assert len(body["items"]) == 2
    assert body["summary"]["total_count"] == 2
    assert body["summary"]["planned_hours_min"] == 18
    assert body["summary"]["planned_hours_max"] == 18
    assert body["summary"]["actual_hours"] == 0
    assert body["summary"]["status_breakdown"]["进行中"] == 1
    assert body["summary"]["status_breakdown"]["未开始"] == 1
    assert body["summary"]["status_breakdown"]["total"] == 2
    assert {m["member_id"] for m in body["members"]} == {member_a_id, member_b_id}
    assert all("actual_hours" in item for item in body["items"])

    member_a_cookies = _login(team_annual_plan_schema, "member_a_items")
    status, body, _ = _request(
        "GET",
        "/api/planning/team-annual-plan/items?year=2026",
        cookies=member_a_cookies,
    )
    assert status == 200
    assert body["meta"]["scope"] == "本人"
    assert body["pagination"]["total_count"] == 1
    assert body["items"][0]["member_id"] == member_a_id
    assert body["summary"]["total_count"] == 1
    assert body["summary"]["planned_hours_min"] == 10
    assert body["summary"]["planned_hours_max"] == 10
    assert [m["member_id"] for m in body["members"]] == [member_a_id]

    status, _, _ = _request(
        "GET",
        f"/api/planning/team-annual-plan/items?year=2026&member_id={member_b_id}",
        cookies=member_a_cookies,
    )
    assert status == 403


def test_team_annual_plan_items_filters_and_pagination(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_annual_plan_schema, "leader_filter", ["Leader"])
    member_id = _create_test_user(team_annual_plan_schema, "member_filter", ["Member"])
    _insert_plan_items(
        team_annual_plan_schema,
        member_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "priority": "高",
                "estimated_hours": "10",
                "plan_month": 3,
                "plan_quarter": "Q1",
                "status": "进行中",
                "l1_code": "P01",
                "l1_name": "Data Infra",
                "l2_code": "P01-L2A",
                "l2_name": "Data basics",
                "l3_name": "Data modeling",
            },
            {
                "l3_code": "P02-L2B-L3A",
                "current_level": 1,
                "target_level": 3,
                "priority": "中",
                "estimated_hours": "8",
                "plan_month": 5,
                "plan_quarter": "Q2",
                "status": "未开始",
                "l1_code": "P02",
                "l1_name": "AI Infra",
                "l2_code": "P02-L2B",
                "l2_name": "AI basics",
                "l3_name": "Agent design",
            },
        ],
    )

    leader_cookies = _login(team_annual_plan_schema, "leader_filter")
    status, body, _ = _request(
        "GET",
        "/api/planning/team-annual-plan/items?year=2026&domain_code=P01",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body["pagination"]["total_count"] == 1
    assert body["items"][0]["l3_code"] == "P01-L2A-L3A"

    status, body, _ = _request(
        "GET",
        f"/api/planning/team-annual-plan/items?year=2026&priority={quote('高')}",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body["pagination"]["total_count"] == 1
    assert body["items"][0]["priority"] == "高"

    status, body, _ = _request(
        "GET",
        "/api/planning/team-annual-plan/items?year=2026&page_size=1&page=1",
        cookies=leader_cookies,
    )
    assert status == 200
    assert len(body["items"]) == 1
    assert body["pagination"]["total_pages"] == 2


def test_team_annual_plan_summary_is_pagination_invariant_and_excludes_invalidated_logs(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    """Summary must be computed over the full filtered set, not the page."""
    _create_test_user(team_annual_plan_schema, "leader_summary", ["Leader"])
    member_id = _create_test_user(team_annual_plan_schema, "member_summary", ["Member"])

    _insert_plan_items(
        team_annual_plan_schema,
        member_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "priority": "高",
                "estimated_hours": "10",
                "plan_month": 3,
                "plan_quarter": "Q1",
                "status": "进行中",
                "l1_code": "P01",
                "l1_name": "Data Infra",
                "l2_code": "P01-L2A",
                "l2_name": "Data basics",
                "l3_name": "Data modeling",
            },
            {
                "l3_code": "P02-L2B-L3A",
                "current_level": 1,
                "target_level": 3,
                "priority": "中",
                "estimated_hours": "8",
                "plan_month": 5,
                "plan_quarter": "Q2",
                "status": "未开始",
                "l1_code": "P02",
                "l1_name": "AI Infra",
                "l2_code": "P02-L2B",
                "l2_name": "AI basics",
                "l3_name": "Agent design",
            },
            {
                "l3_code": "C03-L2A-L3A",
                "current_level": 2,
                "target_level": 3,
                "priority": "低",
                "estimated_hours": "6",
                "plan_month": 7,
                "plan_quarter": "Q3",
                "status": "已完成",
                "l1_code": "C03",
                "l1_name": "学习创新",
                "l2_code": "C03-L2A",
                "l2_name": "创新实践",
                "l3_name": "技术创新提案",
            },
        ],
    )

    plan_item_ids = [
        row[0]
        for row in team_annual_plan_schema.execute(
            """
            SELECT pi.id
            FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.member_id = %s AND agp.year = %s
            ORDER BY pi.plan_month
            """,
            (member_id, 2026),
        ).fetchall()
    ]

    for plan_item_id in plan_item_ids:
        team_annual_plan_schema.execute(
            """
            INSERT INTO learning_task (plan_item_id, l3_code, status)
            VALUES (%s, 'X', '已完成')
            """,
            (plan_item_id,),
        )
    task_ids = [
        row[0]
        for row in team_annual_plan_schema.execute(
            "SELECT id FROM learning_task WHERE plan_item_id = ANY(%s) ORDER BY id",
            (plan_item_ids,),
        ).fetchall()
    ]

    # Valid logs for tasks 1 and 3; invalidated log for task 2.
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id)
        VALUES (%s, '2026-03-15', 4, %s)
        """,
        (task_ids[0], member_id),
    )
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id, invalidated_at)
        VALUES (%s, '2026-05-15', 5, %s, NOW())
        """,
        (task_ids[1], member_id),
    )
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id)
        VALUES (%s, '2026-07-15', 2, %s)
        """,
        (task_ids[2], member_id),
    )
    team_annual_plan_schema.commit()

    leader_cookies = _login(team_annual_plan_schema, "leader_summary")

    def load_summary(page: int, page_size: int, extra: str = "") -> dict[str, object]:
        status, body, _ = _request(
            "GET",
            (
                f"/api/planning/team-annual-plan/items?year=2026"
                f"&page_size={page_size}&page={page}{extra}"
            ),
            cookies=leader_cookies,
        )
        assert status == 200, body
        return body["summary"]

    full_summary = load_summary(1, 20)
    assert full_summary["total_count"] == 3
    assert full_summary["planned_hours_min"] == 24
    assert full_summary["planned_hours_max"] == 24
    assert full_summary["actual_hours"] == 6
    assert full_summary["has_values"] is True
    assert full_summary["has_unparsed"] is False
    assert full_summary["status_breakdown"]["进行中"] == 1
    assert full_summary["status_breakdown"]["未开始"] == 1
    assert full_summary["status_breakdown"]["已完成"] == 1
    assert full_summary["status_breakdown"]["total"] == 3

    page1 = load_summary(1, 1)
    page2 = load_summary(2, 1)
    page3 = load_summary(3, 1)
    assert page1 == page2 == page3

    # Filtered summary recomputes over the matching subset.
    p01_summary = load_summary(1, 20, "&domain_code=P01")
    assert p01_summary["total_count"] == 1
    assert p01_summary["planned_hours_min"] == 10
    assert p01_summary["planned_hours_max"] == 10
    assert p01_summary["actual_hours"] == 4


def test_team_annual_plan_summary_counts_each_plan_item_once_with_multiple_logs(
    team_annual_plan_schema: psycopg.Connection,
) -> None:
    """Multiple progress logs must not multiply PlanItem counts or status buckets."""
    _create_test_user(team_annual_plan_schema, "leader_card", ["Leader"])
    member_id = _create_test_user(team_annual_plan_schema, "member_card", ["Member"])

    _insert_plan_items(
        team_annual_plan_schema,
        member_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "priority": "高",
                "estimated_hours": "10",
                "plan_month": 3,
                "plan_quarter": "Q1",
                "status": "进行中",
                "l1_code": "P01",
                "l1_name": "Data Infra",
                "l2_code": "P01-L2A",
                "l2_name": "Data basics",
                "l3_name": "Data modeling",
            },
            {
                "l3_code": "P02-L2B-L3A",
                "current_level": 1,
                "target_level": 3,
                "priority": "中",
                "estimated_hours": "8",
                "plan_month": 5,
                "plan_quarter": "Q2",
                "status": "已完成",
                "l1_code": "P02",
                "l1_name": "AI Infra",
                "l2_code": "P02-L2B",
                "l2_name": "AI basics",
                "l3_name": "Agent design",
            },
        ],
    )

    plan_item_ids = [
        row[0]
        for row in team_annual_plan_schema.execute(
            """
            SELECT pi.id
            FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.member_id = %s AND agp.year = %s
            ORDER BY pi.plan_month
            """,
            (member_id, 2026),
        ).fetchall()
    ]

    for plan_item_id in plan_item_ids:
        team_annual_plan_schema.execute(
            """
            INSERT INTO learning_task (plan_item_id, l3_code, status)
            VALUES (%s, 'X', '已完成')
            """,
            (plan_item_id,),
        )
    task_ids = [
        row[0]
        for row in team_annual_plan_schema.execute(
            "SELECT id FROM learning_task WHERE plan_item_id = ANY(%s) ORDER BY id",
            (plan_item_ids,),
        ).fetchall()
    ]

    # Item 1: two valid logs plus one invalidated log.
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id)
        VALUES (%s, '2026-03-10', 3, %s)
        """,
        (task_ids[0], member_id),
    )
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id)
        VALUES (%s, '2026-03-20', 4, %s)
        """,
        (task_ids[0], member_id),
    )
    team_annual_plan_schema.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, recorder_id, invalidated_at)
        VALUES (%s, '2026-03-25', 99, %s, NOW())
        """,
        (task_ids[0], member_id),
    )
    team_annual_plan_schema.commit()

    leader_cookies = _login(team_annual_plan_schema, "leader_card")

    def load_summary(page: int, page_size: int) -> dict[str, object]:
        status, body, _ = _request(
            "GET",
            (
                f"/api/planning/team-annual-plan/items?year=2026"
                f"&page_size={page_size}&page={page}"
            ),
            cookies=leader_cookies,
        )
        assert status == 200, body
        return body["summary"]

    full_summary = load_summary(1, 20)
    assert full_summary["total_count"] == 2
    assert full_summary["status_breakdown"]["进行中"] == 1
    assert full_summary["status_breakdown"]["已完成"] == 1
    assert full_summary["status_breakdown"]["total"] == 2
    assert full_summary["actual_hours"] == 7

    page1 = load_summary(1, 1)
    page2 = load_summary(2, 1)
    assert page1 == page2 == full_summary
