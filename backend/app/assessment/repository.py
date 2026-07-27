from typing import Any

import psycopg

from ..access.repository import get_primary_buddy, is_member_assigned_to_buddy
from ..catalog.standard_targets import resolve_standard_target


def _now(connection: psycopg.Connection) -> Any:
    return connection.execute("SELECT NOW()").fetchone()[0]


def create_assessment_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    assessment_type: str = "年度",
) -> int:
    with connection.transaction():
        member_row = connection.execute(
            "SELECT target_level FROM tcp_user WHERE id = %s",
            (member_id,),
        ).fetchone()
        if member_row is None:
            raise ValueError("member not found")
        member_target_level = member_row[0]
        if member_target_level is None:
            raise ValueError("member target_level is required")

        capability_rows = connection.execute(
            """
            SELECT c.code, c.recommended_start_level,
                   o.node_id IS NOT NULL AS override_present,
                   o.target_level AS override_value
            FROM capability_node c
            LEFT JOIN capability_standard_target_override o
              ON o.node_id = c.id AND o.job_level = %s
            WHERE c.node_type = 'L3' AND c.enabled = TRUE
            ORDER BY c.code
            """,
            (member_target_level,),
        ).fetchall()
        snapshots = []
        for (
            code,
            recommended_start_level,
            override_present,
            override_value,
        ) in capability_rows:
            if recommended_start_level is None:
                raise ValueError(f"recommended_start_level is required for {code}")
            resolved = resolve_standard_target(
                member_target_level,
                recommended_start_level,
                override_present=override_present,
                override_value=override_value,
            )
            snapshots.append(
                (
                    code,
                    resolved.applicable,
                    resolved.target_level,
                    resolved.target_level,
                    resolved.source,
                )
            )

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

        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO assessment_detail (
                    assessment_id, l3_code, current_level, target_level,
                    standard_target_applicable, standard_target_level,
                    target_adjusted, adjusted_target_level,
                    target_adjustment_reason, target_snapshot_source,
                    target_compatibility_error, gap_value, evidence_note,
                    plan_candidate
                )
                VALUES (
                    %s, %s, NULL, %s, %s, %s, FALSE, NULL, NULL, %s,
                    NULL, NULL, NULL, FALSE
                )
                """,
                [
                    (assessment_id, code, target, applicable, standard, source)
                    for code, applicable, standard, target, source in snapshots
                ],
            )

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
               ad.standard_target_applicable, ad.standard_target_level,
               ad.target_adjusted, ad.adjusted_target_level,
               ad.target_adjustment_reason, ad.target_snapshot_source,
               ad.target_compatibility_error,
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
            "standard_target_applicable": row[7],
            "standard_target_level": row[8],
            "target_adjusted": row[9],
            "adjusted_target_level": row[10],
            "target_adjustment_reason": row[11],
            "target_snapshot_source": row[12],
            "target_compatibility_error": row[13],
            "l3_name": row[14],
            "recommended_start_level": row[15],
            "l1_code": row[16],
            "l1_name": row[17],
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
            "SELECT status, member_id FROM assessment WHERE id = %s FOR UPDATE",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not editable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        snapshot_rows = connection.execute(
            """
            SELECT id, l3_code, standard_target_applicable,
                   standard_target_level, target_compatibility_error,
                   target_level, gap_value, target_snapshot_source
            FROM assessment_detail
            WHERE assessment_id = %s
            ORDER BY l3_code
            """,
            (assessment_id,),
        ).fetchall()
        snapshots = {row[1]: row for row in snapshot_rows}
        submitted_codes = [str(detail.get("l3_code", "")) for detail in details]
        if len(submitted_codes) != len(set(submitted_codes)):
            raise ValueError("duplicate assessment detail")
        if set(submitted_codes) != set(snapshots):
            raise ValueError("batch must include every assessment detail")

        forbidden_fields = {
            "target_level",
            "standard_target_applicable",
            "standard_target_level",
            "target_snapshot_source",
            "target_compatibility_error",
            "gap_value",
        }
        for detail in details:
            forbidden = forbidden_fields.intersection(detail)
            if forbidden:
                raise ValueError(
                    "member cannot set calculated target fields: "
                    + ", ".join(sorted(forbidden))
                )
            (
                detail_id,
                code,
                applicable,
                standard_target,
                compatibility_error,
                existing_target,
                existing_gap,
                snapshot_source,
            ) = snapshots[str(detail["l3_code"])]
            if compatibility_error:
                raise ValueError(
                    f"assessment detail {code} requires compatibility repair"
                )

            cl = detail.get("current_level")
            current_level = int(cl) if cl is not None else None
            if current_level is not None and (
                isinstance(cl, bool) or not 1 <= current_level <= 5
            ):
                raise ValueError("current_level must be between 1 and 5")

            target_adjusted = detail.get("target_adjusted", False)
            if not isinstance(target_adjusted, bool):
                raise ValueError("target_adjusted must be boolean")
            adjusted = detail.get("adjusted_target_level")
            reason = detail.get("target_adjustment_reason")
            plan_candidate = detail.get("plan_candidate", False)
            if not isinstance(plan_candidate, bool):
                raise ValueError("plan_candidate must be boolean")

            legacy_preserved = (
                snapshot_source == "legacy_preserved"
                and applicable is None
                and existing_target is not None
            )
            if legacy_preserved:
                if target_adjusted or adjusted is not None or reason is not None:
                    raise ValueError(
                        f"legacy preserved target {code} cannot be adjusted"
                    )
                final_target = int(existing_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else existing_gap
                )
            elif applicable is not True:
                if (
                    target_adjusted
                    or adjusted is not None
                    or reason is not None
                    or plan_candidate
                ):
                    raise ValueError(
                        f"not applicable item {code} cannot be adjusted or planned"
                    )
                current_level = None
                final_target = None
                gap_value = None
            else:
                if standard_target is None:
                    raise ValueError(f"assessment detail {code} has no standard target")
                if target_adjusted:
                    if (
                        isinstance(adjusted, bool)
                        or not isinstance(adjusted, int)
                        or not 1 <= adjusted <= 5
                    ):
                        raise ValueError(
                            "adjusted_target_level must be between 1 and 5"
                        )
                    if not isinstance(reason, str) or not reason.strip():
                        raise ValueError("adjustment reason is required")
                    final_target = adjusted
                    reason = reason.strip()
                else:
                    if adjusted is not None or reason is not None:
                        raise ValueError("adjustment fields require target_adjusted")
                    final_target = int(standard_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else None
                )

            connection.execute(
                """
                UPDATE assessment_detail
                SET current_level = %s,
                    target_adjusted = %s,
                    adjusted_target_level = %s,
                    target_adjustment_reason = %s,
                    target_level = %s,
                    gap_value = %s,
                    evidence_note = %s,
                    plan_candidate = %s
                WHERE id = %s
                """,
                (
                    current_level,
                    target_adjusted,
                    adjusted if target_adjusted else None,
                    reason if target_adjusted else None,
                    final_target,
                    gap_value,
                    detail.get("evidence_note"),
                    plan_candidate,
                    detail_id,
                ),
            )


def submit_assessment(
    connection: psycopg.Connection, assessment_id: int, member_id: int
) -> None:
    with connection.transaction():
        row = connection.execute(
            "SELECT status, member_id FROM assessment WHERE id = %s FOR UPDATE",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not submittable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        incompatible_detail = connection.execute(
            """
            SELECT l3_code, target_compatibility_error
            FROM assessment_detail
            WHERE assessment_id = %s
              AND target_compatibility_error IS NOT NULL
            ORDER BY l3_code
            LIMIT 1
            """,
            (assessment_id,),
        ).fetchone()
        if incompatible_detail is not None:
            code, compatibility_error = incompatible_detail
            raise ValueError(
                f"assessment detail {code} requires compatibility repair: "
                f"{compatibility_error}"
            )

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
        raw_gap_value = detail["gap_value"]
        if raw_gap_value is None:
            connection.execute(
                """
                DELETE FROM gap
                WHERE assessment_id = %s AND l3_code = %s
                """,
                (assessment_id, detail["l3_code"]),
            )
            continue
        gap_value = int(raw_gap_value)
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


def get_assessment_review_summary_for_buddy(
    connection: psycopg.Connection,
    buddy_id: int,
    year: int,
) -> dict[str, int]:
    """Return pending and completed assessment review counts for a Buddy in a year."""
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE ar.status = '待复核'
            ) AS pending_count,
            COUNT(*) FILTER (
                WHERE ar.status = '已闭环'
                  AND EXTRACT(YEAR FROM ar.reviewed_at)::INT = %s
            ) AS completed_count
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        WHERE ar.buddy_id = %s AND a.year = %s
        """,
        (year, buddy_id, year),
    ).fetchone()
    if row is None:
        return {"pending_count": 0, "completed_count": 0}
    return {
        "pending_count": int(row[0] or 0),
        "completed_count": int(row[1] or 0),
    }
