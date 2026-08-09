from typing import Any

import psycopg


def get_latest_submitted_assessment(
    connection: psycopg.Connection, member_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, member_id, year, version, assessment_type, status,
               created_at, submitted_at, archived_at
        FROM assessment
        WHERE member_id = %s
          AND status IN ('待复核', '已复核', '建议调整', '已归档')
        ORDER BY submitted_at DESC NULLS LAST, id DESC
        LIMIT 1
        """,
        (member_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "version": row[3],
        "assessment_type": row[4],
        "status": row[5],
        "created_at": row[6],
        "submitted_at": row[7],
        "archived_at": row[8],
    }


def _latest_closed_review(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, assessment_id, sequence, buddy_id, conclusion,
               feedback, reviewed_at, status
        FROM assessment_review
        WHERE assessment_id = %s AND status = '已闭环'
        ORDER BY sequence DESC
        LIMIT 1
        """,
        (assessment_id,),
    ).fetchone()
    if row is None:
        return None
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


def _has_pending_review(connection: psycopg.Connection, assessment_id: int) -> bool:
    row = connection.execute(
        "SELECT 1 FROM assessment_review "
        "WHERE assessment_id = %s AND status = '待复核' LIMIT 1",
        (assessment_id,),
    ).fetchone()
    return row is not None


def check_annual_plan_gate(
    connection: psycopg.Connection, member_id: int
) -> dict[str, Any]:
    """
    Issue #82: Weak management flow generates plans atomically when an
    assessment is submitted. This gate remains for backward compatibility and
    returns eligible whenever a submitted assessment exists.
    """
    latest = get_latest_submitted_assessment(connection, member_id)
    if latest is None:
        return {"eligible": False, "reason": "暂无已提交的能力评估"}

    # Issue #82: No longer blocks on Buddy review - plans are generated immediately
    return {"eligible": True, "reason": None}
