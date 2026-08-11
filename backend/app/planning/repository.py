import json
from datetime import date, datetime, timedelta
from typing import Any

import psycopg

from ..access.repository import (
    get_assigned_members,
    is_member_assigned_to_buddy,
)
from ..catalog.repository import DOMAIN_CODES, get_l3_contexts
from .gate import check_annual_plan_gate, get_latest_submitted_assessment
from .hours import parse_estimated_hours, summarize_estimated_hours
from .metrics import (
    grade_to_level,
    logged_tasks_in_month,
    plan_items_in_month,
    valid_hours_by_task,
)


def _now(connection: psycopg.Connection) -> Any:
    return connection.execute("SELECT NOW()").fetchone()[0]


def _serialize_datetime(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _plan_item_row(row: tuple[Any, ...]) -> dict[str, object]:
    item = {
        "id": row[0],
        "annual_growth_plan_id": row[1],
        "growth_goal_id": row[2],
        "l3_code": row[3],
        "current_level": row[4],
        "target_level": row[5],
        "priority": row[6],
        "learning_material": row[7],
        "learning_task_content": row[8],
        "expected_output": row[9],
        "estimated_hours": row[10],
        "plan_start_date": row[11],
        "plan_end_date": row[12],
        "target_month": row[13],
        "status": row[14],
        "revision": row[15],
    }
    item["estimated_hours_parsed"] = parse_estimated_hours(
        row[10] if isinstance(row[10], str) else None
    ).as_dict()
    return item


def _estimated_hours_summary(items: list[dict[str, object]]) -> dict[str, object]:
    return summarize_estimated_hours(
        [
            (
                item.get("estimated_hours")
                if isinstance(item.get("estimated_hours"), str)
                else None
            )
            for item in items
        ]
    )


def _attach_l3_contexts(
    connection: psycopg.Connection, items: list[dict[str, object]]
) -> list[dict[str, object]]:
    contexts = get_l3_contexts(
        connection, [str(item["l3_code"]) for item in items if item.get("l3_code")]
    )
    for item in items:
        code = item.get("l3_code")
        if isinstance(code, str):
            # Frozen snapshot fields (source plan items) win over live catalog
            # context; live context only fills keys that are still missing.
            for key, value in contexts[code].items():
                if key not in item or item[key] is None:
                    item[key] = value
    return items


_ALLOWED_TASK_STATUSES = {
    "未开始",
    "进行中",
    "已完成",
    "延期",
    "暂停",
    "取消",
}

# Service-enforced task state machine (v0010).  Terminal states are closed.
_TASK_TRANSITIONS: dict[str, set[str]] = {
    "未开始": {"进行中", "取消"},
    "进行中": {"暂停", "延期", "已完成", "取消"},
    "暂停": {"进行中", "取消"},
    "延期": {"进行中", "暂停", "已完成", "取消"},
    "已完成": set(),
    "取消": set(),
}

# Reasons required when ENTERING these states.
_STATUS_REASON_FIELDS = {
    "延期": "delay_reason",
    "暂停": "pause_reason",
    "取消": "cancel_reason",
}

_COMPLETION_QUALITY_VALUES = ("达到预期", "部分达到", "超出预期")

_MAX_NEXT_ACTION_LENGTH = 200

_MAX_LOG_HOURS_PER_ENTRY = 24


class PlanningDomainError(ValueError):
    """Structured domain error carried to the API layer for mapping.

    Attributes mirror the contract error envelope:
    code / entity_type / entity_id / field / reason / message.
    """

    code = "planning_domain_error"
    entity_type = "planning"
    field: str | None = None

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        entity_type: str | None = None,
        entity_id: object = None,
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code
        if entity_type is not None:
            self.entity_type = entity_type
        self.entity_id = entity_id
        self.field = field


class LegacyPlanningWriteDisabled(ValueError):
    """Old manual planning write paths are closed (API and repository).

    Modern plans can only be created atomically by an approved Assessment.
    """

    code = "legacy_planning_write_disabled"


class InvalidTaskTransition(PlanningDomainError):
    code = "invalid_task_transition"
    entity_type = "learning_task"


class InvalidStatusReason(PlanningDomainError):
    code = "invalid_status_reason"
    entity_type = "learning_task"


class TaskRevisionConflict(PlanningDomainError):
    code = "task_revision_conflict"
    entity_type = "learning_task"


class TransitionIdempotencyConflict(PlanningDomainError):
    code = "transition_idempotency_conflict"
    entity_type = "learning_task"


class CompletionGateError(PlanningDomainError):
    code = "completion_gate_failed"
    entity_type = "learning_task"


class PlanItemDateError(PlanningDomainError):
    code = "invalid_date_range"
    entity_type = "plan_item"


class PlanItemRevisionConflict(PlanningDomainError):
    code = "plan_revision_conflict"
    entity_type = "plan_item"


class PlanItemValidationError(PlanningDomainError):
    code = "invalid_plan_item"
    entity_type = "plan_item"


class TaskValidationError(PlanningDomainError):
    code = "invalid_task"
    entity_type = "learning_task"


class SourceFieldLocked(PlanningDomainError):
    code = "source_field_locked"


class LogValidationError(PlanningDomainError):
    code = "invalid_hours"
    entity_type = "learning_progress_log"


class LogIdempotencyConflict(PlanningDomainError):
    code = "log_idempotency_conflict"
    entity_type = "learning_progress_log"


class EvidenceValidationError(PlanningDomainError):
    code = "invalid_evidence"
    entity_type = "evidence"


class EvidenceRevisionConflict(PlanningDomainError):
    code = "evidence_revision_conflict"
    entity_type = "evidence"


class EvidenceReviewConflict(PlanningDomainError):
    code = "review_idempotency_conflict"
    entity_type = "evidence_review"


class ReviewValidationError(PlanningDomainError):
    code = "invalid_review"
    entity_type = "evidence_review"


# Member-editable task fields; status/dates/hours are machine-managed.
_UPDATABLE_TASK_FIELDS = {
    "completion_quality",
    "review_conclusion",
    "next_action",
}

# Plan-item fields remain Member-editable under date constraints; the source
# snapshot (incl. quarter/month) and status are read-only for members.
_UPDATABLE_PLAN_ITEM_FIELDS = {
    "plan_start_date",
    "plan_end_date",
}


def get_or_create_annual_plan(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT id, member_id, year, plan_cycle, status, start_date, end_date, created_at
        FROM annual_growth_plan
        WHERE member_id = %s AND year = %s
        """,
        (member_id, year),
    ).fetchone()
    if row is not None:
        return {
            "id": row[0],
            "member_id": row[1],
            "year": row[2],
            "plan_cycle": row[3],
            "status": row[4],
            "start_date": row[5],
            "end_date": row[6],
            "created_at": row[7],
        }
    row = connection.execute(
        """
        INSERT INTO annual_growth_plan (member_id, year, status)
        VALUES (%s, %s, '制定中')
        RETURNING id, member_id, year, plan_cycle, status,
                  start_date, end_date, created_at
        """,
        (member_id, year),
    ).fetchone()
    assert row is not None
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "plan_cycle": row[3],
        "status": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": row[7],
    }


def list_eligible_gaps(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    gate = check_annual_plan_gate(connection, member_id)
    if not gate["eligible"]:
        return []

    latest = get_latest_submitted_assessment(connection, member_id)
    assert latest is not None

    rows = connection.execute(
        """
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate
        FROM gap g
        WHERE g.assessment_id = %s AND g.plan_candidate = TRUE
        ORDER BY g.l3_code
        """,
        (latest["id"],),
    ).fetchall()
    return _attach_l3_contexts(
        connection,
        [
            {
                "id": row[0],
                "assessment_id": row[1],
                "l3_code": row[2],
                "current_level": row[3],
                "target_level": row[4],
                "gap_value": row[5],
                "priority": row[6],
                "plan_candidate": row[7],
            }
            for row in rows
        ],
    )


def create_growth_goal(
    connection: psycopg.Connection, member_id: int, gap_id: int
) -> dict[str, object]:
    raise LegacyPlanningWriteDisabled(
        "manual growth goal creation is disabled; plans are generated "
        "atomically from an approved assessment"
    )


def list_growth_goals(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT gg.id, gg.gap_id, gg.annual_growth_plan_id, gg.l3_code,
               gg.year, gg.target_level, gg.priority
        FROM growth_goal gg
        JOIN annual_growth_plan agp ON agp.id = gg.annual_growth_plan_id
        WHERE agp.member_id = %s
        ORDER BY gg.l3_code
        """,
        (member_id,),
    ).fetchall()
    return _attach_l3_contexts(
        connection,
        [
            {
                "id": row[0],
                "gap_id": row[1],
                "annual_growth_plan_id": row[2],
                "l3_code": row[3],
                "year": row[4],
                "target_level": row[5],
                "priority": row[6],
            }
            for row in rows
        ],
    )


def delete_growth_goal(
    connection: psycopg.Connection, member_id: int, goal_id: int
) -> None:
    raise LegacyPlanningWriteDisabled(
        "manual growth goal deletion is disabled; plans are generated "
        "atomically from an approved assessment"
    )


def get_annual_plan_with_items(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT agp.id, agp.member_id, agp.year, agp.plan_cycle, agp.status,
               agp.start_date, agp.end_date, agp.created_at,
               agp.source_assessment_id, agp.planning_source_type,
               sv.label AS source_standard_version_label
        FROM annual_growth_plan agp
        LEFT JOIN assessment a ON a.id = agp.source_assessment_id
        LEFT JOIN capability_standard_version sv
          ON sv.id = a.capability_standard_version_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchone()
    if row is None:
        return None
    items = connection.execute(
        """
        SELECT pi.id, pi.annual_growth_plan_id, pi.growth_goal_id, pi.l3_code,
               pi.current_level, pi.target_level, pi.priority, pi.learning_material,
               pi.learning_task_content, pi.expected_output, pi.estimated_hours,
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status,
               pi.source_assessment_id, pi.source_assessment_detail_id,
               pi.capability_standard_version_id, pi.planning_snapshot_id,
               pi.l3_node_id, pi.l1_code, pi.l1_name, pi.l2_code, pi.l2_name,
               pi.l3_name, pi.scope_type, pi.standard_target_level,
               pi.adjusted_target_level, pi.effective_target_level,
               pi.standard_job_level_snapshot, pi.member_current_level_snapshot,
               pi.member_target_level_snapshot, pi.plan_quarter, pi.plan_month,
               pi.planning_source_type, pi.assessment_revision, pi.gap_value,
               pi.include_in_plan, pi.revision
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        ORDER BY pi.l3_code
        """,
        (member_id, year),
    ).fetchall()
    plan_items: list[dict[str, object]] = []
    for item in items:
        payload = _plan_item_row(item)
        payload.update(
            {
                "source_assessment_id": item[15],
                "source_assessment_detail_id": item[16],
                "capability_standard_version_id": item[17],
                "planning_snapshot_id": item[18],
                "l3_node_id": item[19],
                "l1_code": item[20],
                "l1_name": item[21],
                "l2_code": item[22],
                "l2_name": item[23],
                "l3_name": item[24],
                "scope_type": item[25],
                "standard_target_level": item[26],
                "adjusted_target_level": item[27],
                "effective_target_level": item[28],
                "standard_job_level_snapshot": item[29],
                "member_current_level_snapshot": item[30],
                "member_target_level_snapshot": item[31],
                "plan_quarter": item[32],
                "plan_month": item[33],
                "planning_source_type": item[34],
                "assessment_revision": item[35],
                "gap_value": item[36],
                "include_in_plan": item[37],
                "revision": item[38],
            }
        )
        plan_items.append(payload)
    plan_items = _attach_l3_contexts(connection, plan_items)

    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "plan_cycle": row[3],
        "status": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": row[7],
        "source_assessment_id": row[8],
        "planning_source_type": row[9],
        "source_standard_version_label": row[10],
        "items": plan_items,
        "estimated_hours_summary": _estimated_hours_summary(plan_items),
    }


def _get_l3_defaults(
    connection: psycopg.Connection, l3_code: str
) -> dict[str, str | None]:
    row = connection.execute(
        """
        SELECT materials_text, expected_output, estimated_hours
        FROM capability_node
        WHERE code = %s AND node_type = 'L3'
        LIMIT 1
        """,
        (l3_code,),
    ).fetchone()
    if row is None:
        return {
            "learning_material": None,
            "expected_output": None,
            "estimated_hours": None,
        }
    return {
        "learning_material": row[0],
        "expected_output": row[1],
        "estimated_hours": row[2],
    }


def generate_plan_items(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    raise LegacyPlanningWriteDisabled(
        "manual plan generation is disabled; plans are generated "
        "atomically from an approved assessment"
    )


def list_plan_items(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT pi.id, pi.annual_growth_plan_id, pi.growth_goal_id, pi.l3_code,
               pi.current_level, pi.target_level, pi.priority, pi.learning_material,
               pi.learning_task_content, pi.expected_output, pi.estimated_hours,
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status,
               pi.revision
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
        ORDER BY pi.l3_code
        """,
        (member_id,),
    ).fetchall()
    return [_plan_item_row(row) for row in rows]


_TASK_COLUMNS = (
    "id, plan_item_id, l3_code, status, actual_start_date, actual_end_date, "
    "actual_hours, completion_quality, review_conclusion, next_action, "
    "revision, actual_started_at, actual_completed_at, delay_reason, "
    "pause_reason, cancel_reason, revised_due_date"
)


def _prefixed(columns: str, alias: str) -> str:
    return ", ".join(f"{alias}.{column}" for column in columns.split(", "))


def _learning_task_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "plan_item_id": row[1],
        "l3_code": row[2],
        "status": row[3],
        "actual_start_date": row[4],
        "actual_end_date": row[5],
        "actual_hours": row[6],
        "completion_quality": row[7],
        "review_conclusion": row[8],
        "next_action": row[9],
        "revision": row[10],
        "actual_started_at": row[11],
        "actual_completed_at": row[12],
        "delay_reason": row[13],
        "pause_reason": row[14],
        "cancel_reason": row[15],
        "revised_due_date": row[16],
    }


def create_learning_task(
    connection: psycopg.Connection, member_id: int, plan_item_id: int
) -> dict[str, object]:
    raise LegacyPlanningWriteDisabled(
        "manual learning task creation is disabled; tasks are generated "
        "atomically from an approved assessment"
    )


def _insert_learning_task(
    connection: psycopg.Connection, plan_item_id: int, l3_code: str
) -> dict[str, object]:
    inserted = connection.execute(
        f"""
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, '未开始')
        RETURNING {_TASK_COLUMNS}
        """,
        (plan_item_id, l3_code),
    ).fetchone()
    assert inserted is not None
    return _learning_task_row(inserted)


def _insert_learning_task(
    connection: psycopg.Connection, plan_item_id: int, l3_code: str
) -> dict[str, object]:
    inserted = connection.execute(
        f"""
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, '未开始')
        RETURNING {_TASK_COLUMNS}
        """,
        (plan_item_id, l3_code),
    ).fetchone()
    assert inserted is not None
    return _learning_task_row(inserted)


def _month_end(year: int, month: int) -> date:
    # month=12 rolls into January of the next year; minus one day is the end
    # of the target month.
    return date(year + month // 12, month % 12 + 1, 1) - timedelta(days=1)


def _validate_plan_item_dates(
    connection: psycopg.Connection,
    plan_item_id: int,
    updates: dict[str, object],
) -> None:
    """Apply the unique plan-date rules from the #63 contract.

    - start <= due;
    - neither date leaves the source quarter;
    - due must fall inside the source plan month;
    - start may be anywhere in the same quarter, no later than due.
    """
    row = connection.execute(
        """
        SELECT pi.plan_start_date, pi.plan_end_date, pi.plan_quarter,
               pi.plan_month, pi.target_month, agp.year
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE pi.id = %s
        """,
        (plan_item_id,),
    ).fetchone()
    if row is None:
        raise PermissionError("plan item not found")

    def _as_date(value: object) -> date | None:
        if value is None:
            return None
        return value if isinstance(value, date) else date.fromisoformat(str(value))

    start = _as_date(updates.get("plan_start_date", row[0]))
    due = _as_date(updates.get("plan_end_date", row[1]))
    plan_quarter = row[2]
    plan_month = row[3]
    target_month = row[4]
    month = plan_month if plan_month is not None else target_month
    year = int(row[5])

    if start is not None and due is not None and start > due:
        raise PlanItemDateError(
            "plan_start_date must not be later than plan_end_date",
            entity_id=plan_item_id,
            field="plan_start_date",
        )

    # Quarter is authoritative when present; otherwise derive it from month.
    quarter_key = plan_quarter
    if quarter_key is None and month is not None:
        quarter_key = f"Q{(month - 1) // 3 + 1}"
    if quarter_key is not None:
        quarter_first_month = {"Q1": 1, "Q2": 4, "Q3": 7, "Q4": 10}.get(quarter_key)
        if quarter_first_month is None:
            raise PlanItemDateError(
                "invalid source quarter",
                entity_id=plan_item_id,
                field="plan_quarter",
            )
        q_first = date(year, quarter_first_month, 1)
        q_last = _month_end(year, quarter_first_month + 2)
        if start is not None and not q_first <= start <= q_last:
            raise PlanItemDateError(
                "plan_start_date must stay inside the source quarter",
                entity_id=plan_item_id,
                field="plan_start_date",
            )
        if due is not None and not q_first <= due <= q_last:
            raise PlanItemDateError(
                "plan_end_date must stay inside the source quarter",
                entity_id=plan_item_id,
                field="plan_end_date",
            )

    if due is not None and month is not None:
        first, last = date(year, month, 1), _month_end(year, month)
        if not first <= due <= last:
            raise PlanItemDateError(
                "plan_end_date must fall inside the source plan month",
                entity_id=plan_item_id,
                field="plan_end_date",
            )


def update_plan_item(
    connection: psycopg.Connection,
    member_id: int,
    plan_item_id: int,
    fields: dict[str, object],
    expected_revision: int | None = None,
) -> dict[str, object]:
    expected_revision = _validate_expected_revision(
        expected_revision, PlanItemValidationError
    )
    owned = connection.execute(
        """
        SELECT pi.id, pi.revision
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE pi.id = %s AND agp.member_id = %s
        """,
        (plan_item_id, member_id),
    ).fetchone()
    if owned is None:
        raise PermissionError("plan item does not belong to member")

    updates: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _UPDATABLE_PLAN_ITEM_FIELDS:
            raise SourceFieldLocked(
                f"field '{key}' is not updatable",
                entity_type="plan_item",
                entity_id=plan_item_id,
                field=key,
            )
        updates[key] = value

    for key in ("plan_start_date", "plan_end_date"):
        value = updates.get(key)
        if value is not None and not isinstance(value, str):
            raise PlanItemDateError(
                f"{key} must be an ISO date",
                entity_id=plan_item_id,
                field=key,
            )
        if isinstance(value, str):
            try:
                date.fromisoformat(value)
            except ValueError as exc:
                raise PlanItemDateError(
                    f"{key} must be an ISO date",
                    entity_id=plan_item_id,
                    field=key,
                ) from exc

    if not updates:
        raise PlanItemValidationError(
            "PUT requires at least one writable business field",
            entity_id=plan_item_id,
            field="fields",
        )

    with connection.transaction():
        locked = connection.execute(
            "SELECT revision FROM plan_item WHERE id = %s FOR UPDATE",
            (plan_item_id,),
        ).fetchone()
        assert locked is not None
        if int(locked[0]) != expected_revision:
            raise PlanItemRevisionConflict(
                "plan item revision conflict",
                entity_id=plan_item_id,
                field="revision",
            )
        # Dates frozen once the task reached a terminal state.
        terminal = connection.execute(
            """
            SELECT 1 FROM learning_task
            WHERE plan_item_id = %s AND status IN ('已完成', '取消')
            """,
            (plan_item_id,),
        ).fetchone()
        if terminal is not None and (
            "plan_start_date" in updates or "plan_end_date" in updates
        ):
            raise PlanItemDateError(
                "plan dates are frozen after task completion or cancellation",
                entity_id=plan_item_id,
                field="plan_start_date",
            )
        _validate_plan_item_dates(connection, plan_item_id, updates)

        columns = list(updates.keys())
        set_clause = ", ".join(f"{column} = %s" for column in columns)
        values = [updates[column] for column in columns] + [plan_item_id]
        updated = connection.execute(
            f"""
            UPDATE plan_item
            SET {set_clause}, revision = revision + 1
            WHERE id = %s
            RETURNING id, annual_growth_plan_id, growth_goal_id, l3_code,
                      current_level, target_level, priority, learning_material,
                      learning_task_content, expected_output, estimated_hours,
                      plan_start_date, plan_end_date, target_month, status,
                      revision
            """,
            values,
        ).fetchone()
        assert updated is not None
    return _attach_l3_contexts(connection, [_plan_item_row(updated)])[0]


def list_learning_tasks(
    connection: psycopg.Connection,
    member_id: int,
    year: int | None = None,
) -> list[dict[str, object]]:
    year_filter = "" if year is None else "AND agp.year = %s"
    params: tuple[object, ...] = (member_id,) if year is None else (member_id, year)
    rows = connection.execute(
        f"""
        SELECT {_prefixed(_TASK_COLUMNS, "lt")},
               pi.current_level, pi.target_level, pi.priority,
               pi.learning_material, pi.learning_task_content,
               pi.expected_output, pi.estimated_hours, pi.target_month
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
          {year_filter}
        ORDER BY lt.l3_code
        """,
        params,
    ).fetchall()
    tasks = _attach_l3_contexts(
        connection,
        [
            {
                **_learning_task_row(row[:17]),
                "plan_item_current_level": row[17],
                "plan_item_target_level": row[18],
                "plan_item_priority": row[19],
                "plan_item_learning_material": row[20],
                "plan_item_learning_task_content": row[21],
                "plan_item_expected_output": row[22],
                "plan_item_estimated_hours": row[23],
                "plan_item_target_month": row[24],
            }
            for row in rows
        ],
    )
    for task in tasks:
        raw = task.get("plan_item_estimated_hours")
        task["plan_item_estimated_hours_parsed"] = parse_estimated_hours(
            raw if isinstance(raw, str) else None
        ).as_dict()
    return tasks


def get_learning_task(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        f"""
        SELECT {_prefixed(_TASK_COLUMNS, "lt")},
               pi.current_level, pi.target_level, pi.priority,
               pi.learning_material, pi.learning_task_content,
               pi.expected_output, pi.estimated_hours, pi.target_month
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.id = %s AND agp.member_id = %s
        """,
        (task_id, member_id),
    ).fetchone()
    if row is None:
        return None
    task = _attach_l3_contexts(
        connection,
        [
            {
                **_learning_task_row(row[:17]),
                "plan_item_current_level": row[17],
                "plan_item_target_level": row[18],
                "plan_item_priority": row[19],
                "plan_item_learning_material": row[20],
                "plan_item_learning_task_content": row[21],
                "plan_item_expected_output": row[22],
                "plan_item_estimated_hours": row[23],
                "plan_item_target_month": row[24],
            }
        ],
    )[0]
    raw = task.get("plan_item_estimated_hours")
    task["plan_item_estimated_hours_parsed"] = parse_estimated_hours(
        raw if isinstance(raw, str) else None
    ).as_dict()
    return task


def _task_row(connection: psycopg.Connection, task_id: int) -> dict[str, object]:
    row = connection.execute(
        f"SELECT {_TASK_COLUMNS} FROM learning_task WHERE id = %s",
        (task_id,),
    ).fetchone()
    assert row is not None
    return _learning_task_row(row)


def _validate_completion_fields(fields: dict[str, object], task_id: int) -> None:
    """Shared format rules for member-supplied completion fields (PUT and the
    已完成 transition payload enforce the identical contract)."""
    if "completion_quality" in fields:
        quality = fields["completion_quality"]
        if quality is not None and quality not in _COMPLETION_QUALITY_VALUES:
            raise CompletionGateError(
                "invalid completion_quality",
                entity_id=task_id,
                field="completion_quality",
            )
    for key in ("review_conclusion", "next_action"):
        value = fields.get(key)
        if value is not None and not isinstance(value, str):
            raise CompletionGateError(
                f"{key} must be text", entity_id=task_id, field=key
            )
        if (
            key == "next_action"
            and isinstance(value, str)
            and len(value) > _MAX_NEXT_ACTION_LENGTH
        ):
            raise CompletionGateError(
                "next_action must be at most 200 characters",
                entity_id=task_id,
                field="next_action",
            )


def update_learning_task(
    connection: psycopg.Connection,
    member_id: int,
    task_id: int,
    fields: dict[str, object],
    expected_revision: int | None = None,
) -> dict[str, object]:
    """Member-editable task fields only; status/dates/hours are machine-owned."""
    expected_revision = _validate_expected_revision(
        expected_revision, TaskValidationError
    )

    # Ownership pre-check: a token-only PUT must never read another member's
    # task back, so we verify membership before looking at business fields.
    owned = connection.execute(
        """
        SELECT lt.id
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.id = %s AND agp.member_id = %s
        """,
        (task_id, member_id),
    ).fetchone()
    if owned is None:
        raise PermissionError("learning task does not belong to member")

    updates: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _UPDATABLE_TASK_FIELDS:
            raise SourceFieldLocked(
                f"field '{key}' is not updatable",
                entity_type="learning_task",
                entity_id=task_id,
                field=key,
            )
        updates[key] = value

    _validate_completion_fields(updates, task_id)

    if not updates:
        # Mirror the plan-item contract: a PUT with no writable business fields
        # is a request error, not a read interface.
        raise TaskValidationError(
            "PUT requires at least one writable business field",
            entity_id=task_id,
            field="fields",
        )

    with connection.transaction():
        locked = connection.execute(
            """
            SELECT lt.id
            FROM learning_task lt
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE lt.id = %s AND agp.member_id = %s
            FOR UPDATE OF lt
            """,
            (task_id, member_id),
        ).fetchone()
        if locked is None:
            raise PermissionError("learning task does not belong to member")
        revision_row = connection.execute(
            "SELECT revision FROM learning_task WHERE id = %s", (task_id,)
        ).fetchone()
        assert revision_row is not None
        if int(revision_row[0]) != expected_revision:
            raise TaskRevisionConflict(
                "learning task revision conflict",
                entity_id=task_id,
                field="revision",
            )
        columns = list(updates.keys())
        set_clause = ", ".join(f"{column} = %s" for column in columns)
        values = [updates[column] for column in columns]
        values.append(task_id)
        connection.execute(
            f"UPDATE learning_task SET {set_clause}, revision = revision + 1 "
            f"WHERE id = %s",
            values,
        )
    return _task_row(connection, task_id)


def _transition_fingerprint(*payload: object) -> str:
    import hashlib

    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, ensure_ascii=False).encode()
    ).hexdigest()


def _check_completion_gate(connection: psycopg.Connection, task_id: int) -> None:
    row = connection.execute(
        """
        SELECT lt.completion_quality, lt.review_conclusion, lt.next_action,
               lt.actual_hours,
               EXISTS (
                   SELECT 1 FROM evidence e
                   WHERE e.learning_task_id = lt.id AND e.status = '通过'
               )
        FROM learning_task lt
        WHERE lt.id = %s
        """,
        (task_id,),
    ).fetchone()
    assert row is not None
    quality, review_conclusion, next_action, actual_hours, evidence_ok = row
    if not evidence_ok:
        raise CompletionGateError(
            "task requires at least one approved evidence",
            entity_id=task_id,
            field="evidence",
        )
    if not review_conclusion or not str(review_conclusion).strip():
        raise CompletionGateError(
            "task requires a non-empty retrospective conclusion",
            entity_id=task_id,
            field="review_conclusion",
        )
    if not actual_hours or int(actual_hours) <= 0:
        raise CompletionGateError(
            "task requires aggregated actual_hours > 0 from valid logs",
            entity_id=task_id,
            field="actual_hours",
        )
    if quality not in _COMPLETION_QUALITY_VALUES:
        raise CompletionGateError(
            "invalid completion_quality",
            entity_id=task_id,
            field="completion_quality",
        )
    if not next_action or not str(next_action).strip():
        raise CompletionGateError(
            "task requires a non-empty next action",
            entity_id=task_id,
            field="next_action",
        )
    if len(str(next_action)) > _MAX_NEXT_ACTION_LENGTH:
        raise CompletionGateError(
            "next_action must be at most 200 characters",
            entity_id=task_id,
            field="next_action",
        )


def transition_learning_task(
    connection: psycopg.Connection,
    member_id: int,
    task_id: int,
    to_status: str,
    reason: object,
    expected_revision: int | None,
    idempotency_key: str | None = None,
    revised_due_date: object = None,
    completion_fields: dict[str, object] | None = None,
) -> dict[str, object]:
    """Service-enforced task state machine (v0010).  Zero partial writes."""
    if to_status not in _ALLOWED_TASK_STATUSES:
        raise InvalidTaskTransition(
            f"invalid status '{to_status}'", entity_id=task_id, field="status"
        )
    # Issue #150: the retrospective payload rides the 已完成 transition so the
    # gate verdict and the field/status write commit in one transaction; a
    # gate failure persists nothing and never advances the revision.
    if completion_fields and to_status != "已完成":
        raise InvalidTaskTransition(
            "completion fields are only accepted when completing a task",
            entity_id=task_id,
            field="status",
        )
    if completion_fields:
        unknown = set(completion_fields) - {
            "completion_quality",
            "review_conclusion",
            "next_action",
        }
        if unknown:
            raise SourceFieldLocked(
                f"field '{sorted(unknown)[0]}' is not updatable",
                entity_type="learning_task",
                entity_id=task_id,
                field=sorted(unknown)[0],
            )
        _validate_completion_fields(completion_fields, task_id)
    if to_status == "延期" and revised_due_date is not None:
        if not isinstance(revised_due_date, str):
            raise InvalidStatusReason(
                "revised_due_date must be an ISO date",
                entity_id=task_id,
                field="revised_due_date",
            )
        try:
            date.fromisoformat(revised_due_date)
        except ValueError as exc:
            raise InvalidStatusReason(
                "revised_due_date must be an ISO date",
                entity_id=task_id,
                field="revised_due_date",
            ) from exc

    # Fingerprint stays identical to the pre-#150 shape for requests without a
    # completion payload, so recorded keys replay instead of false-conflicting.
    fp_parts: list[object] = [to_status, reason]
    if completion_fields:
        fp_parts.append(completion_fields)
    fingerprint = _transition_fingerprint(*fp_parts)
    with connection.transaction():
        owned = connection.execute(
            """
            SELECT lt.id
            FROM learning_task lt
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE lt.id = %s AND agp.member_id = %s
            FOR UPDATE OF lt
            """,
            (task_id, member_id),
        ).fetchone()
        if owned is None:
            raise PermissionError("learning task does not belong to member")
        task_row = connection.execute(
            f"SELECT {_TASK_COLUMNS} FROM learning_task WHERE id = %s",
            (task_id,),
        ).fetchone()
        assert task_row is not None
        current = _learning_task_row(task_row)

        # Idempotent replay: same request key + same payload returns the
        # current task state; same key + different payload conflicts.
        if idempotency_key is not None:
            existing = connection.execute(
                """
                SELECT fingerprint FROM task_transition_history
                WHERE learning_task_id = %s AND request_key = %s
                """,
                (task_id, idempotency_key),
            ).fetchone()
            if existing is not None:
                if existing[0] == fingerprint:
                    return current
                raise TransitionIdempotencyConflict(
                    "idempotency key reused with a different payload",
                    entity_id=task_id,
                    field="idempotency_key",
                )

        from_status = str(current["status"])
        if (
            expected_revision is not None
            and int(current["revision"]) != expected_revision
        ):
            raise TaskRevisionConflict(
                "learning task revision conflict",
                entity_id=task_id,
                field="revision",
            )
        if to_status not in _TASK_TRANSITIONS.get(from_status, set()):
            raise InvalidTaskTransition(
                f"transition from '{from_status}' to '{to_status}' is not allowed",
                entity_id=task_id,
                field="status",
            )
        reason_field = _STATUS_REASON_FIELDS.get(to_status)
        if reason_field is not None:
            if not isinstance(reason, str) or not reason.strip():
                raise InvalidStatusReason(
                    f"{reason_field} is required",
                    entity_id=task_id,
                    field=reason_field,
                )

        side_effects: dict[str, object] = {}
        if reason_field is not None:
            side_effects[reason_field] = reason
        if to_status == "进行中" and current["actual_started_at"] is None:
            side_effects["actual_started_at"] = _now(connection)
        if to_status == "已完成":
            if completion_fields:
                # Write the retrospective first (same transaction): the gate
                # below then judges the effective post-write state, and any
                # gate failure rolls this write back with everything else.
                columns = list(completion_fields.keys())
                set_clause = ", ".join(f"{column} = %s" for column in columns)
                connection.execute(
                    f"UPDATE learning_task SET {set_clause} WHERE id = %s",
                    [*completion_fields.values(), task_id],
                )
            _check_completion_gate(connection, task_id)
            side_effects["actual_completed_at"] = _now(connection)
            # Atomically archive all approved evidence for this task.
            connection.execute(
                """
                UPDATE evidence
                SET status = '已归档'
                WHERE learning_task_id = %s AND status = '通过'
                """,
                (task_id,),
            )
        if to_status == "延期" and revised_due_date is not None:
            side_effects["revised_due_date"] = revised_due_date
        side_effects["status"] = to_status

        columns = list(side_effects.keys())
        set_clause = ", ".join(f"{column} = %s" for column in columns)
        values = [side_effects[column] for column in columns]
        values.append(task_id)
        connection.execute(
            f"UPDATE learning_task SET {set_clause}, revision = revision + 1 "
            f"WHERE id = %s",
            values,
        )
        connection.execute(
            """
            INSERT INTO task_transition_history (
                learning_task_id, from_status, to_status, reason, actor_id,
                occurred_at, request_key, fingerprint
            )
            VALUES (%s, %s, %s, %s, %s, NOW(), %s, %s)
            """,
            (
                task_id,
                from_status,
                to_status,
                reason,
                member_id,
                idempotency_key,
                fingerprint,
            ),
        )
        connection.execute(
            "UPDATE plan_item SET status = %s "
            "WHERE id = (SELECT plan_item_id FROM learning_task WHERE id = %s)",
            (to_status, task_id),
        )
    return _task_row(connection, task_id)


def list_task_transition_history(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> list[dict[str, object]]:
    """Append-only transition audit, Member (owner) scoped."""
    _assert_task_ownership(connection, member_id, task_id)
    rows = connection.execute(
        """
        SELECT id, learning_task_id, from_status, to_status, reason, actor_id,
               occurred_at, request_key
        FROM task_transition_history
        WHERE learning_task_id = %s
        ORDER BY id
        """,
        (task_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "learning_task_id": row[1],
            "from_status": row[2],
            "to_status": row[3],
            "reason": row[4],
            "actor_id": row[5],
            "occurred_at": row[6],
            "request_key": row[7],
        }
        for row in rows
    ]


_LOG_COLUMNS = (
    "id, task_id, record_date, actual_hours, note, recorder_id, created_at, "
    "invalidated_at, invalidated_by, correction_of_log_id, idempotency_key"
)


def _progress_log_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "task_id": row[1],
        "record_date": row[2],
        "actual_hours": row[3],
        "note": row[4],
        "recorder_id": row[5],
        "created_at": row[6],
        "invalidated_at": row[7],
        "invalidated_by": row[8],
        "correction_of_log_id": row[9],
        "idempotency_key": row[10],
    }


def _assert_task_ownership(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> None:
    owned = connection.execute(
        """
        SELECT lt.id
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.id = %s AND agp.member_id = %s
        """,
        (task_id, member_id),
    ).fetchone()
    if owned is None:
        raise PermissionError("learning task does not belong to member")


def _validate_actual_hours(value: object) -> int:
    try:
        hours = int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError) as exc:
        raise LogValidationError(
            "actual_hours must be an integer between 1 and 24", field="actual_hours"
        ) from exc
    if not 1 <= hours <= _MAX_LOG_HOURS_PER_ENTRY:
        raise LogValidationError(
            "actual_hours must be an integer between 1 and 24", field="actual_hours"
        )
    return hours


def _aggregate_task_actual_hours(connection: psycopg.Connection, task_id: int) -> int:
    row = connection.execute(
        """
        SELECT COALESCE(SUM(actual_hours), 0)
        FROM learning_progress_log
        WHERE task_id = %s AND invalidated_at IS NULL
        """,
        (task_id,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _refresh_task_actual_hours(connection: psycopg.Connection, task_id: int) -> None:
    connection.execute(
        "UPDATE learning_task SET actual_hours = %s WHERE id = %s",
        (_aggregate_task_actual_hours(connection, task_id), task_id),
    )


def _lock_task_for_execution(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> tuple[str, int]:
    """FOR UPDATE on the task row; returns (status, revision)."""
    row = connection.execute(
        """
        SELECT lt.status, lt.revision
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.id = %s AND agp.member_id = %s
        FOR UPDATE OF lt
        """,
        (task_id, member_id),
    ).fetchone()
    if row is None:
        raise PermissionError("learning task does not belong to member")
    return str(row[0]), int(row[1])


def create_progress_log(
    connection: psycopg.Connection,
    member_id: int,
    task_id: int,
    record_date: str,
    actual_hours: object,
    note: object,
    idempotency_key: str | None = None,
    correction_of_log_id: object = None,
) -> dict[str, object]:
    """Append-only log entry; actual_hours re-aggregates in the same
    transaction.  Same idempotency key + same payload replays the original
    log; a reused key with a different payload is a 409.  Corrections arrive
    as a new log referencing the voided one via correction_of_log_id."""
    try:
        parsed_date = date.fromisoformat(str(record_date))
    except (TypeError, ValueError) as exc:
        raise LogValidationError(
            "record_date must be an ISO date", field="record_date"
        ) from exc
    if parsed_date > date.today():
        raise LogValidationError(
            "record_date must not be in the future", field="record_date"
        )
    hours = _validate_actual_hours(actual_hours)

    correction_id: int | None = None
    if correction_of_log_id is not None:
        try:
            correction_id = int(correction_of_log_id)  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise LogValidationError(
                "correction_of_log_id must be an integer",
                field="correction_of_log_id",
            ) from exc

    with connection.transaction():
        status, _ = _lock_task_for_execution(connection, member_id, task_id)
        if status not in ("进行中", "延期"):
            raise PlanningDomainError(
                f"logs require task status 进行中/延期, got '{status}'",
                code="invalid_task_state_for_log",
                entity_type="learning_task",
                entity_id=task_id,
                field="status",
            )
        if correction_id is not None:
            voided = connection.execute(
                """
                SELECT lpl.task_id, lpl.invalidated_at
                FROM learning_progress_log lpl
                JOIN learning_task lt ON lt.id = lpl.task_id
                JOIN plan_item pi ON pi.id = lt.plan_item_id
                JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
                WHERE lpl.id = %s AND agp.member_id = %s
                """,
                (correction_id, member_id),
            ).fetchone()
            if voided is None or voided[1] is None:
                raise LogValidationError(
                    "correction_of_log_id must reference a voided log of this task",
                    field="correction_of_log_id",
                )
            if int(voided[0]) != task_id:
                raise LogValidationError(
                    "correction_of_log_id must belong to the same task",
                    field="correction_of_log_id",
                )
        if idempotency_key is not None:
            # Idempotency is scoped to (task, key): a key must never replay or
            # collide with a log of another task or member, and the full
            # payload (record_date/hours/note/recorder/correction) must match.
            existing = connection.execute(
                "SELECT id FROM learning_progress_log "
                "WHERE idempotency_key = %s AND task_id = %s",
                (idempotency_key, task_id),
            ).fetchone()
            if existing is not None:
                row = connection.execute(
                    f"SELECT {_LOG_COLUMNS} FROM learning_progress_log WHERE id = %s",
                    (existing[0],),
                ).fetchone()
                assert row is not None
                original = _progress_log_row(row)
                if (
                    str(original["record_date"]) == str(parsed_date)
                    and int(original["actual_hours"]) == hours
                    and original["note"] == note
                    and int(original["recorder_id"]) == member_id
                    and original["correction_of_log_id"] == correction_id
                ):
                    return original
                raise LogIdempotencyConflict(
                    "idempotency key reused with a different payload",
                    entity_id=existing[0],
                    field="idempotency_key",
                )

        row = connection.execute(
            f"""
            INSERT INTO learning_progress_log (
                task_id, record_date, actual_hours, note, recorder_id,
                idempotency_key, correction_of_log_id
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            RETURNING {_LOG_COLUMNS}
            """,
            (
                task_id,
                str(parsed_date),
                hours,
                note,
                member_id,
                idempotency_key,
                correction_id,
            ),
        ).fetchone()
        assert row is not None
        _refresh_task_actual_hours(connection, task_id)
    return _progress_log_row(row)


def list_progress_logs(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> list[dict[str, object]]:
    _assert_task_ownership(connection, member_id, task_id)
    rows = connection.execute(
        f"""
        SELECT {_LOG_COLUMNS}
        FROM learning_progress_log
        WHERE task_id = %s
        ORDER BY record_date DESC, id DESC
        """,
        (task_id,),
    ).fetchall()
    return [_progress_log_row(row) for row in rows]


def _get_progress_log_for_member(
    connection: psycopg.Connection, member_id: int, log_id: int
) -> tuple[dict[str, object], int] | None:
    row = connection.execute(
        f"""
        SELECT {_prefixed(_LOG_COLUMNS, "lpl")}, agp.member_id
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lpl.id = %s
        """,
        (log_id,),
    ).fetchone()
    if row is None:
        return None
    log = _progress_log_row(row[:11])
    task_owner_id = int(row[11])
    return log, task_owner_id


def invalidate_progress_log(
    connection: psycopg.Connection,
    member_id: int,
    log_id: int,
    idempotency_key: str | None = None,
) -> dict[str, object]:
    """Append-only correction: the log is voided (never deleted) and
    actual_hours re-aggregates in the same transaction."""
    with connection.transaction():
        row = connection.execute(
            """
            SELECT lpl.id, lpl.recorder_id, lpl.invalidated_at, agp.member_id,
                   lpl.task_id
            FROM learning_progress_log lpl
            JOIN learning_task lt ON lt.id = lpl.task_id
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE lpl.id = %s
            FOR UPDATE OF lpl
            """,
            (log_id,),
        ).fetchone()
        if row is None:
            raise KeyError("progress log not found")
        log_id, recorder_id, invalidated_at, task_owner_id, task_id = row
        if int(recorder_id) != member_id or int(task_owner_id) != member_id:
            raise PermissionError("progress log does not belong to member")
        if idempotency_key is not None and invalidated_at is not None:
            # Idempotent replay of an already-voided log.
            updated = connection.execute(
                f"SELECT {_LOG_COLUMNS} FROM learning_progress_log WHERE id = %s",
                (log_id,),
            ).fetchone()
            assert updated is not None
            return _progress_log_row(updated)
        connection.execute(
            """
            UPDATE learning_progress_log
            SET invalidated_at = NOW(), invalidated_by = %s
            WHERE id = %s
            """,
            (member_id, log_id),
        )
        _refresh_task_actual_hours(connection, int(task_id))
    row = connection.execute(
        f"SELECT {_LOG_COLUMNS} FROM learning_progress_log WHERE id = %s",
        (log_id,),
    ).fetchone()
    assert row is not None
    return _progress_log_row(row)


def get_monthly_hours(
    connection: psycopg.Connection, member_id: int, year: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT EXTRACT(MONTH FROM lpl.record_date)::INT AS month,
               SUM(lpl.actual_hours) AS total_hours
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
          AND EXTRACT(YEAR FROM lpl.record_date) = %s
        GROUP BY month
        ORDER BY month
        """,
        (member_id, year),
    ).fetchall()
    return [
        {"month": row[0], "total_hours": int(row[1]) if row[1] is not None else 0}
        for row in rows
    ]


_MONTHLY_REVIEW_FIELDS = ("main_output", "problems", "next_month_focus", "notes")
_MAX_MONTHLY_REVIEW_FIELD_LENGTH = 3000


def _monthly_review_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "month": row[3],
        "revision": row[4],
        "main_output": row[5],
        "problems": row[6],
        "next_month_focus": row[7],
        "notes": row[8],
        "created_at": row[9],
        "updated_at": row[10],
    }


