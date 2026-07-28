import asyncio
import json
from typing import Any
from urllib.parse import urlsplit

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)
from app.access.schema import create_access_schema
from app.assessment.repository import (
    create_assessment_draft,
    get_assessment,
    get_pending_reviews_for_buddy,
    save_assessment_draft,
    submit_assessment,
    submit_assessment_review,
)
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.main import app
from app.planning.repository import (
    create_growth_goal,
    create_progress_log,
    generate_plan_items,
    list_eligible_gaps,
)
from app.planning.schema import create_planning_schema

SESSION_COOKIE = "tcp_session"


def _reset_full_schema(connection: psycopg.Connection) -> None:
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
        connection.execute("DROP TABLE IF EXISTS capability_standard_target_override")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")


@pytest.fixture
def team_analytics_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_full_schema(connection)
    create_access_schema(connection)
    create_assessment_schema(connection)
    create_planning_schema(connection)
    create_catalog_schema(connection)
    return connection


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


def _ensure_l3_nodes(connection: psycopg.Connection, l3_codes: list[str]) -> None:
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

    sort_order = 1
    for l3_code in l3_codes:
        domain = l3_code[:3]
        l2_code = l3_code[:7]
        l1_row = connection.execute(
            """
            INSERT INTO capability_node (
                model_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row, enabled
            )
            VALUES (%s, 'L1', %s, %s, %s, 'test.xlsx', 'sheet', %s, TRUE)
            ON CONFLICT (model_id, code) DO UPDATE SET code = EXCLUDED.code
            RETURNING id
            """,
            (model_id, domain, f"Domain {domain}", sort_order, sort_order + 1),
        ).fetchone()
        assert l1_row is not None
        l1_id = l1_row[0]
        sort_order += 2

        l2_row = connection.execute(
            """
            INSERT INTO capability_node (
                model_id, parent_node_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (
                %s, %s, 'L2', %s, %s, %s,
                'test.xlsx', 'sheet', %s
            )
            ON CONFLICT (model_id, code) DO UPDATE SET code = EXCLUDED.code
            RETURNING id
            """,
            (model_id, l1_id, l2_code, f"Item {l2_code}", sort_order, sort_order + 1),
        ).fetchone()
        assert l2_row is not None
        l2_id = l2_row[0]
        sort_order += 2

        connection.execute(
            """
            INSERT INTO capability_node (
                model_id, parent_node_id, node_type, code, name, sort_order,
                recommended_start_level,
                materials_text, expected_output, estimated_hours,
                source_workbook, source_sheet, source_row
            )
            VALUES (
                %s, %s, 'L3', %s, %s, %s,
                'P4',
                'test materials', 'test output', '10',
                'test.xlsx', 'sheet', %s
            )
            ON CONFLICT (model_id, code) DO UPDATE SET code = EXCLUDED.code
            """,
            (model_id, l2_id, l3_code, f"Leaf {l3_code}", sort_order, sort_order + 1),
        )
        sort_order += 2


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


def _submit_and_approve_assessment(
    connection: psycopg.Connection,
    member_id: int,
    buddy_id: int,
    year: int,
    details: list[dict[str, object]],
) -> int:
    assessment_id = create_assessment_draft(connection, member_id, year)
    assessment = get_assessment(connection, assessment_id)
    assert assessment is not None
    supplied = {detail["l3_code"]: detail for detail in details}
    migrated_details = []
    for snapshot in assessment["details"]:
        detail = supplied.get(snapshot["l3_code"])
        if detail is None:
            migrated = {
                "l3_code": snapshot["l3_code"],
                "current_level": (
                    1 if snapshot["standard_target_applicable"] is True else None
                ),
                "evidence_note": "非本场景能力项",
                "plan_candidate": False,
            }
            if snapshot["l3_code"] == "P02-L2B-L3A":
                migrated.update(
                    {
                        "target_adjusted": True,
                        "adjusted_target_level": 3,
                        "target_adjustment_reason": "测试场景默认目标",
                    }
                )
        else:
            migrated = dict(detail)
            target_level = migrated.pop("target_level")
            migrated.update(
                {
                    "target_adjusted": True,
                    "adjusted_target_level": target_level,
                    "target_adjustment_reason": "测试场景目标",
                }
            )
        migrated_details.append(migrated)
    save_assessment_draft(
        connection, assessment_id, member_id, migrated_details, expected_revision=1
    )
    submit_assessment(connection, assessment_id, member_id, expected_revision=2)
    pending = get_pending_reviews_for_buddy(connection, buddy_id)
    review = next(r for r in pending if r["assessment_id"] == assessment_id)
    submit_assessment_review(connection, review["id"], buddy_id, "认可", "符合预期")
    return assessment_id


