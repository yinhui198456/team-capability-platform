"""Issue #64 phase 1 — repository-owned metric dictionary and shared aggregation.

Every aggregate key the planning views emit has a dictionary entry here
(definition / scope / phase).  Consumers built in phase 1 are the three
Member-facing views (Member Dashboard, Monthly Review, Growth Profile);
Team Analytics and Team Annual Plan are phase 2 and their entries are
documented but not implemented.

The two helpers below are the shared query layer: ``plan_items_in_month``
and ``valid_hours_by_task`` are the only statements the Member Dashboard's
``current_month`` block and the Monthly Review summary/details are built
from, so both consumers aggregate the same rows the same way (reconciliation
holds by construction).
"""

from typing import Any

import psycopg

# Six plan-item states; never the legacy "待 Evidence Review".
_PLAN_ITEM_STATES = ("未开始", "进行中", "已完成", "延期", "暂停", "取消")

# P-grades to the 1..5 capability scale (P4 is the entry grade).
_GRADE_TO_LEVEL = {"P4": 1, "P5": 2, "P6": 3, "P7": 4, "P8": 5}

METRIC_DICTIONARY: dict[str, dict[str, object]] = {
    # ── Phase 1: Member-facing consumers ────────────────────────────────
    "member_dashboard.meta": {
        "definition": (
            "as_of / year / scope / source / denominator_source for the "
            "Member dashboard.  denominator_source is the member's own "
            "assessment_details or planned_items — never the standard catalog."
        ),
        "scope": "本人",
        "phase": 1,
    },
    "member_dashboard.gap_summary": {
        "definition": (
            "Split of the traceable gap rows into current_required vs "
            "target_progressive.  scope_type comes from the assessment "
            "detail snapshot (scope-v1); legacy details (scope_type NULL) "
            "fall back to the grade mapping target vs member current grade "
            "and flag derivation=legacy_fallback."
        ),
        "scope": "本人",
        "phase": 1,
    },
    "member_dashboard.applicable_completion": {
        "definition": (
            "total / completed / ratio over the detail rows of the current "
            "(latest) assessment; completed means current_level reaches the "
            "effective target.  ratio is 0 when total is 0."
        ),
        "scope": "本人",
        "phase": 1,
    },
    "member_dashboard.current_month": {
        "definition": (
            "planned_count / planned_ids over plan_item.plan_month of the "
            "current month, in_progress_count and delayed_count over the "
            "six states, pending_evidence_count from latest-version "
            "evidence in (草稿, 需补充), actual_hours from valid "
            "learning_progress_log rows recorded in that month."
        ),
        "scope": "本人",
        "phase": 1,
    },
    "member_dashboard.next_action": {
        "definition": (
            "One action from a fixed decision chain "
            "(complete_assessment → await_buddy_review → revise_assessment "
            "→ submit_evidence → handle_delayed → set_priorities → none). "
            "Priorities are never derived: set_priorities fires only when "
            "a gap has no Member-provided priority."
        ),
        "scope": "本人",
        "phase": 1,
    },
    "monthly_review.summary": {
        "definition": (
            "planned_count / completed_count / in_progress_count / "
            "delayed_count / paused_count / cancelled_count / "
            "completion_rate / actual_hours / estimated_hours_summary "
            "(min_hours / max_hours / has_values / has_unparsed over the "
            "detail rows' estimated_hours, shared estimated-hours parse "
            "semantics) for one (member, year, month); computed from the "
            "detail rows so summary and details reconcile exactly.  States "
            "are the six plan-item states; actual_hours aggregates valid "
            "logs only."
        ),
        "scope": "本人 / buddy_assigned / leader_team",
        "phase": 1,
    },
    "monthly_review.details": {
        "definition": (
            "One row per plan_item with plan_month = month, carrying "
            "plan_item_id / task_id / l3_code / status / estimated_hours "
            "(raw value) / estimated_hours_parsed (raw / min_hours / "
            "max_hours / is_valid / is_range) / actual_hours (valid logs "
            "of that task recorded in that month)."
        ),
        "scope": "本人 / buddy_assigned / leader_team",
        "phase": 1,
    },
    "profile.monthly_reviews": {
        "definition": (
            "Member-written monthly reviews of the year with immutable "
            "history (every revision preserved, never mutated)."
        ),
        "scope": "本人 / buddy_assigned / leader_team",
        "phase": 1,
    },
    "profile.provenance": {
        "definition": (
            "assessment → snapshot → plan item → task → evidence chain: "
            "assessment_scope_version, planning_source_type, "
            "source_assessment_id, scope_type, assessment_revision on plan "
            "items.  Task completion never mutates levels or snapshots."
        ),
        "scope": "本人 / buddy_assigned / leader_team",
        "phase": 1,
    },
    # ── Phase 2: Team consumers (implemented) ─────────────────────────────
    "team_analytics.gap_summary": {
        "definition": (
            "Team-level split of gap rows (same split rule as "
            "member_dashboard.gap_summary, team denominator)."
        ),
        "scope": "团队",
        "phase": 2,
    },
    "team_analytics.meta": {
        "definition": (
            "as_of / year / scope / source / denominator_source for the "
            "Team Analytics view. source = team_analytics.v2."
        ),
        "scope": "团队",
        "phase": 2,
    },
    "team_annual_plan.meta": {
        "definition": "as_of / year / scope / source for the Team Annual Plan.",
        "scope": "团队",
        "phase": 2,
    },
    "team_annual_plan.items": {
        "definition": (
            "Paginated, sortable, filterable list of formal PlanItems for a "
            "team year. Formal means include_in_plan = TRUE and the owning "
            "annual_growth_plan is for the requested year. Includes member "
            "identity and L3 context."
        ),
        "scope": "团队",
        "phase": 2,
    },
}