def _monthly_review_history_rows(
    connection: psycopg.Connection, monthly_review_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT revision, main_output, problems, next_month_focus, notes,
               changed_by, changed_at
        FROM monthly_review_history
        WHERE monthly_review_id = %s
        ORDER BY revision
        """,
        (monthly_review_id,),
    ).fetchall()
    return [
        {
            "revision": row[0],
            "main_output": row[1],
            "problems": row[2],
            "next_month_focus": row[3],
            "notes": row[4],
            "changed_by": row[5],
            "changed_at": row[6],
        }
        for row in rows
    ]


def get_monthly_review(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    month: int,
    scope: str = "本人",
) -> dict[str, object]:
    """Monthly Review for one (member, year, month).

    Summary values are computed from the detail rows inside the same
    transaction, so summary and details reconcile exactly.  ``scope`` is
    the permission scope/source resolved by the API layer (Member self,
    assigned Buddy, team Leader).
    """
    now = _now(connection)
    items = plan_items_in_month(connection, member_id, year, month)
    # Issue #86: hours belong to the log's record_date month.  Tasks planned
    # in another month but logged in this one surface as traceable
    # occurrence rows (planned_in_month=False, carrying their own
    # plan_month) — never dropped, never disguised as planned here.
    occurrence_items = logged_tasks_in_month(connection, member_id, year, month)
    task_ids = [
        int(d["task_id"])
        for d in (*items, *occurrence_items)
        if d["task_id"] is not None
    ]
    hours_by_task = valid_hours_by_task(connection, task_ids, year, month)

    def _detail_row(
        d: dict[str, object], *, planned_in_month: bool
    ) -> dict[str, object]:
        return {
            "plan_item_id": d["plan_item_id"],
            "task_id": d["task_id"],
            "l3_code": d["l3_code"],
            "status": d["status"],
            "estimated_hours": d["estimated_hours"],
            "estimated_hours_parsed": parse_estimated_hours(
                d["estimated_hours"]
            ).as_dict(),
            "actual_hours": (
                hours_by_task.get(int(d["task_id"]), 0)
                if d["task_id"] is not None
                else 0
            ),
            "planned_in_month": planned_in_month,
            "plan_month": month if planned_in_month else d["plan_month"],
        }

    planned_rows = [_detail_row(d, planned_in_month=True) for d in items]
    details = planned_rows + [
        _detail_row(d, planned_in_month=False) for d in occurrence_items
    ]
    planned = len(planned_rows)
    completed = sum(1 for d in planned_rows if d["status"] == "已完成")
    summary = {
        "planned_count": planned,
        "completed_count": completed,
        "in_progress_count": sum(1 for d in planned_rows if d["status"] == "进行中"),
        "delayed_count": sum(1 for d in planned_rows if d["status"] == "延期"),
        "paused_count": sum(1 for d in planned_rows if d["status"] == "暂停"),
        "cancelled_count": sum(1 for d in planned_rows if d["status"] == "取消"),
        "completion_rate": completed / planned if planned else 0,
        "actual_hours": sum(int(d["actual_hours"]) for d in details),
        "estimated_hours_summary": summarize_estimated_hours(
            [d["estimated_hours"] for d in planned_rows]
        ),
    }

    written: dict[str, object] | None = None
    history: list[dict[str, object]] = []
    written_row = connection.execute(
        """
        SELECT id, member_id, year, month, revision, main_output, problems,
               next_month_focus, notes, created_at, updated_at
        FROM monthly_review
        WHERE member_id = %s AND year = %s AND month = %s
        """,
        (member_id, year, month),
    ).fetchone()
    if written_row is not None:
        written = _monthly_review_row(written_row)
        history = _monthly_review_history_rows(connection, int(written_row[0]))

    return {
        "summary": summary,
        "details": details,
        "written": written,
        "history": history,
        "meta": {
            "year": year,
            "scope": scope,
            "as_of": _serialize_datetime(now),
            "source": "monthly_review.v1",
        },
    }


def upsert_monthly_review(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    month: int,
    fields: dict[str, object],
    *,
    expected_revision: int,
) -> dict[str, object]:
    """Create or CAS-update the Member's monthly review.

    Every successful write appends an immutable history row (revision 1 on
    create, N+1 on update).  Stale revisions and validation failures raise
    before any write; the request-scoped transaction rolls back anything
    touched, so failures are zero partial writes.  Concurrent first creates
    are arbitrated by the unique index: the losing INSERT ... ON CONFLICT
    DO NOTHING re-locks the winning row and raises the revision-conflict
    contract instead of a bare UNIQUE violation.
    """
    if month < 1 or month > 12:
        raise PlanningDomainError(
            "month must be between 1 and 12",
            code="monthly_review_validation_error",
            entity_type="monthly_review",
            field="month",
        )
    clean: dict[str, str | None] = {}
    for name in _MONTHLY_REVIEW_FIELDS:
        value = fields.get(name)
        if value is not None and (
            not isinstance(value, str) or len(value) > _MAX_MONTHLY_REVIEW_FIELD_LENGTH
        ):
            raise PlanningDomainError(
                f"{name} must be a string of at most "
                f"{_MAX_MONTHLY_REVIEW_FIELD_LENGTH} characters",
                code="monthly_review_validation_error",
                entity_type="monthly_review",
                field=name,
            )
        clean[name] = value

    row = connection.execute(
        """
        SELECT id, revision
        FROM monthly_review
        WHERE member_id = %s AND year = %s AND month = %s
        FOR UPDATE
        """,
        (member_id, year, month),
    ).fetchone()

    def _conflict(current: int) -> PlanningDomainError:
        return PlanningDomainError(
            "monthly review revision mismatch: "
            f"expected {expected_revision}, current {current}",
            code="monthly_review_revision_conflict",
            entity_type="monthly_review",
            entity_id=row[0] if row is not None else None,
            field="revision",
        )

    if row is None:
        if expected_revision != 0:
            raise _conflict(0)
        written_row = connection.execute(
            """
            INSERT INTO monthly_review
                (member_id, year, month, revision, main_output, problems,
                 next_month_focus, notes)
            VALUES (%s, %s, %s, 1, %s, %s, %s, %s)
            ON CONFLICT (member_id, year, month) DO NOTHING
            RETURNING id, member_id, year, month, revision, main_output,
                      problems, next_month_focus, notes, created_at, updated_at
            """,
            (
                member_id,
                year,
                month,
                clean["main_output"],
                clean["problems"],
                clean["next_month_focus"],
                clean["notes"],
            ),
        ).fetchone()
        if written_row is None:
            # A concurrent first create committed between our SELECT and
            # INSERT (the SELECT ... FOR UPDATE above locks only existing
            # rows).  The unique index arbitration is the write barrier:
            # re-lock the winning row and surface the CAS contract instead
            # of letting the UNIQUE violation escape as a 500.
            row = connection.execute(
                """
                SELECT id, revision
                FROM monthly_review
                WHERE member_id = %s AND year = %s AND month = %s
                FOR UPDATE
                """,
                (member_id, year, month),
            ).fetchone()
            raise _conflict(int(row[1]) if row is not None else 0)
        connection.execute(
            """
            INSERT INTO monthly_review_history
                (monthly_review_id, revision, main_output, problems,
                 next_month_focus, notes, changed_by)
            VALUES (%s, 1, %s, %s, %s, %s, %s)
            """,
            (
                written_row[0],
                clean["main_output"],
                clean["problems"],
                clean["next_month_focus"],
                clean["notes"],
                member_id,
            ),
        )
    else:
        current_revision = int(row[1])
        if current_revision != expected_revision:
            raise _conflict(current_revision)
        new_revision = current_revision + 1
        connection.execute(
            """
            INSERT INTO monthly_review_history
                (monthly_review_id, revision, main_output, problems,
                 next_month_focus, notes, changed_by)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
            """,
            (
                row[0],
                new_revision,
                clean["main_output"],
                clean["problems"],
                clean["next_month_focus"],
                clean["notes"],
                member_id,
            ),
        )
        written_row = connection.execute(
            """
            UPDATE monthly_review
            SET revision = %s, main_output = %s, problems = %s,
                next_month_focus = %s, notes = %s, updated_at = NOW()
            WHERE id = %s
            RETURNING id, member_id, year, month, revision, main_output,
                      problems, next_month_focus, notes, created_at, updated_at
            """,
            (
                new_revision,
                clean["main_output"],
                clean["problems"],
                clean["next_month_focus"],
                clean["notes"],
                row[0],
            ),
        ).fetchone()
        assert written_row is not None

    written = _monthly_review_row(written_row)
    return {
        "written": written,
        "history": _monthly_review_history_rows(connection, int(written_row[0])),
    }


def get_member_dashboard(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object]:
    """Return the Member-only, read-only aggregation used by UI-01."""
    now = _now(connection)
    current_month = now.month

    # Latest assessment of the year (including draft) drives the dashboard stage.
    latest_assessment_row = connection.execute(
        """
        SELECT id, status, submitted_at, archived_at,
               member_current_level_snapshot, member_target_level_snapshot
        FROM assessment
        WHERE member_id = %s AND year = %s
        ORDER BY created_at DESC, id DESC
        LIMIT 1
        """,
        (member_id, year),
    ).fetchone()
    latest_assessment: dict[str, object] | None = None
    if latest_assessment_row is not None:
        latest_assessment = {
            "id": latest_assessment_row[0],
            "status": latest_assessment_row[1],
            "submitted_at": _serialize_datetime(latest_assessment_row[2]),
            "archived_at": _serialize_datetime(latest_assessment_row[3]),
            "member_current_level_snapshot": latest_assessment_row[4],
            "member_target_level_snapshot": latest_assessment_row[5],
        }

    # Latest submitted assessment of the year feeds the radar and Gap list.
    submitted_assessment_row = connection.execute(
        """
        SELECT id
        FROM assessment
        WHERE member_id = %s AND year = %s
          AND status IN ('待复核', '已复核', '建议调整', '已归档')
        ORDER BY submitted_at DESC NULLS LAST, id DESC
        LIMIT 1
        """,
        (member_id, year),
    ).fetchone()
    submitted_assessment_id = (
        submitted_assessment_row[0] if submitted_assessment_row else None
    )

    # Latest review for the latest assessment (may be pending or closed).
    review_status: str | None = None
    review_conclusion: str | None = None
    if latest_assessment is not None:
        review_row = connection.execute(
            """
            SELECT status, conclusion
            FROM assessment_review
            WHERE assessment_id = %s
            ORDER BY sequence DESC, id DESC
            LIMIT 1
            """,
            (latest_assessment["id"],),
        ).fetchone()
        if review_row is not None:
            review_status = review_row[0]
            review_conclusion = review_row[1]

    # Staged self-assessment follow-up (#81 round 1): the four personal-
    # workspace categories derived from the latest assessment of the year.
    # required_incomplete blocks submission (草稿/建议调整 only); unassessed
    # ADVANCED items are "complete later" work; positive-gap items not
    # selected into the plan are the growth backlog waiting for planning;
    # review_return covers 待复核/建议调整 (review or return work).
    follow_up: dict[str, object] = {
        "assessment_id": None,
        "assessment_status": None,
        "required_incomplete": 0,
        "advanced_unassessed": 0,
        "gaps_waiting_planning": 0,
        "review_return": False,
    }
    if latest_assessment is not None:
        follow_up["assessment_id"] = latest_assessment["id"]
        follow_up["assessment_status"] = latest_assessment["status"]
        follow_up["review_return"] = latest_assessment["status"] in (
            "待复核",
            "建议调整",
        )
        follow_up_rows = connection.execute(
            """
            SELECT scope_type, current_level, target_level, gap_value,
                   include_in_plan
            FROM assessment_detail
            WHERE assessment_id = %s
            """,
            (latest_assessment["id"],),
        ).fetchall()
        required_incomplete = 0
        advanced_unassessed = 0
        gaps_waiting = 0
        for (
            scope_type,
            current_level,
            target_level,
            gap_value,
            include_in_plan,
        ) in follow_up_rows:
            if scope_type == "target_progressive":
                if current_level is None:
                    advanced_unassessed += 1
                continue
            # current_required, or legacy rows without a scope snapshot.
            if current_level is None or target_level is None:
                required_incomplete += 1
            if (
                gap_value is not None
                and int(gap_value) > 0
                and include_in_plan is not True
            ):
                gaps_waiting += 1
        follow_up["required_incomplete"] = required_incomplete
        follow_up["advanced_unassessed"] = advanced_unassessed
        follow_up["gaps_waiting_planning"] = gaps_waiting

    # Applicable completion of the current (latest) assessment: of the
    # detail rows it carries, how many carry a valid current_level (0–5).
    # Issue #61 defines current_level 0–5 as valid and NULL as unassessed, so
    # a row with current_level=0 is filled, not lost by a target comparison.
    applicable_completion: dict[str, object] = {
        "total": 0,
        "completed": 0,
        "ratio": 0,
    }
    if latest_assessment is not None:
        completion_row = connection.execute(
            """
            SELECT COUNT(*),
                   COUNT(*) FILTER (WHERE current_level IS NOT NULL)
            FROM assessment_detail
            WHERE assessment_id = %s
            """,
            (latest_assessment["id"],),
        ).fetchone()
        if completion_row is not None:
            total = int(completion_row[0])
            completed = int(completion_row[1])
            applicable_completion = {
                "total": total,
                "completed": completed,
                "ratio": completed / total if total else 0,
            }

    # Annual plan status for the year.
    annual_plan_status_row = connection.execute(
        """
        SELECT status
        FROM annual_growth_plan
        WHERE member_id = %s AND year = %s
        LIMIT 1
        """,
        (member_id, year),
    ).fetchone()
    annual_plan_status = annual_plan_status_row[0] if annual_plan_status_row else None

    total_hours_row = connection.execute(
        """
        SELECT COALESCE(SUM(lpl.actual_hours), 0)
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchone()
    current_month_hours_row = connection.execute(
        """
        SELECT COALESCE(SUM(lpl.actual_hours), 0)
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
          AND agp.year = %s
          AND EXTRACT(MONTH FROM lpl.record_date) = %s
        """,
        (member_id, year, current_month),
    ).fetchone()
    plan_hours_rows = connection.execute(
        """
        SELECT pi.estimated_hours, pi.target_month
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchall()
    annual_hours = summarize_estimated_hours(
        [row[0] if isinstance(row[0], str) else None for row in plan_hours_rows]
    )
    current_month_hours = summarize_estimated_hours(
        [
            row[0] if isinstance(row[0], str) else None
            for row in plan_hours_rows
            if row[1] == current_month
        ]
    )
    completed_row = connection.execute(
        """
        SELECT COUNT(*)
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s AND lt.status = '已完成'
        """,
        (member_id, year),
    ).fetchone()
    pending_evidence_row = connection.execute(
        """
        SELECT COUNT(*) FILTER (
                   WHERE e.status IN ('草稿', '需补充')
                     AND NOT EXISTS (
                         SELECT 1 FROM evidence superseding
                         WHERE superseding.supersedes_evidence_id = e.id
                     )
               ),
               COUNT(*) FILTER (
                   WHERE e.status = '待 Review'
                     AND NOT EXISTS (
                         SELECT 1 FROM evidence superseding
                         WHERE superseding.supersedes_evidence_id = e.id
                     )
               )
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchone()
    score_rows = connection.execute(
        """
        SELECT SUBSTRING(ad.l3_code FROM 1 FOR 3),
               ROUND(AVG(ad.current_level))::INT
        FROM assessment_detail ad
        WHERE ad.assessment_id = %s
        GROUP BY SUBSTRING(ad.l3_code FROM 1 FOR 3)
        """,
        (submitted_assessment_id,),
    ).fetchall()
    scores = {str(row[0]): int(row[1]) for row in score_rows}
    progress_rows = connection.execute(
        """
        SELECT pi.status, COUNT(*)
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        GROUP BY pi.status
        """,
        (member_id, year),
    ).fetchall()
    progress = {str(row[0]): int(row[1]) for row in progress_rows}
    current_tasks = [
        task
        for task in list_learning_tasks(connection, member_id)
        if task["status"] not in {"已完成", "取消"}
    ]

    # Gaps come from the latest submitted assessment, not limited to plan_candidate.
    # Each gap carries its scope split (current_required vs target_progressive):
    # scope-v1 snapshots store scope_type on the assessment detail; legacy
    # details (NULL scope_type) fall back to the grade mapping of the gap's
    # target against the member's current grade.
    gaps: list[dict[str, object]] = []
    legacy_gap_scope = False
    if submitted_assessment_id is not None:
        gap_rows = connection.execute(
            """
            SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
                   g.target_level, g.gap_value, g.priority, ad.scope_type
            FROM gap g
            LEFT JOIN assessment_detail ad
              ON ad.assessment_id = g.assessment_id AND ad.l3_code = g.l3_code
            WHERE g.assessment_id = %s
            ORDER BY g.l3_code
            """,
            (submitted_assessment_id,),
        ).fetchall()
        member_grade_level = grade_to_level(
            latest_assessment.get("member_current_level_snapshot")
            if latest_assessment is not None
            else None
        )
        if member_grade_level is None:
            member_level_row = connection.execute(
                "SELECT current_level FROM tcp_user WHERE id = %s",
                (member_id,),
            ).fetchone()
            member_grade_level = (
                grade_to_level(member_level_row[0])
                if member_level_row is not None
                else None
            )
        for row in gap_rows:
            scope_type = row[7]
            if scope_type is None:
                legacy_gap_scope = True
                scope_type = (
                    "target_progressive"
                    if member_grade_level is not None
                    and int(row[4]) > member_grade_level
                    else "current_required"
                )
            gaps.append(
                {
                    "id": row[0],
                    "assessment_id": row[1],
                    "l3_code": row[2],
                    "current_level": row[3],
                    "target_level": row[4],
                    "gap_value": row[5],
                    "priority": row[6],
                    "plan_candidate": False,
                    "scope_type": scope_type,
                }
            )

    contexts = get_l3_contexts(
        connection,
        [str(item["l3_code"]) for item in [*gaps, *current_tasks]],
    )
    for item in [*gaps, *current_tasks]:
        item.update(contexts[str(item["l3_code"])])

    assessment_out: dict[str, object] | None = None
    if latest_assessment is not None:
        assessment_out = {
            **latest_assessment,
            "review_status": review_status,
            "review_conclusion": review_conclusion,
            "applicable_completion": applicable_completion,
        }

    # Current-month block: shared aggregation layer over plan_month, the six
    # states, latest-version pending evidence, and valid logs of the month.
    month_items = plan_items_in_month(connection, member_id, year, current_month)
    month_task_ids = [
        int(d["task_id"]) for d in month_items if d["task_id"] is not None
    ]
    month_hours = valid_hours_by_task(connection, month_task_ids, year, current_month)
    month_plan_item_ids = [int(d["plan_item_id"]) for d in month_items]
    pending_evidence_plan_item_ids: set[int] = set()
    if month_plan_item_ids:
        pending_evidence_rows = connection.execute(
            """
            SELECT DISTINCT lt.plan_item_id
            FROM evidence e
            JOIN learning_task lt ON lt.id = e.learning_task_id
            WHERE lt.plan_item_id = ANY(%s)
              AND e.status IN ('草稿', '需补充')
              AND NOT EXISTS (
                  SELECT 1 FROM evidence superseding
                  WHERE superseding.supersedes_evidence_id = e.id
              )
            """,
            (month_plan_item_ids,),
        ).fetchall()
        pending_evidence_plan_item_ids = {int(row[0]) for row in pending_evidence_rows}
    current_month_out = {
        "planned_count": len(month_plan_item_ids),
        "planned_ids": month_plan_item_ids,
        "in_progress_count": sum(1 for d in month_items if d["status"] == "进行中"),
        "delayed_count": sum(1 for d in month_items if d["status"] == "延期"),
        "pending_evidence_count": len(
            pending_evidence_plan_item_ids & set(month_plan_item_ids)
        ),
        "actual_hours": sum(
            month_hours.get(int(d["task_id"]), 0)
            for d in month_items
            if d["task_id"] is not None
        ),
    }

    # Fixed decision chain — the next action is never derived from invented
    # priorities (gaps keep exactly the Member's own priority input).
    next_action: dict[str, object] = {
        "action_key": "none",
        "message": "当前没有需要处理的事项",
        "count": 0,
    }
    if latest_assessment is not None and latest_assessment["status"] == "草稿":
        next_action = {
            "action_key": "complete_assessment",
            "message": "完成并提交当前年度的能力评估",
            "count": 1,
        }
    elif review_status == "待复核":
        next_action = {
            "action_key": "await_buddy_review",
            "message": "等待 Buddy 复核当前评估",
            "count": 1,
        }
    elif (
        latest_assessment is not None and latest_assessment["status"] == "建议调整"
    ) or review_conclusion == "建议调整":
        next_action = {
            "action_key": "revise_assessment",
            "message": "按复核意见调整当前评估",
            "count": 1,
        }
    elif (
        pending_evidence_to_submit := (
            int(pending_evidence_row[0]) if pending_evidence_row else 0
        )
    ) > 0:
        next_action = {
            "action_key": "submit_evidence",
            "message": "提交待提交的学习证据",
            "count": pending_evidence_to_submit,
        }
    elif progress.get("延期", 0) > 0:
        next_action = {
            "action_key": "handle_delayed",
            "message": "处理延期的计划项",
            "count": progress.get("延期", 0),
        }
    elif any(g.get("priority") is None for g in gaps):
        next_action = {
            "action_key": "set_priorities",
            "message": "为差距项设置优先级",
            "count": sum(1 for g in gaps if g.get("priority") is None),
        }

    gap_summary = {
        "current_required": sum(
            1 for g in gaps if g["scope_type"] == "current_required"
        ),
        "target_progressive": sum(
            1 for g in gaps if g["scope_type"] == "target_progressive"
        ),
        "derivation": "legacy_fallback" if legacy_gap_scope else "scope_v1",
    }

    return {
        "meta": {
            "year": year,
            "scope": "本人",
            "as_of": _serialize_datetime(now),
            "source": "member_dashboard.v1",
            "denominator_source": (
                "assessment_details"
                if submitted_assessment_id is not None
                else "planned_items"
            ),
        },
        "year": year,
        "assessment": assessment_out,
        "annual_plan_status": annual_plan_status,
        "follow_up": follow_up,
        "summary": {
            "annual_actual_hours": int(total_hours_row[0]) if total_hours_row else 0,
            "annual_planned_hours": annual_hours["min_hours"] or 0,
            "annual_planned_hours_min": annual_hours["min_hours"],
            "annual_planned_hours_max": annual_hours["max_hours"],
            "annual_planned_hours_has_values": annual_hours["has_values"],
            "annual_planned_hours_has_unparsed": annual_hours["has_unparsed"],
            "current_month_actual_hours": (
                int(current_month_hours_row[0]) if current_month_hours_row else 0
            ),
            "current_month_planned_hours": current_month_hours["min_hours"] or 0,
            "current_month_planned_hours_min": current_month_hours["min_hours"],
            "current_month_planned_hours_max": current_month_hours["max_hours"],
            "current_month_planned_hours_has_values": current_month_hours["has_values"],
            "current_month_planned_hours_has_unparsed": current_month_hours[
                "has_unparsed"
            ],
            "completed_task_count": int(completed_row[0]) if completed_row else 0,
            # Two semantically distinct todos; superseded evidence versions are
            # never counted (each chain contributes at most one pending item).
            "pending_evidence_to_submit": (
                int(pending_evidence_row[0]) if pending_evidence_row else 0
            ),
            "pending_evidence_to_review": (
                int(pending_evidence_row[1]) if pending_evidence_row else 0
            ),
        },
        "plan_progress": {
            "total": sum(progress.values()),
            "未开始": progress.get("未开始", 0),
            "进行中": progress.get("进行中", 0),
            "已完成": progress.get("已完成", 0),
            "延期": progress.get("延期", 0),
            "暂停": progress.get("暂停", 0),
            "取消": progress.get("取消", 0),
        },
        "domain_radar": [
            {"domain_code": code, "score": scores.get(code, 0)}
            for code in ("P01", "P02", "P03", "C01", "C02", "C03")
        ],
        "gaps": gaps,
        "gap_summary": gap_summary,
        "current_month": current_month_out,
        "next_action": next_action,
        "current_tasks": current_tasks,
    }


_EVIDENCE_UPDATABLE_FIELDS = {
    "content",
    "evidence_link",
    "description",
    "evidence_type",
    "url",
    "file_reference",
    "file_name",
    "mime_type",
    "file_size",
}

_ALLOWED_EVIDENCE_STATUSES = {
    "草稿",
    "待 Review",
    "通过",
    "需补充",
    "驳回",
    "已归档",
}

_EVIDENCE_COLUMNS = (
    "id, learning_task_id, l3_code, version_number, content, evidence_link, "
    "status, submitted_at, created_at, submitted_by, description, "
    "evidence_type, url, file_reference, file_name, mime_type, file_size, "
    "supersedes_evidence_id, revision"
)


def _evidence_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "learning_task_id": row[1],
        "l3_code": row[2],
        "version_number": row[3],
        "content": row[4],
        "evidence_link": row[5],
        "status": row[6],
        "submitted_at": row[7],
        "created_at": row[8],
        "submitted_by": row[9],
        "description": row[10],
        "evidence_type": row[11],
        "url": row[12],
        "file_reference": row[13],
        "file_name": row[14],
        "mime_type": row[15],
        "file_size": row[16],
        "supersedes_evidence_id": row[17],
        "revision": row[18],
    }


def _assert_evidence_ownership(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object]:
    row = connection.execute(
        f"""
        SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")}
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE e.id = %s AND agp.member_id = %s
        """,
        (evidence_id, member_id),
    ).fetchone()
    if row is None:
        raise PermissionError("evidence does not belong to member")
    return _attach_l3_contexts(connection, [_evidence_row(row)])[0]


def _validate_evidence_metadata(fields: dict[str, object]) -> None:
    evidence_type = fields.get("evidence_type")
    if evidence_type is not None and evidence_type not in ("link", "file"):
        raise EvidenceValidationError(
            "evidence_type must be 'link' or 'file'", field="evidence_type"
        )
    if evidence_type == "link" and not fields.get("url"):
        raise EvidenceValidationError("evidence_type 'link' requires url", field="url")
    if evidence_type == "file" and not fields.get("file_reference"):
        raise EvidenceValidationError(
            "evidence_type 'file' requires file_reference", field="file_reference"
        )
    file_size = fields.get("file_size")
    if file_size is not None:
        try:
            if int(file_size) <= 0:
                raise ValueError
        except (TypeError, ValueError) as exc:
            raise EvidenceValidationError(
                "file_size must be a positive integer", field="file_size"
            ) from exc


def create_evidence_draft(
    connection: psycopg.Connection,
    member_id: int,
    learning_task_id: int,
    content: object,
    evidence_link: object,
    description: object = None,
    evidence_type: object = None,
    url: object = None,
    file_reference: object = None,
    file_name: object = None,
    mime_type: object = None,
    file_size: object = None,
    supersedes_evidence_id: object = None,
) -> dict[str, object]:
    _assert_task_ownership(connection, member_id, learning_task_id)

    with connection.transaction():
        # Lock the task row to serialize concurrent evidence creation
        # for the same task — prevents duplicate drafts, version-number
        # races, and TOCTOU on the task status check.
        task = connection.execute(
            "SELECT l3_code, status FROM learning_task WHERE id = %s FOR UPDATE",
            (learning_task_id,),
        ).fetchone()
        assert task is not None
        l3_code = task[0]
        task_status = str(task[1])
        if task_status in ("已完成", "暂停", "取消"):
            raise EvidenceValidationError(
                "task is completed or closed — "
                "create a new task or change the plan instead",
                entity_id=learning_task_id,
                field="status",
            )
        draft = connection.execute(
            """
            SELECT 1 FROM evidence
            WHERE learning_task_id = %s AND status = '草稿'
            LIMIT 1
            """,
            (learning_task_id,),
        ).fetchone()
        if draft is not None:
            raise EvidenceValidationError(
                "draft evidence already exists for this task",
                entity_id=learning_task_id,
                field="status",
            )

        pending = connection.execute(
            """
            SELECT 1 FROM evidence
            WHERE learning_task_id = %s AND status = '待 Review'
            LIMIT 1
            """,
            (learning_task_id,),
        ).fetchone()
        if pending is not None:
            raise EvidenceValidationError(
                "a pending review round already exists — "
                "wait for the review to conclude",
                entity_id=learning_task_id,
                field="status",
            )

        supersedes: object = None
        if supersedes_evidence_id is not None:
            try:
                supersedes = int(supersedes_evidence_id)  # type: ignore[arg-type]
            except (TypeError, ValueError) as exc:
                raise EvidenceValidationError(
                    "supersedes_evidence_id must be an integer",
                    field="supersedes_evidence_id",
                ) from exc
            superseded = connection.execute(
                """
                SELECT status, learning_task_id FROM evidence WHERE id = %s
                """,
                (supersedes,),
            ).fetchone()
            if superseded is None or int(superseded[1]) != learning_task_id:
                raise EvidenceValidationError(
                    "superseded evidence must belong to the same task",
                    field="supersedes_evidence_id",
                )
            if superseded[0] == "通过":
                raise EvidenceValidationError(
                    "approved evidence is terminal and cannot be superseded",
                    field="supersedes_evidence_id",
                )
            if superseded[0] != "需补充":
                raise EvidenceValidationError(
                    "a new version may only supersede evidence marked 需补充",
                    field="supersedes_evidence_id",
                )

        metadata: dict[str, object] = {
            key: value
            for key, value in {
                "description": description,
                "evidence_type": evidence_type,
                "url": url,
                "file_reference": file_reference,
                "file_name": file_name,
                "mime_type": mime_type,
                "file_size": file_size,
            }.items()
            if value is not None
        }
        _validate_evidence_metadata(metadata)

        max_version = connection.execute(
            """
            SELECT COALESCE(MAX(version_number), 0)
            FROM evidence
            WHERE learning_task_id = %s
            """,
            (learning_task_id,),
        ).fetchone()
        assert max_version is not None
        version_number = int(max_version[0]) + 1

        columns = ", ".join(
            [
                "learning_task_id",
                "l3_code",
                "version_number",
                "content",
                "evidence_link",
                "status",
            ]
            + list(metadata.keys())
        )
        placeholders = ", ".join(["%s"] * (6 + len(metadata)))
        values: list[object] = [
            learning_task_id,
            l3_code,
            version_number,
            content,
            evidence_link,
            "草稿",
        ]
        values.extend(metadata[key] for key in metadata)
        if supersedes is not None:
            columns += ", supersedes_evidence_id"
            placeholders += ", %s"
            values.append(supersedes)

        row = connection.execute(
            f"""
            INSERT INTO evidence ({columns})
            VALUES ({placeholders})
            RETURNING {_EVIDENCE_COLUMNS}
            """,
            values,
        ).fetchone()
        assert row is not None
    return _attach_l3_contexts(connection, [_evidence_row(row)])[0]


def _validate_expected_revision(
    value: object, error_cls: type[PlanningDomainError] = EvidenceValidationError
) -> int:
    """P1: any Member PUT must carry a non-negative integer expected_revision —
    bool, non-integer, negative or missing is a 422 at every layer."""
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        raise error_cls(
            "expected_revision must be a non-negative integer",
            field="expected_revision",
        )
    return value


def update_evidence_draft(
    connection: psycopg.Connection,
    member_id: int,
    evidence_id: int,
    fields: dict[str, object],
    expected_revision: int,
) -> dict[str, object]:
    """CAS update with no bypassable path: expected_revision is required and
    validated at the repository boundary; the row is locked, status/revision
    re-read, and the response is the UPDATE ... RETURNING snapshot captured
    inside the same transaction — never a re-read of a row another concurrent
    operation may have changed."""
    expected_revision = _validate_expected_revision(expected_revision)

    updates: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _EVIDENCE_UPDATABLE_FIELDS:
            raise EvidenceValidationError(
                f"field '{key}' is not updatable",
                entity_id=evidence_id,
                field=key,
            )
        updates[key] = value
    _validate_evidence_metadata(updates)

    with connection.transaction():
        row = connection.execute(
            f"""
            SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")}
            FROM evidence e
            JOIN learning_task lt ON lt.id = e.learning_task_id
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE e.id = %s AND agp.member_id = %s
            FOR UPDATE OF e
            """,
            (evidence_id, member_id),
        ).fetchone()
        if row is None:
            raise PermissionError("evidence does not belong to member")
        evidence = _evidence_row(row)
        if evidence["status"] != "草稿":
            raise EvidenceValidationError(
                "only draft evidence can be updated",
                entity_id=evidence_id,
                field="status",
            )
        if int(evidence["revision"]) != expected_revision:
            raise EvidenceRevisionConflict(
                "evidence revision conflict",
                entity_id=evidence_id,
                field="revision",
            )

        if not updates:
            return _attach_l3_contexts(connection, [evidence])[0]

        columns = list(updates.keys())
        set_clause = ", ".join(f"{col} = %s" for col in columns)
        values = [updates[col] for col in columns]
        values.append(evidence_id)
        updated = connection.execute(
            f"""
            UPDATE evidence
            SET {set_clause}, revision = revision + 1
            WHERE id = %s
            RETURNING {_EVIDENCE_COLUMNS}
            """,
            values,
        ).fetchone()
        assert updated is not None
    # Only read-only L3 context is attached outside the transaction; the
    # mutable evidence row is never re-read for the response.
    return _attach_l3_contexts(connection, [_evidence_row(updated)])[0]


def submit_evidence(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object]:
    """Submit a draft for buddy review.  The task status is untouched — the
    review state lives on the evidence, never on the task (v0010)."""
    with connection.transaction():
        row = connection.execute(
            f"""
            SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")}, lt.status
            FROM evidence e
            JOIN learning_task lt ON lt.id = e.learning_task_id
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE e.id = %s AND agp.member_id = %s
            FOR UPDATE OF e
            """,
            (evidence_id, member_id),
        ).fetchone()
        if row is None:
            raise PermissionError("evidence does not belong to member")
        evidence = _evidence_row(row[:19])
        task_status = str(row[19])
        if evidence["status"] != "草稿":
            raise EvidenceValidationError(
                "only draft evidence can be submitted",
                entity_id=evidence_id,
                field="status",
            )
        if task_status not in ("进行中", "延期"):
            raise PlanningDomainError(
                "evidence submission requires task status 进行中/延期",
                code="invalid_task_state_for_evidence",
                entity_type="learning_task",
                entity_id=int(evidence["learning_task_id"]),
                field="status",
            )
        submitted = connection.execute(
            f"""
            UPDATE evidence
            SET status = '待 Review', submitted_at = NOW(), submitted_by = %s,
                revision = revision + 1
            WHERE id = %s
            RETURNING {_EVIDENCE_COLUMNS}
            """,
            (member_id, evidence_id),
        ).fetchone()
        assert submitted is not None
    return _attach_l3_contexts(connection, [_evidence_row(submitted)])[0]


def list_evidences(
    connection: psycopg.Connection, member_id: int, learning_task_id: int
) -> list[dict[str, object]]:
    _assert_task_ownership(connection, member_id, learning_task_id)
    rows = connection.execute(
        f"""
        SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")}
        FROM evidence e
        WHERE e.learning_task_id = %s
        ORDER BY e.version_number DESC
        """,
        (learning_task_id,),
    ).fetchall()
    return _attach_l3_contexts(connection, [_evidence_row(row) for row in rows])


def get_evidence(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        f"""
        SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")}
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE e.id = %s AND agp.member_id = %s
        """,
        (evidence_id, member_id),
    ).fetchone()
    if row is None:
        return None
    return _attach_l3_contexts(connection, [_evidence_row(row)])[0]


def _evidence_review_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "evidence_id": row[1],
        "buddy_id": row[2],
        "status": row[3],
        "conclusion": row[4],
        "feedback": row[5],
        "reviewed_at": row[6],
        "created_at": row[7],
    }


