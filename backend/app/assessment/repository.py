from typing import Any

import psycopg

from ..access.repository import get_primary_buddy, is_member_assigned_to_buddy


def _now(connection: psycopg.Connection) -> Any:
    return connection.execute("SELECT NOW()").fetchone()[0]


def create_assessment_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    assessment_type: str = "年度",
) -> int:
    with connection.transaction():
        row = connection.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM assessment
            WHERE member_id = %s AND year = %s
            """,
            (member_id, year),
        ).fetchone()
        assert row is not None
        version = row[0]

        row = connection.execute(
            """
            INSERT INTO assessment (member_id, year, version, assessment_type, status)
            VALUES (%s, %s, %s, %s, '草稿')
            RETURNING id
            """,
            (member_id, year, version, assessment_type),
        ).fetchone()
        assert row is not None
        assessment_id = row[0]

        # Pre-populate detail rows from capability model. Use a savepoint
        # so that missing catalog tables (e.g. test DB) don't abort the
        # outer transaction.
        try:
            with connection.transaction():
                connection.execute(
                    """
                    INSERT INTO assessment_detail (
                        assessment_id, l3_code, current_level, target_level,
                        gap_value, evidence_note, plan_candidate
                    )
                    SELECT
                        %s,
                        c.code,
                        NULL,
                        NULL,
                        0,
                        NULL,
                        FALSE
                    FROM capability_node c
                    WHERE c.node_type = 'L3' AND c.enabled = TRUE
                    """,
                    (assessment_id,),
                )
        except psycopg.errors.UndefinedTable:
            pass  # capability_node doesn't exist (e.g. test DB without catalog)

    return assessment_id


def get_assessment(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT id, member_id, year, version, assessment_type, status,
               created_at, submitted_at, archived_at
        FROM assessment
        WHERE id = %s
        """,
        (assessment_id,),
    ).fetchone()
    if row is None:
        return None

    details = _get_assessment_details(connection, assessment_id)
    gap_summary = _get_gap_summary(connection, assessment_id)
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
        "details": details,
        "gap_summary": gap_summary,
    }


