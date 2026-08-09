"""
Test for Issue #82: Atomic plan and task generation on assessment submit.
"""

import psycopg


def test_submit_assessment_generates_plan_and_tasks(connection):
    """
    Test that submitting an assessment immediately generates:
    - Annual growth plan
    - Plan items (for include_in_plan=TRUE details)
    - Learning tasks (1:1 with plan items)
    """
    conn = connection

    with conn.transaction():
        # Create member
        member = conn.execute(
            "INSERT INTO tcp_user (username, full_name, password_hash, "
            "current_level, target_level) VALUES "
            "('test_member', 'Test Member', 'dummy_hash', 'P5', 'P6') "
            "RETURNING id"
        ).fetchone()
        member_id = member[0]

        # Create assessment draft
        assessment = conn.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status, revision,
                member_current_level_snapshot, member_target_level_snapshot
            )
            VALUES (%s, 2026, 1, '年度', '草稿', 1, 'P5', 'P6')
            RETURNING id
            """,
            (member_id,),
        ).fetchone()
        assessment_id = assessment[0]

        # Add assessment details with include_in_plan=TRUE
        conn.execute(
            """
            INSERT INTO assessment_detail (
                assessment_id, l3_code, current_level, target_level, gap_value,
                include_in_plan, member_priority, plan_month,
                l3_node_id, scope_type, standard_target_level
            )
            VALUES
                (%s, 'P01-01-01', 2, 4, 2, TRUE, '高', 3, 1, 'current_required', 4),
                (%s, 'P01-01-02', 1, 3, 2, TRUE, '中', 6, 2, 'current_required', 3),
                (%s, 'P01-01-03', 3, 3, 0, FALSE, NULL, NULL, 3, 'current_required', 3)
            """,
            (assessment_id, assessment_id, assessment_id),
        )

        # Submit assessment
        from backend.app.assessment.repository import submit_assessment

        result = submit_assessment(conn, assessment_id, member_id, expected_revision=1)

        # Verify plan generation result in response
        assert "plan_generation" in result
        plan_gen = result["plan_generation"]
        assert plan_gen["created_items"] == 2  # Only include_in_plan=TRUE items
        assert plan_gen["created_tasks"] == 2  # 1:1 with plan items
        assert plan_gen["skipped_items"] == 0

        # Verify annual_growth_plan created
        plan = conn.execute(
            "SELECT id, status FROM annual_growth_plan "
            "WHERE member_id=%s AND year=2026",
            (member_id,),
        ).fetchone()
        assert plan is not None
        annual_plan_id = plan[0]

        # Verify plan_items created
        items = conn.execute(
            "SELECT l3_code, status FROM plan_item "
            "WHERE annual_growth_plan_id=%s ORDER BY l3_code",
            (annual_plan_id,),
        ).fetchall()
        assert len(items) == 2
        assert items[0][0] == "P01-01-01"
        assert items[0][1] == "未开始"
        assert items[1][0] == "P01-01-02"

        # Verify learning_tasks created
        tasks = conn.execute(
            """
            SELECT lt.l3_code, lt.status
            FROM learning_task lt
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            WHERE pi.annual_growth_plan_id = %s
            ORDER BY lt.l3_code
            """,
            (annual_plan_id,),
        ).fetchall()
        assert len(tasks) == 2
        assert tasks[0][0] == "P01-01-01"
        assert tasks[0][1] == "未开始"


def test_submit_assessment_idempotent(connection):
    """
    Test that re-submitting the same assessment does not duplicate plan items or tasks.
    """
    conn = connection

    with conn.transaction():
        # Setup (same as above)
        member = conn.execute(
            "INSERT INTO tcp_user (username, full_name, current_level, target_level) "
            "VALUES ('test_member2', 'Test Member 2', 'P5', 'P6') RETURNING id"
        ).fetchone()
        member_id = member[0]

        assessment = conn.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status, revision,
                member_current_level_snapshot, member_target_level_snapshot
            )
            VALUES (%s, 2026, 1, '年度', '草稿', 1, 'P5', 'P6')
            RETURNING id
            """,
            (member_id,),
        ).fetchone()
        assessment_id = assessment[0]

        conn.execute(
            """
            INSERT INTO assessment_detail (
                assessment_id, l3_code, current_level, target_level, gap_value,
                include_in_plan, member_priority, plan_month,
                l3_node_id, scope_type, standard_target_level
            )
            VALUES (%s, 'P02-01-01', 2, 4, 2, TRUE, '高', 3, 10, 'current_required', 4)
            """,
            (assessment_id,),
        )

        from backend.app.assessment.repository import submit_assessment

        # First submit
        result1 = submit_assessment(conn, assessment_id, member_id, expected_revision=1)
        assert result1["plan_generation"]["created_items"] == 1
        assert result1["plan_generation"]["created_tasks"] == 1

        # Change assessment back to draft for second submit (simulate resubmit scenario)
        conn.execute(
            "UPDATE assessment SET status='建议调整', revision=2 WHERE id=%s",
            (assessment_id,),
        )

        conn.execute(
            """
            UPDATE assessment_detail
            SET include_in_plan=TRUE, plan_month=6
            WHERE assessment_id=%s AND l3_code='P02-01-01'
            """,
            (assessment_id,),
        )

        # Second submit - should skip existing items
        result2 = submit_assessment(conn, assessment_id, member_id, expected_revision=2)
        assert result2["plan_generation"]["created_items"] == 0
        assert result2["plan_generation"]["skipped_items"] == 1
        assert result2["plan_generation"]["created_tasks"] == 0

        # Verify still only 1 plan item and 1 task
        plan = conn.execute(
            "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
            (member_id,),
        ).fetchone()

        item_count = conn.execute(
            "SELECT COUNT(*) FROM plan_item WHERE annual_growth_plan_id=%s", (plan[0],)
        ).fetchone()[0]
        assert item_count == 1

        task_count = conn.execute(
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
    first_l3 = "P01-L2A-L3A"
    later_l3 = "P01-L2A-L3B"
    base.ensure_nodes(review_schema, [first_l3, later_l3])

    first_assessment = base.submit(
        review_schema,
        member_id,
        2026,
        [
            {
                "l3_code": first_l3,
                "current_level": 2,
                "target_level": 4,
                "member_priority": "高",
                "include_in_plan": True,
                "plan_quarter": "Q2",
                "plan_month": 5,
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
                "l3_code": later_l3,
                "current_level": 2,
                "target_level": 3,
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
    assert items == [
        (first_l3, first_assessment),
        (later_l3, later_assessment),
    ]
    task_count = review_schema.execute(
        "SELECT COUNT(*) FROM learning_task lt "
        "JOIN plan_item pi ON pi.id=lt.plan_item_id "
        "WHERE pi.annual_growth_plan_id=%s",
        (int(plan[0]),),
    ).fetchone()[0]
    assert task_count == 2