def list_pending_evidence_reviews_for_buddy(
    connection: psycopg.Connection, buddy_id: int
) -> list[dict[str, object]]:
    """The buddy's pending evidence queue — evidence rows awaiting review for
    members the buddy is currently (and effectively) assigned to."""
    rows = connection.execute(
        f"""
        SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")},
               agp.member_id, u.username
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        JOIN tcp_user u ON u.id = agp.member_id
        JOIN buddy_relationship br
          ON br.member_id = agp.member_id
         AND br.buddy_id = %s
         AND br.is_primary = TRUE
         AND br.effective_to IS NULL
        WHERE e.status = '待 Review'
        ORDER BY e.submitted_at ASC NULLS LAST
        """,
        (buddy_id,),
    ).fetchall()
    items = []
    for row in rows:
        evidence = _evidence_row(row[:19])
        evidence["member_id"] = row[19]
        evidence["username"] = row[20]
        items.append(evidence)
    return _attach_l3_contexts(connection, items)


def get_evidence_review_for_buddy(
    connection: psycopg.Connection, review_id: int, buddy_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT er.id, er.evidence_id, er.buddy_id, er.status, er.conclusion,
               er.feedback, er.reviewed_at, er.created_at,
               e.learning_task_id, e.l3_code, e.version_number,
               e.content, e.evidence_link, agp.member_id
        FROM evidence_review er
        JOIN evidence e ON e.id = er.evidence_id
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE er.id = %s
        """,
        (review_id,),
    ).fetchone()
    if row is None:
        return None
    if int(row[2]) != buddy_id:
        return None
    member_id = int(row[13])
    if not is_member_assigned_to_buddy(connection, member_id, buddy_id):
        return None
    return _attach_l3_contexts(
        connection,
        [
            {
                "id": row[0],
                "evidence_id": row[1],
                "buddy_id": row[2],
                "status": row[3],
                "conclusion": row[4],
                "feedback": row[5],
                "reviewed_at": row[6],
                "created_at": row[7],
                "learning_task_id": row[8],
                "l3_code": row[9],
                "version_number": row[10],
                "content": row[11],
                "evidence_link": row[12],
                "member_id": member_id,
            }
        ],
    )[0]


def _acquire_buddy_relationship_lock(
    connection: psycopg.Connection, member_id: int
) -> None:
    """The shared advisory lock the buddy-relationship write path uses
    (access/repository.create_buddy_relationship).  The evidence-review path
    takes it FIRST, then the evidence row — a relationship switch and a
    review can never interleave.  Extracted as a module function so the
    mutation test can prove the review depends on it."""
    connection.execute(
        "SELECT pg_advisory_xact_lock(hashtext(%s))",
        (f"tcp_buddy_relationship:{member_id}",),
    )


def submit_evidence_review(
    connection: psycopg.Connection,
    evidence_id: int,
    buddy_id: int,
    conclusion: str,
    feedback: object,
    idempotency_key: str | None = None,
) -> dict[str, object]:
    """Append-only evidence review (v0010).

    One immutable review row per evidence version (UNIQUE(evidence_id));
    the evidence status updates in the same transaction.  The task state is
    NOT touched — completion goes through the task transition gate.
    """
    if conclusion not in ("通过", "需补充"):
        raise ReviewValidationError(
            "conclusion must be 通过 or 需补充",
            entity_id=evidence_id,
            field="conclusion",
        )
    if conclusion == "需补充" and (
        not isinstance(feedback, str) or not feedback.strip()
    ):
        raise ReviewValidationError(
            "需补充 requires non-empty feedback",
            entity_id=evidence_id,
            field="feedback",
        )

    with connection.transaction():
        # Lock order (fixed): member buddy-relationship advisory lock FIRST,
        # then the evidence row — the same order create_buddy_relationship
        # uses, so a relationship switch and a review can never interleave.
        member_row = connection.execute(
            """
            SELECT agp.member_id
            FROM evidence e
            JOIN learning_task lt ON lt.id = e.learning_task_id
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE e.id = %s
            """,
            (evidence_id,),
        ).fetchone()
        if member_row is None:
            raise ReviewValidationError(
                "evidence not found", entity_id=evidence_id, field="evidence"
            )
        member_id = int(member_row[0])
        _acquire_buddy_relationship_lock(connection, member_id)
        # Re-read under the lock; the relationship may have changed.
        row = connection.execute(
            """
            SELECT e.status, agp.member_id, e.learning_task_id
            FROM evidence e
            JOIN learning_task lt ON lt.id = e.learning_task_id
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE e.id = %s
            FOR UPDATE OF e
            """,
            (evidence_id,),
        ).fetchone()
        assert row is not None
        evidence_status, member_id, task_id = row

        # Idempotent replay checked before any state validation.
        if idempotency_key is not None:
            existing = connection.execute(
                """
                SELECT er.id
                FROM evidence_review er
                WHERE er.evidence_id = %s
                  AND er.idempotency_key = %s
                """,
                (evidence_id, idempotency_key),
            ).fetchone()
            if existing is not None:
                row2 = connection.execute(
                    """
                    SELECT id, evidence_id, buddy_id, status, conclusion,
                           feedback, reviewed_at, created_at
                    FROM evidence_review WHERE id = %s
                    """,
                    (existing[0],),
                ).fetchone()
                assert row2 is not None
                return _evidence_review_row(row2)

        if evidence_status != "待 Review":
            raise PlanningDomainError(
                "evidence is not pending review",
                code="review_already_submitted",
                entity_type="evidence_review",
                entity_id=evidence_id,
                field="status",
            )
        # Re-read the CURRENT effective buddy relationship inside the lock.
        if not is_member_assigned_to_buddy(connection, int(member_id), buddy_id):
            raise PermissionError("buddy is not assigned to member")

        reviewed_at = _now(connection)
        inserted = connection.execute(
            """
            INSERT INTO evidence_review (
                evidence_id, buddy_id, status, conclusion, feedback,
                reviewed_at, idempotency_key
            )
            VALUES (%s, %s, '已闭环', %s, %s, %s, %s)
            RETURNING id, evidence_id, buddy_id, status, conclusion,
                      feedback, reviewed_at, created_at
            """,
            (evidence_id, buddy_id, conclusion, feedback, reviewed_at, idempotency_key),
        ).fetchone()
        assert inserted is not None
        connection.execute(
            """
            UPDATE evidence
            SET status = %s, revision = revision + 1
            WHERE id = %s
            """,
            (conclusion, evidence_id),
        )

    return _evidence_review_row(inserted)


def get_evidence_review_summary_for_buddy(
    connection: psycopg.Connection,
    buddy_id: int,
    year: int,
) -> dict[str, int]:
    """Return pending and completed evidence review counts for a Buddy in a year.

    Pending counts come from evidence awaiting review for assigned members;
    completed counts come from the immutable review history.
    """
    pending = connection.execute(
        """
        SELECT COUNT(*)
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        JOIN buddy_relationship br
          ON br.member_id = agp.member_id
         AND br.buddy_id = %s
         AND br.is_primary = TRUE
         AND br.effective_to IS NULL
        WHERE e.status = '待 Review' AND agp.year = %s
        """,
        (buddy_id, year),
    ).fetchone()
    completed = connection.execute(
        """
        SELECT COUNT(*)
        FROM evidence_review er
        JOIN evidence e ON e.id = er.evidence_id
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE er.buddy_id = %s
          AND EXTRACT(YEAR FROM er.reviewed_at)::INT = %s
        """,
        (buddy_id, year),
    ).fetchone()
    return {
        "pending_count": int(pending[0] or 0) if pending else 0,
        "completed_count": int(completed[0] or 0) if completed else 0,
    }


def list_evidence_reviews_for_task(
    connection: psycopg.Connection, member_id: int, learning_task_id: int
) -> list[dict[str, object]]:
    _assert_task_ownership(connection, member_id, learning_task_id)
    return _list_evidence_reviews_for_task(connection, learning_task_id)


def list_evidence_reviews_for_buddy_task(
    connection: psycopg.Connection, buddy_id: int, learning_task_id: int
) -> list[dict[str, object]]:
    row = connection.execute(
        """
        SELECT agp.member_id
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.id = %s
        """,
        (learning_task_id,),
    ).fetchone()
    if row is None or not is_member_assigned_to_buddy(
        connection, int(row[0]), buddy_id
    ):
        raise PermissionError("learning task does not belong to assigned member")
    return _list_evidence_reviews_for_task(connection, learning_task_id)


def _list_evidence_reviews_for_task(
    connection: psycopg.Connection, learning_task_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT er.id, er.evidence_id, er.status, er.conclusion,
               er.feedback, er.reviewed_at, er.created_at, e.version_number
        FROM evidence_review er
        JOIN evidence e ON e.id = er.evidence_id
        WHERE e.learning_task_id = %s
        ORDER BY e.version_number DESC
        """,
        (learning_task_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "evidence_id": row[1],
            "status": row[2],
            "conclusion": row[3],
            "feedback": row[4],
            "reviewed_at": row[5],
            "created_at": row[6],
            "version_number": row[7],
        }
        for row in rows
    ]