def _create_plan_item_data(
    connection: psycopg.Connection,
    member_id: int,
    buddy_id: int,
    year: int,
    details: list[dict[str, object]],
) -> list[dict[str, object]]:
    _submit_and_approve_assessment(connection, member_id, buddy_id, year, details)
    eligible = list_eligible_gaps(connection, member_id)
    for gap in eligible:
        create_growth_goal(connection, member_id, int(gap["id"]))
    return generate_plan_items(connection, member_id)


def _build_two_member_team(
    connection: psycopg.Connection,
) -> tuple[int, int, dict[str, str]]:
    l3_codes = ["P01-L2A-L3A", "P02-L2B-L3A"]
    _ensure_l3_nodes(connection, l3_codes)

    _create_test_user(connection, "team_leader", ["Leader"])
    buddy_id = _create_test_user(connection, "team_buddy", ["Buddy"])
    member_a_id = _create_test_user(connection, "member_a", ["Member"])
    member_b_id = _create_test_user(connection, "member_b", ["Member"])
    create_buddy_relationship(connection, member_a_id, buddy_id)
    create_buddy_relationship(connection, member_b_id, buddy_id)
    connection.commit()

    items_a = _create_plan_item_data(
        connection,
        member_a_id,
        buddy_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "evidence_note": "a p01",
                "plan_candidate": True,
            },
            {
                "l3_code": "P02-L2B-L3A",
                "current_level": 1,
                "target_level": 3,
                "evidence_note": "a p02",
                "plan_candidate": True,
            },
        ],
    )
    items_b = _create_plan_item_data(
        connection,
        member_b_id,
        buddy_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 3,
                "target_level": 4,
                "evidence_note": "b p01",
                "plan_candidate": True,
            }
        ],
    )

    item_by_code_a = {item["l3_code"]: item for item in items_a}
    item_by_code_b = {item["l3_code"]: item for item in items_b}

    # Member A: P01 completed in March, P02 in progress scheduled for May.
    p01_item_a = item_by_code_a["P01-L2A-L3A"]
    p02_item_a = item_by_code_a["P02-L2B-L3A"]
    p01_task_a = connection.execute(
        "SELECT id FROM learning_task WHERE plan_item_id = %s", (p01_item_a["id"],)
    ).fetchone()
    p02_task_a = connection.execute(
        "SELECT id FROM learning_task WHERE plan_item_id = %s", (p02_item_a["id"],)
    ).fetchone()
    assert p01_task_a is not None
    assert p02_task_a is not None
    connection.execute(
        """
        UPDATE plan_item
        SET target_month = %s, plan_end_date = %s
        WHERE id = %s
        """,
        (3, "2026-03-31", p01_item_a["id"]),
    )
    connection.execute(
        """
        UPDATE plan_item
        SET target_month = %s, plan_end_date = %s
        WHERE id = %s
        """,
        (5, "2026-05-31", p02_item_a["id"]),
    )
    connection.execute(
        """
        UPDATE learning_task
        SET status = '已完成', actual_end_date = %s
        WHERE id = %s
        """,
        ("2026-03-10", p01_task_a[0]),
    )
    connection.execute(
        """
        UPDATE plan_item
        SET status = '已完成'
        WHERE id = %s
        """,
        (p01_item_a["id"],),
    )
    create_progress_log(
        connection, member_a_id, int(p01_task_a[0]), "2026-03-10", 5, "日志"
    )
    connection.execute(
        """
        INSERT INTO evidence (learning_task_id, l3_code, version_number, status)
        VALUES (%s, %s, 1, '已归档')
        """,
        (p01_task_a[0], "P01-L2A-L3A"),
    )
    connection.execute(
        """
        INSERT INTO evidence (learning_task_id, l3_code, version_number, status)
        VALUES (%s, %s, 1, '驳回')
        """,
        (p02_task_a[0], "P02-L2B-L3A"),
    )

    # Member B: P01 not started, scheduled for March.
    p01_item_b = item_by_code_b["P01-L2A-L3A"]
    connection.execute(
        """
        UPDATE plan_item
        SET target_month = %s, plan_end_date = %s
        WHERE id = %s
        """,
        (3, "2026-03-31", p01_item_b["id"]),
    )

    connection.commit()
    return member_a_id, member_b_id, _login(connection, "team_leader")


