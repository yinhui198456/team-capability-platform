"""
Test for Issue #82: Atomic plan and task generation.

The legacy submit write path is retired (#178): learning tasks are created
only by explicit generation.  These tests exercise the atomic generator
directly (the same function the old submit chain called and the fixture
helpers use today).
"""

import psycopg

from app.assessment.repository import save_assessment_draft
from tests.standard_target_support import create_scoped_draft, standard_target_payload


def _generation_setup(
    review_schema: psycopg.Connection,
) -> tuple[int, str, int]:
    """Full-schema setup ending in an explicit draft save (no submit — the
    write path under test is the generator itself, #178)."""
    from tests.review_support import ReviewTestBase

    base = ReviewTestBase()
    member_id, _ = base.setup_users(review_schema)
    l3_code = "P01-L2A-L3A"
    base.ensure_nodes(review_schema, [l3_code])

    assessment_id = create_scoped_draft(review_schema, member_id, 2026)
    payload = standard_target_payload(
        review_schema,
        assessment_id,
        [
            {
                "l3_code": l3_code,
                "current_level": 1,
                "target_level": 4,
                "member_priority": "高",
                "include_in_plan": True,
                "plan_quarter": "Q2",
                "plan_month": 5,
            }
        ],
    )
    save_assessment_draft(
        review_schema, assessment_id, member_id, payload, expected_revision=1
    )
    return member_id, l3_code, assessment_id


