"""S3/B01 workspace contract: metrics and queue share one Buddy scope."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier, Event

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)
from app.planning.repository import (
    EvidenceReviewConflict,
    create_evidence_draft,
    get_evidence_review_workspace_for_buddy,
    list_learning_tasks,
    submit_evidence,
    submit_evidence_review,
    transition_learning_task,
)
from tests.review_support import (
    ReviewTestBase,
    create_generated_plan_items,
    reset_full_schema,
)
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
        create_generated_plan_items(
            connection,
            member_id,
            2026,
            [
                {
                    "l3_code": "P01-L2A-L3A",
                    "current_level": 0,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-08",
                }
            ],
        )
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
        status, body, _ = _request(
            "POST",
            f"/api/planning/evidences/{evidence_id}/review",
            {
                "conclusion": "需补充",
                "feedback": "不同结论",
                "idempotency_key": "same-key",
            },
            cookies=buddy_cookies,
        )
        assert status == 409
        assert body["detail"]["code"] == "review_idempotency_conflict"

        second = create_evidence_draft(
            connection, member_id, int(task["id"]), "第二份成果", None
        )
        submit_evidence(connection, member_id, int(second["id"]))
        connection.commit()
        status, body, _ = _request(
            "POST",
            f"/api/planning/evidences/{second['id']}/review",
            {"conclusion": "通过", "feedback": "达标", "idempotency_key": "same-key"},
            cookies=buddy_cookies,
        )
        assert status == 409
        assert body["detail"]["code"] == "review_idempotency_conflict"

    def test_review_same_key_across_evidence_concurrently_conflicts(
        self, connection: psycopg.Connection
    ) -> None:
        """Two database sessions never leak the global key UNIQUE violation."""
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        other_member_id = create_user(
            connection, "rv-second-member", "Second Member", "secret"
        )
        assign_role(connection, other_member_id, "Member")
        connection.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (other_member_id,),
        )
        create_buddy_relationship(connection, other_member_id, buddy_id)
        for member in (member_id, other_member_id):
            create_generated_plan_items(
                connection,
                member,
                2026,
                [
                    {
                        "l3_code": "P01-L2A-L3A",
                        "current_level": 0,
                        "member_priority": "高",
                        "include_in_plan": True,
                        "plan_month": "2026-08",
                    }
                ],
            )
        evidence_ids = []
        for member in (member_id, other_member_id):
            task = list_learning_tasks(connection, member, 2026)[0]
            transition_learning_task(
                connection,
                member,
                int(task["id"]),
                "进行中",
                None,
                int(task["revision"]),
            )
            evidence = create_evidence_draft(
                connection, member, int(task["id"]), "成果", None
            )
            submit_evidence(connection, member, int(evidence["id"]))
            evidence_ids.append(int(evidence["id"]))
        connection.commit()

        from app.settings import settings

        idempotency_query = (
            "FROM evidence_review er\n                WHERE er.idempotency_key"
        )
        idempotency_lock_seen = Event()
        select_barrier = Barrier(2)

        class SynchronizedConnection:
            def __init__(self, raw: psycopg.Connection) -> None:
                self.raw = raw

            def transaction(self):
                return self.raw.transaction()

            def execute(self, query, params=None):
                text = str(query)
                result = self.raw.execute(query, params)
                if (
                    "pg_advisory_xact_lock" in text
                    and params
                    and "tcp_evidence_review_idempotency:" in str(params[0])
                ):
                    idempotency_lock_seen.set()
                if idempotency_query in text and not idempotency_lock_seen.is_set():
                    select_barrier.wait(timeout=10)
                return result

        def review(evidence_id: int) -> str:
            with psycopg.connect(settings.database_url) as raw:
                try:
                    submit_evidence_review(
                        SynchronizedConnection(raw),
                        evidence_id,
                        buddy_id,
                        "通过",
                        "达标",
                        "cross-evidence-key",
                    )
                    return "created"
                except EvidenceReviewConflict:
                    return "conflict"

        with ThreadPoolExecutor(max_workers=2) as pool:
            outcomes = list(pool.map(review, evidence_ids))

        assert sorted(outcomes) == ["conflict", "created"]
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM evidence_review "
                "WHERE idempotency_key='cross-evidence-key'"
            ).fetchone()[0]
            == 1
        )

    def test_workspace_marks_direct_resubmission_and_excludes_member_side_item(
        self, connection: psycopg.Connection
    ) -> None:
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        create_generated_plan_items(
            connection,
            member_id,
            2026,
            [
                {
                    "l3_code": "P01-L2A-L3A",
                    "current_level": 0,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-08",
                }
            ],
        )
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
        create_generated_plan_items(
            connection,
            member_id,
            2027,
            [
                {
                    "l3_code": "P01-L2A-L3A",
                    "current_level": 0,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2027-08",
                }
            ],
        )
        normal_task = list_learning_tasks(connection, member_id, 2027)[0]
        transition_learning_task(
            connection,
            member_id,
            int(normal_task["id"]),
            "进行中",
            None,
            int(normal_task["revision"]),
        )
        normal = create_evidence_draft(
            connection, member_id, int(normal_task["id"]), "首次提交", None
        )
        submit_evidence(connection, member_id, int(normal["id"]))

        workspace = get_evidence_review_workspace_for_buddy(connection, buddy_id)

        assert workspace["summary"] == {
            "pending_count": 2,
            "needs_supplement_count": 0,
            "approved_this_month_count": 0,
            "average_response_days": 0.0,
        }
        assert workspace["members"] == [
            {"id": member_id, "username": "rv-member", "pending_count": 2}
        ]
        assert {
            int(item["id"]): bool(item["is_resubmission"])
            for item in workspace["queue"]
        } == {int(normal["id"]): False, int(resubmission["id"]): True}

        other_buddy_id = create_user(
            connection, "rv-pending-outsider", "Pending Outsider", "secret"
        )
        assign_role(connection, other_buddy_id, "Buddy")
        connection.commit()
        assert get_evidence_review_workspace_for_buddy(connection, other_buddy_id) == {
            "summary": {
                "pending_count": 0,
                "needs_supplement_count": 0,
                "approved_this_month_count": 0,
                "average_response_days": None,
            },
            "members": [],
            "queue": [],
        }

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
