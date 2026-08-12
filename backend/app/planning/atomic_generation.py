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

from typing import Any

import psycopg

from ..assessment.repository import AssessmentValidationError

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

    # Selection-only rows (Issue #178 partial save) may never pick a plan
    # quarter/month; plan_item_approval_completeness requires both, so fall
    # back to Q1 / month 1 instead of failing the batch.
    if plan_quarter is None:
        plan_quarter = "Q1"
    if plan_month is None:
        plan_month = 1

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
    connection: psycopg.Connection, assessment_id: int, l3_codes: list[str]
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
                   l3_node_id
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
        ) = row
        if compat_error:
            raise AssessmentValidationError(
                code,
                "compatibility_repair_required",
                f"assessment detail {code} requires compatibility repair",
                l3_node_id=l3_node_id,
                field="target_compatibility_error",
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
    return list(
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


def generate_plan_items_for_selection(
    connection: psycopg.Connection,
    assessment_id: int,
    l3_codes: list[str],
) -> dict[str, Any]:
    """
    Issue #178: atomically generate/reuse annual plan items and learning
    tasks for exactly the selected, validated L3 rows.

    Runs inside the caller's transaction.  Only the selected L3s are
    validated; unselected rows with current_level=NULL never block.  Creates
    no Assessment Review and never transitions the assessment status.
    Idempotent per (annual_growth_plan_id, l3_code): existing plan items are
    reused, existing tasks and their logs/evidence are untouched.

    Returns:
    {
        "annual_plan_id": int,
        "created_items": int,
        "skipped_items": int,
        "created_tasks": int
    }
    """
    if not l3_codes:
        raise ValueError("l3_codes must not be empty")

    assessment = _load_assessment(connection, assessment_id)
    details = _validate_selected_details(connection, assessment_id, l3_codes)

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

    annual_plan_id = _get_or_create_annual_plan(connection, assessment_id, assessment)
    return {
        "annual_plan_id": annual_plan_id,
        "created_items": created_items,
        "skipped_items": skipped_items,
        "created_tasks": created_tasks,
    }


def generate_plan_and_tasks_from_assessment(
    connection: psycopg.Connection,
    assessment_id: int,
) -> dict[str, Any]:
    """
    Atomically generate annual plan, plan items, and learning tasks
    from submitted assessment (Issue #82; full-form submit path).

    Called from submit_assessment() in the same transaction.

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
