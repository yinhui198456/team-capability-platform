from typing import Any

import psycopg

from ..assessment.repository import get_gap
from .gate import check_annual_plan_gate, get_latest_submitted_assessment


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


_ALLOWED_TASK_STATUSES = {
    "未开始",
    "进行中",
    "待 Evidence Review",
    "已完成",
    "延期",
    "暂停",
    "取消",
}


_UPDATABLE_TASK_FIELDS = {
    "status",
    "actual_start_date",
    "actual_end_date",
    "actual_hours",
    "completion_quality",
    "review_conclusion",
    "next_action",
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
        created.append(_plan_item_row(inserted))
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

    inserted = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, '未开始')
        RETURNING id, plan_item_id, l3_code, status,
                  actual_start_date, actual_end_date, actual_hours,
                  completion_quality, review_conclusion, next_action
        """,
        (plan_item_id, row[1]),
    ).fetchone()
    assert inserted is not None
    return _learning_task_row(inserted)


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
               pi.expected_output, pi.estimated_hours
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
               pi.expected_output, pi.estimated_hours
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

    if "status" in updates and updates["status"] not in _ALLOWED_TASK_STATUSES:
        raise ValueError("invalid status")

    if "actual_hours" in updates:
        try:
            hours = int(updates["actual_hours"])  # type: ignore[arg-type]
        except (TypeError, ValueError) as exc:
            raise ValueError("actual_hours must be a non-negative integer") from exc
        if hours < 0:
            raise ValueError("actual_hours must be a non-negative integer")
        updates["actual_hours"] = hours

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
