import psycopg
import pytest

from tests.test_capability_profile import (
    _build_full_profile,
    _login,
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


# ── Issue #64 phase 1: dashboard semantic alignment ────────────────────────


def _dashboard(profile_schema, member_cookies: dict[str, str], year: int = 2026):
    status, body, _ = _request(
        "GET", f"/api/planning/member-dashboard?year={year}", cookies=member_cookies
    )
    assert status == 200
    assert body is not None
    return body


def test_dashboard_meta_identifies_scope_and_as_of(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)
    body = _dashboard(profile_schema, member_cookies)

    meta = body["meta"]
    assert meta["year"] == 2026
    assert meta["scope"] == "本人"
    assert meta["as_of"] is not None
    assert isinstance(meta["source"], str) and meta["source"]
    # The Member denominator is the member's own assessment/plan data,
    # never the whole 310-node standard library.
    assert meta["denominator_source"] in ("assessment_details", "planned_items")
    assert meta["denominator_source"] != "standard_catalog"


def test_dashboard_gap_split_current_vs_target(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)
    body = _dashboard(profile_schema, member_cookies)

    gap_summary = body["gap_summary"]
    assert set(gap_summary) == {
        "current_required",
        "target_progressive",
        "derivation",
    }
    assert gap_summary["derivation"] in ("scope_v1", "legacy_fallback")
    # Counts reconcile with the traceable gap rows.
    assert gap_summary["current_required"] + gap_summary["target_progressive"] == len(
        body["gaps"]
    )
    assert all(
        g["scope_type"] in ("current_required", "target_progressive")
        for g in body["gaps"]
    )


def test_dashboard_applicable_completion_of_open_assessment(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)
    body = _dashboard(profile_schema, member_cookies)

    assessment = body["assessment"]
    completion = assessment["applicable_completion"]
    assert set(completion) == {"total", "completed", "ratio"}
    total = completion["total"]
    expected_ratio = completion["completed"] / total if total else 0
    assert abs(completion["ratio"] - expected_ratio) < 1e-9
    assert total <= len(body["gaps"])


def test_dashboard_current_month_counts_reconcilable(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)
    # Move the sole plan item into the current month (2026-08, Q3), 进行中.
    profile_schema.execute(
        """
        UPDATE plan_item SET plan_month = 8, plan_quarter = 'Q3'
        WHERE annual_growth_plan_id IN (
            SELECT id FROM annual_growth_plan WHERE member_id = %s
        )
        """,
        (member_id,),
    )
    profile_schema.commit()

    body = _dashboard(profile_schema, member_cookies)
    current_month = body["current_month"]
    assert current_month["planned_count"] == 1
    assert current_month["in_progress_count"] == 1
    assert current_month["delayed_count"] == 0
    assert current_month["pending_evidence_count"] == 0
    assert len(current_month["planned_ids"]) == 1
    # Reconciles with the traceable detail identifiers.
    assert current_month["planned_count"] == len(current_month["planned_ids"])
    assert current_month["in_progress_count"] == sum(
        1
        for pi_id in current_month["planned_ids"]
        if any(t["plan_item_id"] == pi_id for t in body["current_tasks"])
    )
    assert current_month["actual_hours"] == 0  # March log is not an August log


def test_dashboard_current_month_delayed_and_pending_evidence(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)
    profile_schema.execute(
        """
        UPDATE plan_item SET plan_month = 8, plan_quarter = 'Q3', status = '延期'
        WHERE annual_growth_plan_id IN (
            SELECT id FROM annual_growth_plan WHERE member_id = %s
        )
        """,
        (member_id,),
    )
    profile_schema.execute(
        """
        UPDATE learning_task SET status = '延期'
        WHERE plan_item_id IN (
            SELECT pi.id FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.member_id = %s
        )
        """,
        (member_id,),
    )
    # Draft evidence v2 (member pending) superseding the approved v1.
    profile_schema.execute(
        """
        UPDATE evidence
        SET status = '草稿', version_number = 2,
            supersedes_evidence_id = NULL
        WHERE learning_task_id IN (
            SELECT lt.id FROM learning_task lt
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.member_id = %s
        )
        """,
        (member_id,),
    )
    profile_schema.commit()

    body = _dashboard(profile_schema, member_cookies)
    current_month = body["current_month"]
    assert current_month["delayed_count"] == 1
    assert current_month["in_progress_count"] == 0
    assert current_month["pending_evidence_count"] == 1
    assert current_month["planned_count"] == 1


def test_dashboard_next_action_deterministic_no_auto_priority(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)

    # Seed state (assessment archived, task 进行中, evidence approved): the
    # next action falls out of a fixed decision chain, never from derived
    # priorities.
    body = _dashboard(profile_schema, member_cookies)
    assert set(body["next_action"]) == {"action_key", "message", "count"}
    assert body["next_action"]["action_key"] in (
        "complete_assessment",
        "await_buddy_review",
        "revise_assessment",
        "submit_evidence",
        "handle_delayed",
        "set_priorities",
        "none",
    )

    # Delayed item → handle_delayed, traceable to the delayed plan item.
    profile_schema.execute(
        """
        UPDATE plan_item SET status = '延期'
        WHERE annual_growth_plan_id IN (
            SELECT id FROM annual_growth_plan WHERE member_id = %s
        )
        """,
        (member_id,),
    )
    profile_schema.commit()
    body = _dashboard(profile_schema, member_cookies)
    assert body["next_action"]["action_key"] == "handle_delayed"
    assert body["next_action"]["count"] == 1

    # Priorities remain exactly the Member's own input.
    assert body["gaps"][0]["priority"] == "高"


def test_dashboard_no_310_denominator(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)
    body = _dashboard(profile_schema, member_cookies)

    # 1 assessment detail / 1 plan item — never 310 standards.
    assert len(body["gaps"]) == 1
    assert body["plan_progress"]["total"] == 1
    assert body["summary"]["annual_planned_hours"] == 10


def test_dashboard_query_count_bounded(
    profile_schema: psycopg.Connection,
) -> None:
    from app.planning.repository import get_member_dashboard
    from tests.test_monthly_review import _CountingConnection

    member_id, _ = _build_full_profile(profile_schema)
    profile_schema.commit()

    counted = _CountingConnection(profile_schema)
    result = get_member_dashboard(counted, member_id, 2026)
    assert result is not None
    assert counted.statement_count < 30, (
        f"member dashboard read issued {counted.statement_count} statements; "
        "shared aggregation must stay bounded for team-sized data"
    )
