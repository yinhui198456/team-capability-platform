import psycopg
import pytest

from tests.test_capability_profile import (
    _build_full_profile,
    _request,
)
from tests.test_capability_profile import (
    profile_schema as _initialize_profile_schema,
)


@pytest.fixture
def profile_schema(connection: psycopg.Connection) -> psycopg.Connection:
    return _initialize_profile_schema.__wrapped__(connection)


def test_member_dashboard_aggregates_hour_suffix_ranges(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)

    profile_schema.execute(
        """
        UPDATE plan_item
        SET estimated_hours = '4–6h'
        WHERE annual_growth_plan_id IN (
            SELECT id FROM annual_growth_plan
            WHERE member_id = (
                SELECT id FROM tcp_user WHERE username = 'member_profile'
            )
        )
        """
    )
    profile_schema.commit()

    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=member_cookies
    )

    assert status == 200
    assert body is not None
    assert body["summary"]["annual_planned_hours_min"] == 4
    assert body["summary"]["annual_planned_hours_max"] == 6
    assert body["summary"]["annual_planned_hours_has_unparsed"] is False


def test_member_dashboard_aggregates_only_current_member_data(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=member_cookies
    )

    assert status == 200
    assert body is not None
    assert body["year"] == 2026
    assert body["summary"] == {
        "annual_actual_hours": 5,
        "annual_planned_hours": 10,
        "annual_planned_hours_min": 10,
        "annual_planned_hours_max": 10,
        "annual_planned_hours_has_values": True,
        "annual_planned_hours_has_unparsed": False,
        "current_month_actual_hours": 0,
        "current_month_planned_hours": 0,
        "current_month_planned_hours_min": 0,
        "current_month_planned_hours_max": 0,
        "current_month_planned_hours_has_values": False,
        "current_month_planned_hours_has_unparsed": False,
        "completed_task_count": 1,
        "pending_evidence_count": 0,
    }
    assert body["plan_progress"] == {
        "total": 1,
        "未开始": 0,
        "进行中": 0,
        "待 Evidence Review": 0,
        "已完成": 1,
        "延期": 0,
    }
    assert body["domain_radar"][0] == {"domain_code": "P01", "score": 2}
    assert len(body["gaps"]) == 1
    assert body["gaps"][0]["l3_code"] == "P01-L2A-L3A"
    assert body["gaps"][0]["l2_code"] == "P01-L2A"
    assert body["gaps"][0]["l3_name"] == "Leaf"
    assert body["current_tasks"] == []
    assert body["assessment"] is not None
    assert body["assessment"]["status"] == "已归档"
    assert body["assessment"]["submitted_at"] is not None
    assert body["assessment"]["review_status"] == "已闭环"
    assert body["assessment"]["review_conclusion"] == "认可"
    assert body["annual_plan_status"] == "制定中"


def test_member_dashboard_rejects_non_members(
    profile_schema: psycopg.Connection,
) -> None:
    _build_full_profile(profile_schema, "dashboard_member", "dashboard_buddy")
    from tests.test_capability_profile import _login

    status, _, _ = _request(
        "GET",
        "/api/planning/member-dashboard?year=2026",
        cookies=_login(profile_schema, "dashboard_buddy"),
    )
    assert status == 403