def _assert_profile_view_permission(
    connection: psycopg.Connection,
    viewer_id: int,
    viewer_roles: list[str],
    member_id: int,
) -> None:
    if "Admin" in viewer_roles or "Leader" in viewer_roles:
        return
    if viewer_id == member_id and "Member" in viewer_roles:
        return
    if "Buddy" in viewer_roles and is_member_assigned_to_buddy(
        connection, member_id, viewer_id
    ):
        return
    raise PermissionError("insufficient permissions to view capability profile")


def _assert_monthly_review_read_permission(
    connection: psycopg.Connection,
    viewer_id: int,
    viewer_roles: list[str],
    member_id: int,
) -> None:
    """Read scope for Monthly Reviews: Member self; assigned Buddy; team
    Leader; Admin never bypasses business isolation (self only)."""
    if "Leader" in viewer_roles:
        return
    if "Admin" in viewer_roles:
        if viewer_id != member_id:
            raise PermissionError("admin may only view their own monthly review")
        return
    if viewer_id == member_id and "Member" in viewer_roles:
        return
    if "Buddy" in viewer_roles and is_member_assigned_to_buddy(
        connection, member_id, viewer_id
    ):
        return
    raise PermissionError("insufficient permissions to view monthly review")


def _profile_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "status": row[3],
        "created_at": row[4],
        "updated_at": row[5],
    }


