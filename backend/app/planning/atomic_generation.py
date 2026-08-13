"""
Issue #82 / #178: Generate annual plan and learning tasks.

Issue #82: on assessment submission, atomically generate the annual plan,
plan items and learning tasks (previously gated on Buddy approval).

Issue #178: Member selects one or more filled applicable L3 rows on the
assessment/Gap page and generates or reuses the annual plan learning tasks
for exactly those rows.  Only the selected L3s are validated (current_level
0-5, 0 included); unselected NULL rows never block.  The batch is atomic and
idempotent, creates no Assessment Review, and never touches historical
reviews.
"""

import hashlib
import json
from typing import Any

import psycopg

from ..assessment.repository import AssessmentValidationError


class PlanTimeValidationError(AssessmentValidationError):
    """Batch plan-time validation failure (Issue #178 corrected contract).

    Every selected L3 missing an explicit plan quarter and/or plan month is
    listed in ``issues``; the batch generates nothing.  No default quarter or
    month is ever invented.
    """

    def __init__(self, issues: list[AssessmentValidationError]) -> None:
        self.issues = issues
        first = issues[0]
        super().__init__(
            first.l3_code,
            first.reason,
            str(first),
            l3_node_id=first.l3_node_id,
            field=first.field,
        )


class SelectionValidationError(AssessmentValidationError):
    """Batch selection validation failure (Issue #178): every selected L3
    that cannot be planned (e.g. its planning snapshot is missing) is listed
    in ``issues``; the batch generates nothing.
    """

    def __init__(self, issues: list[AssessmentValidationError]) -> None:
        self.issues = issues
        first = issues[0]
        super().__init__(
            first.l3_code,
            first.reason,
            str(first),
            l3_node_id=first.l3_node_id,
            field=first.field,
        )


# assessment detail columns shared by both generation paths.
_DETAIL_COLUMNS = """
    ad.id, ad.l3_code, ad.current_level, ad.target_level,
    ad.gap_value, ad.member_priority,
    ad.plan_quarter, ad.plan_month,
    ad.l3_node_id, ad.l1_code, ad.l1_name,
    ad.l2_code, ad.l2_name, ad.l3_name,
    ad.scope_type, ad.standard_target_level,
    ad.adjusted_target_level, ad.target_level AS effective_target,
    ad.standard_job_level_snapshot,
    ad.standard_target_applicable, ad.target_compatibility_error
"""


def _load_assessment(connection: psycopg.Connection, assessment_id: int) -> tuple:
    """Assessment metadata shared by both generation paths."""
    assessment = connection.execute(
        """
        SELECT member_id, year, capability_standard_version_id, revision,
               member_current_level_snapshot, member_target_level_snapshot
        FROM assessment
        WHERE id = %s
        """,
        (assessment_id,),
    ).fetchone()

    if assessment is None:
        raise ValueError(f"Assessment {assessment_id} not found")
    return assessment


def _get_or_create_annual_plan(
    connection: psycopg.Connection, assessment_id: int, assessment: tuple
) -> int:
    member_id, year = assessment[0], assessment[1]
    plan_row = connection.execute(
        """
        SELECT id FROM annual_growth_plan
        WHERE member_id = %s AND year = %s
        """,
        (member_id, year),
    ).fetchone()

    if plan_row is None:
        plan_row = connection.execute(
            """
            INSERT INTO annual_growth_plan (
                member_id, year, status,
                source_assessment_id, planning_source_type
            )
            VALUES (%s, %s, '执行中', %s, 'assessment_approval')
            RETURNING id
            """,
            (member_id, year, assessment_id),
        ).fetchone()

    return int(plan_row[0])