def test_team_analytics_requires_leader(
    team_analytics_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_analytics_schema, "member_only", ["Member"])
    _create_test_user(team_analytics_schema, "buddy_only", ["Buddy"])
    _create_test_user(team_analytics_schema, "admin_only", ["Admin"])
    _create_test_user(team_analytics_schema, "leader_user", ["Leader"])
    _create_test_user(team_analytics_schema, "admin_leader", ["Admin", "Leader"])
    team_analytics_schema.commit()

    status, _, _ = _request("GET", "/api/planning/team-analytics?year=2026")
    assert status == 401

    for username in ("member_only", "buddy_only", "admin_only"):
        cookies = _login(team_analytics_schema, username)
        status, _, _ = _request(
            "GET", "/api/planning/team-analytics?year=2026", cookies=cookies
        )
        assert status == 403, f"{username} should not access team analytics"

    for username in ("leader_user", "admin_leader"):
        cookies = _login(team_analytics_schema, username)
        status, body, _ = _request(
            "GET", "/api/planning/team-analytics?year=2026", cookies=cookies
        )
        assert status == 200, f"{username} should access team analytics"
        assert body is not None


def test_team_analytics_rejects_invalid_domain(
    team_analytics_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_analytics_schema, "leader_domain", ["Leader"])
    _ensure_l3_nodes(team_analytics_schema, ["P01-L2A-L3A"])
    # Add a disabled non-MVP L1 to confirm it is rejected.
    model_id = team_analytics_schema.execute(
        "SELECT id FROM capability_model LIMIT 1"
    ).fetchone()[0]
    team_analytics_schema.execute(
        """
        INSERT INTO capability_node (
            model_id, node_type, code, name, sort_order,
            source_workbook, source_sheet, source_row, enabled
        )
        VALUES (%s, 'L1', 'X01', 'Disabled', 99,
                'test.xlsx', 'sheet', 99, FALSE)
        ON CONFLICT (model_id, code) DO UPDATE SET code = EXCLUDED.code
        """,
        (model_id,),
    )
    team_analytics_schema.commit()

    cookies = _login(team_analytics_schema, "leader_domain")
    for code in ("UNKNOWN", "X01", "P01-L2A-L3A"):
        status, body, _ = _request(
            "GET",
            f"/api/planning/team-analytics?year=2026&domain_code={code}",
            cookies=cookies,
        )
        assert status == 422, f"{code} should be rejected"
        assert "invalid" in str(body.get("detail", "")).lower()


def test_team_analytics_empty_data_returns_zero_aggregates(
    team_analytics_schema: psycopg.Connection,
) -> None:
    _create_test_user(team_analytics_schema, "leader_empty", ["Leader"])
    team_analytics_schema.commit()
    cookies = _login(team_analytics_schema, "leader_empty")

    status, body, _ = _request(
        "GET", "/api/planning/team-analytics?year=2026", cookies=cookies
    )
    assert status == 200
    assert body is not None
    assert body["year"] == 2026
    assert body["kpis"]["assessment_completion_rate"] == 0.0
    assert body["kpis"]["plan_completion_rate"] == 0.0
    assert body["kpis"]["evidence_pass_rate"] == 0.0
    assert body["kpis"]["overdue_plan_item_count"] == 0
    assert len(body["domain_averages"]) == 6
    assert all(entry["actual"] == 0 for entry in body["domain_averages"])
    assert body["member_attainment"] == []
    assert len(body["monthly_trends"]) == 12
    assert body["overdue_items"] == []