def plan_items_in_month(
    connection: psycopg.Connection, member_id: int, year: int, month: int
) -> list[dict[str, object]]:
    """Plan items scheduled in ``month`` (plan_month), with their task ids.

    Single shared query for both the Dashboard ``current_month`` block and
    the Monthly Review detail rows.
    """
    # plan_month is TEXT 'YYYY-MM' (Issue #194) — derive the canonical
    # string from the int args instead of comparing an INT to TEXT.
    month_text = f"{year:04d}-{month:02d}"
    rows = connection.execute(
        """
        SELECT pi.id, pi.status, pi.l3_code, pi.estimated_hours, lt.id
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        LEFT JOIN learning_task lt ON lt.plan_item_id = pi.id
        WHERE agp.member_id = %s AND agp.year = %s AND pi.plan_month = %s
        ORDER BY pi.l3_code
        """,
        (member_id, year, month_text),
    ).fetchall()
    return [
        {
            "plan_item_id": row[0],
            "status": row[1],
            "l3_code": row[2],
            "estimated_hours": row[3],
            "task_id": row[4],
        }
        for row in rows
    ]


def valid_hours_by_task(
    connection: psycopg.Connection,
    task_ids: list[int],
    year: int,
    month: int,
) -> dict[int, int]:
    """Valid (non-invalidated) actual_hours per task, recorded in the month.

    One query for all tasks, so aggregation never degrades to per-row
    lookups; the Monthly Review and the Dashboard share this query.
    """
    if not task_ids:
        return {}
    rows = connection.execute(
        """
        SELECT task_id, COALESCE(SUM(actual_hours), 0)
        FROM learning_progress_log
        WHERE task_id = ANY(%s)
          AND invalidated_at IS NULL
          AND EXTRACT(YEAR FROM record_date) = %s
          AND EXTRACT(MONTH FROM record_date) = %s
        GROUP BY task_id
        """,
        (list(task_ids), year, month),
    ).fetchall()
    return {int(row[0]): int(row[1]) for row in rows}


def grade_to_level(grade: Any) -> int | None:
    """Map a P4..P8 snapshot grade to the 1..5 capability scale."""
    if grade is None:
        return None
    return _GRADE_TO_LEVEL.get(str(grade))