def _create_plan_item_and_task(
    connection: psycopg.Connection,
    assessment_id: int,
    assessment: tuple,
    detail: tuple,
) -> tuple[int, int]:
    """Create one plan item + 1:1 learning task for a validated detail row.

    Returns (created_items_delta, created_tasks_delta) — (0, 0) when the
    (annual_growth_plan_id, l3_code) pair already exists (idempotent reuse).
    """
    (
        _member_id,
        _year,
        standard_version_id,
        assessment_revision,
        member_current_snapshot,
        member_target_snapshot,
    ) = assessment

    (
        detail_id,
        l3_code,
        current_level,
        target_level,
        gap_value,
        priority,
        plan_quarter,
        plan_month,
        l3_node_id,
        l1_code,
        l1_name,
        l2_code,
        l2_name,
        l3_name,
        scope_type,
        standard_target,
        adjusted_target,
        effective_target,
        standard_job_snapshot,
        _applicable,
        _compat_error,
    ) = detail

    annual_plan_id = _get_or_create_annual_plan(connection, assessment_id, assessment)

    # Constraint requires priority to be non-NULL
    # when planning_source_type='assessment_approval'
    if priority is None:
        priority = "中"

    # Issue #178 corrected contract: never invent a plan quarter/month.
    # Rows without explicit plan time are skipped here; the explicit
    # generation path rejects such selections up front (PlanTimeValidationError)
    # and the approval path is guarded by validate_plan_selection.
    if plan_quarter is None or plan_month is None:
        return (0, 0)

    # Get planning snapshot for this L3 capability
    snapshot = connection.execute(
        """
        SELECT id, materials_text, expected_output, estimated_hours
        FROM capability_standard_planning_snapshot
        WHERE capability_standard_version_id = %s AND l3_node_id = %s
        """,
        (standard_version_id, l3_node_id),
    ).fetchone()

    if snapshot is None:
        # Skip if no planning snapshot exists for this capability
        return (0, 0)

    planning_snapshot_id = int(snapshot[0])

    # Check if plan_item already exists for this L3
    existing_item = connection.execute(
        """
        SELECT id FROM plan_item
        WHERE annual_growth_plan_id = %s AND l3_code = %s
        """,
        (annual_plan_id, l3_code),
    ).fetchone()

    if existing_item is not None:
        return (0, 0)

    # Create plan_item
    item_row = connection.execute(
        """
        INSERT INTO plan_item (
            annual_growth_plan_id, l3_code,
            current_level, target_level, priority,
            status, revision,
            source_assessment_id, source_assessment_detail_id,
            capability_standard_version_id,
            planning_snapshot_id,
            l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_name,
            scope_type, standard_target_level, adjusted_target_level,
            effective_target_level, standard_job_level_snapshot,
            member_current_level_snapshot, member_target_level_snapshot,
            plan_quarter, plan_month, gap_value, include_in_plan,
            planning_source_type, assessment_revision
        )
        VALUES (
            %s, %s, %s, %s, %s,
            '未开始', 1,
            %s, %s, %s,
            %s,
            %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s,
            %s, %s,
            %s, %s, %s, TRUE,
            'assessment_approval', %s
        )
        RETURNING id
        """,
        (
            annual_plan_id,
            l3_code,
            current_level,
            target_level,
            priority,
            assessment_id,
            detail_id,
            standard_version_id,
            planning_snapshot_id,
            l3_node_id,
            l1_code,
            l1_name,
            l2_code,
            l2_name,
            l3_name,
            scope_type,
            standard_target,
            adjusted_target,
            effective_target,
            standard_job_snapshot,
            member_current_snapshot,
            member_target_snapshot,
            plan_quarter,
            plan_month,
            gap_value,
            assessment_revision,
        ),
    ).fetchone()

    plan_item_id = int(item_row[0])

    # Check if learning_task already exists
    existing_task = connection.execute(
        """
        SELECT id FROM learning_task
        WHERE plan_item_id = %s
        """,
        (plan_item_id,),
    ).fetchone()

    created_tasks = 0
    if existing_task is None:
        # Create learning_task (1:1 with plan_item)
        connection.execute(
            """
            INSERT INTO learning_task (
                plan_item_id, l3_code, status, revision
            )
            VALUES (%s, %s, '未开始', 0)
            """,
            (plan_item_id, l3_code),
        )
        created_tasks = 1

    return (1, created_tasks)