def test_generate_plan_and_tasks_from_assessment(review_schema: psycopg.Connection):
    """
    The atomic generator creates:
    - Annual growth plan
    - Plan items (for include_in_plan=TRUE details)
    - Learning tasks (1:1 with plan items)
    """
    member_id, l3_code, assessment_id = _generation_setup(review_schema)

    # Generate explicitly (the function the retired submit chain used)
    from app.planning.atomic_generation import (
        generate_plan_and_tasks_from_assessment,
    )

    result = generate_plan_and_tasks_from_assessment(review_schema, assessment_id)
    review_schema.commit()

    # Verify plan generation result in response
    assert result["created_items"] == 1  # Only the include_in_plan=TRUE detail
    assert result["created_tasks"] == 1  # 1:1 with plan items
    assert result["skipped_items"] == 0

    # Verify annual_growth_plan created
    plan = review_schema.execute(
        "SELECT id, status FROM annual_growth_plan " "WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan is not None
    annual_plan_id = plan[0]

    # Verify plan_item created
    items = review_schema.execute(
        "SELECT l3_code, status FROM plan_item "
        "WHERE annual_growth_plan_id=%s ORDER BY l3_code",
        (annual_plan_id,),
    ).fetchall()
    assert items == [(l3_code, "未开始")]

    # Verify learning_task created
    tasks = review_schema.execute(
        """
        SELECT lt.l3_code, lt.status
        FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.annual_growth_plan_id = %s
        ORDER BY lt.l3_code
        """,
        (annual_plan_id,),
    ).fetchall()
    assert tasks == [(l3_code, "未开始")]


def test_generate_plan_and_tasks_idempotent(review_schema: psycopg.Connection):
    """
    Test that re-running the atomic generator does not duplicate plan items or tasks.
    """
    member_id, _, assessment_id = _generation_setup(review_schema)

    from app.planning.atomic_generation import (
        generate_plan_and_tasks_from_assessment,
    )

    # First generation
    result1 = generate_plan_and_tasks_from_assessment(review_schema, assessment_id)
    review_schema.commit()
    assert result1["created_items"] == 1
    assert result1["created_tasks"] == 1

    # Second generation - should skip the existing item
    result2 = generate_plan_and_tasks_from_assessment(review_schema, assessment_id)
    review_schema.commit()
    assert result2["created_items"] == 0
    assert result2["skipped_items"] == 1
    assert result2["created_tasks"] == 0

    # Verify still only 1 plan item and 1 task
    plan = review_schema.execute(
        "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan is not None

    item_count = review_schema.execute(
        "SELECT COUNT(*) FROM plan_item WHERE annual_growth_plan_id=%s", (plan[0],)
    ).fetchone()[0]
    assert item_count == 1

    task_count = review_schema.execute(
        """
        SELECT COUNT(*) FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.annual_growth_plan_id=%s
        """,
        (plan[0],),
    ).fetchone()[0]
    assert task_count == 1


def test_later_assessment_adds_only_new_item_to_existing_annual_plan(
    review_schema: psycopg.Connection,
) -> None:
    """A later assessment reuses the member/year plan without overwriting it.

    This is the production regression for the UAT failure: the plan keeps the
    first assessment as its creation source, while the new item and task keep
    the later assessment/detail as their exact provenance.
    """
    from tests.review_support import ReviewTestBase

    base = ReviewTestBase()
    member_id, buddy_id = base.setup_users(review_schema)
    l3_code = "P01-L2A-L3A"
    base.ensure_nodes(review_schema, [l3_code])

    first_assessment = base.submit(
        review_schema,
        member_id,
        2026,
        [
            {
                "l3_code": l3_code,
                "current_level": 3,
                "target_level": 3,
            }
        ],
    )
    base.approve(review_schema, first_assessment, buddy_id)

    later_assessment = base.submit(
        review_schema,
        member_id,
        2026,
        [
            {
                "l3_code": l3_code,
                "current_level": 1,
                "target_level": 4,
                "member_priority": "中",
                "include_in_plan": True,
                "plan_quarter": "Q3",
                "plan_month": 8,
            }
        ],
    )

    plan = review_schema.execute(
        "SELECT id, source_assessment_id FROM annual_growth_plan "
        "WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan is not None
    assert int(plan[1]) == first_assessment

    items = review_schema.execute(
        "SELECT l3_code, source_assessment_id FROM plan_item "
        "WHERE annual_growth_plan_id=%s ORDER BY l3_code",
        (int(plan[0]),),
    ).fetchall()
    assert items == [(l3_code, later_assessment)]
    task_count = review_schema.execute(
        "SELECT COUNT(*) FROM learning_task lt "
        "JOIN plan_item pi ON pi.id=lt.plan_item_id "
        "WHERE pi.annual_growth_plan_id=%s",
        (int(plan[0]),),
    ).fetchone()[0]
    assert task_count == 1


def test_submitted_included_gap_with_buddy_acceptance_creates_plan_item_and_task(
    review_schema: psycopg.Connection,
) -> None:
    """Issue #84 end-to-end: submit with an included positive gap must create
    the annual plan item and learning task, and Buddy acceptance must not
    duplicate them.

    This reproduces the UAT failure path: the member included C01.01.01 in
    the plan (是 + May 2026), submitted, and the Buddy accepted, yet
    /growth/annual-plan?year=2026 was empty — the include had silently been
    cleared on save (see test_explicit_include_on_gap_zero_...).
    """
    from tests.review_support import ReviewTestBase

    base = ReviewTestBase()
    member_id, buddy_id = base.setup_users(review_schema)
    l3_code = "P01-L2A-L3A"
    base.ensure_nodes(review_schema, [l3_code])

    assessment_id = base.submit(
        review_schema,
        member_id,
        2026,
        [
            {
                "l3_code": l3_code,
                "current_level": 1,
                "target_level": 4,
                "member_priority": "高",
                "include_in_plan": True,
                "plan_quarter": "Q2",
                "plan_month": 5,
            }
        ],
    )

    # Atomic generation on self-submit: plan row + item + task all exist.
    plan = review_schema.execute(
        "SELECT id, source_assessment_id FROM annual_growth_plan "
        "WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan is not None
    assert int(plan[1]) == assessment_id

    items = review_schema.execute(
        "SELECT l3_code, source_assessment_id FROM plan_item "
        "WHERE annual_growth_plan_id=%s ORDER BY l3_code",
        (int(plan[0]),),
    ).fetchall()
    assert items == [(l3_code, assessment_id)]
    task_count = review_schema.execute(
        "SELECT COUNT(*) FROM learning_task lt "
        "JOIN plan_item pi ON pi.id=lt.plan_item_id "
        "WHERE pi.annual_growth_plan_id=%s",
        (int(plan[0]),),
    ).fetchone()[0]
    assert task_count == 1

    # Buddy acceptance detects the existing plan: no regeneration, no dupes.
    result = base.approve(review_schema, assessment_id, buddy_id)
    assert result["assessment_status"] == "已归档"
    assert result["plan"]["created"] is False
    assert result["plan"]["items_created"] == 0
    assert result["plan"]["tasks_created"] == 0

    items_after = review_schema.execute(
        "SELECT COUNT(*) FROM plan_item WHERE annual_growth_plan_id=%s",
        (int(plan[0]),),
    ).fetchone()[0]
    assert items_after == 1
