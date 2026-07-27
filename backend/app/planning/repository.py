from datetime import date, datetime
from typing import Any

import psycopg

from ..access.repository import (
    get_assigned_members,
    get_primary_buddy,
    is_member_assigned_to_buddy,
)
from ..assessment.repository import get_gap
from ..catalog.repository import DOMAIN_CODES
from .gate import check_annual_plan_gate, get_latest_submitted_assessment


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
    return {
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
    }


def _get_l3_names(
    connection: psycopg.Connection, l3_codes: list[str]
) -> dict[str, str | None]:
    if not l3_codes:
        return {}
    # capability_node uses dots while task/gap codes use dashes.
    code_map = {code.replace("-", "."): code for code in l3_codes}
    rows = connection.execute(
        """
        SELECT code, name FROM capability_node
        WHERE node_type = 'L3' AND code = ANY(%s)
        """,
        (list(code_map.keys()),),
    ).fetchall()
    return {code_map[str(row[0])]: row[1] for row in rows}


_ALLOWED_TASK_STATUSES = {
    "未开始",
    "进行中",
    "待 Evidence Review",
    "已完成",
    "延期",
    "暂停",
    "取消",
}

_MEMBER_MANAGED_TASK_STATUSES = {
    "未开始",
    "进行中",
    "延期",
    "暂停",
    "取消",
}

_MEMBER_MANAGED_PLAN_ITEM_STATUSES = {"进行中", "暂停", "取消"}


_UPDATABLE_TASK_FIELDS = {
    "status",
    "actual_start_date",
    "actual_end_date",
    "completion_quality",
    "review_conclusion",
    "next_action",
}

_UPDATABLE_PLAN_ITEM_FIELDS = {
    "plan_start_date",
    "plan_end_date",
    "target_month",
    "status",
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
    return [
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
    ]


def create_growth_goal(
    connection: psycopg.Connection, member_id: int, gap_id: int
) -> dict[str, object]:
    gate = check_annual_plan_gate(connection, member_id)
    if not gate["eligible"]:
        raise ValueError(gate["reason"] or "annual plan gate not passed")

    gap = get_gap(connection, gap_id)
    if gap is None:
        raise ValueError("gap not found")

    latest = get_latest_submitted_assessment(connection, member_id)
    assert latest is not None
    if int(gap["assessment_id"]) != latest["id"] or int(gap["member_id"]) != member_id:
        raise ValueError("gap is not from latest approved assessment")

    year = int(latest["year"])
    annual_plan = get_or_create_annual_plan(connection, member_id, year)
    annual_plan_id = int(annual_plan["id"])

    existing = connection.execute(
        """
        SELECT 1 FROM growth_goal
        WHERE annual_growth_plan_id = %s AND l3_code = %s
        LIMIT 1
        """,
        (annual_plan_id, gap["l3_code"]),
    ).fetchone()
    if existing is not None:
        raise ValueError("growth goal already exists for this l3 code")

    row = connection.execute(
        """
        INSERT INTO growth_goal (
            gap_id, annual_growth_plan_id, l3_code, year, target_level, priority
        )
        VALUES (%s, %s, %s, %s, %s, %s)
        RETURNING id, gap_id, annual_growth_plan_id, l3_code,
                  year, target_level, priority
        """,
        (
            gap_id,
            annual_plan_id,
            gap["l3_code"],
            year,
            gap["target_level"],
            gap["priority"],
        ),
    ).fetchone()
    assert row is not None
    return {
        "id": row[0],
        "gap_id": row[1],
        "annual_growth_plan_id": row[2],
        "l3_code": row[3],
        "year": row[4],
        "target_level": row[5],
        "priority": row[6],
    }


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
    return [
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
    ]


def delete_growth_goal(
    connection: psycopg.Connection, member_id: int, goal_id: int
) -> None:
    with connection.transaction():
        row = connection.execute(
            """
            SELECT agp.member_id
            FROM growth_goal gg
            JOIN annual_growth_plan agp ON agp.id = gg.annual_growth_plan_id
            WHERE gg.id = %s
            """,
            (goal_id,),
        ).fetchone()
        if row is None:
            raise ValueError("growth goal not found")
        if int(row[0]) != member_id:
            raise PermissionError("growth goal does not belong to member")

        connection.execute("DELETE FROM growth_goal WHERE id = %s", (goal_id,))


def get_annual_plan_with_items(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, member_id, year, plan_cycle, status, start_date, end_date, created_at
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
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        ORDER BY pi.l3_code
        """,
        (member_id, year),
    ).fetchall()
    plan_items = [_plan_item_row(item) for item in items]
    l3_names = _get_l3_names(connection, [item["l3_code"] for item in plan_items])
    for item in plan_items:
        item["l3_name"] = l3_names.get(item["l3_code"])

    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "plan_cycle": row[3],
        "status": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": row[7],
        "items": plan_items,
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
    gate = check_annual_plan_gate(connection, member_id)
    if not gate["eligible"]:
        raise ValueError(gate["reason"] or "annual plan gate not passed")

    latest = get_latest_submitted_assessment(connection, member_id)
    assert latest is not None
    year = int(latest["year"])

    annual_plan = get_or_create_annual_plan(connection, member_id, year)
    annual_plan_id = int(annual_plan["id"])

    rows = connection.execute(
        """
        SELECT gg.id, gg.l3_code, gg.target_level, gg.priority, gap.current_level
        FROM growth_goal gg
        JOIN annual_growth_plan agp ON agp.id = gg.annual_growth_plan_id
        JOIN gap ON gap.id = gg.gap_id
        WHERE agp.member_id = %s AND agp.year = %s
          AND NOT EXISTS (
              SELECT 1 FROM plan_item pi
              WHERE pi.growth_goal_id = gg.id
          )
        ORDER BY gg.l3_code
        """,
        (member_id, year),
    ).fetchall()

    created: list[dict[str, object]] = []
    for row in rows:
        goal_id = row[0]
        l3_code = row[1]
        target_level = row[2]
        priority = row[3]
        current_level = row[4]
        defaults = _get_l3_defaults(connection, l3_code)
        inserted = connection.execute(
            """
            INSERT INTO plan_item (
                annual_growth_plan_id, growth_goal_id, l3_code, current_level,
                target_level, priority, learning_material, expected_output,
                estimated_hours, status
            )
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, '未开始')
            RETURNING id, annual_growth_plan_id, growth_goal_id, l3_code,
                      current_level, target_level, priority, learning_material,
                      learning_task_content, expected_output, estimated_hours,
                      plan_start_date, plan_end_date, target_month, status
            """,
            (
                annual_plan_id,
                goal_id,
                l3_code,
                current_level,
                target_level,
                priority,
                defaults["learning_material"],
                defaults["expected_output"],
                defaults["estimated_hours"],
            ),
        ).fetchone()
        assert inserted is not None
        item = _plan_item_row(inserted)
        _insert_learning_task(connection, int(item["id"]), l3_code)
        created.append(item)

    # Existing plans created before the 1:1 task invariant are repaired on the
    # next generation attempt. The unique constraint keeps this idempotent.
    missing_tasks = connection.execute(
        """
        SELECT pi.id, pi.l3_code
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
          AND NOT EXISTS (
              SELECT 1 FROM learning_task lt WHERE lt.plan_item_id = pi.id
          )
        """,
        (member_id, year),
    ).fetchall()
    for plan_item_id, l3_code in missing_tasks:
        _insert_learning_task(connection, int(plan_item_id), str(l3_code))
    return created


def list_plan_items(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT pi.id, pi.annual_growth_plan_id, pi.growth_goal_id, pi.l3_code,
               pi.current_level, pi.target_level, pi.priority, pi.learning_material,
               pi.learning_task_content, pi.expected_output, pi.estimated_hours,
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
        ORDER BY pi.l3_code
        """,
        (member_id,),
    ).fetchall()
    return [_plan_item_row(row) for row in rows]


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
    }


