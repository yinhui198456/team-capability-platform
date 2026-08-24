"""S3/B01 workspace contract: metrics and queue share one Buddy scope."""

from concurrent.futures import ThreadPoolExecutor

import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.planning.repository import (
    create_evidence_draft,
    get_evidence_review_workspace_for_buddy,
    list_learning_tasks,
    submit_evidence,
    submit_evidence_review,
    transition_learning_task,
)
from tests.review_support import ReviewTestBase, reset_full_schema
from tests.test_evidence_review import _login, _request


class TestB01EvidenceWorkspace(ReviewTestBase):
    @pytest.mark.parametrize(
        "assignment_sql",
        [
            "UPDATE buddy_relationship SET effective_date=CURRENT_DATE+1 "
            "WHERE member_id=%s",
            "UPDATE buddy_relationship SET expiry_date=CURRENT_DATE-1 "
            "WHERE member_id=%s",
        ],
        ids=["future", "expired"],
    )
    def test_workspace_uses_canonical_current_buddy_relationship(
        self, connection: psycopg.Connection, assignment_sql: str
    ) -> None:
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        connection.execute(assignment_sql, (member_id,))
        connection.commit()

        workspace = get_evidence_review_workspace_for_buddy(connection, buddy_id)

        assert workspace["members"] == []
        assert workspace["queue"] == []
        assert workspace["summary"]["pending_count"] == 0
        with pytest.raises(PermissionError):
            get_evidence_review_workspace_for_buddy(connection, buddy_id, member_id)

    def test_workspace_excludes_other_buddy_and_forbids_unknown_member(
        self, connection: psycopg.Connection
    ) -> None:
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        other_buddy_id = create_user(
            connection, "rv-other-buddy", "Other Buddy", "secret"
        )
        assign_role(connection, other_buddy_id, "Buddy")
        connection.commit()

        workspace = get_evidence_review_workspace_for_buddy(connection, other_buddy_id)

        assert workspace["members"] == []
        assert workspace["queue"] == []
        assert workspace["summary"]["average_response_days"] is None
        with pytest.raises(PermissionError):
            get_evidence_review_workspace_for_buddy(
                connection, other_buddy_id, member_id
            )
        cookies = _login(connection, "rv-buddy")
        status, _, _ = _request(
            "GET",
            f"/api/planning/evidence-reviews/workspace?member_id={member_id + 1_000}",
            cookies=cookies,
        )
        assert status == 403

    def test_workspace_requires_an_active_buddy_role(
        self, connection: psycopg.Connection
    ) -> None:
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        connection.execute("DELETE FROM tcp_user_role WHERE user_id=%s", (buddy_id,))
        connection.commit()

        assert (
            get_evidence_review_workspace_for_buddy(connection, buddy_id)["members"]
            == []
        )
        with pytest.raises(PermissionError):
            get_evidence_review_workspace_for_buddy(connection, buddy_id, member_id)

    def test_review_same_key_concurrently_replays_one_write(
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
        transition_learning_task(
            connection,
            member_id,
            int(task["id"]),
            "进行中",
            None,
            int(task["revision"]),
        )
        connection.commit()
        member_cookies = _login(connection, "rv-member")
        buddy_cookies = _login(connection, "rv-buddy")
        status, evidence, _ = _request(
            "POST",
            f"/api/planning/learning-tasks/{task['id']}/evidences",
            {"content": "成果", "evidence_link": "http://example.com/out"},
            cookies=member_cookies,
        )
        assert status == 200
        evidence_id = int(evidence["id"])
        _request(
            "POST",
            f"/api/planning/evidences/{evidence_id}/submit",
            {},
            cookies=member_cookies,
        )

        def review() -> tuple[int, object]:
            return _request(
                "POST",
                f"/api/planning/evidences/{evidence_id}/review",
                {
                    "conclusion": "通过",
                    "feedback": "达标",
                    "idempotency_key": "same-key",
                },
                cookies=buddy_cookies,
            )[:2]

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: review(), range(2)))

        assert [status for status, _ in results] == [200, 200]
        assert results[0][1]["id"] == results[1][1]["id"]
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM evidence_review WHERE evidence_id=%s",
                (evidence_id,),
            ).fetchone()[0]
            == 1
        )

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
        review = submit_evidence_review(
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
        assert workspace["members"] == [
            {"id": member_id, "username": "rv-member", "pending_count": 1}
        ]
        assert [item["id"] for item in workspace["queue"]] == [resubmission["id"]]
        assert workspace["queue"][0]["is_resubmission"] is True

        connection.execute(
            "UPDATE evidence_review SET reviewed_at=date_trunc('month', "
            "CURRENT_TIMESTAMP) - INTERVAL '1 day' WHERE id=%s",
            (int(review["id"]),),
        )
        connection.commit()
        assert (
            get_evidence_review_workspace_for_buddy(connection, buddy_id)["summary"][
                "average_response_days"
            ]
            is None
        )
