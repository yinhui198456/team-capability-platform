import psycopg

from ..assessment.repository import get_gap
from .gate import check_annual_plan_gate, get_latest_submitted_assessment


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