def _assessment_review_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "assessment_id": row[1],
        "sequence": row[2],
        "buddy_id": row[3],
        "conclusion": row[4],
        "feedback": row[5],
        "reviewed_at": row[6],
        "status": row[7],
    }


# Provenance columns appended after the 16 _plan_item_row columns: the
# assessment → snapshot → plan item chain (scope_type, assessment_revision,
# planning_source_type, source assessment/detail ids, snapshot ids and the
# frozen job-grade/level snapshots).
_PLAN_ITEM_PROVENANCE_KEYS = (
    "source_assessment_id",
    "source_assessment_detail_id",
    "planning_snapshot_id",
    "l3_node_id",
    "l1_code",
    "l1_name",
    "l2_code",
    "l2_name",
    "l3_name",
    "scope_type",
    "standard_target_level",
    "adjusted_target_level",
    "effective_target_level",
    "standard_job_level_snapshot",
    "member_current_level_snapshot",
    "member_target_level_snapshot",
    "plan_quarter",
    "plan_month",
    "planning_source_type",
    "assessment_revision",
    "gap_value",
    "include_in_plan",
)


def _annual_plan_with_items_for_member(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, member_id, year, plan_cycle, status, start_date, end_date,
               created_at, source_assessment_id
        FROM annual_growth_plan
        WHERE member_id = %s AND year = %s
        """,
        (member_id, year),
    ).fetchone()
    if row is None:
        return None
    items = connection.execute(
        """
        SELECT pi.id, pi.annual_growth_plan_id, pi.growth_goal_id, pi.l3_code,
               pi.current_level, pi.target_level, pi.priority, pi.learning_material,
               pi.learning_task_content, pi.expected_output, pi.estimated_hours,
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status,
               pi.revision,
               pi.source_assessment_id, pi.source_assessment_detail_id,
               pi.planning_snapshot_id, pi.l3_node_id, pi.l1_code, pi.l1_name,
               pi.l2_code, pi.l2_name, pi.l3_name, pi.scope_type,
               pi.standard_target_level, pi.adjusted_target_level,
               pi.effective_target_level, pi.standard_job_level_snapshot,
               pi.member_current_level_snapshot, pi.member_target_level_snapshot,
               pi.plan_quarter, pi.plan_month, pi.planning_source_type,
               pi.assessment_revision, pi.gap_value, pi.include_in_plan
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        ORDER BY pi.l3_code
        """,
        (member_id, year),
    ).fetchall()
    plan_items = []
    for item in items:
        plan_item = _plan_item_row(item)
        for index, key in enumerate(_PLAN_ITEM_PROVENANCE_KEYS, start=16):
            plan_item[key] = item[index]
        plan_items.append(plan_item)
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "plan_cycle": row[3],
        "status": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": row[7],
        "source_assessment_id": row[8],
        "items": plan_items,
        "estimated_hours_summary": _estimated_hours_summary(plan_items),
    }


def _learning_tasks_with_logs_and_evidences(
    connection: psycopg.Connection, plan_item_ids: list[int]
) -> dict[int, dict[str, object]]:
    """Tasks of many plan items with their logs and evidences — 3 queries
    total (tasks, logs, evidences), never one burst per plan item."""
    if not plan_item_ids:
        return {}
    task_rows = connection.execute(
        f"""
        SELECT {_prefixed(_TASK_COLUMNS, "lt")}
        FROM learning_task lt
        WHERE lt.plan_item_id = ANY(%s)
        """,
        (list(plan_item_ids),),
    ).fetchall()
    tasks: dict[int, dict[str, object]] = {}
    plan_item_by_task: dict[int, int] = {}
    for row in task_rows:
        task = _learning_task_row(row)
        task["progress_logs"] = []
        task["evidences"] = []
        tasks[int(task["id"])] = task
        plan_item_by_task[int(task["id"])] = int(task["plan_item_id"])
    task_ids = list(tasks)
    if task_ids:
        log_rows = connection.execute(
            f"""
            SELECT {_LOG_COLUMNS}
            FROM learning_progress_log
            WHERE task_id = ANY(%s)
            ORDER BY record_date DESC
            """,
            (task_ids,),
        ).fetchall()
        for log_row in log_rows:
            log = _progress_log_row(log_row)
            tasks[int(log["task_id"])]["progress_logs"].append(log)
        evidence_rows = connection.execute(
            f"""
            SELECT {_prefixed(_EVIDENCE_COLUMNS, "e")},
                   er.id, er.status, er.conclusion, er.feedback, er.reviewed_at
            FROM evidence e
            LEFT JOIN evidence_review er ON er.evidence_id = e.id
            WHERE e.learning_task_id = ANY(%s)
            ORDER BY e.version_number DESC
            """,
            (task_ids,),
        ).fetchall()
        for evidence_row in evidence_rows:
            evidence = {
                **_evidence_row(evidence_row[:19]),
                "review": (
                    {
                        "id": evidence_row[19],
                        "status": evidence_row[20],
                        "conclusion": evidence_row[21],
                        "feedback": evidence_row[22],
                        "reviewed_at": evidence_row[23],
                    }
                    if evidence_row[19] is not None
                    else None
                ),
            }
            tasks[int(evidence_row[1])]["evidences"].append(evidence)
    return {plan_item_by_task[task_id]: task for task_id, task in tasks.items()}


def get_capability_profile(
    connection: psycopg.Connection,
    viewer_id: int,
    viewer_roles: list[str],
    member_id: int,
    year: int,
) -> dict[str, object] | None:
    member_row = connection.execute(
        """SELECT id, username, full_name, current_level, target_level
           FROM tcp_user WHERE id = %s""",
        (member_id,),
    ).fetchone()
    if member_row is None:
        return None

    _assert_profile_view_permission(connection, viewer_id, viewer_roles, member_id)

    row = connection.execute(
        """
        SELECT id, member_id, year, status, created_at, updated_at
        FROM capability_profile
        WHERE member_id = %s AND year = %s
        """,
        (member_id, year),
    ).fetchone()
    if row is None:
        row = connection.execute(
            """
            INSERT INTO capability_profile (member_id, year, status)
            VALUES (%s, %s, '已生成')
            RETURNING id, member_id, year, status, created_at, updated_at
            """,
            (member_id, year),
        ).fetchone()
        assert row is not None
    profile = _profile_row(row)

    assessment_rows = connection.execute(
        """
        SELECT id, member_id, year, version, assessment_type, status,
               created_at, submitted_at, archived_at, assessment_scope_version
        FROM assessment
        WHERE member_id = %s AND year = %s
        ORDER BY created_at DESC
        """,
        (member_id, year),
    ).fetchall()
    assessments: list[dict[str, object]] = []
    for assessment_row in assessment_rows:
        assessment_id = assessment_row[0]
        review_rows = connection.execute(
            """
            SELECT id, assessment_id, sequence, buddy_id, conclusion,
                   feedback, reviewed_at, status
            FROM assessment_review
            WHERE assessment_id = %s
            ORDER BY sequence
            """,
            (assessment_id,),
        ).fetchall()
        assessments.append(
            {
                "id": assessment_row[0],
                "member_id": assessment_row[1],
                "year": assessment_row[2],
                "version": assessment_row[3],
                "assessment_type": assessment_row[4],
                "status": assessment_row[5],
                "created_at": assessment_row[6],
                "submitted_at": assessment_row[7],
                "archived_at": assessment_row[8],
                "scope_version": assessment_row[9],
                "reviews": [
                    _assessment_review_row(review_row) for review_row in review_rows
                ],
            }
        )

    annual_plan = _annual_plan_with_items_for_member(connection, member_id, year)
    if annual_plan is not None:
        tasks_by_plan_item = _learning_tasks_with_logs_and_evidences(
            connection, [int(item["id"]) for item in annual_plan["items"]]
        )
        enriched_items = [
            {
                **item,
                "learning_task": tasks_by_plan_item.get(int(item["id"])),
            }
            for item in annual_plan["items"]
        ]
        contexts = get_l3_contexts(
            connection, [str(item["l3_code"]) for item in enriched_items]
        )
        for item in enriched_items:
            # Frozen provenance keys (l1/l2/l3 codes, names) win over live
            # catalog context; context only fills keys still missing.
            context = contexts.get(str(item["l3_code"]), {})
            for key, value in context.items():
                if key not in item or item[key] is None:
                    item[key] = value
            task = item["learning_task"]
            if isinstance(task, dict):
                task.update(context)
                for evidence in task["evidences"]:
                    evidence.update(context)
        annual_plan["items"] = enriched_items

    start_of_year = f"{year}-01-01"
    start_of_next_year = f"{year + 1}-01-01"

    total_hours_row = connection.execute(
        """
        SELECT COALESCE(SUM(lpl.actual_hours), 0)
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
          AND lpl.record_date >= %s AND lpl.record_date < %s
        """,
        (member_id, start_of_year, start_of_next_year),
    ).fetchone()
    total_learning_hours = int(total_hours_row[0]) if total_hours_row else 0

    planned_hours_rows = connection.execute(
        """
        SELECT pi.estimated_hours
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchall()
    planned_hours = summarize_estimated_hours(
        [row[0] if isinstance(row[0], str) else None for row in planned_hours_rows]
    )

    evidence_status_rows = connection.execute(
        """
        SELECT e.status, COUNT(*)
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        GROUP BY e.status
        """,
        (member_id, year),
    ).fetchall()
    evidence_count_by_status = {
        str(status_row[0]): int(status_row[1]) for status_row in evidence_status_rows
    }

    # Member-written monthly reviews with their immutable history.
    monthly_reviews: list[dict[str, object]] = []
    review_rows = connection.execute(
        """
        SELECT id, member_id, year, month, revision, main_output, problems,
               next_month_focus, notes, created_at, updated_at
        FROM monthly_review
        WHERE member_id = %s AND year = %s
        ORDER BY month, id
        """,
        (member_id, year),
    ).fetchall()
    if review_rows:
        history_rows = connection.execute(
            """
            SELECT monthly_review_id, revision, main_output, problems,
                   next_month_focus, notes, changed_by, changed_at
            FROM monthly_review_history
            WHERE monthly_review_id = ANY(%s)
            ORDER BY monthly_review_id, revision
            """,
            ([int(row[0]) for row in review_rows],),
        ).fetchall()
        history_by_review: dict[int, list[dict[str, object]]] = {}
        for history_row in history_rows:
            history_by_review.setdefault(int(history_row[0]), []).append(
                {
                    "revision": history_row[1],
                    "main_output": history_row[2],
                    "problems": history_row[3],
                    "next_month_focus": history_row[4],
                    "notes": history_row[5],
                    "changed_by": history_row[6],
                    "changed_at": history_row[7],
                }
            )
        for review_row in review_rows:
            review = _monthly_review_row(review_row)
            review["history"] = history_by_review.get(int(review_row[0]), [])
            monthly_reviews.append(review)

    if viewer_id == member_id:
        view_scope = "本人"
    elif "Buddy" in viewer_roles:
        view_scope = "buddy_assigned"
    elif "Leader" in viewer_roles:
        view_scope = "leader_team"
    else:
        view_scope = "本人"

    return {
        **profile,
        "meta": {
            "year": year,
            "scope": view_scope,
            "as_of": _serialize_datetime(_now(connection)),
            "source": "capability_profile.v1",
        },
        "member": {
            "id": member_row[0],
            "username": member_row[1],
            "full_name": member_row[2],
            "current_level": member_row[3],
            "target_level": member_row[4],
        },
        "assessments": assessments,
        "annual_plan": annual_plan,
        "monthly_reviews": monthly_reviews,
        "statistics": {
            "total_learning_hours": total_learning_hours,
            "total_planned_hours": planned_hours["min_hours"] or 0,
            "total_planned_hours_min": planned_hours["min_hours"],
            "total_planned_hours_max": planned_hours["max_hours"],
            "total_planned_hours_has_values": planned_hours["has_values"],
            "total_planned_hours_has_unparsed": planned_hours["has_unparsed"],
            "evidence_count_by_status": evidence_count_by_status,
        },
    }


def list_selectable_members_for_profile(
    connection: psycopg.Connection,
    viewer_id: int,
    viewer_roles: list[str],
    year: int,
) -> list[dict[str, object]]:
    """返回当前登录人在成长档案中可选的成员列表。

    权限范围：
    - Admin：全部活跃用户
    - Leader：全部 Member 角色活跃用户
    - Buddy：自己负责的成员
    - Member：仅本人
    """
    if "Admin" in viewer_roles:
        rows = connection.execute(
            """
            SELECT id, username, full_name
            FROM tcp_user
            WHERE is_active = TRUE
            ORDER BY username
            """,
        ).fetchall()
        return [{"id": row[0], "username": row[1], "full_name": row[2]} for row in rows]
    if "Leader" in viewer_roles:
        rows = connection.execute(
            """
            SELECT u.id, u.username, u.full_name
            FROM tcp_user u
            JOIN tcp_user_role ur ON ur.user_id = u.id
            JOIN tcp_role r ON r.id = ur.role_id
            WHERE r.code = 'Member' AND u.is_active = TRUE
            ORDER BY u.username
            """,
        ).fetchall()
        return [{"id": row[0], "username": row[1], "full_name": row[2]} for row in rows]
    if "Buddy" in viewer_roles:
        assigned = get_assigned_members(connection, viewer_id)
        return [
            {
                "id": m["id"],
                "username": m["username"],
                "full_name": m["full_name"],
                "current_level": m.get("current_level"),
                "target_level": m.get("target_level"),
            }
            for m in assigned
        ]
    row = connection.execute(
        """SELECT id, username, full_name, current_level, target_level
           FROM tcp_user WHERE id = %s""",
        (viewer_id,),
    ).fetchone()
    if row is None:
        return []
    items = [
        {
            "id": row[0],
            "username": row[1],
            "full_name": row[2],
            "current_level": row[3],
            "target_level": row[4],
        }
    ]
    return items


_ALLOWED_TEAM_PLAN_STATUSES = {"已发布", "已归档"}


def _team_annual_plan_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "code": row[1],
        "year": row[2],
        "publisher_id": row[3],
        "resource_arrangement": row[4],
        "description": row[5],
        "published_at": row[6],
        "status": row[7],
        "created_at": row[8],
        "updated_at": row[9],
    }


