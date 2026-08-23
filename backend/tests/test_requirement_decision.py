# ruff: noqa: E501
import psycopg
import pytest

from app.access.repository import assign_role, create_user
from app.planning.repository import (
    RequirementDecisionConflict,
    decide_requirement_change,
    list_change_proposals,
)
from tests.review_support import ReviewTestBase
from tests.test_evidence import _login, _request

_L3 = "P01-L2A-L3A"


class TestRequirementDecision(ReviewTestBase):
    def _proposal(self, connection: psycopg.Connection) -> tuple[int, int, int]:
        member_id, buddy_id = self.setup_users(connection)
        self.ensure_nodes(connection, [_L3])
        first = self.submit(
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
        self.approve(connection, first, buddy_id)
        second = self.submit(
            connection,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 3,
                    "target_level": 4,
                    "member_priority": "中",
                    "include_in_plan": True,
                    "plan_month": "2026-08",
                }
            ],
        )
        self.approve(connection, second, buddy_id)
        proposal = list_change_proposals(connection, member_id, 2026)[0]
        return member_id, int(proposal["id"]), int(proposal["details"][0]["id"])

    def test_keep_is_idempotent_and_conflicts_when_changed(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, proposal_id, detail_id = self._proposal(review_schema)
        assert (
            decide_requirement_change(
                review_schema, member_id, proposal_id, detail_id, "keep_original"
            )["idempotent"]
            is False
        )
        assert (
            decide_requirement_change(
                review_schema, member_id, proposal_id, detail_id, "keep_original"
            )["idempotent"]
            is True
        )
        with pytest.raises(RequirementDecisionConflict):
            decide_requirement_change(
                review_schema, member_id, proposal_id, detail_id, "adopt_new"
            )
        assert (
            list_change_proposals(review_schema, member_id, 2026)[0]["status"]
            == "已处理"
        )

    def test_rejects_other_member_and_invalid_decision(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, proposal_id, detail_id = self._proposal(review_schema)
        with pytest.raises(PermissionError):
            decide_requirement_change(
                review_schema, member_id + 999, proposal_id, detail_id, "keep_original"
            )
        with pytest.raises(ValueError):
            decide_requirement_change(
                review_schema, member_id, proposal_id, detail_id, "invalid"
            )

    def test_adopt_new_cross_version_updates_lineage_and_preserves_previous(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, proposal_id, detail_id = self._proposal(review_schema)
        old = review_schema.execute(
            "SELECT pi.id, pi.planning_snapshot_id, pi.capability_standard_version_id, pi.l3_node_id, pi.revision, pi.plan_month, pi.priority FROM plan_item pi"
        ).fetchone()
        detail = review_schema.execute(
            "SELECT planning_snapshot_id, l3_node_id FROM annual_plan_change_proposal_detail WHERE id=%s",
            (detail_id,),
        ).fetchone()
        review_schema.execute("SET session_replication_role = replica")
        new_version = review_schema.execute(
            """INSERT INTO capability_standard_version (model_id, version_no, label, status)
            SELECT model_id, version_no + 100, label || '-v2', '草稿'
            FROM capability_standard_version WHERE id=%s RETURNING id""",
            (old[2],),
        ).fetchone()[0]
        new_snapshot = review_schema.execute(
            """INSERT INTO capability_standard_planning_snapshot
            (capability_standard_version_id,l3_node_id,l3_code,l3_name,materials_text,expected_output,estimated_hours,source_type,source_hash)
            SELECT %s,l3_node_id,l3_code,'新任务内容','新材料','新输出','99 h',source_type,'new-hash'
            FROM capability_standard_planning_snapshot WHERE id=%s RETURNING id""",
            (new_version, detail[0]),
        ).fetchone()[0]
        review_schema.execute("SET session_replication_role = origin")
        review_schema.execute(
            "UPDATE annual_plan_change_proposal_detail SET planning_snapshot_id=%s, capability_standard_version_id=%s WHERE id=%s",
            (new_snapshot, new_version, detail_id),
        )
        review_schema.commit()
        decide_requirement_change(
            review_schema, member_id, proposal_id, detail_id, "adopt_new"
        )
        got = review_schema.execute(
            "SELECT planning_snapshot_id,capability_standard_version_id,l3_node_id,l3_name,learning_material,learning_task_content,expected_output,estimated_hours,revision,plan_month,priority FROM plan_item WHERE id=%s",
            (old[0],),
        ).fetchone()
        prev = review_schema.execute(
            "SELECT previous_planning_snapshot_id FROM annual_plan_change_proposal_detail WHERE id=%s",
            (detail_id,),
        ).fetchone()[0]
        assert got == (
            new_snapshot,
            new_version,
            old[3],
            "新任务内容",
            "新材料",
            "新任务内容",
            "新输出",
            "99 h",
            old[4] + 1,
            old[5],
            old[6],
        )
        assert prev == old[1]

    def test_member_requirement_decision_endpoint_contract(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, proposal_id, detail_id = self._proposal(review_schema)
        cookies = _login(review_schema, "rv-member")
        path = f"/api/planning/change-proposals/{proposal_id}/details/{detail_id}/requirement-decision"
        status, body, _ = _request("PUT", path, {"decision": "keep_original"}, cookies)
        assert status == 200 and body["idempotent"] is False
        status, body, _ = _request("PUT", path, {"decision": "keep_original"}, cookies)
        assert status == 200 and body["idempotent"] is True
        status, body, _ = _request("PUT", path, {"decision": "adopt_new"}, cookies)
        assert (
            status == 409 and body["detail"]["code"] == "requirement_decision_conflict"
        )
        status, body, _ = _request("PUT", path, {"decision": "invalid"}, cookies)
        assert status == 422
        buddy_cookies = _login(review_schema, "rv-buddy")
        status, _, _ = _request(
            "PUT", path, {"decision": "keep_original"}, buddy_cookies
        )
        assert status == 403
        other_id = create_user(review_schema, "other-member", "Other", "secret")
        assign_role(review_schema, other_id, "Member")
        review_schema.commit()
        status, _, _ = _request(
            "PUT",
            path,
            {"decision": "keep_original"},
            _login(review_schema, "other-member"),
        )
        assert status == 403