def create_learning_task(
    connection: psycopg.Connection, member_id: int, plan_item_id: int
) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT pi.id, pi.l3_code
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE pi.id = %s AND agp.member_id = %s
        """,
        (plan_item_id, member_id),
    ).fetchone()
    if row is None:
        raise PermissionError("plan item does not belong to member")

    existing = connection.execute(
        "SELECT 1 FROM learning_task WHERE plan_item_id = %s LIMIT 1",
        (plan_item_id,),
    ).fetchone()
    if existing is not None:
        raise ValueError("learning task already exists for this plan item")

    return _insert_learning_task(connection, plan_item_id, str(row[1]))


def _insert_learning_task(
    connection: psycopg.Connection, plan_item_id: int, l3_code: str
) -> dict[str, object]:
    inserted = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, '未开始')
        RETURNING id, plan_item_id, l3_code, status,
                  actual_start_date, actual_end_date, actual_hours,
                  completion_quality, review_conclusion, next_action
        """,
        (plan_item_id, l3_code),
    ).fetchone()
    assert inserted is not None
    return _learning_task_row(inserted)


def update_plan_item(
    connection: psycopg.Connection,
    member_id: int,
    plan_item_id: int,
    fields: dict[str, object],
) -> dict[str, object]:
    owned = connection.execute(
        """
        SELECT pi.id
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
            raise ValueError(f"field '{key}' is not updatable")
        updates[key] = value

    if "status" in updates:
        if updates["status"] not in _MEMBER_MANAGED_PLAN_ITEM_STATUSES:
            raise ValueError("plan item status is not member-manageable")
    if "target_month" in updates and updates["target_month"] is not None:
        try:
            target_month = int(updates["target_month"])  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise ValueError("target_month must be between 1 and 12") from exc
        if not 1 <= target_month <= 12:
            raise ValueError("target_month must be between 1 and 12")
        updates["target_month"] = target_month

    for key in ("plan_start_date", "plan_end_date"):
        value = updates.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError(f"{key} must be an ISO date")
        if isinstance(value, str):
            try:
                date.fromisoformat(value)
            except ValueError as exc:
                raise ValueError(f"{key} must be an ISO date") from exc

    if not updates:
        rows = list_plan_items(connection, member_id)
        return next(item for item in rows if item["id"] == plan_item_id)

    columns = list(updates.keys())
    set_clause = ", ".join(f"{column} = %s" for column in columns)
    values = [updates[column] for column in columns] + [plan_item_id]
    with connection.transaction():
        updated = connection.execute(
            f"""
            UPDATE plan_item
            SET {set_clause}
            WHERE id = %s
            RETURNING id, annual_growth_plan_id, growth_goal_id, l3_code,
                      current_level, target_level, priority, learning_material,
                      learning_task_content, expected_output, estimated_hours,
                      plan_start_date, plan_end_date, target_month, status
            """,
            values,
        ).fetchone()
        assert updated is not None
        if "status" in updates:
            connection.execute(
                "UPDATE learning_task SET status = %s WHERE plan_item_id = %s",
                (updates["status"], plan_item_id),
            )
    return _plan_item_row(updated)


def list_learning_tasks(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT lt.id, lt.plan_item_id, lt.l3_code, lt.status,
               lt.actual_start_date, lt.actual_end_date, lt.actual_hours,
               lt.completion_quality, lt.review_conclusion, lt.next_action,
               pi.current_level, pi.target_level, pi.priority,
               pi.learning_material, pi.learning_task_content,
               pi.expected_output, pi.estimated_hours, pi.target_month
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
        ORDER BY lt.l3_code
        """,
        (member_id,),
    ).fetchall()
    return [
        {
            **_learning_task_row(row[:10]),
            "plan_item_current_level": row[10],
            "plan_item_target_level": row[11],
            "plan_item_priority": row[12],
            "plan_item_learning_material": row[13],
            "plan_item_learning_task_content": row[14],
            "plan_item_expected_output": row[15],
            "plan_item_estimated_hours": row[16],
            "plan_item_target_month": row[17],
        }
        for row in rows
    ]