def _fetch_team_plan_focus_domains(
    connection: psycopg.Connection, plan_id: int
) -> list[str]:
    rows = connection.execute(
        """
        SELECT l1_code FROM team_annual_capability_plan_domain
        WHERE plan_id = %s
        ORDER BY l1_code
        """,
        (plan_id,),
    ).fetchall()
    return [row[0] for row in rows]


def _validate_focus_domains(connection: psycopg.Connection, codes: list[str]) -> None:
    if not codes:
        return
    if len(codes) != len(set(codes)):
        raise ValueError("duplicate focus domain codes")
    rows = connection.execute(
        """
        SELECT code FROM capability_node
        WHERE node_type = 'L1'
          AND enabled = TRUE
          AND code = ANY(%s)
          AND code = ANY(%s)
        """,
        (list(set(codes)), list(DOMAIN_CODES)),
    ).fetchall()
    valid = {row[0] for row in rows}
    invalid = set(codes) - valid
    if invalid:
        raise ValueError(f"invalid focus domain codes: {sorted(invalid)}")


def get_team_annual_plan_by_year(
    connection: psycopg.Connection, year: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, code, year, publisher_id, resource_arrangement,
               description, published_at, status, created_at, updated_at
        FROM team_annual_capability_plan
        WHERE year = %s
        """,
        (year,),
    ).fetchone()
    if row is None:
        return None
    plan = _team_annual_plan_row(row)
    plan["focus_domains"] = _fetch_team_plan_focus_domains(connection, int(plan["id"]))
    return plan


def create_or_publish_team_annual_plan(
    connection: psycopg.Connection,
    publisher_id: int,
    data: dict[str, object],
) -> dict[str, object]:
    try:
        year = int(data["year"])  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError) as exc:
        raise ValueError("year is required") from exc
    focus_domain_codes = list(
        dict.fromkeys(data.get("focus_domain_codes", []))  # type: ignore[arg-type]
    )
    resource_arrangement = data.get("resource_arrangement")
    description = data.get("description")
    code = f"TACP-{year}"
    _validate_focus_domains(connection, focus_domain_codes)
    with connection.transaction():
        existing = connection.execute(
            """
            SELECT id FROM team_annual_capability_plan
            WHERE year = %s
            FOR UPDATE
            """,
            (year,),
        ).fetchone()
        if existing is not None:
            raise ValueError(f"team annual plan for year {year} already exists")
        row = connection.execute(
            """
            INSERT INTO team_annual_capability_plan (
                code, year, publisher_id, resource_arrangement,
                description, published_at, status
            )
            VALUES (%s, %s, %s, %s, %s, NOW(), '已发布')
            RETURNING id, code, year, publisher_id, resource_arrangement,
                      description, published_at, status, created_at, updated_at
            """,
            (code, year, publisher_id, resource_arrangement, description),
        ).fetchone()
        assert row is not None
        plan_id = row[0]
        for l1_code in focus_domain_codes:
            connection.execute(
                """
                INSERT INTO team_annual_capability_plan_domain (plan_id, l1_code)
                VALUES (%s, %s)
                """,
                (plan_id, l1_code),
            )
    plan = _team_annual_plan_row(row)
    plan["focus_domains"] = focus_domain_codes
    return plan


def update_team_annual_plan(
    connection: psycopg.Connection,
    year: int,
    data: dict[str, object],
) -> dict[str, object]:
    focus_domain_codes = list(
        dict.fromkeys(data.get("focus_domain_codes", []))  # type: ignore[arg-type]
    )
    resource_arrangement = data.get("resource_arrangement")
    description = data.get("description")
    _validate_focus_domains(connection, focus_domain_codes)
    with connection.transaction():
        existing = connection.execute(
            """
            SELECT id, status FROM team_annual_capability_plan
            WHERE year = %s
            FOR UPDATE
            """,
            (year,),
        ).fetchone()
        if existing is None:
            raise KeyError("team annual plan not found")
        plan_id, plan_status = existing
        if plan_status != "已发布":
            raise ValueError("team annual plan is not published")
        row = connection.execute(
            """
            UPDATE team_annual_capability_plan
            SET resource_arrangement = %s,
                description = %s,
                updated_at = NOW()
            WHERE id = %s
            RETURNING id, code, year, publisher_id, resource_arrangement,
                      description, published_at, status, created_at, updated_at
            """,
            (resource_arrangement, description, plan_id),
        ).fetchone()
        assert row is not None
        connection.execute(
            "DELETE FROM team_annual_capability_plan_domain WHERE plan_id = %s",
            (plan_id,),
        )
        for l1_code in focus_domain_codes:
            connection.execute(
                """
                INSERT INTO team_annual_capability_plan_domain (plan_id, l1_code)
                VALUES (%s, %s)
                """,
                (plan_id, l1_code),
            )
    plan = _team_annual_plan_row(row)
    plan["focus_domains"] = focus_domain_codes
    return plan


def archive_team_annual_plan(
    connection: psycopg.Connection,
    year: int,
) -> None:
    with connection.transaction():
        row = connection.execute(
            """
            UPDATE team_annual_capability_plan
            SET status = '已归档', updated_at = NOW()
            WHERE year = %s
            RETURNING id
            """,
            (year,),
        ).fetchone()
        if row is None:
            raise KeyError("team annual plan not found")


_TEAM_ANNUAL_PLAN_ITEM_SORT_COLUMNS = {
    "priority": "pi.priority",
    "plan_month": "pi.plan_month",
    "status": "pi.status",
    "l3_code": "pi.l3_code",
    "member_id": "agp.member_id",
}


_TEAM_ANNUAL_PLAN_ITEM_ALLOWED_FILTERS = {
    "priority": {"高", "中", "低"},
    "status": {"未开始", "进行中", "已完成", "延期", "暂停", "取消"},
    "quarter": {"Q1", "Q2", "Q3", "Q4"},
}


def list_team_annual_plan_items(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    *,
    scope_label: str = "leader_team",
    domain_code: str | None = None,
    priority: str | None = None,
    status: str | None = None,
    quarter: str | None = None,
    month: int | None = None,
    member_id: int | None = None,
    q: str | None = None,
    page: int = 1,
    page_size: int = 20,
    sort_by: str = "plan_month",
    sort_order: str = "asc",
) -> dict[str, object]:
    """Paginated formal PlanItem list for the Team Annual Plan view.

    Formal PlanItems are those explicitly included in the member's annual
    plan (`include_in_plan = TRUE`) for the requested year.
    """
    if not member_ids:
        return {
            "meta": {
                "year": year,
                "as_of": _serialize_datetime(_now(connection)),
                "scope": scope_label,
                "source": "team_annual_plan.items.v1",
            },
            "filters": {
                "domain_code": domain_code,
                "priority": priority,
                "status": status,
                "quarter": quarter,
                "month": month,
                "member_id": member_id,
                "q": q,
            },
            "pagination": {
                "page": page,
                "page_size": page_size,
                "total_pages": 0,
                "total_count": 0,
            },
            "items": [],
        }

    if member_id is not None and member_id not in member_ids:
        raise PermissionError("member out of scope")

    if domain_code is not None:
        _validate_focus_domains(connection, [domain_code])
    if (
        priority is not None
        and priority not in _TEAM_ANNUAL_PLAN_ITEM_ALLOWED_FILTERS["priority"]
    ):
        raise ValueError(f"invalid priority: {priority}")
    if (
        status is not None
        and status not in _TEAM_ANNUAL_PLAN_ITEM_ALLOWED_FILTERS["status"]
    ):
        raise ValueError(f"invalid status: {status}")
    if (
        quarter is not None
        and quarter not in _TEAM_ANNUAL_PLAN_ITEM_ALLOWED_FILTERS["quarter"]
    ):
        raise ValueError(f"invalid quarter: {quarter}")
    if month is not None and not 1 <= month <= 12:
        raise ValueError(f"invalid month: {month}")

    order_column = _TEAM_ANNUAL_PLAN_ITEM_SORT_COLUMNS.get(sort_by, "pi.plan_month")
    order_direction = "ASC" if sort_order.lower() == "asc" else "DESC"

    params: list[object] = [year, member_ids]
    where_clauses = [
        "agp.year = %s",
        "agp.member_id = ANY(%s)",
        "pi.include_in_plan = TRUE",
    ]

    if domain_code is not None:
        where_clauses.append("LEFT(pi.l3_code, 3) = %s")
        params.append(domain_code)
    if priority is not None:
        where_clauses.append("pi.priority = %s")
        params.append(priority)
    if status is not None:
        where_clauses.append("pi.status = %s")
        params.append(status)
    if quarter is not None:
        where_clauses.append("pi.plan_quarter = %s")
        params.append(quarter)
    if month is not None:
        where_clauses.append("pi.plan_month = %s")
        params.append(month)
    if member_id is not None:
        where_clauses.append("agp.member_id = %s")
        params.append(member_id)
    if q:
        where_clauses.append(
            """
            (LOWER(pi.l3_code) LIKE %s OR LOWER(pi.l3_name) LIKE %s
             OR LOWER(u.full_name) LIKE %s)
            """.strip()
        )
        like = f"%{q.lower()}%"
        params.extend([like, like, like])

    where_sql = " AND ".join(where_clauses)

    # Pagination-invariant aggregates over the full filtered set, using valid
    # progress logs only.  Pre-aggregate actual hours per PlanItem so that
    # multiple progress-log rows do not inflate counts or status buckets.
    aggregate_row = connection.execute(
        f"""
        SELECT
            COUNT(DISTINCT pi.id),
            COALESCE(SUM(lpl_agg.actual_hours), 0),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '未开始'),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '进行中'),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '已完成'),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '延期'),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '暂停'),
            COUNT(DISTINCT pi.id) FILTER (WHERE pi.status = '取消')
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        JOIN tcp_user u ON u.id = agp.member_id
        LEFT JOIN (
            SELECT lt.plan_item_id,
                   COALESCE(SUM(lpl.actual_hours), 0) AS actual_hours
            FROM learning_task lt
            JOIN learning_progress_log lpl
              ON lpl.task_id = lt.id AND lpl.invalidated_at IS NULL
            GROUP BY lt.plan_item_id
        ) lpl_agg ON lpl_agg.plan_item_id = pi.id
        WHERE {where_sql}
        """,
        params,
    ).fetchone()
    total_count = int(aggregate_row[0]) if aggregate_row else 0

    estimated_summary = summarize_estimated_hours(
        [
            row[0] if isinstance(row[0], str) else None
            for row in connection.execute(
                f"""
                SELECT pi.estimated_hours
                FROM plan_item pi
                JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
                JOIN tcp_user u ON u.id = agp.member_id
                WHERE {where_sql}
                """,
                params,
            ).fetchall()
        ]
    )

    summary = {
        "total_count": total_count,
        "planned_hours_min": estimated_summary["min_hours"],
        "planned_hours_max": estimated_summary["max_hours"],
        "has_values": estimated_summary["has_values"],
        "has_unparsed": estimated_summary["has_unparsed"],
        "actual_hours": int(aggregate_row[1]) if aggregate_row else 0,
        "status_breakdown": {
            "未开始": int(aggregate_row[2]) if aggregate_row else 0,
            "进行中": int(aggregate_row[3]) if aggregate_row else 0,
            "已完成": int(aggregate_row[4]) if aggregate_row else 0,
            "延期": int(aggregate_row[5]) if aggregate_row else 0,
            "暂停": int(aggregate_row[6]) if aggregate_row else 0,
            "取消": int(aggregate_row[7]) if aggregate_row else 0,
            "total": total_count,
        },
    }

    page = max(1, page)
    page_size = max(1, min(page_size, 200))
    total_pages = (
        max(1, (total_count + page_size - 1) // page_size) if total_count else 0
    )
    offset = (page - 1) * page_size

    rows = connection.execute(
        f"""
        SELECT pi.id, pi.annual_growth_plan_id, pi.growth_goal_id, pi.l3_code,
               pi.current_level, pi.target_level, pi.priority, pi.learning_material,
               pi.learning_task_content, pi.expected_output, pi.estimated_hours,
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status,
               pi.revision, pi.scope_type, pi.plan_quarter, pi.plan_month,
               pi.l1_code, pi.l1_name, pi.l2_code, pi.l2_name, pi.l3_name,
               agp.member_id, u.username, u.full_name
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        JOIN tcp_user u ON u.id = agp.member_id
        WHERE {where_sql}
        ORDER BY {order_column} {order_direction}, pi.l3_code
        LIMIT %s OFFSET %s
        """,
        (*params, page_size, offset),
    ).fetchall()

    items: list[dict[str, object]] = []
    for row in rows:
        item = {
            "id": row[0],
            "annual_growth_plan_id": row[1],
            "growth_goal_id": row[2],
            "l3_code": row[3],
            "current_level": row[4],
            "target_level": row[5],
            "priority": row[6],
            "learning_material": row[7],
            "learning_task_content": row[8],
            "expected_output": row[9],
            "estimated_hours": row[10],
            "plan_start_date": row[11],
            "plan_end_date": row[12],
            "target_month": row[13],
            "status": row[14],
            "revision": row[15],
            "scope_type": row[16],
            "plan_quarter": row[17],
            "plan_month": row[18],
            "l1_code": row[19],
            "l1_name": row[20],
            "l2_code": row[21],
            "l2_name": row[22],
            "l3_name": row[23],
            "member_id": row[24],
            "username": row[25],
            "full_name": row[26],
        }
        item["estimated_hours_parsed"] = parse_estimated_hours(
            row[10] if isinstance(row[10], str) else None
        ).as_dict()
        items.append(item)

    # Bulk-load valid actual hours for the page (one query, no N+1).
    if items:
        item_ids = [int(item["id"]) for item in items]
        actual_hours_rows = connection.execute(
            """
            SELECT pi.id, COALESCE(SUM(lpl.actual_hours), 0)
            FROM plan_item pi
            LEFT JOIN learning_task lt ON lt.plan_item_id = pi.id
            LEFT JOIN learning_progress_log lpl
              ON lpl.task_id = lt.id AND lpl.invalidated_at IS NULL
            WHERE pi.id = ANY(%s)
            GROUP BY pi.id
            """,
            (item_ids,),
        ).fetchall()
        actual_hours_by_item = {int(row[0]): int(row[1]) for row in actual_hours_rows}
        for item in items:
            item["actual_hours"] = actual_hours_by_item.get(int(item["id"]), 0)
    else:
        actual_hours_by_item: dict[int, int] = {}

    items = _attach_l3_contexts(connection, items)

    members = _team_analytics_members(connection, member_ids)

    return {
        "meta": {
            "year": year,
            "as_of": _serialize_datetime(_now(connection)),
            "scope": scope_label,
            "source": "team_annual_plan.items.v1",
        },
        "filters": {
            "domain_code": domain_code,
            "priority": priority,
            "status": status,
            "quarter": quarter,
            "month": month,
            "member_id": member_id,
            "q": q,
        },
        "pagination": {
            "page": page,
            "page_size": page_size,
            "total_pages": total_pages,
            "total_count": total_count,
        },
        "summary": summary,
        "members": members,
        "items": items,
    }


_TEAM_ANALYTICS_DOMAIN_CODES = list(DOMAIN_CODES)


def validate_team_analytics_domain_filter(
    connection: psycopg.Connection, domain_code: str | None
) -> None:
    """Validate an optional L1 domain filter for team analytics.

    Raises ValueError when the code is not an enabled MVP L1 domain.
    """
    if domain_code is None:
        return
    _validate_focus_domains(connection, [domain_code])


def _team_analytics_members(
    connection: psycopg.Connection, member_ids: list[int]
) -> list[dict[str, object]]:
    if not member_ids:
        return []
    rows = connection.execute(
        """
        SELECT u.id, u.username, u.full_name
        FROM tcp_user u
        JOIN tcp_user_role ur ON ur.user_id = u.id
        JOIN tcp_role r ON r.id = ur.role_id
        WHERE r.code = 'Member'
          AND u.id = ANY(%s)
        ORDER BY u.id
        """,
        (member_ids,),
    ).fetchall()
    return [
        {"member_id": row[0], "username": row[1], "full_name": row[2]} for row in rows
    ]


def _team_analytics_assessment_kpi(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> tuple[int, int]:
    if not member_ids:
        return 0, 0
    row = connection.execute(
        """
        WITH member_scope AS (
            SELECT DISTINCT u.id
            FROM tcp_user u
            JOIN tcp_user_role ur ON ur.user_id = u.id
            JOIN tcp_role r ON r.id = ur.role_id
            WHERE r.code = 'Member'
              AND u.id = ANY(%s)
        ), latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
              AND a.member_id = ANY(%s)
            ORDER BY a.member_id, a.submitted_at DESC NULLS LAST, a.created_at DESC
        ), completed_members AS (
            SELECT DISTINCT ms.id
            FROM member_scope ms
            JOIN latest_assessments la ON la.member_id = ms.id
            JOIN assessment_detail ad ON ad.assessment_id = la.id
            WHERE ad.current_level IS NOT NULL
              AND ad.target_level IS NOT NULL
              AND (%s::TEXT IS NULL OR LEFT(ad.l3_code, 3) = %s::TEXT)
        )
        SELECT
            (SELECT COUNT(*) FROM completed_members) AS completed,
            (SELECT COUNT(*) FROM member_scope) AS total
        """,
        (member_ids, year, member_ids, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_plan_kpi(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> tuple[int, int]:
    if not member_ids:
        return 0, 0
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE pi.status = '已完成') AS completed,
            COUNT(*) AS total
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s AND pi.status != '取消'
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_evidence_kpi(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> tuple[int, int]:
    if not member_ids:
        return 0, 0
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE e.status IN ('通过', '已归档')) AS passed,
            COUNT(*) FILTER (WHERE e.status IN (
                '通过', '需补充', '驳回', '已归档'
            )) AS total
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_overdue_items(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> list[dict[str, object]]:
    if not member_ids:
        return []
    rows = connection.execute(
        """
        WITH due AS (
            SELECT agp.member_id, pi.l3_code, pi.status,
                   CASE
                       WHEN pi.plan_end_date IS NOT NULL THEN pi.plan_end_date
                       WHEN pi.target_month IS NOT NULL THEN
                           (MAKE_DATE(%s, pi.target_month, 1)
                            + INTERVAL '1 month - 1 day')::DATE
                   END AS due_date
            FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.year = %s AND pi.status NOT IN ('已完成', '取消')
              AND agp.member_id = ANY(%s)
              AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        )
        SELECT d.member_id, u.username, u.full_name,
               d.l3_code,
               d.due_date, (CURRENT_DATE - d.due_date) AS overdue_days, d.status
        FROM due d
        JOIN tcp_user u ON u.id = d.member_id
        WHERE d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
        ORDER BY overdue_days DESC, d.l3_code
        """,
        (year, year, member_ids, domain_code, domain_code),
    ).fetchall()
    items = [
        {
            "member_id": row[0],
            "username": row[1],
            "full_name": row[2],
            "l3_code": row[3],
            "due_date": str(row[4]) if row[4] is not None else None,
            "overdue_days": int(row[5]) if row[5] is not None else 0,
            "status": row[6],
        }
        for row in rows
    ]
    return _attach_l3_contexts(connection, items)


def _team_analytics_domain_averages(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_codes: list[str],
) -> list[dict[str, object]]:
    if not member_ids:
        return [
            {"domain_code": code, "actual": 0, "target": 0} for code in domain_codes
        ]
    rows = connection.execute(
        """
        WITH latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id, a.status
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
              AND a.member_id = ANY(%s)
            ORDER BY a.member_id, a.submitted_at DESC NULLS LAST, a.created_at DESC
        )
        SELECT LEFT(ad.l3_code, 3) AS domain_code,
               ROUND(AVG(ad.current_level), 2) AS actual,
               ROUND(AVG(ad.target_level), 2) AS target
        FROM latest_assessments la
        JOIN assessment_detail ad ON ad.assessment_id = la.id
        JOIN tcp_user u ON u.id = la.member_id
        JOIN tcp_user_role ur ON ur.user_id = u.id
        JOIN tcp_role r ON r.id = ur.role_id
        WHERE r.code = 'Member'
          AND ad.current_level IS NOT NULL
          AND ad.target_level IS NOT NULL
          AND LEFT(ad.l3_code, 3) = ANY(%s)
        GROUP BY LEFT(ad.l3_code, 3)
        """,
        (year, member_ids, domain_codes),
    ).fetchall()
    averages = {str(row[0]): {"actual": row[1], "target": row[2]} for row in rows}
    return [
        {
            "domain_code": code,
            "actual": (
                float(averages[code]["actual"])
                if code in averages and averages[code]["actual"] is not None
                else 0
            ),
            "target": (
                float(averages[code]["target"])
                if code in averages and averages[code]["target"] is not None
                else 0
            ),
        }
        for code in domain_codes
    ]


def _team_analytics_member_attainment(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_codes: list[str],
) -> list[dict[str, object]]:
    members = _team_analytics_members(connection, member_ids)
    if not members:
        return []

    rows = connection.execute(
        """
        WITH latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id, a.status
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
              AND a.member_id = ANY(%s)
            ORDER BY a.member_id, a.submitted_at DESC NULLS LAST, a.created_at DESC
        )
        SELECT la.member_id, LEFT(ad.l3_code, 3) AS domain_code,
               AVG(ad.current_level) AS actual,
               AVG(ad.target_level) AS target
        FROM latest_assessments la
        JOIN assessment_detail ad ON ad.assessment_id = la.id
        JOIN tcp_user u ON u.id = la.member_id
        JOIN tcp_user_role ur ON ur.user_id = u.id
        JOIN tcp_role r ON r.id = ur.role_id
        WHERE r.code = 'Member'
          AND ad.current_level IS NOT NULL
          AND ad.target_level IS NOT NULL
          AND LEFT(ad.l3_code, 3) = ANY(%s)
        GROUP BY la.member_id, LEFT(ad.l3_code, 3)
        ORDER BY la.member_id, LEFT(ad.l3_code, 3)
        """,
        (year, member_ids, domain_codes),
    ).fetchall()

    member_domain_values: dict[int, dict[str, tuple[float, float]]] = {
        int(member["member_id"]): {} for member in members
    }
    for row in rows:
        member_domain_values[int(row[0])][str(row[1])] = (
            float(row[2]) if row[2] is not None else 0.0,
            float(row[3]) if row[3] is not None else 0.0,
        )

    attainment: list[dict[str, object]] = []
    for member in members:
        mid = int(member["member_id"])
        for code in domain_codes:
            actual, target = member_domain_values[mid].get(code, (None, None))
            if actual is not None and target is not None and target > 0:
                attainment_value = round((actual / target) * 100, 2)
            else:
                attainment_value = None
            attainment.append(
                {
                    "member_id": mid,
                    "username": member["username"],
                    "full_name": member["full_name"],
                    "domain_code": code,
                    "attainment": attainment_value,
                    "actual": actual,
                    "target": target,
                }
            )
    return attainment


def _team_analytics_distributions(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> dict[str, object]:
    """Team-level breakdowns required by the Phase 2 analytics contract.

    Covers priority, formal inclusion ratio, quarterly split, the six plan-item
    states, and evidence pending acceptance (status = '待 Review' and not
    superseded).  All counts respect the same scope/domain filter as the rest
    of the aggregate.
    """
    empty = {
        "priority": {"高": 0, "中": 0, "低": 0, "total": 0},
        "formal_inclusion_ratio": {
            "included_count": 0,
            "total_count": 0,
            "ratio": 0.0,
        },
        "quarterly": {"Q1": 0, "Q2": 0, "Q3": 0, "Q4": 0, "total": 0},
        "plan_status": {
            "未开始": 0,
            "进行中": 0,
            "已完成": 0,
            "延期": 0,
            "暂停": 0,
            "取消": 0,
            "total": 0,
        },
        "pending_acceptance": {"count": 0},
    }
    if not member_ids:
        return empty

    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE pi.priority = '高') AS high,
            COUNT(*) FILTER (WHERE pi.priority = '中') AS medium,
            COUNT(*) FILTER (WHERE pi.priority = '低') AS low,
            COUNT(*) FILTER (
                WHERE pi.include_in_plan = TRUE AND pi.status != '取消'
            ) AS included,
            COUNT(*) FILTER (WHERE pi.status != '取消') AS non_cancelled,
            COUNT(*) FILTER (WHERE pi.plan_quarter = 'Q1') AS q1,
            COUNT(*) FILTER (WHERE pi.plan_quarter = 'Q2') AS q2,
            COUNT(*) FILTER (WHERE pi.plan_quarter = 'Q3') AS q3,
            COUNT(*) FILTER (WHERE pi.plan_quarter = 'Q4') AS q4,
            COUNT(*) FILTER (WHERE pi.status = '未开始') AS not_started,
            COUNT(*) FILTER (WHERE pi.status = '进行中') AS in_progress,
            COUNT(*) FILTER (WHERE pi.status = '已完成') AS completed,
            COUNT(*) FILTER (WHERE pi.status = '延期') AS delayed,
            COUNT(*) FILTER (WHERE pi.status = '暂停') AS paused,
            COUNT(*) FILTER (WHERE pi.status = '取消') AS cancelled,
            COUNT(*) AS total
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return empty

    included_count = int(row[3] or 0)
    non_cancelled_count = int(row[4] or 0)
    pending_row = connection.execute(
        """
        SELECT COUNT(*)
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
          AND e.status = '待 Review'
          AND NOT EXISTS (
              SELECT 1 FROM evidence superseding
              WHERE superseding.supersedes_evidence_id = e.id
          )
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchone()
    pending_count = int(pending_row[0] if pending_row else 0)

    return {
        "priority": {
            "高": int(row[0] or 0),
            "中": int(row[1] or 0),
            "低": int(row[2] or 0),
            "total": int(row[15] or 0),
        },
        "formal_inclusion_ratio": {
            "included_count": included_count,
            "total_count": non_cancelled_count,
            "ratio": (
                round(included_count / non_cancelled_count, 4)
                if non_cancelled_count
                else 0.0
            ),
        },
        "quarterly": {
            "Q1": int(row[5] or 0),
            "Q2": int(row[6] or 0),
            "Q3": int(row[7] or 0),
            "Q4": int(row[8] or 0),
            "total": int(row[15] or 0),
        },
        "plan_status": {
            "未开始": int(row[9] or 0),
            "进行中": int(row[10] or 0),
            "已完成": int(row[11] or 0),
            "延期": int(row[12] or 0),
            "暂停": int(row[13] or 0),
            "取消": int(row[14] or 0),
            "total": int(row[15] or 0),
        },
        "pending_acceptance": {"count": pending_count},
    }