def test_team_analytics_aggregates_match_data(
    team_analytics_schema: psycopg.Connection,
) -> None:
    member_a_id, member_b_id, leader_cookies = _build_two_member_team(
        team_analytics_schema
    )
    _create_test_user(team_analytics_schema, "member_without_assessment", ["Member"])

    status, body, _ = _request(
        "GET", "/api/planning/team-analytics?year=2026", cookies=leader_cookies
    )
    assert status == 200
    assert body is not None

    kpis = body["kpis"]
    assert kpis["assessment_completed_count"] == 2
    assert kpis["assessment_total_count"] == 3
    assert kpis["assessment_completion_rate"] == pytest.approx(2 / 3, rel=1e-3)
    assert kpis["plan_completed_count"] == 1
    assert kpis["plan_total_count"] == 3
    assert kpis["plan_completion_rate"] == pytest.approx(1 / 3, rel=1e-3)
    assert kpis["evidence_passed_count"] == 1
    assert kpis["evidence_total_count"] == 2
    assert kpis["evidence_pass_rate"] == 0.5
    assert kpis["overdue_plan_item_count"] == 2

    averages = {row["domain_code"]: row for row in body["domain_averages"]}
    assert len(averages) == 6
    assert averages["P01"]["actual"] == pytest.approx(2.5, rel=1e-3)
    assert averages["P01"]["target"] == 4
    assert averages["P02"]["actual"] == 1
    assert averages["P02"]["target"] == 3
    assert averages["P03"]["actual"] == 0

    attainment = {
        (row["member_id"], row["domain_code"]): row for row in body["member_attainment"]
    }
    assert attainment[(member_a_id, "P01")]["attainment"] == pytest.approx(50.0)
    assert attainment[(member_a_id, "P02")]["attainment"] == pytest.approx(
        100.0 / 3, rel=1e-3
    )
    assert attainment[(member_b_id, "P01")]["attainment"] == pytest.approx(75.0)
    assert attainment[(member_b_id, "P02")]["attainment"] == pytest.approx(
        100.0 / 3, rel=1e-3
    )

    trends = {row["month"]: row for row in body["monthly_trends"]}
    assert trends[3]["planned_count"] == 2
    assert trends[3]["actual_count"] == 1
    assert trends[3]["planned_hours"] == 20
    assert trends[3]["actual_hours"] == 5
    assert trends[3]["cumulative_planned_rate"] == pytest.approx(2 / 3, rel=1e-3)
    assert trends[3]["cumulative_actual_rate"] == pytest.approx(1 / 3, rel=1e-3)
    assert trends[5]["planned_count"] == 1
    assert trends[5]["cumulative_planned_rate"] == 1.0
    assert trends[5]["cumulative_actual_rate"] == pytest.approx(1 / 3, rel=1e-3)

    overdue = body["overdue_items"]
    assert len(overdue) == 2
    overdue_members = {item["member_id"] for item in overdue}
    assert overdue_members == {member_a_id, member_b_id}
    assert all(item["l2_code"] is not None for item in overdue)
    assert all(item["l3_name"] is not None for item in overdue)


def test_team_analytics_keeps_estimated_hour_ranges_as_ranges(
    team_analytics_schema: psycopg.Connection,
) -> None:
    _, _, leader_cookies = _build_two_member_team(team_analytics_schema)
    team_analytics_schema.execute(
        """
        UPDATE plan_item
        SET estimated_hours = '4–6h'
        WHERE target_month = 3
        """
    )
    team_analytics_schema.commit()

    status, body, _ = _request(
        "GET", "/api/planning/team-analytics?year=2026", cookies=leader_cookies
    )
    assert status == 200
    assert body is not None
    march = next(row for row in body["monthly_trends"] if row["month"] == 3)
    assert march["planned_hours_min"] == 8
    assert march["planned_hours_max"] == 12
    assert march["planned_hours"] == 8
    assert march["planned_hours_max"] != 46