def _validate_selected_details(
    connection: psycopg.Connection,
    assessment_id: int,
    l3_codes: list[str],
    standard_version_id: int,
) -> list[tuple]:
    """Validate ONLY the selected L3s (Issue #178).

    Each selected row must exist and be applicable with a filled outcome
    (current_level 0-5 — NULL means not assessed — and an effective target)
    and a positive gap.  Any invalid selection fails the whole batch.
    """
    for code in l3_codes:
        row = connection.execute(
            """
            SELECT l3_code, current_level, target_level, gap_value,
                   standard_target_applicable, target_compatibility_error,
                   l3_node_id, scope_type
            FROM assessment_detail
            WHERE assessment_id = %s AND l3_code = %s
            """,
            (assessment_id, code),
        ).fetchone()
        if row is None:
            raise AssessmentValidationError(
                code,
                "unknown_l3_code",
                f"assessment detail {code} not found",
            )
        (
            _code,
            current_level,
            target_level,
            gap_value,
            applicable,
            compat_error,
            l3_node_id,
            scope_type,
        ) = row
        if compat_error:
            raise AssessmentValidationError(
                code,
                "compatibility_repair_required",
                f"assessment detail {code} requires compatibility repair",
                l3_node_id=l3_node_id,
                field="target_compatibility_error",
            )
        if scope_type is None:
            # Pre-scope (legacy) drafts cannot be planned: the plan item
            # write requires the scope provenance snapshots.  The sanctioned
            # path is the read-only draft-target-repair flow, not generation.
            raise AssessmentValidationError(
                code,
                "legacy_scope_required",
                "旧版草稿缺少作用域信息，请先修复评估目标后再生成学习任务",
                l3_node_id=l3_node_id,
                field="scope_type",
            )
        if applicable is False:
            raise AssessmentValidationError(
                code,
                "not_applicable",
                f"not applicable item {code} cannot be planned",
                l3_node_id=l3_node_id,
                field="target_level",
            )
        if current_level is None:
            raise AssessmentValidationError(
                code,
                "requires_current_level",
                f"assessment detail {code} requires current level (0–5)",
                l3_node_id=l3_node_id,
                field="current_level",
            )
        if target_level is None:
            raise AssessmentValidationError(
                code,
                "requires_target_level",
                f"assessment detail {code} has no effective target",
                l3_node_id=l3_node_id,
                field="target_level",
            )
        if gap_value is None or int(gap_value) <= 0:
            raise AssessmentValidationError(
                code,
                "plan_not_applicable",
                f"item {code} with gap<=0 cannot have plan selection",
                l3_node_id=l3_node_id,
                field="include_in_plan",
            )

    # Fetch the full detail rows for the validated selection, in stable order.
    placeholders = ", ".join("%s" for _ in l3_codes)
    details = list(
        connection.execute(
            f"""
            SELECT {_DETAIL_COLUMNS}
            FROM assessment_detail ad
            WHERE ad.assessment_id = %s
              AND ad.l3_code IN ({placeholders})
            ORDER BY ad.l3_code
            """,
            (assessment_id, *l3_codes),
        ).fetchall()
    )

    # Plan-time completeness (corrected #178 contract): every selected L3 must
    # carry an explicit plan quarter AND month — no default quarter/month may
    # be invented.  Collect every missing field across the whole selection so
    # the member sees each L3 and what to fill in one response.
    plan_time_issues: list[AssessmentValidationError] = []
    for detail in details:
        code = detail[1]
        l3_node_id = detail[8]
        if detail[6] is None:
            plan_time_issues.append(
                AssessmentValidationError(
                    code,
                    "plan_quarter_required",
                    f"assessment detail {code} requires an explicit plan quarter",
                    l3_node_id=l3_node_id,
                    field="plan_quarter",
                )
            )
        if detail[7] is None:
            plan_time_issues.append(
                AssessmentValidationError(
                    code,
                    "plan_month_required",
                    f"assessment detail {code} requires an explicit plan month",
                    l3_node_id=l3_node_id,
                    field="plan_month",
                )
            )
    if plan_time_issues:
        raise PlanTimeValidationError(plan_time_issues)

    # Planning-snapshot existence (#178): every selected L3 must have the
    # immutable v0009 snapshot its learning task is built from.  A missing
    # snapshot is a structured per-L3 failure — never the old silent (0,0)
    # 'skip' that the frontend mislabeled as 已存在.
    snapshot_issues: list[AssessmentValidationError] = []
    for detail in details:
        code = detail[1]
        l3_node_id = detail[8]
        snapshot = connection.execute(
            "SELECT 1 FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id = %s AND l3_node_id = %s",
            (standard_version_id, l3_node_id),
        ).fetchone()
        if snapshot is None:
            snapshot_issues.append(
                AssessmentValidationError(
                    code,
                    "planning_snapshot_missing",
                    f"assessment detail {code} has no planning snapshot",
                    l3_node_id=l3_node_id,
                    field="planning_snapshot",
                )
            )
    if snapshot_issues:
        raise SelectionValidationError(snapshot_issues)
    return details