def _team_analytics_monthly_trends(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> list[dict[str, object]]:
    if not member_ids:
        # Empty filtered cohort: explicit no-data, distinguishable from a
        # populated cohort with zero completions (Issue #87).
        return []
    planned_rows = connection.execute(
        """
        SELECT pi.plan_month AS month,
               pi.estimated_hours
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s AND pi.status != '取消'
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchall()
    planned_values_by_month: dict[int, list[str | None]] = {}
    for month, estimated_hours in planned_rows:
        if month is not None:
            planned_values_by_month.setdefault(int(month), []).append(
                estimated_hours if isinstance(estimated_hours, str) else None
            )
    planned_by_month = {
        month: (len(values), summarize_estimated_hours(values))
        for month, values in planned_values_by_month.items()
    }

    # Completed items come from the SAME population and predicate as the
    # plan-completion KPI (plan_item.status = '已完成', non-cancelled,
    # year/member/domain filters), so the year-end cumulative reconciles
    # with the summary by construction (Issue #87).  Attribution month is
    # the persisted completion month — actual_completed_at (v0010 gate),
    # falling back to the legacy actual_end_date — when it lands inside the
    # plan year; otherwise the item's saved plan_month.  Nothing is derived
    # from updated_at.
    actual_count_rows = connection.execute(
        """
        SELECT month, COUNT(*) AS actual_count
        FROM (
            SELECT CASE
                       WHEN lt.actual_completed_at IS NOT NULL
                            AND EXTRACT(YEAR FROM lt.actual_completed_at) = %s
                           THEN EXTRACT(MONTH FROM lt.actual_completed_at)::INT
                       WHEN lt.actual_end_date IS NOT NULL
                            AND EXTRACT(YEAR FROM lt.actual_end_date) = %s
                           THEN EXTRACT(MONTH FROM lt.actual_end_date)::INT
                       ELSE pi.plan_month
                   END AS month
            FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            LEFT JOIN learning_task lt ON lt.plan_item_id = pi.id
            WHERE pi.status = '已完成'
              AND agp.year = %s
              AND agp.member_id = ANY(%s)
              AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        ) attributed
        WHERE month IS NOT NULL
        GROUP BY month
        ORDER BY month
        """,
        (year, year, year, member_ids, domain_code, domain_code),
    ).fetchall()
    actual_count_by_month = {int(row[0]): int(row[1]) for row in actual_count_rows}

    actual_hours_rows = connection.execute(
        """
        SELECT EXTRACT(MONTH FROM lpl.record_date)::INT AS month,
               SUM(lpl.actual_hours) AS actual_hours
        FROM learning_progress_log lpl
        JOIN learning_task lt ON lt.id = lpl.task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE EXTRACT(YEAR FROM lpl.record_date) = %s
          AND lpl.invalidated_at IS NULL
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        GROUP BY month
        ORDER BY month
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchall()
    actual_hours_by_month = {int(row[0]): int(row[1]) for row in actual_hours_rows}

    total_row = connection.execute(
        """
        SELECT COUNT(*)
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s AND pi.status != '取消'
          AND agp.member_id = ANY(%s)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchone()
    total_plan_items = int(total_row[0]) if total_row else 0
    if total_plan_items == 0:
        # No plan items in the filtered cohort: explicit no-data, not twelve
        # zero months (Issue #87).
        return []

    trends: list[dict[str, object]] = []
    cumulative_planned = 0
    cumulative_actual = 0
    cumulative_planned_hours_min = 0.0
    cumulative_planned_hours_max = 0.0
    cumulative_planned_hours_has_unparsed = False
    cumulative_actual_hours = 0
    for month in range(1, 13):
        planned_count, planned_hours = planned_by_month.get(
            month,
            (0, {"min_hours": None, "max_hours": None, "has_unparsed": False}),
        )
        actual_count = actual_count_by_month.get(month, 0)
        actual_hours = actual_hours_by_month.get(month, 0)

        cumulative_planned += planned_count
        cumulative_actual += actual_count
        planned_hours_min = float(planned_hours["min_hours"] or 0)
        planned_hours_max = float(planned_hours["max_hours"] or 0)
        cumulative_planned_hours_min += planned_hours_min
        cumulative_planned_hours_max += planned_hours_max
        cumulative_planned_hours_has_unparsed = (
            cumulative_planned_hours_has_unparsed or bool(planned_hours["has_unparsed"])
        )
        cumulative_actual_hours += actual_hours

        trends.append(
            {
                "month": month,
                "planned_count": planned_count,
                "actual_count": actual_count,
                "cumulative_planned_rate": (
                    round(cumulative_planned / total_plan_items, 4)
                    if total_plan_items
                    else 0.0
                ),
                "cumulative_actual_rate": (
                    round(cumulative_actual / total_plan_items, 4)
                    if total_plan_items
                    else 0.0
                ),
                "planned_hours": planned_hours_min,
                "planned_hours_min": planned_hours["min_hours"],
                "planned_hours_max": planned_hours["max_hours"],
                "planned_hours_has_unparsed": planned_hours["has_unparsed"],
                "actual_hours": actual_hours,
                "cumulative_planned_hours": cumulative_planned_hours_min,
                "cumulative_planned_hours_min": cumulative_planned_hours_min,
                "cumulative_planned_hours_max": cumulative_planned_hours_max,
                "cumulative_planned_hours_has_unparsed": (
                    cumulative_planned_hours_has_unparsed
                ),
                "cumulative_actual_hours": cumulative_actual_hours,
            }
        )
    return trends


def _team_analytics_gap_summary(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
) -> dict[str, object]:
    """Team-level scope split (current_required vs target_progressive).

    Mirrors the member_dashboard.gap_summary rule: assessment detail
    scope_type wins; NULL scope_type falls back to the member's current
    grade level vs the gap target level.
    """
    if not member_ids:
        return {
            "current_required": 0,
            "target_progressive": 0,
            "derivation": "scope_v1",
        }
    rows = connection.execute(
        """
        WITH latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id, a.member_current_level_snapshot
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
              AND a.member_id = ANY(%s)
            ORDER BY a.member_id, a.submitted_at DESC NULLS LAST, a.created_at DESC
        )
        SELECT ad.scope_type,
               ad.target_level,
               COALESCE(a.member_current_level_snapshot, u.current_level)
                   AS member_grade
        FROM latest_assessments a
        JOIN assessment_detail ad ON ad.assessment_id = a.id
        JOIN tcp_user u ON u.id = a.member_id
        WHERE ad.current_level IS NOT NULL
          AND ad.target_level IS NOT NULL
          AND (%s::TEXT IS NULL OR LEFT(ad.l3_code, 3) = %s::TEXT)
        """,
        (year, member_ids, domain_code, domain_code),
    ).fetchall()

    current_required = 0
    target_progressive = 0
    has_scope_v1 = False
    for scope_type, target_level, member_grade in rows:
        if scope_type is not None:
            has_scope_v1 = True
            if scope_type == "current_required":
                current_required += 1
            elif scope_type == "target_progressive":
                target_progressive += 1
            continue
        member_grade_level = grade_to_level(member_grade)
        if member_grade_level is not None and int(target_level) > member_grade_level:
            target_progressive += 1
        else:
            current_required += 1

    return {
        "current_required": current_required,
        "target_progressive": target_progressive,
        "derivation": "scope_v1" if has_scope_v1 else "legacy_fallback",
    }


def _empty_team_analytics(
    year: int,
    domain_code: str | None,
    scope_label: str,
    requested_member_id: int | None,
) -> dict[str, object]:
    domain_codes = (
        [domain_code] if domain_code is not None else _TEAM_ANALYTICS_DOMAIN_CODES
    )
    return {
        "meta": {
            "year": year,
            "as_of": None,
            "scope": scope_label,
            "source": "team_analytics.v2",
            "denominator_source": "assessment_details",
        },
        "year": year,
        "filters": {
            "member_id": requested_member_id,
            "domain_code": domain_code,
        },
        "gap_summary": {
            "current_required": 0,
            "target_progressive": 0,
            "derivation": "scope_v1",
        },
        "kpis": {
            "assessment_completion_rate": 0.0,
            "assessment_completed_count": 0,
            "assessment_total_count": 0,
            "plan_completion_rate": 0.0,
            "plan_completed_count": 0,
            "plan_total_count": 0,
            "evidence_pass_rate": 0.0,
            "evidence_passed_count": 0,
            "evidence_total_count": 0,
            "overdue_plan_item_count": 0,
        },
        "domain_averages": [
            {"domain_code": code, "actual": 0, "target": 0} for code in domain_codes
        ],
        "member_attainment": [],
        "monthly_trends": _team_analytics_monthly_trends(
            connection=None, year=year, member_ids=[], domain_code=domain_code
        ),
        "distributions": _team_analytics_distributions(
            connection=None, year=year, member_ids=[], domain_code=domain_code
        ),
        "overdue_items": [],
    }


def get_team_analytics(
    connection: psycopg.Connection,
    year: int,
    member_ids: list[int],
    domain_code: str | None,
    scope_label: str,
    requested_member_id: int | None = None,
) -> dict[str, object]:
    """Return read-only team analytics aggregates for the resolved member scope."""
    domain_codes = (
        [domain_code] if domain_code is not None else _TEAM_ANALYTICS_DOMAIN_CODES
    )

    if not member_ids:
        return _empty_team_analytics(
            year, domain_code, scope_label, requested_member_id
        )

    assessment_completed, assessment_total = _team_analytics_assessment_kpi(
        connection, year, member_ids, domain_code
    )
    plan_completed, plan_total = _team_analytics_plan_kpi(
        connection, year, member_ids, domain_code
    )
    evidence_passed, evidence_total = _team_analytics_evidence_kpi(
        connection, year, member_ids, domain_code
    )
    overdue_items = _team_analytics_overdue_items(
        connection, year, member_ids, domain_code
    )

    return {
        "meta": {
            "year": year,
            "as_of": _serialize_datetime(_now(connection)),
            "scope": scope_label,
            "source": "team_analytics.v2",
            "denominator_source": "assessment_details",
        },
        "year": year,
        "filters": {
            "member_id": requested_member_id,
            "domain_code": domain_code,
        },
        "gap_summary": _team_analytics_gap_summary(
            connection, year, member_ids, domain_code
        ),
        "kpis": {
            "assessment_completion_rate": (
                round(assessment_completed / assessment_total, 4)
                if assessment_total
                else 0.0
            ),
            "assessment_completed_count": assessment_completed,
            "assessment_total_count": assessment_total,
            "plan_completion_rate": (
                round(plan_completed / plan_total, 4) if plan_total else 0.0
            ),
            "plan_completed_count": plan_completed,
            "plan_total_count": plan_total,
            "evidence_pass_rate": (
                round(evidence_passed / evidence_total, 4) if evidence_total else 0.0
            ),
            "evidence_passed_count": evidence_passed,
            "evidence_total_count": evidence_total,
            "overdue_plan_item_count": len(overdue_items),
        },
        "domain_averages": _team_analytics_domain_averages(
            connection, year, member_ids, domain_codes
        ),
        "member_attainment": _team_analytics_member_attainment(
            connection, year, member_ids, domain_codes
        ),
        "monthly_trends": _team_analytics_monthly_trends(
            connection, year, member_ids, domain_code
        ),
        "distributions": _team_analytics_distributions(
            connection, year, member_ids, domain_code
        ),
        "overdue_items": overdue_items,
    }


def list_change_proposals(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
) -> list[dict[str, object]]:
    """Read-only change proposals for a member/year (all statuses, none writable)."""
    proposals = connection.execute(
        """
        SELECT id, member_id, year, source_assessment_id,
               target_annual_growth_plan_id, status, created_by, summary,
               created_at
        FROM annual_plan_change_proposal
        WHERE member_id = %s AND year = %s
        ORDER BY id
        """,
        (member_id, year),
    ).fetchall()
    result: list[dict[str, object]] = []
    for row in proposals:
        proposal_id = int(row[0])
        details = connection.execute(
            """
            SELECT id, source_assessment_detail_id, assessment_id, l3_node_id,
                   l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
                   scope_type, current_level, standard_target_level,
                   adjusted_target_level, effective_target_level, gap_value,
                   member_priority, include_in_plan, plan_quarter, plan_month,
                   standard_job_level_snapshot, member_current_level_snapshot,
                   member_target_level_snapshot, capability_standard_version_id,
                   planning_snapshot_id, assessment_revision,
                   planning_source_type
            FROM annual_plan_change_proposal_detail
            WHERE proposal_id = %s
            ORDER BY l3_code
            """,
            (proposal_id,),
        ).fetchall()
        summary = row[7]
        if isinstance(summary, str):
            summary = json.loads(summary)
        result.append(
            {
                "id": proposal_id,
                "member_id": int(row[1]),
                "year": int(row[2]),
                "source_assessment_id": int(row[3]),
                "target_annual_growth_plan_id": int(row[4]),
                "status": str(row[5]),
                "created_by": int(row[6]),
                "summary": summary,
                "created_at": row[8],
                "details": [
                    {
                        "id": int(d[0]),
                        "source_assessment_detail_id": int(d[1]),
                        "assessment_id": int(d[2]),
                        "l3_node_id": int(d[3]),
                        "l1_code": d[4],
                        "l1_name": d[5],
                        "l2_code": d[6],
                        "l2_name": d[7],
                        "l3_code": d[8],
                        "l3_name": d[9],
                        "scope_type": d[10],
                        "current_level": d[11],
                        "standard_target_level": d[12],
                        "adjusted_target_level": d[13],
                        "effective_target_level": d[14],
                        "gap_value": d[15],
                        "member_priority": d[16],
                        "include_in_plan": d[17],
                        "plan_quarter": d[18],
                        "plan_month": d[19],
                        "standard_job_level_snapshot": d[20],
                        "member_current_level_snapshot": d[21],
                        "member_target_level_snapshot": d[22],
                        "capability_standard_version_id": d[23],
                        "planning_snapshot_id": d[24],
                        "assessment_revision": d[25],
                        "planning_source_type": d[26],
                    }
                    for d in details
                ],
            }
        )
    return result
