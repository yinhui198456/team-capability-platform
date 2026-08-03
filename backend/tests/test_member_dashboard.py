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
        "completed_task_count": 0,
        "pending_evidence_to_submit": 0,
        "pending_evidence_to_review": 0,
    }
    assert body["plan_progress"] == {
        "total": 1,
        "未开始": 0,
        "进行中": 1,
        "已完成": 0,
        "延期": 0,
        "暂停": 0,
        "取消": 0,
    }
    assert body["domain_radar"][0] == {"domain_code": "P01", "score": 2}
    assert len(body["gaps"]) == 1
    assert body["gaps"][0]["l3_code"] == "P01-L2A-L3A"
    assert body["gaps"][0]["l2_code"] == "P01-L2A"
    assert body["gaps"][0]["l3_name"] == "Leaf"
    assert len(body["current_tasks"]) == 1
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


def _create_evidence(
    connection: psycopg.Connection, mc: dict[str, str], task_id: int, **extra: object
) -> tuple[int, dict[str, object] | None]:
    body: dict[str, object] = {
        "content": "成果",
        "evidence_link": "http://example.com/out",
    }
    body.update(extra)
    status, payload, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        body,
        cookies=mc,
    )
    return status, payload


def _evidence_todos(
    connection: psycopg.Connection, mc: dict[str, str]
) -> tuple[int, int]:
    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=mc
    )
    assert status == 200 and body is not None
    summary = body["summary"]
    return (
        int(summary["pending_evidence_to_submit"]),
        int(summary["pending_evidence_to_review"]),
    )


def test_member_dashboard_evidence_todos_exclude_superseded(
    profile_schema: psycopg.Connection,
) -> None:
    """Issue #63: evidence todos are per-role and never count superseded
    versions (each supersedes chain contributes at most one pending item)."""
    from tests.test_capability_profile import _login

    _, member_cookies = _build_full_profile(profile_schema)
    status, tasks, _ = _request(
        "GET", "/api/planning/learning-tasks", cookies=member_cookies
    )
    assert status == 200
    task_id = next(t["id"] for t in tasks if t["plan_item_id"] is not None)

    # Baseline after the approved chain in _build_full_profile: no todos.
    assert _evidence_todos(profile_schema, member_cookies) == (0, 0)

    # Draft v1: only the member todo.
    status, first = _create_evidence(profile_schema, member_cookies, task_id)
    assert status == 200
    first_id = int(first["id"])
    assert _evidence_todos(profile_schema, member_cookies) == (1, 0)

    # Submitted v1: only the buddy todo.
    status, _, _ = _request(
        "POST", f"/api/planning/evidences/{first_id}/submit", {}, cookies=member_cookies
    )
    assert status == 200
    assert _evidence_todos(profile_schema, member_cookies) == (0, 1)

    # Buddy asks for more: v1 returns to the member todo.
    buddy_cookies = _login(profile_schema, "buddy_profile")
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{first_id}/review",
        {"conclusion": "需补充", "feedback": "请补充截图"},
        cookies=buddy_cookies,
    )
    assert status == 200
    assert _evidence_todos(profile_schema, member_cookies) == (1, 0)

    # v2 supersedes v1: the superseded v1 must not be counted a second time.
    status, second = _create_evidence(
        profile_schema, member_cookies, task_id, supersedes_evidence_id=first_id
    )
    assert status == 200
    second_id = int(second["id"])
    assert _evidence_todos(profile_schema, member_cookies) == (1, 0)

    # Submitted v2: only the buddy todo, superseded v1 still excluded.
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{second_id}/submit",
        {},
        cookies=member_cookies,
    )
    assert status == 200
    assert _evidence_todos(profile_schema, member_cookies) == (0, 1)
