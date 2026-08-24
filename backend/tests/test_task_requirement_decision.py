import pytest
from fastapi import HTTPException

from app.access.repository import assign_role, create_user
from app.assessment.repository import save_assessment_draft, submit_assessment
from app.catalog.standard_versions import (
    capture_planning_snapshot,
    create_draft,
    publish_version,
)
from app.planning.api import put_task_requirement_decision
from app.planning.repository import (
    TaskRequirementDecisionConflict,
    TaskValidationError,
    create_evidence_draft,
    decide_task_requirement,
    get_learning_task,
    list_evidences,
    list_learning_tasks,
    submit_evidence,
    transition_learning_task,
)
from tests.review_support import ReviewTestBase, reset_full_schema
from tests.standard_target_support import create_scoped_draft, standard_target_payload

_L3 = "P01-L2A-L3A"


class TestTaskRequirementDecision(ReviewTestBase):
    def _submit_followup(self, connection, member_id: int) -> int:
        assessment_id = create_scoped_draft(connection, member_id, 2026, "晋升复核")
        connection.execute(
            """UPDATE assessment SET member_current_level_snapshot='P4',
               member_target_level_snapshot='P5' WHERE id=%s""",
            (assessment_id,),
        )
        payload = standard_target_payload(
            connection,
            assessment_id,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-05",
                }
            ],
        )
        save_assessment_draft(
            connection, assessment_id, member_id, payload, expected_revision=1
        )
        submit_assessment(connection, assessment_id, member_id, expected_revision=2)
        connection.commit()
        return assessment_id

    def _publish_requirement(
        self, connection, actor_id: int, expected_output: str
    ) -> None:
        model_id, node_id = connection.execute(
            """SELECT m.id, n.id FROM capability_model m
               JOIN capability_node n ON n.model_id=m.id
               WHERE n.code=%s""",
            (_L3,),
        ).fetchone()
        draft = create_draft(connection, int(model_id), actor_id, "M05 test change")
        connection.execute(
            "UPDATE capability_node SET expected_output=%s WHERE id=%s",
            (expected_output, node_id),
        )
        connection.execute(
            """DELETE FROM capability_standard_planning_snapshot
               WHERE capability_standard_version_id=%s AND l3_node_id=%s""",
            (int(draft["id"]), node_id),
        )
        capture_planning_snapshot(
            connection, int(draft["id"]), int(node_id), "version_publish"
        )
        publish_version(connection, int(draft["id"]), actor_id, 1)
        connection.commit()

    def _pending_task(self, connection):
        reset_full_schema(connection)
        member_id, buddy_id = self.setup_users(connection)
        self.ensure_nodes(connection, [_L3])
        assessment_id = self.submit(
            connection,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-05",
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
        self._publish_requirement(connection, buddy_id, "第二版预期输出")
        followup = self._submit_followup(connection, member_id)
        self.approve(connection, followup, buddy_id)
        detail = get_learning_task(connection, member_id, int(task["id"]))
        assert detail is not None and detail["requirement_change"] is not None
        return member_id, buddy_id, task, detail

    @pytest.mark.parametrize(
        ("choice", "expected_output"),
        [("adopt_new", "第二版预期输出"), ("continue_current", None)],
    )
    def test_pending_requirement_blocks_evidence_until_immutable_choice(
        self, connection, choice: str, expected_output: str | None
    ) -> None:
        member_id, buddy_id, task, detail = self._pending_task(connection)
        task_id = int(task["id"])
        change = detail["requirement_change"]
        assert isinstance(change, dict)

        evidence = create_evidence_draft(connection, member_id, task_id, "草稿", None)
        with pytest.raises(TaskValidationError, match="choose the requirement"):
            submit_evidence(connection, member_id, int(evidence["id"]))
        assert list_evidences(connection, member_id, task_id)[0]["status"] == "草稿"

        result = decide_task_requirement(
            connection,
            member_id,
            task_id,
            int(change["proposal_detail_id"]),
            choice,
            0,
        )
        assert result["decision"]["choice"] == choice
        readback = get_learning_task(connection, member_id, task_id)
        assert readback is not None
        assert readback["requirement_change"] is None
        assert readback["effective_requirement"]["expected_output"] == expected_output
        submitted = submit_evidence(connection, member_id, int(evidence["id"]))
        assert submitted["status"] == "待 Review"

        with pytest.raises(TaskValidationError, match="immutable"):
            decide_task_requirement(
                connection,
                member_id,
                task_id,
                int(change["proposal_detail_id"]),
                "continue_current" if choice == "adopt_new" else "adopt_new",
                0,
            )
        with pytest.raises(TaskRequirementDecisionConflict):
            decide_task_requirement(
                connection,
                member_id,
                task_id,
                int(change["proposal_detail_id"]),
                choice,
                1,
            )

        self._publish_requirement(connection, buddy_id, "第三版预期输出")
        followup = self._submit_followup(connection, member_id)
        self.approve(connection, followup, buddy_id)
        later = get_learning_task(connection, member_id, task_id)
        assert later is not None
        assert (
            later["requirement_change"]["proposed"]["expected_output"]
            == "第三版预期输出"
        )

    def test_requirement_decision_rejects_wrong_member_and_proposal(
        self, connection
    ) -> None:
        member_id, _, task, detail = self._pending_task(connection)
        other_id = create_user(connection, "other-member", "Other", "secret")
        assign_role(connection, other_id, "Member")
        connection.commit()
        change = detail["requirement_change"]
        assert isinstance(change, dict)

        with pytest.raises(HTTPException) as denied:
            put_task_requirement_decision(
                {"id": other_id, "roles": ["Member"]},
                connection,
                int(task["id"]),
                {
                    "proposal_detail_id": int(change["proposal_detail_id"]),
                    "choice": "adopt_new",
                    "expected_revision": 0,
                },
            )
        assert denied.value.status_code == 403

        with pytest.raises(HTTPException) as invalid:
            put_task_requirement_decision(
                {"id": member_id, "roles": ["Member"]},
                connection,
                int(task["id"]),
                {
                    "proposal_detail_id": int(change["proposal_detail_id"]) + 1,
                    "choice": "adopt_new",
                    "expected_revision": 0,
                },
            )
        assert invalid.value.status_code == 422
        assert invalid.value.detail["field"] == "proposal_detail_id"
