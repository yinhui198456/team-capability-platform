"""S3/B01 workspace contract: metrics and queue share one Buddy scope."""

import psycopg

from app.planning.repository import (
    create_evidence_draft,
    get_evidence_review_workspace_for_buddy,
    list_learning_tasks,
    submit_evidence,
    submit_evidence_review,
    transition_learning_task,
)
from tests.review_support import ReviewTestBase, reset_full_schema


class TestB01EvidenceWorkspace(ReviewTestBase):
    def test_workspace_marks_direct_resubmission_and_excludes_member_side_item(
        self, connection: psycopg.Connection
    ) -> None:
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        assessment_id = self.submit(
            connection,
            member_id,
            2026,
            [
                {
                    "l3_code": "P01-L2A-L3A",
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-08",
                }
            ],
        )
        self.approve(connection, assessment_id, buddy_id)
        task = list_learning_tasks(connection, member_id, 2026)[0]
        task_id = int(task["id"])
        transition_learning_task(
            connection, member_id, task_id, "进行中", None, int(task["revision"])
        )
        first = create_evidence_draft(connection, member_id, task_id, "第一版", None)
        submit_evidence(connection, member_id, int(first["id"]))
        submit_evidence_review(
            connection, int(first["id"]), buddy_id, "需补充", "请补充结果"
        )
        resubmission = create_evidence_draft(
            connection,
            member_id,
            task_id,
            "第二版",
            None,
            supersedes_evidence_id=int(first["id"]),
        )
        submit_evidence(connection, member_id, int(resubmission["id"]))

        workspace = get_evidence_review_workspace_for_buddy(connection, buddy_id)

        assert workspace["summary"] == {
            "pending_count": 1,
            "needs_supplement_count": 0,
            "approved_this_month_count": 0,
            "average_response_days": 0.0,
        }
        assert workspace["members"] == [{"id": member_id, "username": "rv-member"}]
        assert [item["id"] for item in workspace["queue"]] == [resubmission["id"]]
        assert workspace["queue"][0]["is_resubmission"] is True
