"""Issue #62: atomic first-approval plan generation, subsequent-approval
change proposals, final archived state and legacy write blocking.

Every scenario runs against the production review write path
(submit_assessment_review) with real PostgreSQL rows and the v0009 schema.
"""

import psycopg
import pytest

from app.assessment.repository import (
    ReviewError,
    get_assessment,
    get_assessment_reviews,
    get_buddy_review_workspace,
)
from app.planning.repository import (
    LegacyPlanningWriteDisabled,
    create_growth_goal,
    generate_plan_items,
    get_annual_plan_with_items,
    list_change_proposals,
)
from tests.review_support import ReviewTestBase

_L3 = "P01-L2A-L3A"


class TestReviewPlanAtomic(ReviewTestBase):
    def test_approve_zero_items_creates_plan_shell(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [{"l3_code": _L3, "current_level": 3, "target_level": 3}],
        )
        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["plan"]["created"] is True
        assert result["plan"]["items_created"] == 0
        assert result["plan"]["tasks_created"] == 0
        plan = get_annual_plan_with_items(review_schema, member_id, 2026)
        assert plan is not None
        assert plan["source_assessment_id"] == assessment_id
        assert plan["planning_source_type"] == "assessment_approval"
        assert plan["items"] == []
        assert (
            review_schema.execute("SELECT COUNT(*) FROM learning_task").fetchone()[0]
            == 0
        )

    def test_approve_multiple_items_one_item_one_task_and_full_snapshot(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["plan"]["items_created"] == 1
        assert result["plan"]["tasks_created"] == 1

        plan = get_annual_plan_with_items(review_schema, member_id, 2026)
        assert plan is not None
        assert len(plan["items"]) == 1
        item = plan["items"][0]
        assert item["source_assessment_id"] == assessment_id
        assert item["source_assessment_detail_id"] is not None
        assert item["capability_standard_version_id"] is not None
        assert item["planning_snapshot_id"] is not None
        assert item["l3_node_id"] is not None
        assert item["planning_source_type"] == "assessment_approval"
        assert item["include_in_plan"] is True
        assert item["priority"] == "高"
        assert item["plan_quarter"] == "Q2"
        assert item["plan_month"] == 5
        assert item["gap_value"] == 2
        assert item["current_level"] == 2
        assert item["target_level"] == 4
        assert item["effective_target_level"] == 4
        assert item["member_current_level_snapshot"] == "P4"
        assert item["member_target_level_snapshot"] == "P5"
        assert item["assessment_revision"] == 3
        assert item["l1_code"] is not None
        assert item["l2_code"] is not None
        assert item["l3_name"] is not None
        assert item["scope_type"] is not None
        # frozen planning source: material/output/hours come from the immutable
        # snapshot, never from live catalog recomputation
        assert (
            item["learning_material"] is not None
            or item["learning_task_content"] is not None
        )
        tasks = review_schema.execute(
            """
            SELECT lt.id, lt.plan_item_id, lt.status FROM learning_task lt
            JOIN plan_item pi ON pi.id = lt.plan_item_id
            WHERE pi.source_assessment_detail_id = %s
            """,
            (item["source_assessment_detail_id"],),
        ).fetchall()
        assert len(tasks) == 1
        assert tasks[0][2] == "未开始"

    def test_approve_missing_snapshot_rolls_back_everything(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        # Simulate a missing immutable snapshot (corrupt/legacy data): bypass
        # the published-version immutability trigger for this one deletion.
        review_schema.execute("SET session_replication_role = replica")
        review_schema.execute(
            "DELETE FROM capability_standard_planning_snapshot "
            "WHERE l3_node_id IN (SELECT l3_node_id FROM assessment_detail "
            "WHERE assessment_id=%s)",
            (assessment_id,),
        )
        review_schema.execute("SET session_replication_role = origin")
        review_schema.commit()
        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_missing"
        # zero partial writes: assessment still pending, no plan/items/tasks
        assessment = get_assessment(review_schema, assessment_id)
        assert assessment is not None
        assert assessment["status"] == "待复核"
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 0
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 0
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM learning_task").fetchone()[0]
            == 0
        )
        reviews = get_assessment_reviews(review_schema, assessment_id)
        assert reviews[0]["status"] == "待复核"

    def test_adjustment_writes_zero_plan_data(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        result = self.approve(
            review_schema,
            assessment_id,
            buddy_id,
            conclusion="建议调整",
            feedback="请补充说明",
        )
        assert result["assessment_status"] == "建议调整"
        assert result["plan"] is None
        assert result["proposal"] is None
        assessment = get_assessment(review_schema, assessment_id)
        assert assessment["status"] == "建议调整"
        for table in (
            "annual_growth_plan",
            "plan_item",
            "learning_task",
            "annual_plan_change_proposal",
            "annual_plan_change_proposal_detail",
        ):
            assert (
                review_schema.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                == 0
            ), table

    def test_adjustment_requires_feedback(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(ReviewError) as excinfo:
            self.approve(
                review_schema,
                assessment_id,
                buddy_id,
                conclusion="建议调整",
                feedback="   ",
            )
        assert excinfo.value.code == "feedback_required"

    def test_second_approval_creates_proposal_without_touching_plan(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        first = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        self.approve(review_schema, first, buddy_id)

        second = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 3,
                    "target_level": 4,
                    "member_priority": "中",
                    "include_in_plan": True,
                    "plan_quarter": "Q3",
                    "plan_month": 8,
                }
            ],
        )
        plan_before = get_annual_plan_with_items(review_schema, member_id, 2026)
        result = self.approve(review_schema, second, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["plan"] is None
        assert result["proposal"] is not None
        assert result["proposal"]["created"] is True
        assert result["proposal"]["target_is_legacy"] is False

        proposals = list_change_proposals(review_schema, member_id, 2026)
        assert len(proposals) == 1
        proposal = proposals[0]
        assert proposal["source_assessment_id"] == second
        assert proposal["target_annual_growth_plan_id"] == plan_before["id"]
        assert proposal["status"] == "待处理"
        assert len(proposal["details"]) == 1
        detail = proposal["details"][0]
        assert detail["plan_quarter"] == "Q3"
        assert detail["plan_month"] == 8
        assert detail["capability_standard_version_id"] is not None
        assert detail["planning_snapshot_id"] is not None
        assert detail["assessment_revision"] == 3

        plan_after = get_annual_plan_with_items(review_schema, member_id, 2026)
        assert len(plan_after["items"]) == len(plan_before["items"]) == 1
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )

    def test_approve_records_reviewed_by_buddy(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        self.approve(review_schema, assessment_id, buddy_id)
        reviews = get_assessment_reviews(review_schema, assessment_id)
        assert reviews[0]["status"] == "已闭环"
        row = review_schema.execute(
            "SELECT reviewed_by_buddy_id FROM assessment_review "
            "WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        assert row[0] == buddy_id

    def test_priority_column_has_no_default(
        self, review_schema: psycopg.Connection
    ) -> None:
        row = review_schema.execute(
            "SELECT column_default FROM information_schema.columns "
            "WHERE table_name='plan_item' AND column_name='priority'"
        ).fetchone()
        assert row[0] is None

    def test_workspace_dto_reads_canonical_facts(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        workspace = get_buddy_review_workspace(review_schema, assessment_id)
        assert workspace is not None
        summary = workspace["summary"]
        assert summary["total"] == 1
        assert summary["current_required"] == 1
        assert summary["assessed"] == 1
        assert summary["gap_items"] == 1
        assert summary["high"] == 1
        assert summary["in_plan"] == 1
        assert summary["by_quarter"]["Q2"] == 1
        assert summary["existing_formal_plan"] is False
        assert summary["will_create_proposal"] is False
        detail = workspace["details"][0]
        # canonical facts read straight from assessment_detail, no recomputation
        assert detail["target_level"] == 4
        assert detail["gap_value"] == 2
        assert detail["data_issue"] is False

    def test_legacy_write_entrypoints_blocked(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        with pytest.raises(LegacyPlanningWriteDisabled):
            create_growth_goal(review_schema, member_id, 1)
        with pytest.raises(LegacyPlanningWriteDisabled):
            generate_plan_items(review_schema, member_id)

    def test_legacy_write_apis_blocked_over_http(
        self, review_schema: psycopg.Connection
    ) -> None:
        from tests.test_assessment_review import _login, _request

        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        cookies = _login(review_schema, "rv-member")
        assert cookies
        for path in (
            "/api/planning/growth-goals",
            "/api/planning/annual-plan/generate",
            "/api/planning/plan-items/1/learning-task",
        ):
            status, body, _ = _request("POST", path, body={}, cookies=cookies)
            assert status == 422, path
            assert body["detail"]["code"] == "legacy_planning_write_disabled", path
        status, body, _ = _request(
            "DELETE", "/api/planning/growth-goals/1", cookies=cookies
        )
        assert status == 422
        assert body["detail"]["code"] == "legacy_planning_write_disabled"


class TestApproveLegacyNullNodeDetail(ReviewTestBase):
    """Issue #65: compatibility-repaired legacy drafts may hold canonical
    details whose l3_node_id is NULL while l3_code still identifies the
    standard item.  Buddy final approval must resolve the node safely from
    the immutable planning snapshot instead of crashing (observed 500
    TypeError in UAT); insufficient/ambiguous identity stays a controlled
    422 with zero partial writes.
    """

    _INCLUDED = {
        "l3_code": _L3,
        "current_level": 2,
        "target_level": 4,
        "member_priority": "高",
        "include_in_plan": True,
        "plan_quarter": "Q2",
        "plan_month": 5,
    }

    @staticmethod
    def _null_node_id(connection: psycopg.Connection, assessment_id: int) -> int:
        """Simulate the compat-repair state; returns the original node id."""
        row = connection.execute(
            "SELECT l3_node_id FROM assessment_detail WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        assert row is not None and row[0] is not None
        connection.execute(
            "UPDATE assessment_detail SET l3_node_id=NULL WHERE assessment_id=%s",
            (assessment_id,),
        )
        connection.commit()
        return int(row[0])

    def _assert_no_partial_writes(
        self, connection: psycopg.Connection, assessment_id: int
    ) -> None:
        assessment = get_assessment(connection, assessment_id)
        assert assessment is not None
        assert assessment["status"] == "待复核"
        reviews = get_assessment_reviews(connection, assessment_id)
        assert reviews[0]["status"] == "待复核"
        for table in (
            "annual_growth_plan",
            "plan_item",
            "learning_task",
            "annual_plan_change_proposal",
            "annual_plan_change_proposal_detail",
        ):
            assert (
                connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
            ), table

    def test_approve_null_node_detail_resolves_by_code(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        original_node = self._null_node_id(review_schema, assessment_id)

        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["plan"]["items_created"] == 1
        plan = get_annual_plan_with_items(review_schema, member_id, 2026)
        assert plan is not None
        assert len(plan["items"]) == 1
        item = plan["items"][0]
        assert item["l3_node_id"] == original_node
        assert item["planning_snapshot_id"] is not None
        assert item["capability_standard_version_id"] is not None

    def test_approve_null_node_detail_proposal_path_resolves_by_code(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The UAT failure shape: member already has a formal plan, so the
        approval takes the change-proposal path with a NULL-node detail."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        first = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        self.approve(review_schema, first, buddy_id)

        second = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        original_node = self._null_node_id(review_schema, second)

        result = self.approve(review_schema, second, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["proposal"] is not None
        assert result["proposal"]["created"] is True
        proposals = list_change_proposals(review_schema, member_id, 2026)
        assert len(proposals) == 1
        assert len(proposals[0]["details"]) == 1
        assert proposals[0]["details"][0]["l3_node_id"] == original_node

    def test_approve_null_node_unknown_code_controlled_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        self._null_node_id(review_schema, assessment_id)
        review_schema.execute(
            "UPDATE assessment_detail SET l3_code='P99-NOPE-L3Z' "
            "WHERE assessment_id=%s",
            (assessment_id,),
        )
        review_schema.commit()

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_missing"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)

    def test_approve_null_node_ambiguous_code_controlled_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        self._null_node_id(review_schema, assessment_id)
        # Corrupt duplicate: a second snapshot row for the same code but a
        # different node, making code-based resolution ambiguous.  The extra
        # node is created after submit so scope computation is unaffected.
        self.ensure_nodes(review_schema, ["P01-L2A-L3B"])
        dup_node = review_schema.execute(
            "SELECT id FROM capability_node WHERE code='P01-L2A-L3B'"
        ).fetchone()[0]
        version_id = review_schema.execute(
            "SELECT capability_standard_version_id FROM assessment WHERE id=%s",
            (assessment_id,),
        ).fetchone()[0]
        review_schema.execute("SET session_replication_role = replica")
        review_schema.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                source_type, source_hash
            )
            VALUES (%s, %s, %s, 'duplicate', 'version_publish', 'dup-hash')
            """,
            (version_id, dup_node, _L3),
        )
        review_schema.execute("SET session_replication_role = origin")
        review_schema.commit()

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_ambiguous"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)


class _LegacyNullScopeBase(ReviewTestBase):
    """Shared fixtures for Issue #65 legacy (pre-scope) approval simulations.

    Legacy (pre-scope) drafts never froze scope_type and the member UI has no
    control for it, so Buddy final approval of a legitimate legacy assessment
    is blocked with planning_snapshot_incomplete (observed in UAT on three
    included repair-lineage details).

    Legacy drafts are canonically measured against the member's frozen TARGET
    job level (the compat repair flow resolves applicability and the standard
    target from the bound version's target-level matrix row only), so the
    immutable contract uniquely determines the missing scope when that row
    exists, is applicable and agrees with every other frozen canonical field;
    missing or conflicting evidence stays a controlled 422 with zero partial
    writes.
    """

    _INCLUDED = {
        "l3_code": _L3,
        "current_level": 2,
        "target_level": 4,
        "member_priority": "高",
        "include_in_plan": True,
        "plan_quarter": "Q2",
        "plan_month": 5,
    }

    # Fixture Legacy Baseline for _L3 (recommended_start_level P4):
    # P4 row applicable target 2, P5 row applicable target 3 (DEFAULT_TARGETS).
    _TARGET_JOB_TARGET = 3  # repair-lineage frozen standard target (P5 row)

    @staticmethod
    def _simulate_legacy_null_scope(
        connection: psycopg.Connection,
        assessment_id: int,
        *,
        standard_target: int | None = _TARGET_JOB_TARGET,
        frozen_job: str | None = None,
        null_node: bool = True,
    ) -> int:
        """Rebuild the #65 UAT legacy shape: a pre-scope draft (no scope
        version) whose included detail carries the repair-lineage standard
        target but no frozen scope fields.  Returns the original node id."""
        row = connection.execute(
            "SELECT l3_node_id FROM assessment_detail WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        assert row is not None and row[0] is not None
        connection.execute(
            "UPDATE assessment SET assessment_scope_version=NULL WHERE id=%s",
            (assessment_id,),
        )
        connection.execute(
            """
            UPDATE assessment_detail
            SET scope_type=NULL,
                standard_job_level_snapshot=%s,
                standard_target_level=%s,
                l3_node_id = CASE WHEN %s THEN NULL ELSE l3_node_id END
            WHERE assessment_id=%s
            """,
            (frozen_job, standard_target, null_node, assessment_id),
        )
        connection.commit()
        return int(row[0])

    def _assert_no_partial_writes(
        self, connection: psycopg.Connection, assessment_id: int
    ) -> None:
        assessment = get_assessment(connection, assessment_id)
        assert assessment is not None
        assert assessment["status"] == "待复核"
        reviews = get_assessment_reviews(connection, assessment_id)
        assert reviews[0]["status"] == "待复核"
        for table in (
            "annual_growth_plan",
            "plan_item",
            "learning_task",
            "annual_plan_change_proposal",
            "annual_plan_change_proposal_detail",
        ):
            assert (
                connection.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0] == 0
            ), table


class TestApproveLegacyNullScopeType(_LegacyNullScopeBase):
    """Legacy included details with NULL scope_type derive from the frozen
    target-level matrix row; missing or conflicting evidence stays a 422."""

    def test_approve_null_scope_type_derives_from_target_level_matrix(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The UAT shape: NULL l3_node_id AND NULL scope fields; the bound
        version's P5 matrix row (applicable, target 3) uniquely determines
        the missing scope and agrees with the frozen standard target."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        original_node = self._simulate_legacy_null_scope(review_schema, assessment_id)

        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["plan"]["items_created"] == 1
        plan = get_annual_plan_with_items(review_schema, member_id, 2026)
        assert plan is not None
        assert len(plan["items"]) == 1
        item = plan["items"][0]
        assert item["l3_node_id"] == original_node
        assert item["scope_type"] == "target_progressive"
        assert item["standard_job_level_snapshot"] == "P5"
        assert item["standard_target_level"] == self._TARGET_JOB_TARGET
        detail = review_schema.execute(
            "SELECT scope_type, standard_job_level_snapshot, l3_node_id "
            "FROM assessment_detail WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        assert detail[0] == "target_progressive"
        assert detail[1] == "P5"
        assert int(detail[2]) == original_node

    def test_approve_null_scope_type_proposal_path(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The exact UAT F3 shape: the member already has a formal plan, so
        approval of the legacy second assessment takes the change-proposal
        path; a repeat approval is rejected without duplicating data."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        first = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        self.approve(review_schema, first, buddy_id)

        second = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        self._simulate_legacy_null_scope(review_schema, second, null_node=False)

        result = self.approve(review_schema, second, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["proposal"] is not None
        assert result["proposal"]["created"] is True
        proposals = list_change_proposals(review_schema, member_id, 2026)
        assert len(proposals) == 1
        assert len(proposals[0]["details"]) == 1
        detail = proposals[0]["details"][0]
        assert detail["scope_type"] == "target_progressive"
        assert detail["standard_target_level"] == self._TARGET_JOB_TARGET

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, second, buddy_id)
        assert excinfo.value.code == "assessment_already_reviewed"
        assert len(list_change_proposals(review_schema, member_id, 2026)) == 1

    def test_approve_populated_scope_type_preserved(
        self, review_schema: psycopg.Connection
    ) -> None:
        """An already-frozen scope_type is never silently overridden, even on
        a legacy (no scope version) assessment."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        frozen = review_schema.execute(
            "SELECT scope_type, standard_job_level_snapshot, "
            "standard_target_level FROM assessment_detail WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        assert frozen[0] == "current_required"  # scope-v1 current-wins freeze
        review_schema.execute(
            "UPDATE assessment SET assessment_scope_version=NULL WHERE id=%s",
            (assessment_id,),
        )
        review_schema.commit()

        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        item = get_annual_plan_with_items(review_schema, member_id, 2026)["items"][0]
        assert item["scope_type"] == "current_required"
        assert item["standard_job_level_snapshot"] == frozen[1]
        assert item["standard_target_level"] == frozen[2]

    def test_approve_null_scope_conflicting_frozen_target_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Frozen standard target 2 belongs to the P4 matrix row while the
        legacy target-level lineage resolves the P5 row (target 3): the
        canonical evidence conflicts, so approval stays a controlled 422
        instead of manufacturing a scope."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        self._simulate_legacy_null_scope(
            review_schema, assessment_id, standard_target=2
        )

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_conflict"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)

    def test_approve_null_scope_conflicting_frozen_job_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        self._simulate_legacy_null_scope(review_schema, assessment_id, frozen_job="P4")

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_conflict"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)

    def test_approve_null_scope_target_row_not_applicable_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        original_node = self._simulate_legacy_null_scope(review_schema, assessment_id)
        review_schema.execute(
            "UPDATE capability_standard_item SET applicable=FALSE, "
            "target_level=NULL WHERE l3_node_id=%s AND job_level='P5'",
            (original_node,),
        )
        review_schema.commit()

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_conflict"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)

    def test_approve_null_scope_missing_matrix_row_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        original_node = self._simulate_legacy_null_scope(review_schema, assessment_id)
        review_schema.execute(
            "DELETE FROM capability_standard_item "
            "WHERE l3_node_id=%s AND job_level='P5'",
            (original_node,),
        )
        review_schema.commit()

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_incomplete"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)


class TestApproveLegacyNullFrozenLineage(_LegacyNullScopeBase):
    """Issue #65: compat-repaired legacy details may also lack the frozen
    lineage columns (l1_code/l1_name/l2_code/l2_name/l3_name); only l3_code
    survives.  On the change-proposal path the NOT NULL contract of
    annual_plan_change_proposal_detail then surfaced as an uncontrolled 500
    NotNullViolation (observed in UAT on the F3 retry).  The approval path
    must derive the missing lineage from the resolved node's canonical
    ancestry (l3_name from the immutable version-bound planning snapshot),
    stamp it inside the same atomic transaction, keep populated frozen values
    untouched, and return a controlled 422 when the lineage cannot be
    resolved.
    """

    # Fixture node ancestry (ensure_capability_nodes uses code as name):
    # L1 P01 / L2 P01-L2A / L3 P01-L2A-L3A.
    _LINEAGE = ("P01", "P01", "P01-L2A", "P01-L2A", "P01-L2A-L3A")

    def _simulate_legacy_null_lineage(
        self, connection: psycopg.Connection, assessment_id: int
    ) -> int:
        """Full #65 UAT shape: legacy scope fields plus every frozen lineage
        column NULL.  Returns the original node id."""
        original_node = self._simulate_legacy_null_scope(connection, assessment_id)
        connection.execute(
            """
            UPDATE assessment_detail
            SET l1_code=NULL, l1_name=NULL, l2_code=NULL, l2_name=NULL,
                l3_name=NULL
            WHERE assessment_id=%s
            """,
            (assessment_id,),
        )
        connection.commit()
        return original_node

    def test_approve_null_frozen_lineage_proposal_path_derives(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The exact UAT F3-retry shape: the member already has a formal
        plan, so approval takes the proposal path; baseline crashed with an
        uncontrolled 500 NotNullViolation on l1_code."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        first = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        self.approve(review_schema, first, buddy_id)

        second = self.submit(review_schema, member_id, 2026, [dict(self._INCLUDED)])
        self._simulate_legacy_null_lineage(review_schema, second)

        result = self.approve(review_schema, second, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["proposal"] is not None
        assert result["proposal"]["created"] is True
        proposals = list_change_proposals(review_schema, member_id, 2026)
        assert len(proposals) == 1
        assert len(proposals[0]["details"]) == 1
        detail = proposals[0]["details"][0]
        assert detail["l1_code"] == self._LINEAGE[0]
        assert detail["l1_name"] == self._LINEAGE[1]
        assert detail["l2_code"] == self._LINEAGE[2]
        assert detail["l2_name"] == self._LINEAGE[3]
        assert detail["l3_name"] == self._LINEAGE[4]
        assert detail["scope_type"] == "target_progressive"
        stamped = review_schema.execute(
            "SELECT l1_code, l1_name, l2_code, l2_name, l3_name "
            "FROM assessment_detail WHERE assessment_id=%s",
            (second,),
        ).fetchone()
        assert tuple(stamped) == self._LINEAGE

    def test_approve_null_frozen_lineage_plan_path_derives(
        self, review_schema: psycopg.Connection
    ) -> None:
        """First-approval plan path: plan_item tolerates NULL lineage, but
        the frozen contract must stay coherent — derived, not left NULL."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        self._simulate_legacy_null_lineage(review_schema, assessment_id)

        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        assert result["plan"]["items_created"] == 1
        item = get_annual_plan_with_items(review_schema, member_id, 2026)["items"][0]
        assert item["l1_code"] == self._LINEAGE[0]
        assert item["l1_name"] == self._LINEAGE[1]
        assert item["l2_code"] == self._LINEAGE[2]
        assert item["l2_name"] == self._LINEAGE[3]
        assert item["l3_name"] == self._LINEAGE[4]

    def test_approve_null_lineage_broken_ancestry_422_atomic(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        original_node = self._simulate_legacy_null_lineage(review_schema, assessment_id)
        # Break the canonical ancestry after the fact: the L3 node loses its
        # L2 parent, so the lineage cannot be derived.  The hierarchy CHECK
        # and trigger normally forbid this (contained per-test schema, so
        # dropping them here is safe) — simulate corrupt catalog data.
        review_schema.execute(
            "ALTER TABLE capability_node DROP CONSTRAINT capability_node_check"
        )
        review_schema.execute("SET session_replication_role = replica")
        review_schema.execute(
            "UPDATE capability_node SET parent_node_id=NULL WHERE id=%s",
            (original_node,),
        )
        review_schema.execute("SET session_replication_role = origin")
        review_schema.commit()

        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "planning_snapshot_incomplete"
        assert excinfo.value.status_code == 422
        self._assert_no_partial_writes(review_schema, assessment_id)

    def test_approve_populated_lineage_preserved_after_rename(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Populated frozen lineage is never re-derived: renaming the live
        catalog after submit must not leak into the frozen plan item."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [dict(self._INCLUDED)]
        )
        node_id = review_schema.execute(
            "SELECT l3_node_id FROM assessment_detail WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()[0]
        review_schema.execute(
            "UPDATE capability_node SET name='renamed-l3' WHERE id=%s", (node_id,)
        )
        review_schema.execute(
            "UPDATE capability_node SET name='renamed-l2' "
            "WHERE id=(SELECT parent_node_id FROM capability_node WHERE id=%s)",
            (node_id,),
        )
        review_schema.execute(
            "UPDATE capability_node SET name='renamed-l1' "
            "WHERE id=(SELECT parent_node_id FROM capability_node WHERE id=("
            "SELECT parent_node_id FROM capability_node WHERE id=%s))",
            (node_id,),
        )
        review_schema.commit()

        result = self.approve(review_schema, assessment_id, buddy_id)
        assert result["assessment_status"] == "已归档"
        item = get_annual_plan_with_items(review_schema, member_id, 2026)["items"][0]
        assert item["l1_name"] == self._LINEAGE[1]
        assert item["l2_name"] == self._LINEAGE[3]
        assert item["l3_name"] == self._LINEAGE[4]
