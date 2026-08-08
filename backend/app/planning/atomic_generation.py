"""
Issue #82 Implementation: Generate annual plan and learning tasks on assessment submission.

Core changes:
1. Remove Buddy pre-approval gate for annual plan generation
2. Generate annual plan + plan items + learning tasks atomically on assessment submit
3. Ensure idempotency: do not duplicate tasks on repeated submissions
"""

import psycopg
from typing import Any


def generate_plan_and_tasks_from_assessment(
    connection: psycopg.Connection,
    assessment_id: int,
) -> dict[str, Any]:
    """
    Atomically generate annual plan, plan items, and learning tasks from submitted assessment.

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
    # Get assessment metadata
    assessment = connection.execute(
        """
        SELECT member_id, year, capability_standard_version_id, revision
        FROM assessment
        WHERE id = %s
        """,
        (assessment_id,),
    ).fetchone()

    if assessment is None:
        raise ValueError(f"Assessment {assessment_id} not found")

    member_id, year, standard_version_id, assessment_revision = assessment

    # Get or create annual plan
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

    annual_plan_id = int(plan_row[0])

    # Get assessment details where include_in_plan=TRUE
    details = connection.execute(
        """
        SELECT
            ad.id, ad.l3_code, ad.current_level, ad.target_level,
            ad.gap_value, ad.member_priority,
            ad.plan_quarter, ad.plan_month,
            ad.l3_node_id, ad.l1_code, ad.l1_name,
            ad.l2_code, ad.l2_name, ad.l3_name,
            ad.scope_type, ad.standard_target_level,
            ad.adjusted_target_level, ad.target_level AS effective_target,
            ad.standard_job_level_snapshot
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
        (
            detail_id, l3_code, current_level, target_level,
            gap_value, priority, plan_quarter, plan_month,
            l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_name,
            scope_type, standard_target, adjusted_target, effective_target,
            standard_job_snapshot
        ) = detail

        # Constraint requires priority to be non-NULL when planning_source_type='assessment_approval'
        if priority is None:
            priority = '中'

        # Check if plan_item already exists for this L3
        existing_item = connection.execute(
            """
            SELECT id FROM plan_item
            WHERE annual_growth_plan_id = %s AND l3_code = %s
            """,
            (annual_plan_id, l3_code),
        ).fetchone()

        if existing_item is not None:
            skipped_items += 1
            continue

        # Create plan_item
        item_row = connection.execute(
            """
            INSERT INTO plan_item (
                annual_growth_plan_id, l3_code,
                current_level, target_level, priority,
                status, revision,
                source_assessment_id, source_assessment_detail_id,
                capability_standard_version_id,
                l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_name,
                scope_type, standard_target_level, adjusted_target_level,
                effective_target_level, standard_job_level_snapshot,
                plan_quarter, plan_month, gap_value, include_in_plan,
                planning_source_type, assessment_revision
            )
            VALUES (
                %s, %s, %s, %s, %s,
                '未开始', 1,
                %s, %s, %s,
                %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s,
                %s, %s, %s, TRUE,
                'assessment_approval', %s
            )
            RETURNING id
            """,
            (
                annual_plan_id, l3_code, current_level, target_level, priority,
                assessment_id, detail_id, standard_version_id,
                l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_name,
                scope_type, standard_target, adjusted_target, effective_target,
                standard_job_snapshot,
                plan_quarter, plan_month, gap_value,
                assessment_revision
            ),
        ).fetchone()

        plan_item_id = int(item_row[0])
        created_items += 1

        # Check if learning_task already exists
        existing_task = connection.execute(
            """
            SELECT id FROM learning_task
            WHERE plan_item_id = %s
            """,
            (plan_item_id,),
        ).fetchone()

        if existing_task is None:
            # Create learning_task (1:1 with plan_item)
            connection.execute(
                """
                INSERT INTO learning_task (
                    plan_item_id, member_id, l3_code,
                    status, task_sequence, revision
                )
                VALUES (%s, %s, %s, '未开始', 1, 1)
                """,
                (plan_item_id, member_id, l3_code),
            )
            created_tasks += 1

    return {
        "annual_plan_id": annual_plan_id,
        "created_items": created_items,
        "skipped_items": skipped_items,
        "created_tasks": created_tasks,
    }
