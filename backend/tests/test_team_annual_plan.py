import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

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
        connection.execute("DROP TABLE IF EXISTS capability_profile")
        connection.execute("DROP TABLE IF EXISTS evidence_review")
        connection.execute("DROP TABLE IF EXISTS evidence")
        connection.execute("DROP TABLE IF EXISTS learning_progress_log")
        connection.execute("DROP TABLE IF EXISTS learning_task")
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
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
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
    connection.commit()
    return user_id


@pytest.fixture
def team_annual_plan_schema(
    connection: psycopg.Connection,
) -> psycopg.Connection:
    _reset_team_annual_plan_schema(connection)
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    create_catalog_schema(connection)
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