def generate_plan_items_for_selection(
    connection: psycopg.Connection,
    assessment_id: int,
    l3_codes: list[str],
    *,
    expected_revision: int,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    """
    Issue #178: atomically generate/reuse annual plan items and learning
    tasks for exactly the selected, validated L3 rows.

    Owns its transaction.  The assessment row is locked (FOR UPDATE) and its
    revision is compared to ``expected_revision`` — a mismatch raises
    ValueError("revision conflict") with zero writes (mapped to 409 by the
    route).  A batch that creates at least one plan item/task advances the
    authoritative assessment revision exactly once in the same transaction
    (the response and the stored idempotency response carry the new
    revision); an existing-only batch performs no effective write and keeps
    the revision (repair-noop convention).  Only the selected L3s are
    validated; unselected rows with current_level=NULL never block.  Creates
    no Assessment Review and never transitions the assessment status.
    Idempotent per (annual_growth_plan_id, l3_code): existing plan items are
    reused, existing tasks and their logs/evidence are untouched.

    ``idempotency_key`` (optional, Idempotency-Key header) binds to the
    request identity via a fingerprint; the check runs after the row lock so
    concurrent same-key requests serialize and exactly one writes.  The
    idempotency pre-check runs BEFORE the revision CAS so a same-key replay
    of the original payload is served with the stored response (revision
    included) without advancing the revision again.  A replay returns the
    stored response with ``idempotent_replayed=True``; reusing a key for a
    different request raises ValueError("idempotency key reused").

    Returns:
    {
        "annual_plan_id": int,
        "created_items": int,
        "skipped_items": int,
        "created_tasks": int,
        "revision": int,
        "items": [{"l3_code": str, "status": "created" | "existing"}, ...],
        "summary": str
    }
    """
    if not l3_codes:
        raise ValueError("l3_codes must not be empty")

    with connection.transaction():
        # Locked load: serializes concurrent generation for this assessment.
        assessment = connection.execute(
            """
            SELECT member_id, year, capability_standard_version_id, revision,
                   member_current_level_snapshot, member_target_level_snapshot
            FROM assessment
            WHERE id = %s
            FOR UPDATE
            """,
            (assessment_id,),
        ).fetchone()
        if assessment is None:
            raise ValueError(f"Assessment {assessment_id} not found")

        # Idempotency (established convention, cf. create_assessment): the
        # key is scoped to the member and fingerprint-binds the request
        # identity; the pre-check runs under the row lock so a concurrent
        # same-key request replays instead of double-writing.  It precedes
        # the revision CAS so a replay of the original payload is served
        # even after that payload advanced the revision.
        fingerprint: str | None = None
        if idempotency_key is not None:
            fingerprint = hashlib.sha256(
                json.dumps(
                    {
                        "assessment_id": assessment_id,
                        "l3_codes": sorted(l3_codes),
                        "expected_revision": expected_revision,
                    },
                    sort_keys=True,
                    separators=(",", ":"),
                ).encode("utf-8")
            ).hexdigest()
            stored = connection.execute(
                """
                SELECT request_fingerprint, response
                FROM assessment_idempotency_key
                WHERE member_id = %s AND idempotency_key = %s
                """,
                (assessment[0], idempotency_key),
            ).fetchone()
            if stored is not None:
                if stored[0] != fingerprint:
                    raise ValueError("idempotency key reused") from None
                return {**stored[1], "idempotent_replayed": True}

        if int(assessment[3]) != expected_revision:
            raise ValueError("revision conflict")

        details = _validate_selected_details(
            connection, assessment_id, l3_codes, assessment[2]
        )

        created_items = 0
        skipped_items = 0
        created_tasks = 0
        items: list[dict[str, Any]] = []

        for detail in details:
            item_delta, task_delta = _create_plan_item_and_task(
                connection, assessment_id, assessment, detail
            )
            if item_delta:
                created_items += 1
                created_tasks += task_delta
                status = "created"
            else:
                skipped_items += 1
                status = "existing"
            items.append({"l3_code": detail[1], "status": status})

        annual_plan_id = _get_or_create_annual_plan(
            connection, assessment_id, assessment
        )
        # Issue #178: a batch that creates items advances the authoritative
        # assessment revision exactly once, in this same transaction, so the
        # generation writes are visible to optimistic version sequencing.
        # The row is locked, so reading assessment[3] is race-free.
        if created_items > 0:
            connection.execute(
                "UPDATE assessment SET revision = revision + 1 WHERE id = %s",
                (assessment_id,),
            )
            new_revision = int(assessment[3]) + 1
        else:
            new_revision = int(assessment[3])
        response = {
            "annual_plan_id": annual_plan_id,
            "created_items": created_items,
            "skipped_items": skipped_items,
            "created_tasks": created_tasks,
            "revision": new_revision,
            "items": items,
            "summary": (
                f"本批新建 {created_items} 个计划项、{created_tasks} 个学习任务，"
                f"复用 {skipped_items} 个已有计划项"
            ),
            "idempotent_replayed": False,
        }

        if idempotency_key is not None:
            # PK backstop: a key raced across different assessments (different
            # lock rows) can only win once; the loser replays the winner.
            connection.execute("SAVEPOINT save_generate_idempotency")
            try:
                connection.execute(
                    """
                    INSERT INTO assessment_idempotency_key (
                        member_id, idempotency_key, request_fingerprint,
                        assessment_id, response
                    )
                    VALUES (%s, %s, %s, %s, %s::jsonb)
                    """,
                    (
                        assessment[0],
                        idempotency_key,
                        fingerprint,
                        assessment_id,
                        json.dumps(response, ensure_ascii=False),
                    ),
                )
            except psycopg.errors.UniqueViolation:
                connection.execute("ROLLBACK TO SAVEPOINT save_generate_idempotency")
                winner = connection.execute(
                    """
                    SELECT request_fingerprint, response
                    FROM assessment_idempotency_key
                    WHERE member_id = %s AND idempotency_key = %s
                    """,
                    (assessment[0], idempotency_key),
                ).fetchone()
                if winner is None or winner[0] != fingerprint:
                    raise ValueError("idempotency key reused") from None
                return {**winner[1], "idempotent_replayed": True}

        return response


def generate_plan_and_tasks_from_assessment(
    connection: psycopg.Connection,
    assessment_id: int,
) -> dict[str, Any]:
    """
    Atomically generate annual plan, plan items, and learning tasks
    from submitted assessment (Issue #82; full-form submit path).

    Used by the retired submit chain, seed fixtures, and tests.

    Rules:
    - Only creates plan items for assessment_detail rows where include_in_plan=TRUE
    - Idempotent: checks existing plan_item by (annual_growth_plan_id, l3_code)
    - One plan_item per L3 → one learning_task per plan_item (1:1)
    - Preserves existing tasks that are already in progress or completed

    Returns:
    {
        "annual_plan_id": int,
        "created_items": int,
        "skipped_items": int,
        "created_tasks": int
    }
    """
    assessment = _load_assessment(connection, assessment_id)
    annual_plan_id = _get_or_create_annual_plan(connection, assessment_id, assessment)

    # Get assessment details where include_in_plan=TRUE
    details = connection.execute(
        f"""
        SELECT {_DETAIL_COLUMNS}
        FROM assessment_detail ad
        WHERE ad.assessment_id = %s
          AND ad.include_in_plan = TRUE
          AND ad.gap_value > 0
        ORDER BY ad.l3_code
        """,
        (assessment_id,),
    ).fetchall()

    created_items = 0
    skipped_items = 0
    created_tasks = 0

    for detail in details:
        item_delta, task_delta = _create_plan_item_and_task(
            connection, assessment_id, assessment, detail
        )
        if item_delta:
            created_items += 1
            created_tasks += task_delta
        else:
            skipped_items += 1

    return {
        "annual_plan_id": annual_plan_id,
        "created_items": created_items,
        "skipped_items": skipped_items,
        "created_tasks": created_tasks,
    }