def get_learning_task(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT lt.id, lt.plan_item_id, lt.l3_code, lt.status,
               lt.actual_start_date, lt.actual_end_date, lt.actual_hours,
               lt.completion_quality, lt.review_conclusion, lt.next_action,
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
    return {
        **_learning_task_row(row[:10]),
        "plan_item_current_level": row[10],
        "plan_item_target_level": row[11],
        "plan_item_priority": row[12],
        "plan_item_learning_material": row[13],
        "plan_item_learning_task_content": row[14],
        "plan_item_expected_output": row[15],
        "plan_item_estimated_hours": row[16],
        "plan_item_target_month": row[17],
    }


def update_learning_task(
    connection: psycopg.Connection,
    member_id: int,
    task_id: int,
    fields: dict[str, object],
) -> dict[str, object]:
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
            raise ValueError(f"field '{key}' is not updatable")
        updates[key] = value

    if "status" in updates:
        if updates["status"] not in _ALLOWED_TASK_STATUSES:
            raise ValueError("invalid status")
        if updates["status"] not in _MEMBER_MANAGED_TASK_STATUSES:
            raise ValueError("task status is managed by Evidence Review")

    if not updates:
        row = connection.execute(
            """
            SELECT lt.id, lt.plan_item_id, lt.l3_code, lt.status,
                   lt.actual_start_date, lt.actual_end_date, lt.actual_hours,
                   lt.completion_quality, lt.review_conclusion, lt.next_action
            FROM learning_task lt
            WHERE lt.id = %s
            """,
            (task_id,),
        ).fetchone()
        assert row is not None
        return _learning_task_row(row)

    columns = list(updates.keys())
    set_clause = ", ".join(f"{col} = %s" for col in columns)
    values = [updates[col] for col in columns]
    values.append(task_id)

    with connection.transaction():
        updated = connection.execute(
            f"""
            UPDATE learning_task
            SET {set_clause}
            WHERE id = %s
            RETURNING id, plan_item_id, l3_code, status,
                      actual_start_date, actual_end_date, actual_hours,
                      completion_quality, review_conclusion, next_action
            """,
            values,
        ).fetchone()
        if "status" in updates:
            connection.execute(
                """
                UPDATE plan_item
                SET status = %s
                WHERE id = (SELECT plan_item_id FROM learning_task WHERE id = %s)
                """,
                (updates["status"], task_id),
            )
    assert updated is not None
    return _learning_task_row(updated)


_PROGRESS_LOG_UPDATABLE_FIELDS = {"record_date", "actual_hours", "note"}


def _progress_log_row(row: tuple[Any, ...]) -> dict[str, object]:
    return {
        "id": row[0],
        "task_id": row[1],
        "record_date": row[2],
        "actual_hours": row[3],
        "note": row[4],
        "recorder_id": row[5],
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
        raise ValueError("actual_hours must be a non-negative integer") from exc
    if hours < 0:
        raise ValueError("actual_hours must be a non-negative integer")
    return hours


def create_progress_log(
    connection: psycopg.Connection,
    member_id: int,
    task_id: int,
    record_date: str,
    actual_hours: object,
    note: object,
) -> dict[str, object]:
    _assert_task_ownership(connection, member_id, task_id)
    hours = _validate_actual_hours(actual_hours)

    row = connection.execute(
        """
        INSERT INTO learning_progress_log (
            task_id, record_date, actual_hours, note, recorder_id
        )
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id, task_id, record_date, actual_hours, note, recorder_id
        """,
        (task_id, record_date, hours, note, member_id),
    ).fetchone()
    assert row is not None
    return _progress_log_row(row)


def list_progress_logs(
    connection: psycopg.Connection, member_id: int, task_id: int
) -> list[dict[str, object]]:
    _assert_task_ownership(connection, member_id, task_id)
    rows = connection.execute(
        """
        SELECT id, task_id, record_date, actual_hours, note, recorder_id
        FROM learning_progress_log
        WHERE task_id = %s
        ORDER BY record_date DESC
        """,
        (task_id,),
    ).fetchall()
    return [_progress_log_row(row) for row in rows]


def _get_progress_log_for_member(
    connection: psycopg.Connection, member_id: int, log_id: int
) -> tuple[dict[str, object], int] | None:
    row = connection.execute(
        """
        SELECT lpl.id, lpl.task_id, lpl.record_date, lpl.actual_hours,
               lpl.note, lpl.recorder_id, agp.member_id
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
    log = _progress_log_row(row[:6])
    task_owner_id = int(row[6])
    return log, task_owner_id


def update_progress_log(
    connection: psycopg.Connection,
    member_id: int,
    log_id: int,
    fields: dict[str, object],
) -> dict[str, object]:
    result = _get_progress_log_for_member(connection, member_id, log_id)
    if result is None:
        raise KeyError("progress log not found")
    log, task_owner_id = result
    if int(log["recorder_id"]) != member_id or task_owner_id != member_id:
        raise PermissionError("progress log does not belong to member")

    updates: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _PROGRESS_LOG_UPDATABLE_FIELDS:
            raise ValueError(f"field '{key}' is not updatable")
        updates[key] = value

    if "actual_hours" in updates:
        updates["actual_hours"] = _validate_actual_hours(updates["actual_hours"])

    if not updates:
        return log

    columns = list(updates.keys())
    set_clause = ", ".join(f"{col} = %s" for col in columns)
    values = [updates[col] for col in columns]
    values.append(log_id)

    updated = connection.execute(
        f"""
        UPDATE learning_progress_log
        SET {set_clause}
        WHERE id = %s
        RETURNING id, task_id, record_date, actual_hours, note, recorder_id
        """,
        values,
    ).fetchone()
    assert updated is not None
    return _progress_log_row(updated)


def delete_progress_log(
    connection: psycopg.Connection, member_id: int, log_id: int
) -> None:
    result = _get_progress_log_for_member(connection, member_id, log_id)
    if result is None:
        raise KeyError("progress log not found")
    log, task_owner_id = result
    if int(log["recorder_id"]) != member_id or task_owner_id != member_id:
        raise PermissionError("progress log does not belong to member")
    connection.execute("DELETE FROM learning_progress_log WHERE id = %s", (log_id,))


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


def get_member_dashboard(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object]:
    """Return the Member-only, read-only aggregation used by UI-01."""
    current_month = _now(connection).month

    # Latest assessment of the year (including draft) drives the dashboard stage.
    latest_assessment_row = connection.execute(
        """
        SELECT id, status, submitted_at, archived_at
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
    plan_hours_row = connection.execute(
        """
        SELECT
            COALESCE(SUM(
                CASE WHEN pi.estimated_hours ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN pi.estimated_hours::DOUBLE PRECISION ELSE 0 END
            ), 0),
            COALESCE(SUM(
                CASE WHEN pi.target_month = %s
                      AND pi.estimated_hours ~ '^[0-9]+(\\.[0-9]+)?$'
                THEN pi.estimated_hours::DOUBLE PRECISION ELSE 0 END
            ), 0)
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (current_month, member_id, year),
    ).fetchone()
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
        SELECT COUNT(*)
        FROM evidence e
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
          AND e.status IN ('草稿', '待 Review', '需补充')
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
    waiting_review_row = connection.execute(
        """
        SELECT COUNT(*)
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
          AND agp.year = %s
          AND lt.status = '待 Evidence Review'
        """,
        (member_id, year),
    ).fetchone()
    current_tasks = [
        task
        for task in list_learning_tasks(connection, member_id)
        if task["status"] not in {"已完成", "取消"}
    ]

    # Gaps come from the latest submitted assessment, not limited to plan_candidate.
    gaps: list[dict[str, object]] = []
    if submitted_assessment_id is not None:
        gap_rows = connection.execute(
            """
            SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
                   g.target_level, g.gap_value, g.priority
            FROM gap g
            WHERE g.assessment_id = %s
            ORDER BY g.l3_code
            """,
            (submitted_assessment_id,),
        ).fetchall()
        gaps = [
            {
                "id": row[0],
                "assessment_id": row[1],
                "l3_code": row[2],
                "current_level": row[3],
                "target_level": row[4],
                "gap_value": row[5],
                "priority": row[6],
                "plan_candidate": False,
            }
            for row in gap_rows
        ]

    l3_codes = list(
        {gap["l3_code"] for gap in gaps} | {task["l3_code"] for task in current_tasks}
    )
    l3_names = _get_l3_names(connection, l3_codes)
    for gap in gaps:
        gap["l3_name"] = l3_names.get(gap["l3_code"])
    for task in current_tasks:
        task["l3_name"] = l3_names.get(task["l3_code"])

    assessment_out: dict[str, object] | None = None
    if latest_assessment is not None:
        assessment_out = {
            **latest_assessment,
            "review_status": review_status,
            "review_conclusion": review_conclusion,
        }

    return {
        "year": year,
        "assessment": assessment_out,
        "annual_plan_status": annual_plan_status,
        "summary": {
            "annual_actual_hours": int(total_hours_row[0]) if total_hours_row else 0,
            "annual_planned_hours": float(plan_hours_row[0]) if plan_hours_row else 0,
            "current_month_actual_hours": (
                int(current_month_hours_row[0]) if current_month_hours_row else 0
            ),
            "current_month_planned_hours": (
                float(plan_hours_row[1]) if plan_hours_row else 0
            ),
            "completed_task_count": int(completed_row[0]) if completed_row else 0,
            "pending_evidence_count": (
                int(pending_evidence_row[0]) if pending_evidence_row else 0
            ),
        },
        "plan_progress": {
            "total": sum(progress.values()),
            "未开始": progress.get("未开始", 0),
            "进行中": progress.get("进行中", 0),
            "待 Evidence Review": (
                int(waiting_review_row[0]) if waiting_review_row else 0
            ),
            "已完成": progress.get("已完成", 0),
            "延期": progress.get("延期", 0),
        },
        "domain_radar": [
            {"domain_code": code, "score": scores.get(code, 0)}
            for code in ("P01", "P02", "P03", "C01", "C02", "C03")
        ],
        "gaps": gaps,
        "current_tasks": current_tasks,
    }


_EVIDENCE_UPDATABLE_FIELDS = {"content", "evidence_link"}

_ALLOWED_EVIDENCE_STATUSES = {
    "草稿",
    "待 Review",
    "通过",
    "需补充",
    "驳回",
    "已归档",
}


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
    }


def _assert_evidence_ownership(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object]:
    row = connection.execute(
        """
        SELECT e.id, e.learning_task_id, e.l3_code, e.version_number,
               e.content, e.evidence_link, e.status, e.submitted_at, e.created_at
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
    return _evidence_row(row)


def create_evidence_draft(
    connection: psycopg.Connection,
    member_id: int,
    learning_task_id: int,
    content: object,
    evidence_link: object,
) -> dict[str, object]:
    _assert_task_ownership(connection, member_id, learning_task_id)

    task = connection.execute(
        "SELECT l3_code FROM learning_task WHERE id = %s",
        (learning_task_id,),
    ).fetchone()
    assert task is not None
    l3_code = task[0]

    draft = connection.execute(
        """
        SELECT 1 FROM evidence
        WHERE learning_task_id = %s AND status = '草稿'
        LIMIT 1
        """,
        (learning_task_id,),
    ).fetchone()
    if draft is not None:
        raise ValueError("draft evidence already exists for this task")

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

    row = connection.execute(
        """
        INSERT INTO evidence (
            learning_task_id, l3_code, version_number, content,
            evidence_link, status
        )
        VALUES (%s, %s, %s, %s, %s, '草稿')
        RETURNING id, learning_task_id, l3_code, version_number,
                  content, evidence_link, status, submitted_at, created_at
        """,
        (learning_task_id, l3_code, version_number, content, evidence_link),
    ).fetchone()
    assert row is not None
    return _evidence_row(row)


def update_evidence_draft(
    connection: psycopg.Connection,
    member_id: int,
    evidence_id: int,
    fields: dict[str, object],
) -> dict[str, object]:
    evidence = _assert_evidence_ownership(connection, member_id, evidence_id)
    if evidence["status"] != "草稿":
        raise ValueError("only draft evidence can be updated")

    updates: dict[str, object] = {}
    for key, value in fields.items():
        if key not in _EVIDENCE_UPDATABLE_FIELDS:
            raise ValueError(f"field '{key}' is not updatable")
        updates[key] = value

    if not updates:
        return evidence

    columns = list(updates.keys())
    set_clause = ", ".join(f"{col} = %s" for col in columns)
    values = [updates[col] for col in columns]
    values.append(evidence_id)

    row = connection.execute(
        f"""
        UPDATE evidence
        SET {set_clause}
        WHERE id = %s
        RETURNING id, learning_task_id, l3_code, version_number,
                  content, evidence_link, status, submitted_at, created_at
        """,
        values,
    ).fetchone()
    assert row is not None
    return _evidence_row(row)


def submit_evidence(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object]:
    evidence = _assert_evidence_ownership(connection, member_id, evidence_id)
    if evidence["status"] != "草稿":
        raise ValueError("only draft evidence can be submitted")

    buddy = get_primary_buddy(connection, member_id)
    if buddy is None:
        raise ValueError("no primary buddy assigned")

    with connection.transaction():
        row = connection.execute(
            """
            UPDATE evidence
            SET status = '待 Review', submitted_at = NOW()
            WHERE id = %s
            RETURNING id, learning_task_id, l3_code, version_number,
                      content, evidence_link, status, submitted_at, created_at
            """,
            (evidence_id,),
        ).fetchone()
        assert row is not None
        submitted = _evidence_row(row)

        connection.execute(
            """
            INSERT INTO evidence_review (evidence_id, buddy_id, status)
            VALUES (%s, %s, '待 Review')
            """,
            (evidence_id, int(buddy["id"])),
        )
        connection.execute(
            """
            UPDATE learning_task
            SET status = '待 Evidence Review'
            WHERE id = %s
            """,
            (int(submitted["learning_task_id"]),),
        )
        connection.execute(
            """
            UPDATE plan_item
            SET status = '进行中'
            WHERE id = (
                SELECT plan_item_id FROM learning_task WHERE id = %s
            )
            """,
            (int(submitted["learning_task_id"]),),
        )

    return submitted


def list_evidences(
    connection: psycopg.Connection, member_id: int, learning_task_id: int
) -> list[dict[str, object]]:
    _assert_task_ownership(connection, member_id, learning_task_id)
    rows = connection.execute(
        """
        SELECT e.id, e.learning_task_id, e.l3_code, e.version_number,
               e.content, e.evidence_link, e.status, e.submitted_at, e.created_at
        FROM evidence e
        WHERE e.learning_task_id = %s
        ORDER BY e.version_number DESC
        """,
        (learning_task_id,),
    ).fetchall()
    return [_evidence_row(row) for row in rows]


def get_evidence(
    connection: psycopg.Connection, member_id: int, evidence_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT e.id, e.learning_task_id, e.l3_code, e.version_number,
               e.content, e.evidence_link, e.status, e.submitted_at, e.created_at
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
    return _evidence_row(row)


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
    rows = connection.execute(
        """
        SELECT er.id, er.evidence_id, e.submitted_at,
               agp.member_id, u.username, e.learning_task_id,
               e.l3_code, e.version_number, e.content, e.evidence_link
        FROM evidence_review er
        JOIN evidence e ON e.id = er.evidence_id
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        JOIN tcp_user u ON u.id = agp.member_id
        WHERE er.buddy_id = %s AND er.status = '待 Review'
        ORDER BY e.submitted_at ASC NULLS LAST
        """,
        (buddy_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "evidence_id": row[1],
            "submitted_at": row[2],
            "member_id": row[3],
            "username": row[4],
            "learning_task_id": row[5],
            "l3_code": row[6],
            "version_number": row[7],
            "content": row[8],
            "evidence_link": row[9],
        }
        for row in rows
    ]


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
    return {
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


def submit_evidence_review(
    connection: psycopg.Connection,
    review_id: int,
    buddy_id: int,
    conclusion: str,
    feedback: object,
) -> dict[str, object]:
    if conclusion not in ("通过", "需补充", "驳回"):
        raise ValueError("invalid conclusion")

    with connection.transaction():
        row = connection.execute(
            """
            SELECT er.evidence_id, er.buddy_id, er.status, agp.member_id,
                   e.learning_task_id
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
            raise ValueError("review not found")
        evidence_id, review_buddy_id, review_status, member_id, task_id = row
        if int(review_buddy_id) != buddy_id:
            raise ValueError("review is not assigned to this buddy")
        if review_status != "待 Review":
            raise ValueError("review is not pending")
        if not is_member_assigned_to_buddy(connection, int(member_id), buddy_id):
            raise ValueError("buddy is not assigned to member")

        reviewed_at = _now(connection)
        updated = connection.execute(
            """
            UPDATE evidence_review
            SET status = %s, conclusion = %s, feedback = %s, reviewed_at = %s
            WHERE id = %s
            RETURNING id, evidence_id, buddy_id, status, conclusion,
                      feedback, reviewed_at, created_at
            """,
            (conclusion, conclusion, feedback, reviewed_at, review_id),
        ).fetchone()
        assert updated is not None

        evidence_status = "已归档" if conclusion == "通过" else conclusion
        connection.execute(
            "UPDATE evidence SET status = %s WHERE id = %s",
            (evidence_status, evidence_id),
        )
        task_status = "已完成" if conclusion == "通过" else "进行中"
        connection.execute(
            "UPDATE learning_task SET status = %s WHERE id = %s",
            (task_status, task_id),
        )
        connection.execute(
            """
            UPDATE plan_item
            SET status = %s
            WHERE id = (SELECT plan_item_id FROM learning_task WHERE id = %s)
            """,
            (task_status, task_id),
        )

    return _evidence_review_row(updated)


def get_evidence_review_summary_for_buddy(
    connection: psycopg.Connection,
    buddy_id: int,
    year: int,
) -> dict[str, int]:
    """Return pending and completed evidence review counts for a Buddy in a year."""
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE er.status = '待 Review') AS pending_count,
            COUNT(*) FILTER (
                WHERE er.status != '待 Review'
                  AND EXTRACT(YEAR FROM er.reviewed_at)::INT = %s
            ) AS completed_count
        FROM evidence_review er
        JOIN evidence e ON e.id = er.evidence_id
        JOIN learning_task lt ON lt.id = e.learning_task_id
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE er.buddy_id = %s AND agp.year = %s
        """,
        (year, buddy_id, year),
    ).fetchone()
    if row is None:
        return {"pending_count": 0, "completed_count": 0}
    return {
        "pending_count": int(row[0] or 0),
        "completed_count": int(row[1] or 0),
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


def _annual_plan_with_items_for_member(
    connection: psycopg.Connection, member_id: int, year: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, member_id, year, plan_cycle, status, start_date, end_date, created_at
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
               pi.plan_start_date, pi.plan_end_date, pi.target_month, pi.status
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        ORDER BY pi.l3_code
        """,
        (member_id, year),
    ).fetchall()
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "plan_cycle": row[3],
        "status": row[4],
        "start_date": row[5],
        "end_date": row[6],
        "created_at": row[7],
        "items": [_plan_item_row(item) for item in items],
    }


def _learning_task_with_logs_and_evidences(
    connection: psycopg.Connection, plan_item_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT lt.id, lt.plan_item_id, lt.l3_code, lt.status,
               lt.actual_start_date, lt.actual_end_date, lt.actual_hours,
               lt.completion_quality, lt.review_conclusion, lt.next_action
        FROM learning_task lt
        WHERE lt.plan_item_id = %s
        """,
        (plan_item_id,),
    ).fetchone()
    if row is None:
        return None
    task_id = row[0]
    logs = connection.execute(
        """
        SELECT id, task_id, record_date, actual_hours, note, recorder_id
        FROM learning_progress_log
        WHERE task_id = %s
        ORDER BY record_date DESC
        """,
        (task_id,),
    ).fetchall()
    evidences = connection.execute(
        """
        SELECT e.id, e.learning_task_id, e.l3_code, e.version_number,
               e.content, e.evidence_link, e.status, e.submitted_at, e.created_at,
               er.id, er.status, er.conclusion, er.feedback, er.reviewed_at
        FROM evidence e
        LEFT JOIN evidence_review er ON er.evidence_id = e.id
        WHERE e.learning_task_id = %s
        ORDER BY e.version_number DESC
        """,
        (task_id,),
    ).fetchall()
    return {
        **_learning_task_row(row),
        "progress_logs": [_progress_log_row(log) for log in logs],
        "evidences": [
            {
                **_evidence_row(evidence[:9]),
                "review": (
                    {
                        "id": evidence[9],
                        "status": evidence[10],
                        "conclusion": evidence[11],
                        "feedback": evidence[12],
                        "reviewed_at": evidence[13],
                    }
                    if evidence[9] is not None
                    else None
                ),
            }
            for evidence in evidences
        ],
    }


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
               created_at, submitted_at, archived_at
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
                "reviews": [
                    _assessment_review_row(review_row) for review_row in review_rows
                ],
            }
        )

    annual_plan = _annual_plan_with_items_for_member(connection, member_id, year)
    if annual_plan is not None:
        enriched_items = []
        for item in annual_plan["items"]:
            task = _learning_task_with_logs_and_evidences(connection, int(item["id"]))
            if task is not None:
                task["l3_name"] = item.get("l3_name")
            enriched_items.append({**item, "learning_task": task})
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

    planned_hours_row = connection.execute(
        """
        SELECT COALESCE(
            SUM(
                CAST(
                    NULLIF(regexp_substr(pi.estimated_hours, '\\d+'), '')
                    AS NUMERIC
                )
            ),
            0
        )
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s AND agp.year = %s
        """,
        (member_id, year),
    ).fetchone()
    total_planned_hours = int(planned_hours_row[0]) if planned_hours_row else 0

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

    return {
        **profile,
        "member": {
            "id": member_row[0],
            "username": member_row[1],
            "full_name": member_row[2],
            "current_level": member_row[3],
            "target_level": member_row[4],
        },
        "assessments": assessments,
        "annual_plan": annual_plan,
        "statistics": {
            "total_learning_hours": total_learning_hours,
            "total_planned_hours": total_planned_hours,
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
    return [
        {
            "id": row[0],
            "username": row[1],
            "full_name": row[2],
            "current_level": row[3],
            "target_level": row[4],
        }
    ]


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


_TEAM_ANALYTICS_DOMAIN_CODES = list(DOMAIN_CODES)


def _parse_hours_sql(column: str) -> str:
    return (
        "COALESCE(CAST(NULLIF(REGEXP_REPLACE("
        f"COALESCE({column}, ''), '[^0-9]', '', 'g'), '') AS INTEGER), 0)"
    )


def validate_team_analytics_domain_filter(
    connection: psycopg.Connection, domain_code: str | None
) -> None:
    """Validate an optional L1 domain filter for team analytics.

    Raises ValueError when the code is not an enabled MVP L1 domain.
    """
    if domain_code is None:
        return
    _validate_focus_domains(connection, [domain_code])


def _team_analytics_member_scope(
    connection: psycopg.Connection, member_id: int | None
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT u.id, u.username, u.full_name
        FROM tcp_user u
        JOIN tcp_user_role ur ON ur.user_id = u.id
        JOIN tcp_role r ON r.id = ur.role_id
        WHERE r.code = 'Member'
          AND (%s::BIGINT IS NULL OR u.id = %s::BIGINT)
        ORDER BY u.id
        """,
        (member_id, member_id),
    ).fetchall()
    return [
        {"member_id": row[0], "username": row[1], "full_name": row[2]} for row in rows
    ]


def _team_analytics_assessment_kpi(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> tuple[int, int]:
    row = connection.execute(
        """
        WITH member_scope AS (
            SELECT DISTINCT u.id
            FROM tcp_user u
            JOIN tcp_user_role ur ON ur.user_id = u.id
            JOIN tcp_role r ON r.id = ur.role_id
            WHERE r.code = 'Member'
              AND (%s::BIGINT IS NULL OR u.id = %s::BIGINT)
        ), latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
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
        (member_id, member_id, year, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_plan_kpi(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> tuple[int, int]:
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (WHERE pi.status = '已完成') AS completed,
            COUNT(*) AS total
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s AND pi.status != '取消'
          AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_id, member_id, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_evidence_kpi(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> tuple[int, int]:
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
          AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_id, member_id, domain_code, domain_code),
    ).fetchone()
    if row is None:
        return 0, 0
    return int(row[0] or 0), int(row[1] or 0)


def _team_analytics_overdue_items(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> list[dict[str, object]]:
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
              AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
              AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        )
        SELECT d.member_id, u.username, u.full_name,
               d.l3_code, cn.name AS l3_name,
               d.due_date, (CURRENT_DATE - d.due_date) AS overdue_days, d.status
        FROM due d
        JOIN tcp_user u ON u.id = d.member_id
        LEFT JOIN capability_node cn ON cn.code = d.l3_code AND cn.node_type = 'L3'
        WHERE d.due_date IS NOT NULL AND d.due_date < CURRENT_DATE
        ORDER BY overdue_days DESC, d.l3_code
        """,
        (year, year, member_id, member_id, domain_code, domain_code),
    ).fetchall()
    return [
        {
            "member_id": row[0],
            "username": row[1],
            "full_name": row[2],
            "l3_code": row[3],
            "l3_name": row[4],
            "due_date": str(row[5]) if row[5] is not None else None,
            "overdue_days": int(row[6]) if row[6] is not None else 0,
            "status": row[7],
        }
        for row in rows
    ]


def _team_analytics_domain_averages(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_codes: list[str],
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        WITH latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id, a.status
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
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
          AND (%s::BIGINT IS NULL OR la.member_id = %s::BIGINT)
          AND LEFT(ad.l3_code, 3) = ANY(%s)
        GROUP BY LEFT(ad.l3_code, 3)
        """,
        (year, member_id, member_id, domain_codes),
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
    member_id: int | None,
    domain_codes: list[str],
) -> list[dict[str, object]]:
    members = _team_analytics_member_scope(connection, member_id)
    if not members:
        return []

    rows = connection.execute(
        """
        WITH latest_assessments AS (
            SELECT DISTINCT ON (a.member_id)
                   a.id, a.member_id, a.status
            FROM assessment a
            WHERE a.year = %s AND a.status != '草稿'
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
          AND (%s::BIGINT IS NULL OR la.member_id = %s::BIGINT)
          AND LEFT(ad.l3_code, 3) = ANY(%s)
        GROUP BY la.member_id, LEFT(ad.l3_code, 3)
        ORDER BY la.member_id, LEFT(ad.l3_code, 3)
        """,
        (year, member_id, member_id, domain_codes),
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


def _team_analytics_monthly_trends(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> list[dict[str, object]]:
    hours_sql = _parse_hours_sql("pi.estimated_hours")
    planned_rows = connection.execute(
        f"""
        SELECT month, COUNT(*) AS planned_count, SUM(hours) AS planned_hours
        FROM (
            SELECT
                CASE
                    WHEN pi.target_month IS NOT NULL THEN pi.target_month
                    WHEN pi.plan_end_date IS NOT NULL THEN
                        EXTRACT(MONTH FROM pi.plan_end_date)::INT
                END AS month,
                {hours_sql} AS hours
            FROM plan_item pi
            JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
            WHERE agp.year = %s AND pi.status != '取消'
              AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
              AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        ) t
        WHERE month IS NOT NULL
        GROUP BY month
        ORDER BY month
        """,
        (year, member_id, member_id, domain_code, domain_code),
    ).fetchall()
    planned_by_month = {int(row[0]): (int(row[1]), int(row[2])) for row in planned_rows}

    actual_count_rows = connection.execute(
        """
        SELECT EXTRACT(MONTH FROM lt.actual_end_date)::INT AS month,
               COUNT(*) AS actual_count
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE lt.status = '已完成' AND EXTRACT(YEAR FROM lt.actual_end_date) = %s
          AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        GROUP BY month
        ORDER BY month
        """,
        (year, member_id, member_id, domain_code, domain_code),
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
          AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        GROUP BY month
        ORDER BY month
        """,
        (year, member_id, member_id, domain_code, domain_code),
    ).fetchall()
    actual_hours_by_month = {int(row[0]): int(row[1]) for row in actual_hours_rows}

    total_row = connection.execute(
        """
        SELECT COUNT(*)
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.year = %s AND pi.status != '取消'
          AND (%s::BIGINT IS NULL OR agp.member_id = %s::BIGINT)
          AND (%s::TEXT IS NULL OR LEFT(pi.l3_code, 3) = %s::TEXT)
        """,
        (year, member_id, member_id, domain_code, domain_code),
    ).fetchone()
    total_plan_items = int(total_row[0]) if total_row else 0

    trends: list[dict[str, object]] = []
    cumulative_planned = 0
    cumulative_actual = 0
    cumulative_planned_hours = 0
    cumulative_actual_hours = 0
    for month in range(1, 13):
        planned_count, planned_hours = planned_by_month.get(month, (0, 0))
        actual_count = actual_count_by_month.get(month, 0)
        actual_hours = actual_hours_by_month.get(month, 0)

        cumulative_planned += planned_count
        cumulative_actual += actual_count
        cumulative_planned_hours += planned_hours
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
                "planned_hours": planned_hours,
                "actual_hours": actual_hours,
                "cumulative_planned_hours": cumulative_planned_hours,
                "cumulative_actual_hours": cumulative_actual_hours,
            }
        )
    return trends


def get_team_analytics(
    connection: psycopg.Connection,
    year: int,
    member_id: int | None,
    domain_code: str | None,
) -> dict[str, object]:
    """Return Leader-only, read-only team analytics aggregates used by UI-05."""
    domain_codes = (
        [domain_code] if domain_code is not None else _TEAM_ANALYTICS_DOMAIN_CODES
    )

    assessment_completed, assessment_total = _team_analytics_assessment_kpi(
        connection, year, member_id, domain_code
    )
    plan_completed, plan_total = _team_analytics_plan_kpi(
        connection, year, member_id, domain_code
    )
    evidence_passed, evidence_total = _team_analytics_evidence_kpi(
        connection, year, member_id, domain_code
    )
    overdue_items = _team_analytics_overdue_items(
        connection, year, member_id, domain_code
    )

    return {
        "year": year,
        "filters": {
            "member_id": member_id,
            "domain_code": domain_code,
        },
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
            connection, year, member_id, domain_codes
        ),
        "member_attainment": _team_analytics_member_attainment(
            connection, year, member_id, domain_codes
        ),
        "monthly_trends": _team_analytics_monthly_trends(
            connection, year, member_id, domain_code
        ),
        "overdue_items": overdue_items,
    }
