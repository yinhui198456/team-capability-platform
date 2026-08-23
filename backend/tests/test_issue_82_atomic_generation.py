"""
Issue #82: atomic plan and task generation on the retained repository
submit path.  The API /submit is retired by Issue #194; the repository
``submit_assessment`` remains as the seed/historical approval path and
still generates the plan atomically (plan_month is TEXT 'YYYY-MM').
"""

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.assessment.repository import submit_assessment
from tests.review_support import reset_full_schema
from tests.standard_target_support import ensure_capability_nodes, publish_test_standard


@pytest.fixture
def schema(connection: psycopg.Connection) -> psycopg.Connection:
    reset_full_schema(connection)
    return connection


def _seed_draft(
    connection: psycopg.Connection,
    username: str,
    details: list[tuple[str, int, int, str]],
) -> int:
    """Create a member and a draft assessment with the given
    (l3_code, current_level, target_level, plan_month) details."""
    member_id = create_user(connection, username, username, "dummy_hash")
    assign_role(connection, member_id, "Member")
    connection.execute(
        "UPDATE tcp_user SET current_level = 'P5', target_level = 'P6' "
        "WHERE id = %s",
        (member_id,),
    )
    ensure_capability_nodes(connection, [detail[0] for detail in details])
    node_ids = {
        str(row[0]): int(row[1])
        for row in connection.execute(
            "SELECT code, id FROM capability_node WHERE node_type = 'L3'"
        ).fetchall()
    }
    # Publish a minimal standard with planning snapshots for the nodes
    # (draft → capture → publish; v0009 immutability forbids appending
    # snapshots to a published version).
    publish_test_standard(connection, list(node_ids))
    version_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version "
            "WHERE status = '已发布' ORDER BY id LIMIT 1"
        ).fetchone()[0]
    )
    assessment_id = int(
        connection.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status, revision,
                capability_standard_version_id,
                member_current_level_snapshot, member_target_level_snapshot
            )
            VALUES (%s, 2026, 1, '年度', '草稿', 1, %s, 'P5', 'P6')
            RETURNING id
            """,
            (member_id, version_id),
        ).fetchone()[0]
    )
    for code, current_level, target_level, plan_month in details:
        # plan_quarter is a derived compat column (v0015): derive it here the
        # same way the draft save path does (_quarter_of).
        month = plan_month[5:7]
        plan_quarter = (
            "Q1"
            if month <= "03"
            else "Q2" if month <= "06" else "Q3" if month <= "09" else "Q4"
        )
        connection.execute(
            """
            INSERT INTO assessment_detail (
                assessment_id, l3_code, l3_name, l2_code, l2_name,
                l1_code, l1_name, current_level, target_level, gap_value,
                include_in_plan, member_priority, plan_month, plan_quarter,
                l3_node_id, scope_type, standard_target_level,
                standard_job_level_snapshot
            )
            SELECT %s, n.code, n.name, l2.code, l2.name, l1.code, l1.name,
                   %s, %s, %s, TRUE, '高', %s, %s, n.id, 'current_required',
                   %s, 'P5'
            FROM capability_node n
            JOIN capability_node l2 ON l2.id = n.parent_node_id
            JOIN capability_node l1 ON l1.id = l2.parent_node_id
            WHERE n.code = %s
            """,
            (
                assessment_id,
                current_level,
                target_level,
                target_level - current_level,
                plan_month,
                plan_quarter,
                target_level,
                code,
            ),
        )
    connection.commit()
    return assessment_id


def test_submit_assessment_generates_plan_and_tasks(
    schema: psycopg.Connection,
) -> None:
    """Submitting the draft atomically generates: annual plan, plan items
    (for include_in_plan=TRUE details), and learning tasks (1:1)."""
    assessment_id = _seed_draft(
        schema,
        "test_member",
        [
            ("P01-L2A-L3A", 2, 4, "2026-03"),
            ("P01-L2A-L3B", 1, 3, "2026-06"),
        ],
    )

    result = submit_assessment(
        schema, assessment_id, _member_id(schema, assessment_id), 1
    )
    schema.commit()

    plan_gen = result["plan_generation"]
    assert plan_gen["created_items"] == 2
    assert plan_gen["created_tasks"] == 2
    assert plan_gen["skipped_items"] == 0

    plan = schema.execute(
        "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
        (_member_id(schema, assessment_id),),
    ).fetchone()
    assert plan is not None
    annual_plan_id = int(plan[0])

    items = schema.execute(
        "SELECT l3_code, status FROM plan_item "
        "WHERE annual_growth_plan_id=%s ORDER BY l3_code",
        (annual_plan_id,),
    ).fetchall()
    assert len(items) == 2
    assert items[0][0] == "P01-L2A-L3A"
    assert items[0][1] == "未开始"
    assert items[1][0] == "P01-L2A-L3B"

    tasks = schema.execute(
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
    assert tasks[0][0] == "P01-L2A-L3A"
    assert tasks[0][1] == "未开始"


def test_submit_assessment_idempotent(schema: psycopg.Connection) -> None:
    """Re-submitting the same assessment does not duplicate plan items or
    learning tasks (unique (annual_growth_plan_id, l3_code) kernel)."""
    assessment_id = _seed_draft(
        schema, "test_member2", [("P01-L2A-L3A", 2, 4, "2026-03")]
    )
    member_id = _member_id(schema, assessment_id)

    result1 = submit_assessment(schema, assessment_id, member_id, 1)
    schema.commit()
    assert result1["plan_generation"]["created_items"] == 1
    assert result1["plan_generation"]["created_tasks"] == 1

    # Simulate the resubmit scenario: 建议调整 + revised revision.
    schema.execute(
        "UPDATE assessment SET status='建议调整', revision=2 WHERE id=%s",
        (assessment_id,),
    )
    schema.commit()

    result2 = submit_assessment(schema, assessment_id, member_id, 2)
    schema.commit()
    assert result2["plan_generation"]["created_items"] == 0
    assert result2["plan_generation"]["skipped_items"] == 1
    assert result2["plan_generation"]["created_tasks"] == 0

    plan = schema.execute(
        "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
        (member_id,),
    ).fetchone()
    assert plan is not None
    item_count = schema.execute(
        "SELECT COUNT(*) FROM plan_item WHERE annual_growth_plan_id=%s",
        (plan[0],),
    ).fetchone()[0]
    assert item_count == 1
    task_count = schema.execute(
        """
        SELECT COUNT(*) FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.annual_growth_plan_id=%s
        """,
        (plan[0],),
    ).fetchone()[0]
    assert task_count == 1


def _member_id(connection: psycopg.Connection, assessment_id: int) -> int:
    return int(
        connection.execute(
            "SELECT member_id FROM assessment WHERE id = %s", (assessment_id,)
        ).fetchone()[0]
    )