def test_team_analytics_domain_filter_restricts_aggregates(
    team_analytics_schema: psycopg.Connection,
) -> None:
    member_a_id, _, leader_cookies = _build_two_member_team(team_analytics_schema)

    status, body, _ = _request(
        "GET",
        "/api/planning/team-analytics?year=2026&domain_code=P02",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body is not None

    assert [row["domain_code"] for row in body["domain_averages"]] == ["P02"]
    assert body["domain_averages"][0]["actual"] == 1
    assert body["domain_averages"][0]["target"] == 3

    kpis = body["kpis"]
    assert kpis["assessment_total_count"] == 2
    assert kpis["assessment_completion_rate"] == 1.0
    assert kpis["plan_total_count"] == 1
    assert kpis["plan_completion_rate"] == 0.0
    assert kpis["evidence_total_count"] == 1
    assert kpis["evidence_pass_rate"] == 0.0
    assert kpis["overdue_plan_item_count"] == 1

    assert all(row["domain_code"] == "P02" for row in body["member_attainment"])
    assert len(body["member_attainment"]) == 2
    p02_a = next(
        row
        for row in body["member_attainment"]
        if row["member_id"] == member_a_id and row["domain_code"] == "P02"
    )
    assert p02_a["attainment"] == pytest.approx(100.0 / 3, rel=1e-3)

    trends = {row["month"]: row for row in body["monthly_trends"]}
    assert trends[5]["planned_count"] == 1
    assert trends[3]["planned_count"] == 0


def test_team_analytics_member_filter_restricts_aggregates(
    team_analytics_schema: psycopg.Connection,
) -> None:
    member_a_id, _, leader_cookies = _build_two_member_team(team_analytics_schema)

    status, body, _ = _request(
        "GET",
        f"/api/planning/team-analytics?year=2026&member_id={member_a_id}",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body is not None

    kpis = body["kpis"]
    assert kpis["assessment_total_count"] == 1
    assert kpis["plan_total_count"] == 2
    assert kpis["plan_completion_rate"] == 0.5
    assert kpis["evidence_total_count"] == 2
    assert kpis["evidence_pass_rate"] == 0.5
    assert kpis["overdue_plan_item_count"] == 1

    assert all(row["member_id"] == member_a_id for row in body["member_attainment"])
    assert len(body["member_attainment"]) == 6


def test_team_analytics_preserves_personal_plan_endpoints(
    team_analytics_schema: psycopg.Connection,
) -> None:
    l3_codes = ["P01-L2A-L3A"]
    _ensure_l3_nodes(team_analytics_schema, l3_codes)
    buddy_id = _create_test_user(team_analytics_schema, "regression_buddy", ["Buddy"])
    member_id = _create_test_user(
        team_analytics_schema, "regression_member", ["Member"]
    )
    _create_test_user(team_analytics_schema, "regression_leader", ["Leader"])
    create_buddy_relationship(team_analytics_schema, member_id, buddy_id)
    team_analytics_schema.commit()

    _create_plan_item_data(
        team_analytics_schema,
        member_id,
        buddy_id,
        2026,
        [
            {
                "l3_code": "P01-L2A-L3A",
                "current_level": 2,
                "target_level": 4,
                "evidence_note": "regression",
                "plan_candidate": True,
            }
        ],
    )
    team_analytics_schema.commit()

    member_cookies = _login(team_analytics_schema, "regression_member")
    status, plan, _ = _request(
        "GET", "/api/planning/annual-plan?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert plan is not None
    assert len(plan["items"]) == 1

    status, dashboard, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=member_cookies
    )
    assert status == 200
    assert dashboard is not None
    assert dashboard["year"] == 2026

    leader_cookies = _login(team_analytics_schema, "regression_leader")
    status, body, _ = _request(
        "GET",
        f"/api/planning/team-analytics?year=2026&member_id={member_id}",
        cookies=leader_cookies,
    )
    assert status == 200
    assert body is not None
    assert body["kpis"]["plan_total_count"] == 1