def _get_assessment_details(
    connection: psycopg.Connection, assessment_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT ad.id, ad.l3_code, ad.current_level, ad.target_level, ad.gap_value,
               ad.evidence_note, ad.plan_candidate,
               c.name AS l3_name,
               c.recommended_start_level,
               l1.code AS l1_code, l1.name AS l1_name
        FROM assessment_detail ad
        LEFT JOIN capability_node c ON c.code = ad.l3_code AND c.node_type = 'L3'
        LEFT JOIN capability_node l2 ON l2.id = c.parent_node_id
        LEFT JOIN capability_node l1 ON l1.id = l2.parent_node_id
        WHERE ad.assessment_id = %s
        ORDER BY l1.code, c.code
        """,
        (assessment_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "l3_code": row[1],
            "current_level": row[2],
            "target_level": row[3],
            "gap_value": row[4],
            "evidence_note": row[5],
            "plan_candidate": row[6],
            "l3_name": row[7],
            "recommended_start_level": row[8],
            "l1_code": row[9],
            "l1_name": row[10],
        }
        for row in rows
    ]


def _get_gap_summary(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object]:
    """Aggregate gap statistics for the assessment's Gap sidebar."""
    gaps = [
        max(int(row[0]) - int(row[1]), 0)
        for row in connection.execute(
            """
            SELECT target_level, current_level
            FROM assessment_detail
            WHERE assessment_id = %s AND target_level > current_level
            """,
            (assessment_id,),
        ).fetchall()
    ]
    total = len(gaps)
    avg = round(sum(gaps) / total, 1) if total > 0 else 0
    by_priority: dict[str, int] = {"高": 0, "中": 0, "低": 0}
    for g in gaps:
        if g >= 3:
            by_priority["高"] += 1
        elif g > 0:
            by_priority["中"] += 1
        else:
            by_priority["低"] += 1
    return {
        "total_gaps": total,
        "avg_gap": avg,
        "high_priority": by_priority["高"],
        "medium_priority": by_priority["中"],
        "low_priority": by_priority["低"],
    }


def list_member_assessments(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT id, member_id, year, version, assessment_type, status,
               created_at, submitted_at, archived_at
        FROM assessment
        WHERE member_id = %s
        ORDER BY created_at DESC
        """,
        (member_id,),
    ).fetchall()
    return [
        {
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
        for row in rows
    ]


def save_assessment_draft(
    connection: psycopg.Connection,
    assessment_id: int,
    member_id: int,
    details: list[dict[str, object]],
) -> None:
    with connection.transaction():
        row = connection.execute(
            "SELECT status, member_id FROM assessment WHERE id = %s",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not editable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        connection.execute(
            "DELETE FROM assessment_detail WHERE assessment_id = %s",
            (assessment_id,),
        )
        for detail in details:
            cl = detail.get("current_level")
            tl = detail.get("target_level")
            current_level = int(cl) if cl is not None else None
            target_level = int(tl) if tl is not None else None
            if current_level is not None and not (1 <= current_level <= 5):
                raise ValueError("current_level must be between 1 and 5")
            if target_level is not None and not (1 <= target_level <= 5):
                raise ValueError("target_level must be between 1 and 5")
            connection.execute(
                """
                INSERT INTO assessment_detail (
                    assessment_id, l3_code, current_level, target_level,
                    gap_value, evidence_note, plan_candidate
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                (
                    assessment_id,
                    detail["l3_code"],
                    current_level,
                    target_level,
                    target_level - current_level,
                    detail.get("evidence_note"),
                    detail.get("plan_candidate", False),
                ),
            )


def submit_assessment(
    connection: psycopg.Connection, assessment_id: int, member_id: int
) -> None:
    with connection.transaction():
        row = connection.execute(
            "SELECT status, member_id FROM assessment WHERE id = %s",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not submittable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        submitted_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment
            SET status = '待复核', submitted_at = %s
            WHERE id = %s
            """,
            (submitted_at, assessment_id),
        )

        primary_buddy = get_primary_buddy(connection, member_id)
        buddy_id = primary_buddy["id"] if primary_buddy else None
        next_sequence = _next_review_sequence(connection, assessment_id)

        connection.execute(
            """
            INSERT INTO assessment_review (
                assessment_id, sequence, buddy_id, status
            )
            VALUES (%s, %s, %s, '待复核')
            """,
            (assessment_id, next_sequence, buddy_id),
        )

        generate_gaps_for_assessment(connection, assessment_id)


def generate_gaps_for_assessment(
    connection: psycopg.Connection, assessment_id: int
) -> None:
    details = _get_assessment_details(connection, assessment_id)
    for detail in details:
        gap_value = int(detail["gap_value"])
        if gap_value > 0:
            connection.execute(
                """
                INSERT INTO gap (
                    assessment_id, l3_code, current_level, target_level,
                    gap_value, plan_candidate
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (assessment_id, l3_code)
                DO UPDATE SET
                    current_level = EXCLUDED.current_level,
                    target_level = EXCLUDED.target_level,
                    gap_value = EXCLUDED.gap_value,
                    plan_candidate = EXCLUDED.plan_candidate
                """,
                (
                    assessment_id,
                    detail["l3_code"],
                    detail["current_level"],
                    detail["target_level"],
                    gap_value,
                    detail["plan_candidate"],
                ),
            )
        else:
            connection.execute(
                """
                DELETE FROM gap
                WHERE assessment_id = %s AND l3_code = %s
                """,
                (assessment_id, detail["l3_code"]),
            )


def list_gaps(
    connection: psycopg.Connection,
    member_id: int | None = None,
    assessment_id: int | None = None,
) -> list[dict[str, object]]:
    where_clauses: list[str] = []
    params: list[object] = []
    if assessment_id is not None:
        where_clauses.append("g.assessment_id = %s")
        params.append(assessment_id)
    if member_id is not None:
        where_clauses.append("a.member_id = %s")
        params.append(member_id)

    where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    rows = connection.execute(
        f"""
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate,
               a.member_id
        FROM gap g
        JOIN assessment a ON a.id = g.assessment_id
        {where}
        ORDER BY g.l3_code
        """,
        tuple(params),
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
            "member_id": row[8],
        }
        for row in rows
    ]


def get_gap(connection: psycopg.Connection, gap_id: int) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate,
               a.member_id
        FROM gap g
        JOIN assessment a ON a.id = g.assessment_id
        WHERE g.id = %s
        """,
        (gap_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "assessment_id": row[1],
        "l3_code": row[2],
        "current_level": row[3],
        "target_level": row[4],
        "gap_value": row[5],
        "priority": row[6],
        "plan_candidate": row[7],
        "member_id": row[8],
    }


def update_gap(
    connection: psycopg.Connection,
    gap_id: int,
    member_id: int,
    priority: str,
    plan_candidate: bool,
) -> None:
    if priority not in ("高", "中", "低"):
        raise ValueError("invalid priority")

    with connection.transaction():
        row = connection.execute(
            """
            SELECT a.member_id
            FROM gap g
            JOIN assessment a ON a.id = g.assessment_id
            WHERE g.id = %s
            """,
            (gap_id,),
        ).fetchone()
        if row is None:
            raise ValueError("gap not found")
        if int(row[0]) != member_id:
            raise ValueError("gap does not belong to member")

        connection.execute(
            """
            UPDATE gap
            SET priority = %s, plan_candidate = %s
            WHERE id = %s
            """,
            (priority, plan_candidate, gap_id),
        )


def _next_review_sequence(connection: psycopg.Connection, assessment_id: int) -> int:
    row = connection.execute(
        """
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM assessment_review
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchone()
    assert row is not None
    return row[0]


def archive_assessment(
    connection: psycopg.Connection, assessment_id: int, member_id: int
) -> None:
    with connection.transaction():
        row = connection.execute(
            "SELECT status, member_id FROM assessment WHERE id = %s",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status != "已复核":
            raise ValueError("assessment is not in reviewed status")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        archived_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment
            SET status = '已归档', archived_at = %s
            WHERE id = %s
            """,
            (archived_at, assessment_id),
        )


def get_assessment_reviews(
    connection: psycopg.Connection, assessment_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT id, assessment_id, sequence, buddy_id, conclusion,
               feedback, reviewed_at, status
        FROM assessment_review
        WHERE assessment_id = %s
        ORDER BY sequence
        """,
        (assessment_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "assessment_id": row[1],
            "sequence": row[2],
            "buddy_id": row[3],
            "conclusion": row[4],
            "feedback": row[5],
            "reviewed_at": row[6],
            "status": row[7],
        }
        for row in rows
    ]


def get_pending_reviews_for_buddy(
    connection: psycopg.Connection, buddy_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT ar.id, ar.assessment_id, ar.sequence, ar.buddy_id, ar.status,
               a.member_id, a.year, a.version, a.status AS assessment_status,
               a.submitted_at
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        WHERE ar.buddy_id = %s AND ar.status = '待复核'
        ORDER BY a.submitted_at ASC NULLS LAST
        """,
        (buddy_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "assessment_id": row[1],
            "sequence": row[2],
            "buddy_id": row[3],
            "status": row[4],
            "member_id": row[5],
            "year": row[6],
            "version": row[7],
            "assessment_status": row[8],
            "submitted_at": row[9],
        }
        for row in rows
    ]


def submit_assessment_review(
    connection: psycopg.Connection,
    review_id: int,
    buddy_id: int,
    conclusion: str,
    feedback: str | None,
) -> None:
    if conclusion not in ("认可", "建议调整"):
        raise ValueError("invalid conclusion")

    with connection.transaction():
        row = connection.execute(
            """
            SELECT ar.assessment_id, ar.buddy_id, ar.status, a.member_id
            FROM assessment_review ar
            JOIN assessment a ON a.id = ar.assessment_id
            WHERE ar.id = %s
            """,
            (review_id,),
        ).fetchone()
        if row is None:
            raise ValueError("review not found")
        assessment_id, review_buddy_id, review_status, member_id = row
        if review_status != "待复核":
            raise ValueError("review is not pending")
        if int(review_buddy_id) != buddy_id:
            raise ValueError("review is not assigned to this buddy")
        if not is_member_assigned_to_buddy(connection, int(member_id), buddy_id):
            raise ValueError("buddy is not assigned to member")

        reviewed_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment_review
            SET conclusion = %s, feedback = %s, reviewed_at = %s, status = '已闭环'
            WHERE id = %s
            """,
            (conclusion, feedback, reviewed_at, review_id),
        )

        if conclusion == "认可":
            connection.execute(
                """
                UPDATE assessment
                SET status = '已复核'
                WHERE id = %s
                """,
                (assessment_id,),
            )
            archive_assessment(connection, assessment_id, int(member_id))
        else:
            connection.execute(
                """
                UPDATE assessment
                SET status = '建议调整'
                WHERE id = %s
                """,
                (assessment_id,),
            )
