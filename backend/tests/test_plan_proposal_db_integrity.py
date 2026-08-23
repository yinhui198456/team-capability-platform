"""Issue #62 P1-4: the database is the last line of defence.

Composite FKs, unique keys and the extended completeness CHECK for
``planning_source_type='assessment_approval'`` plan items and change
proposal details.  Every destructive attempt is rolled back and leaves zero
partial writes; repository-level corruption is rejected with a structured
ReviewError, never a 500.
"""

import psycopg
import pytest

from app.assessment.repository import ReviewError
from app.catalog.standard_versions import create_draft
from tests.review_support import ReviewTestBase

_L3 = "P01-L2A-L3A"
_fresh_counter = 0

_PLAN_ITEM_COLUMNS = (
    "annual_growth_plan_id, growth_goal_id, l3_code, current_level, target_level, "
    "priority, learning_material, learning_task_content, expected_output, "
    "estimated_hours, plan_start_date, plan_end_date, target_month, status, "
    "source_assessment_id, source_assessment_detail_id, "
    "capability_standard_version_id, planning_snapshot_id, l3_node_id, l1_code, "
    "l1_name, l2_code, l2_name, l3_name, scope_type, standard_target_level, "
    "adjusted_target_level, effective_target_level, standard_job_level_snapshot, "
    "member_current_level_snapshot, member_target_level_snapshot, plan_quarter, "
    "plan_month, planning_source_type, assessment_revision, gap_value, "
    "include_in_plan"
)

_PLAN_ITEM_TYPES = {
    "annual_growth_plan_id": "bigint",
    "growth_goal_id": "bigint",
    "current_level": "int",
    "target_level": "int",
    "source_assessment_id": "bigint",
    "source_assessment_detail_id": "bigint",
    "capability_standard_version_id": "bigint",
    "planning_snapshot_id": "bigint",
    "l3_node_id": "bigint",
    "standard_target_level": "int",
    "adjusted_target_level": "int",
    "effective_target_level": "int",
    "assessment_revision": "bigint",
    "gap_value": "int",
    "plan_month": "int",
    "target_month": "int",
    "include_in_plan": "boolean",
    "scope_type": "text",
    "member_current_level_snapshot": "text",
    "member_target_level_snapshot": "text",
}


class TestPlanProposalDbIntegrity(ReviewTestBase):
    def _approved_item(self, review_schema: psycopg.Connection) -> tuple[int, int, int]:
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
                    "plan_month": "2026-05",
                }
            ],
        )
        self.approve(review_schema, assessment_id, buddy_id)
        item = review_schema.execute(
            "SELECT id, source_assessment_id, source_assessment_detail_id, "
            "capability_standard_version_id, planning_snapshot_id, l3_node_id "
            "FROM plan_item LIMIT 1"
        ).fetchone()
        assert item is not None
        return member_id, buddy_id, assessment_id, item

    def _copy_item_with_override(
        self,
        review_schema: psycopg.Connection,
        item_id: int,
        overrides: dict[str, str],
    ) -> None:
        """INSERT a copy of an existing valid plan_item, overriding columns.

        The override expression keeps the overridden column's *original
        position* in the SELECT list so the INSERT column list stays aligned.
        """
        columns = [column.strip() for column in _PLAN_ITEM_COLUMNS.split(",")]
        select_parts = []
        overrides = dict(overrides)
        if "l3_code" not in overrides:
            overrides["l3_code"] = "'ZZZ-COPYPK'"
        if "source_assessment_detail_id" not in overrides:
            # Give the copy its own plan + assessment + detail on the item's
            # own node: the (detail, assessment, node) triple, the (snapshot,
            # version, node) triple AND the P1-3 (plan, source assessment)
            # binding all stay valid while the business uniques (per-assessment
            # node, per-plan l3_code, per source detail) are dodged.  A test
            # that overrides source_assessment_id (wrong-assessment case) keeps
            # that override, which then violates the plan-source FK instead.
            item = review_schema.execute(
                "SELECT source_assessment_id, l3_node_id FROM plan_item WHERE id=%s",
                (item_id,),
            ).fetchone()
            assert item is not None
            member_id = review_schema.execute(
                "SELECT member_id FROM assessment WHERE id=%s", (int(item[0]),)
            ).fetchone()[0]
            global _fresh_counter
            _fresh_counter += 1
            fresh_assessment = review_schema.execute(
                """
                INSERT INTO assessment (
                    member_id, year, version, assessment_type, status
                )
                VALUES (%s, %s, 1, '年度', '草稿') RETURNING id
                """,
                (int(member_id), 2099 + _fresh_counter),
            ).fetchone()
            fresh_plan = review_schema.execute(
                """
                INSERT INTO annual_growth_plan (
                    member_id, year, status, source_assessment_id,
                    planning_source_type
                )
                VALUES (%s, %s, '制定中', %s, 'assessment_approval') RETURNING id
                """,
                (
                    int(member_id),
                    2099 + _fresh_counter,
                    int(fresh_assessment[0]),
                ),
            ).fetchone()
            fresh_detail = review_schema.execute(
                """
                INSERT INTO assessment_detail (assessment_id, l3_code, l3_node_id)
                VALUES (%s, 'ZZZ-NEWASSESS', %s) RETURNING id
                """,
                (int(fresh_assessment[0]), int(item[1])),
            ).fetchone()
            review_schema.commit()
            if "annual_growth_plan_id" not in overrides:
                overrides["annual_growth_plan_id"] = str(int(fresh_plan[0]))
            if "source_assessment_id" not in overrides:
                overrides["source_assessment_id"] = str(int(fresh_assessment[0]))
            overrides["source_assessment_detail_id"] = str(int(fresh_detail[0]))
        for column in columns:
            if column in overrides:
                literal = overrides[column]
                cast = _PLAN_ITEM_TYPES.get(column)
                select_parts.append(
                    f"{literal}::{'int' if cast == 'int' else cast} AS {column}"
                    if cast
                    else f"{literal} AS {column}"
                )
            else:
                select_parts.append(column)
        review_schema.execute(
            f"""
            INSERT INTO plan_item ({_PLAN_ITEM_COLUMNS})
            SELECT {", ".join(select_parts)} FROM plan_item WHERE id = %s
            """,
            (item_id,),
        )

    def _add_l3_node(
        self, review_schema: psycopg.Connection, model_id: int, tag: str
    ) -> int:
        global _fresh_counter
        _fresh_counter += 1
        tag = f"{tag}-{_fresh_counter}"
        l1 = review_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, %s, %s, 'L1', 99, 'x.xlsx', 's1', 1) RETURNING id
            """,
            (model_id, f"{tag}-L1", f"{tag} L1"),
        ).fetchone()
        l2 = review_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, parent_node_id, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, %s, %s, 'L2', %s, 99, 'x.xlsx', 's1', 1) RETURNING id
            """,
            (model_id, f"{tag}-L2", f"{tag} L2", int(l1[0])),
        ).fetchone()
        l3 = review_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, parent_node_id, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, %s, %s, 'L3', %s, 99, 'x.xlsx', 's1', 1) RETURNING id
            """,
            (model_id, f"{tag}-L3", f"{tag} L3", int(l2[0])),
        ).fetchone()
        review_schema.commit()
        return int(l3[0])

    def _count_items(self, review_schema: psycopg.Connection) -> int:
        return int(
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0]
        )

    def test_plan_item_source_triple_rejects_wrong_assessment(
        self, review_schema: psycopg.Connection
    ) -> None:
        _, _, assessment_id, item = self._approved_item(review_schema)
        # A second member's assessment id (valid row otherwise).
        member2, buddy2 = self.setup_second_member(review_schema)
        other_id = self.submit(
            review_schema, member2, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        assert other_id != assessment_id
        count = self._count_items(review_schema)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            self._copy_item_with_override(
                review_schema,
                int(item[0]),
                {"source_assessment_id": str(other_id)},
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count

    def test_plan_item_source_triple_rejects_wrong_node(
        self, review_schema: psycopg.Connection
    ) -> None:
        _, _, _, item = self._approved_item(review_schema)
        model_id = review_schema.execute(
            "SELECT model_id FROM capability_standard_version WHERE id=%s",
            (int(item[3]),),
        ).fetchone()[0]
        other_node = self._add_l3_node(review_schema, int(model_id), "WRONG")
        count = self._count_items(review_schema)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            self._copy_item_with_override(
                review_schema, int(item[0]), {"l3_node_id": str(other_node)}
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count

    def test_plan_item_snapshot_triple_rejects_wrong_version(
        self, review_schema: psycopg.Connection
    ) -> None:
        _, _, _, item = self._approved_item(review_schema)
        model_id = review_schema.execute(
            "SELECT model_id FROM capability_standard_version WHERE id=%s",
            (int(item[3]),),
        ).fetchone()[0]
        # Another version of the same model (draft clone) whose snapshots are
        # a different (version, node) key set.
        draft = create_draft(review_schema, int(model_id), self.actor_id(review_schema))
        review_schema.commit()
        count = self._count_items(review_schema)
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            self._copy_item_with_override(
                review_schema,
                int(item[0]),
                {"capability_standard_version_id": str(int(draft["id"]))},
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count

    def test_plan_item_completeness_check_rejects_partial_source(
        self, review_schema: psycopg.Connection
    ) -> None:
        _, _, _, item = self._approved_item(review_schema)
        count = self._count_items(review_schema)
        # NOT NULL base columns reject NULL with NotNullViolation; the
        # assessment_approval completeness CHECK is proven by the nullable
        # source columns.  Either way the write is rejected with zero rows.
        not_null_columns = {"l3_code", "priority"}
        for column in (
            "planning_snapshot_id",
            "source_assessment_id",
            "source_assessment_detail_id",
            "capability_standard_version_id",
            "l3_node_id",
            "l1_code",
            "l1_name",
            "l2_code",
            "l2_name",
            "l3_code",
            "l3_name",
            "scope_type",
            "standard_job_level_snapshot",
            "assessment_revision",
            "standard_target_level",
            "effective_target_level",
            "gap_value",
            "plan_quarter",
            "plan_month",
            "priority",
            "include_in_plan",
            "member_current_level_snapshot",
            "member_target_level_snapshot",
        ):
            expected = (
                psycopg.errors.NotNullViolation
                if column in not_null_columns
                else psycopg.errors.CheckViolation
            )
            with pytest.raises(expected):
                self._copy_item_with_override(
                    review_schema, int(item[0]), {column: "NULL"}
                )
            review_schema.rollback()
            assert self._count_items(review_schema) == count, column

    def _proposal_fixture(self, review_schema: psycopg.Connection) -> dict[str, int]:
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
                    "plan_month": "2026-05",
                }
            ],
        )
        self.approve(review_schema, first, buddy_id)
        plan = review_schema.execute(
            "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
            (member_id,),
        ).fetchone()
        second = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 3,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-05",
                }
            ],
        )
        self.approve(review_schema, second, buddy_id)
        proposal = review_schema.execute(
            "SELECT id, source_assessment_id, target_annual_growth_plan_id "
            "FROM annual_plan_change_proposal"
        ).fetchone()
        assert proposal is not None
        detail = review_schema.execute(
            "SELECT id, proposal_id, source_assessment_detail_id, assessment_id, "
            "l3_node_id, capability_standard_version_id, planning_snapshot_id "
            "FROM annual_plan_change_proposal_detail LIMIT 1"
        ).fetchone()
        assert detail is not None
        return {
            "member_id": member_id,
            "buddy_id": buddy_id,
            "plan_id": int(plan[0]),
            "assessment1": first,
            "assessment2": second,
            "proposal_id": int(proposal[0]),
            "source_assessment_id": int(proposal[1]),
            "target_plan_id": int(proposal[2]),
            "detail_id": int(detail[0]),
            "detail_proposal_id": int(detail[1]),
            "detail_source_detail_id": int(detail[2]),
            "detail_assessment_id": int(detail[3]),
            "detail_l3_node_id": int(detail[4]),
            "detail_version_id": int(detail[5]),
            "detail_snapshot_id": int(detail[6]),
        }

    def test_proposal_detail_requires_snapshot(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        with pytest.raises(
            (psycopg.errors.NotNullViolation, psycopg.errors.CheckViolation)
        ):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal_detail (
                    proposal_id, source_assessment_detail_id, assessment_id,
                    l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                    l3_name, capability_standard_version_id, planning_snapshot_id,
                    assessment_revision, planning_source_type, scope_type,
                    current_level, standard_target_level, adjusted_target_level,
                    effective_target_level, gap_value, member_priority,
                    include_in_plan, plan_quarter, plan_month,
                    standard_job_level_snapshot, member_current_level_snapshot,
                    member_target_level_snapshot
                )
                VALUES (%s, %s, %s, %s, 'L1', 'n', 'L2', 'n', 'L3', 'n',
                        %s, NULL, 3, 'assessment_approval', 'current_required',
                        3, 4, NULL, 4, 1, '高', TRUE, 'Q2', '2026-05', 'P4', 'P4', 'P5')
                """,
                (
                    f["detail_proposal_id"],
                    f["detail_source_detail_id"],
                    f["detail_assessment_id"],
                    f["detail_l3_node_id"],
                    f["detail_version_id"],
                ),
            )
        review_schema.rollback()

    def test_proposal_detail_snapshot_triple_rejects_wrong_version(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        model_id = review_schema.execute(
            "SELECT model_id FROM capability_standard_version WHERE id=%s",
            (f["detail_version_id"],),
        ).fetchone()[0]
        draft = create_draft(review_schema, int(model_id), self.actor_id(review_schema))
        review_schema.commit()
        # A fresh detail on a NEW L3 node of assessment1 keeps the source
        # triple valid while the snapshot triple is broken (the draft version
        # has no snapshot row for that node).
        fresh_node = self._add_l3_node(review_schema, int(model_id), "SNAP")
        fresh_id, _node, fresh_code = self._fresh_detail(
            review_schema, f["assessment1"], fresh_node, "SNAP"
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal_detail (
                    proposal_id, source_assessment_detail_id, assessment_id,
                    l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                    l3_name, capability_standard_version_id, planning_snapshot_id,
                    assessment_revision, planning_source_type, scope_type,
                    current_level, standard_target_level, adjusted_target_level,
                    effective_target_level, gap_value, member_priority,
                    include_in_plan, plan_quarter, plan_month,
                    standard_job_level_snapshot, member_current_level_snapshot,
                    member_target_level_snapshot
                )
                VALUES (%s, %s, %s, %s, 'L1', 'n', 'L2', 'n', %s, 'n',
                        %s, %s, 3, 'assessment_approval', 'current_required',
                        3, 4, NULL, 4, 1, '高', TRUE, 'Q2', '2026-05', 'P4', 'P4', 'P5')
                """,
                (
                    f["detail_proposal_id"],
                    fresh_id,
                    f["detail_assessment_id"],
                    fresh_node,
                    fresh_code,
                    int(draft["id"]),
                    f["detail_snapshot_id"],
                ),
            )
        review_schema.rollback()

    def test_proposal_detail_source_triple_rejects_wrong_assessment(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        # member2's assessment detail (fresh id, not referenced by any
        # proposal); claiming member's assessment1 for it breaks the
        # (detail, assessment, node) triple while the snapshot triple stays
        # valid.
        member2, buddy2 = self.setup_second_member(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        other_assessment = self.submit(
            review_schema, member2, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        other_detail = review_schema.execute(
            "SELECT id, l3_node_id, l3_code FROM assessment_detail "
            "WHERE assessment_id=%s",
            (other_assessment,),
        ).fetchone()
        assert other_detail is not None
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal_detail (
                    proposal_id, source_assessment_detail_id, assessment_id,
                    l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                    l3_name, capability_standard_version_id, planning_snapshot_id,
                    assessment_revision, planning_source_type, scope_type,
                    current_level, standard_target_level, adjusted_target_level,
                    effective_target_level, gap_value, member_priority,
                    include_in_plan, plan_quarter, plan_month,
                    standard_job_level_snapshot, member_current_level_snapshot,
                    member_target_level_snapshot
                )
                VALUES (%s, %s, %s, %s, 'L1', 'n', 'L2', 'n', %s, 'n',
                        %s, %s, 3, 'assessment_approval', 'current_required',
                        3, 4, NULL, 4, 1, '高', TRUE, 'Q2', '2026-05', 'P4', 'P4', 'P5')
                """,
                (
                    f["detail_proposal_id"],
                    int(other_detail[0]),
                    f["assessment1"],
                    int(other_detail[1]),
                    str(other_detail[2]),
                    f["detail_version_id"],
                    f["detail_snapshot_id"],
                ),
            )
        review_schema.rollback()

    def _fresh_detail(
        self,
        review_schema: psycopg.Connection,
        assessment_id: int,
        node_id: int | None = None,
        tag: str = "FRESH",
    ) -> tuple[int, int, str]:
        """A new assessment_detail row with a unique l3_code."""
        global _fresh_counter
        _fresh_counter += 1
        if node_id is None:
            node = review_schema.execute(
                "SELECT id FROM capability_node WHERE node_type='L3' "
                "ORDER BY id LIMIT 1"
            ).fetchone()
            node_id = int(node[0])
        code = f"ZZZ-{tag}-{_fresh_counter}"
        row = review_schema.execute(
            """
            INSERT INTO assessment_detail (assessment_id, l3_code, l3_node_id)
            VALUES (%s, %s, %s) RETURNING id
            """,
            (assessment_id, code, node_id),
        ).fetchone()
        review_schema.commit()
        return int(row[0]), node_id, code

    def test_proposal_target_plan_must_belong_to_member_year(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        # Another member's plan for the same year: (member_id, year, plan)
        # must be the member's own.
        member2, buddy2 = self.setup_second_member(review_schema)
        review_schema.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (member2,),
        )
        self.ensure_nodes(review_schema, [_L3])
        first2 = self.submit(
            review_schema,
            member2,
            2026,
            [{"l3_code": _L3, "target_level": 3}],
        )
        self.approve(review_schema, first2, buddy2)
        plan2 = review_schema.execute(
            "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
            (member2,),
        ).fetchone()
        third = self.submit(
            review_schema, f["member_id"], 2027, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal (
                    member_id, year, source_assessment_id,
                    target_annual_growth_plan_id, status, created_by, summary
                )
                VALUES (%s, 2026, %s, %s, '待处理', %s, '{}'::jsonb)
                """,
                (
                    f["member_id"],
                    third,
                    int(plan2[0]),
                    f["buddy_id"],
                ),
            )
        review_schema.rollback()

    def test_proposal_source_assessment_must_belong_to_member_year(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        member2, buddy2 = self.setup_second_member(review_schema)
        review_schema.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (member2,),
        )
        self.ensure_nodes(review_schema, [_L3])
        self.submit(review_schema, member2, 2026, [{"l3_code": _L3, "target_level": 3}])
        third = self.submit(
            review_schema, f["member_id"], 2027, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal (
                    member_id, year, source_assessment_id,
                    target_annual_growth_plan_id, status, created_by, summary
                )
                VALUES (%s, 2026, %s, %s, '待处理', %s, '{}'::jsonb)
                """,
                (
                    f["member_id"],
                    third,
                    f["target_plan_id"],
                    f["buddy_id"],
                ),
            )
        review_schema.rollback()

    def test_corrupt_scope_rejected_structured_no_partial_writes(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Repository-level: corrupt the assessment's bound version, approval
        fails with a structured ReviewError (422), and no plan/proposal rows
        are left behind."""
        f = self._proposal_fixture(review_schema)
        # A third pending assessment with an included plan row.
        third = self.submit(
            review_schema,
            f["member_id"],
            2027,
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
        # Corrupt the scope: bind to a draft whose snapshots were deleted
        # (drafts are mutable, so no trigger bypass is needed).
        model_id = review_schema.execute(
            "SELECT model_id FROM capability_standard_version WHERE id=%s",
            (f["detail_version_id"],),
        ).fetchone()[0]
        draft = create_draft(review_schema, int(model_id), self.actor_id(review_schema))
        review_schema.commit()
        review_schema.execute(
            "DELETE FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (int(draft["id"]),),
        )
        review_schema.execute(
            "UPDATE assessment SET capability_standard_version_id=%s WHERE id=%s",
            (int(draft["id"]), third),
        )
        review_schema.commit()
        review_row = review_schema.execute(
            "SELECT id, sequence FROM assessment_review WHERE assessment_id=%s "
            "AND status='待复核'",
            (third,),
        ).fetchone()
        assert review_row is not None
        from app.assessment.repository import submit_assessment_review

        with pytest.raises(ReviewError) as excinfo:
            submit_assessment_review(
                review_schema,
                int(review_row[0]),
                f["buddy_id"],
                "认可",
                "符合预期",
                expected_revision=3,
                assessment_id_from_url=third,
            )
        assert excinfo.value.code == "planning_snapshot_missing"
        assert excinfo.value.status_code == 422
        review_schema.rollback()
        # zero partial writes: no new proposal, no closed review; the plan for
        # `third` (year 2027) exists from submit-time generation (#82+#194) —
        # the failed approve creates nothing new.
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM annual_plan_change_proposal"
            ).fetchone()[0]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 2
        )
        status = review_schema.execute(
            "SELECT status FROM assessment WHERE id=%s", (third,)
        ).fetchone()
        assert status[0] == "待复核"

    def setup_second_member(self, review_schema: psycopg.Connection) -> tuple[int, int]:
        from app.access.repository import assign_role, create_user

        member2 = create_user(review_schema, "rv-member-2", "RV Member 2", "secret")
        assign_role(review_schema, member2, "Member")
        buddy2 = create_user(review_schema, "rv-buddy-3", "RV Buddy 3", "secret")
        assign_role(review_schema, buddy2, "Buddy")
        review_schema.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (member2,),
        )
        from app.access.repository import create_buddy_relationship

        create_buddy_relationship(review_schema, member2, buddy2)
        review_schema.commit()
        return member2, buddy2

    def actor_id(self, review_schema: psycopg.Connection) -> int:
        row = review_schema.execute(
            "SELECT id FROM tcp_user ORDER BY id LIMIT 1"
        ).fetchone()
        return int(row[0])


# ── P1-2 (2nd review): completeness CHECK must cover scope/member snapshots ─
# ── and target consistency; P1-3: plan/plan_item source member-year must be ─
# ── enforced at the DB level. ────────────────────────────────────────────────


class TestSecondReviewIntegrity(TestPlanProposalDbIntegrity):
    def _approved_item_full(self, review_schema: psycopg.Connection) -> tuple:
        member_id, buddy_id, assessment_id, item = self._approved_item(review_schema)
        plan = review_schema.execute(
            "SELECT id, member_id, year, source_assessment_id "
            "FROM annual_growth_plan LIMIT 1"
        ).fetchone()
        assert plan is not None
        return member_id, buddy_id, assessment_id, item, plan

    def test_plan_item_completeness_rejects_scope_and_member_snapshots(
        self, review_schema: psycopg.Connection
    ) -> None:
        _, _, _, item, _ = self._approved_item_full(review_schema)
        count = self._count_items(review_schema)
        for column in (
            "scope_type",
            "member_current_level_snapshot",
            "member_target_level_snapshot",
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                self._copy_item_with_override(
                    review_schema, int(item[0]), {column: "NULL"}
                )
            review_schema.rollback()
            assert self._count_items(review_schema) == count, column

    def test_plan_item_effective_target_must_equal_adjusted_or_standard(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The effective target is the adjusted target when adjusted, otherwise
        the standard target — the DB must reject inconsistent combinations."""
        _, _, _, item, _ = self._approved_item_full(review_schema)
        count = self._count_items(review_schema)
        # adjusted present but effective differs
        with pytest.raises(psycopg.errors.CheckViolation):
            self._copy_item_with_override(
                review_schema,
                int(item[0]),
                {"adjusted_target_level": "5", "effective_target_level": "2"},
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count
        # no adjusted → effective must equal the standard target
        with pytest.raises(psycopg.errors.CheckViolation):
            self._copy_item_with_override(
                review_schema,
                int(item[0]),
                {"adjusted_target_level": "NULL", "effective_target_level": "5"},
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count

    def test_proposal_detail_completeness_rejects_partial_source(
        self, review_schema: psycopg.Connection
    ) -> None:
        f = self._proposal_fixture(review_schema)
        detail_id = f["detail_id"]
        for column in (
            "scope_type",
            "current_level",
            "standard_target_level",
            "effective_target_level",
            "gap_value",
            "member_priority",
            "include_in_plan",
            "plan_quarter",
            "plan_month",
            "standard_job_level_snapshot",
            "member_current_level_snapshot",
            "member_target_level_snapshot",
        ):
            with pytest.raises(psycopg.errors.CheckViolation):
                review_schema.execute(
                    f"UPDATE annual_plan_change_proposal_detail "
                    f"SET {column} = NULL WHERE id = %s",
                    (detail_id,),
                )
            review_schema.rollback()
        # zero partial writes: the row is untouched
        row = review_schema.execute(
            "SELECT scope_type, current_level, include_in_plan FROM "
            "annual_plan_change_proposal_detail WHERE id=%s",
            (detail_id,),
        ).fetchone()
        assert row[0] == "current_required" and row[2] is True

    def test_plan_source_assessment_cannot_be_cross_member_or_cross_year(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id, assessment_id, item, plan = self._approved_item_full(
            review_schema
        )
        plan_id = int(plan[0])
        # cross-member: member2's assessment
        member2, buddy2 = self.setup_second_member(review_schema)
        other_assessment = self.submit(
            review_schema, member2, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(
            (psycopg.errors.ForeignKeyViolation, psycopg.errors.RaiseException)
        ):
            review_schema.execute(
                "UPDATE annual_growth_plan SET source_assessment_id=%s WHERE id=%s",
                (other_assessment, plan_id),
            )
        review_schema.rollback()
        # cross-year: the same member's assessment for another year
        other_year = self.submit(
            review_schema, member_id, 2027, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(
            (psycopg.errors.ForeignKeyViolation, psycopg.errors.RaiseException)
        ):
            review_schema.execute(
                "UPDATE annual_growth_plan SET source_assessment_id=%s WHERE id=%s",
                (other_year, plan_id),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT source_assessment_id FROM annual_growth_plan WHERE id=%s",
            (plan_id,),
        ).fetchone()
        assert int(row[0]) == assessment_id

    def test_plan_item_source_must_match_plan_source(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id, assessment_id, item, plan = self._approved_item_full(
            review_schema
        )
        plan_id = int(plan[0])
        item_id = int(item[0])
        # a different assessment of the same member (different year)
        other_year = self.submit(
            review_schema, member_id, 2027, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(
            (psycopg.errors.ForeignKeyViolation, psycopg.errors.RaiseException)
        ):
            review_schema.execute(
                "UPDATE plan_item SET source_assessment_id=%s WHERE id=%s",
                (other_year, item_id),
            )
        review_schema.rollback()
        # moving the item to another member's plan
        member2, buddy2 = self.setup_second_member(review_schema)
        other_assessment = self.submit(
            review_schema, member2, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        self.approve(review_schema, other_assessment, buddy2)
        other_plan = review_schema.execute(
            "SELECT id FROM annual_growth_plan WHERE member_id=%s AND year=2026",
            (member2,),
        ).fetchone()
        with pytest.raises(
            (psycopg.errors.ForeignKeyViolation, psycopg.errors.RaiseException)
        ):
            review_schema.execute(
                "UPDATE plan_item SET annual_growth_plan_id=%s WHERE id=%s",
                (int(other_plan[0]), item_id),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT annual_growth_plan_id, source_assessment_id "
            "FROM plan_item WHERE id=%s",
            (item_id,),
        ).fetchone()
        assert (int(row[0]), int(row[1])) == (plan_id, assessment_id)


# ── P1-A/B/C (3rd review): provenance can never be downgraded; proposal ─────
# ── detail must match its parent proposal's source assessment; the standard ─
# ── target is unconditionally frozen. ────────────────────────────────────────


class TestThirdReviewIntegrity(TestSecondReviewIntegrity):
    def test_plan_item_provenance_cannot_be_downgraded(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-A: a modern item must never clear its source type + source id in
        one UPDATE to slip through the legacy NULL branch."""
        _, _, _, item, _ = self._approved_item_full(review_schema)
        item_id = int(item[0])
        with pytest.raises(psycopg.errors.RaiseException):
            review_schema.execute(
                "UPDATE plan_item SET planning_source_type=NULL, "
                "source_assessment_id=NULL WHERE id=%s",
                (item_id,),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT planning_source_type, source_assessment_id "
            "FROM plan_item WHERE id=%s",
            (item_id,),
        ).fetchone()
        assert row[0] == "assessment_approval" and row[1] is not None

    def test_plan_shell_provenance_cannot_be_cleared(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-A: a zero-item formal plan shell keeps its first-approval source;
        clearing source type + source id together is rejected."""
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [{"l3_code": _L3, "current_level": 3, "target_level": 3}],
        )
        self.approve(review_schema, assessment_id, buddy_id)
        plan = review_schema.execute(
            "SELECT id, planning_source_type, source_assessment_id "
            "FROM annual_growth_plan WHERE member_id=%s AND year=2026",
            (member_id,),
        ).fetchone()
        assert plan is not None and plan[1] == "assessment_approval"
        with pytest.raises(psycopg.errors.RaiseException):
            review_schema.execute(
                "UPDATE annual_growth_plan SET planning_source_type=NULL, "
                "source_assessment_id=NULL WHERE id=%s",
                (int(plan[0]),),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT planning_source_type, source_assessment_id "
            "FROM annual_growth_plan WHERE id=%s",
            (int(plan[0]),),
        ).fetchone()
        assert row[0] == "assessment_approval" and row[1] == assessment_id

    def test_plan_source_identity_cannot_drift(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-A: the plan's source assessment identity is immutable even
        between two assessments of the same member/year."""
        _, _, assessment_id, _, plan = self._approved_item_full(review_schema)
        plan_id = int(plan[0])
        # a second assessment of the SAME member/year (version 2)
        twin = review_schema.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status
            )
            VALUES (%s, 2026, 2, '年度', '草稿') RETURNING id
            """,
            (int(plan[1]),),
        ).fetchone()
        review_schema.commit()
        with pytest.raises(psycopg.errors.RaiseException):
            review_schema.execute(
                "UPDATE annual_growth_plan SET source_assessment_id=%s WHERE id=%s",
                (int(twin[0]), plan_id),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT source_assessment_id FROM annual_growth_plan WHERE id=%s",
            (plan_id,),
        ).fetchone()
        assert int(row[0]) == assessment_id

    def test_proposal_detail_assessment_must_match_parent_proposal_source(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-B: a detail can only hang under a proposal whose source
        assessment is the detail's own assessment."""
        f = self._proposal_fixture(review_schema)
        # a second proposal for the SAME member/year (a third assessment
        # version whose approval creates its own proposal)
        third = self.submit(
            review_schema,
            f["member_id"],
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 3,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-05",
                }
            ],
        )
        self.approve(review_schema, third, f["buddy_id"])
        other_proposal = review_schema.execute(
            "SELECT id FROM annual_plan_change_proposal WHERE source_assessment_id=%s",
            (third,),
        ).fetchone()
        assert other_proposal is not None
        # a fresh detail of the FIRST assessment (proposal1's source) hung
        # under proposal2 — the parent FK (proposal2, assessment1) must reject
        # it because proposal2's source is the third assessment.
        model_id = review_schema.execute(
            "SELECT model_id FROM capability_standard_version WHERE id=%s",
            (f["detail_version_id"],),
        ).fetchone()[0]
        fresh_node = self._add_l3_node(review_schema, int(model_id), "P1B")
        fresh_id, _node, fresh_code = self._fresh_detail(
            review_schema, f["detail_assessment_id"], fresh_node, "P1B"
        )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal_detail (
                    proposal_id, source_assessment_detail_id, assessment_id,
                    l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                    l3_name, capability_standard_version_id, planning_snapshot_id,
                    assessment_revision, planning_source_type, scope_type,
                    current_level, standard_target_level, adjusted_target_level,
                    effective_target_level, gap_value, member_priority,
                    include_in_plan, plan_quarter, plan_month,
                    standard_job_level_snapshot, member_current_level_snapshot,
                    member_target_level_snapshot
                )
                VALUES (%s, %s, %s, %s, 'L1', 'n', 'L2', 'n', %s, 'n',
                        %s, %s, 3, 'assessment_approval', 'current_required',
                        3, 4, NULL, 4, 1, '高', TRUE, 'Q2', '2026-05', 'P4', 'P4', 'P5')
                """,
                (
                    int(other_proposal[0]),
                    fresh_id,
                    f["detail_assessment_id"],
                    fresh_node,
                    fresh_code,
                    f["detail_version_id"],
                    f["detail_snapshot_id"],
                ),
            )
        review_schema.rollback()
        # the original detail row is untouched
        row = review_schema.execute(
            "SELECT proposal_id, assessment_id FROM "
            "annual_plan_change_proposal_detail WHERE id=%s",
            (f["detail_id"],),
        ).fetchone()
        assert int(row[0]) == f["detail_proposal_id"]
        assert int(row[1]) == f["detail_assessment_id"]

    def test_plan_item_adjusted_branch_requires_standard_target(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-C: even with an adjusted target, the standard target must be
        frozen — it can never be NULL."""
        _, _, _, item, _ = self._approved_item_full(review_schema)
        count = self._count_items(review_schema)
        with pytest.raises(psycopg.errors.CheckViolation):
            self._copy_item_with_override(
                review_schema,
                int(item[0]),
                {
                    "standard_target_level": "NULL",
                    "adjusted_target_level": "5",
                    "effective_target_level": "5",
                },
            )
        review_schema.rollback()
        assert self._count_items(review_schema) == count

    def test_proposal_detail_adjusted_branch_requires_standard_target(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-C: same rule for proposal details."""
        f = self._proposal_fixture(review_schema)
        with pytest.raises(psycopg.errors.CheckViolation):
            review_schema.execute(
                "UPDATE annual_plan_change_proposal_detail "
                "SET standard_target_level=NULL, adjusted_target_level=5, "
                "effective_target_level=5 WHERE id=%s",
                (f["detail_id"],),
            )
        review_schema.rollback()
        row = review_schema.execute(
            "SELECT standard_target_level, adjusted_target_level, "
            "effective_target_level FROM annual_plan_change_proposal_detail "
            "WHERE id=%s",
            (f["detail_id"],),
        ).fetchone()
        assert row[0] is not None


class TestFourthReviewIntegrity(TestThirdReviewIntegrity):
    """4th review: a change proposal can never reuse the assessment that
    generated the target plan (the first approval source).  The formal plan
    is generated by the first approval; only subsequent assessments of the
    same member/year may generate adjustment proposals."""

    def test_proposal_source_guard_trigger_installed(
        self, review_schema: psycopg.Connection
    ) -> None:
        row = review_schema.execute(
            "SELECT 1 FROM pg_trigger WHERE tgname=%s "
            "AND tgrelid='annual_plan_change_proposal'::regclass",
            ("trg_proposal_source_not_plan_first_source",),
        ).fetchone()
        assert row is not None

    def test_proposal_cannot_reuse_plan_first_source_on_insert(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1 (4th review): after assessment A generated the formal plan,
        inserting a proposal with source=A and target=that plan must be
        rejected — the first approval source is not a valid proposal source."""
        f = self._proposal_fixture(review_schema)
        plan_source = review_schema.execute(
            "SELECT source_assessment_id FROM annual_growth_plan WHERE id=%s",
            (f["plan_id"],),
        ).fetchone()[0]
        assert int(plan_source) == f["assessment1"]
        before = review_schema.execute(
            "SELECT COUNT(*) FROM annual_plan_change_proposal"
        ).fetchone()[0]
        with pytest.raises(psycopg.errors.RaiseException):
            review_schema.execute(
                """
                INSERT INTO annual_plan_change_proposal (
                    member_id, year, source_assessment_id,
                    target_annual_growth_plan_id, status, created_by, summary
                )
                VALUES (%s, 2026, %s, %s, '待处理', %s, '{}')
                """,
                (
                    f["member_id"],
                    f["assessment1"],
                    f["plan_id"],
                    f["member_id"],
                ),
            )
        review_schema.rollback()
        # zero partial writes
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM annual_plan_change_proposal"
            ).fetchone()[0]
            == before
        )

    def test_proposal_source_cannot_drift_to_plan_first_source(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1 (4th review): updating a legal B-proposal's source to the plan's
        first source A must be rejected, with the original row and all
        details completely untouched."""
        f = self._proposal_fixture(review_schema)
        # a second legal proposal (third assessment), stripped of its details
        # so the parent-source FK cannot mask the provenance guard — the
        # guard itself must reject the drift
        third = self.submit(
            review_schema,
            f["member_id"],
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 3,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_month": "2026-05",
                }
            ],
        )
        self.approve(review_schema, third, f["buddy_id"])
        other = review_schema.execute(
            "SELECT id, source_assessment_id, target_annual_growth_plan_id "
            "FROM annual_plan_change_proposal WHERE source_assessment_id=%s",
            (third,),
        ).fetchone()
        assert other is not None
        other_id, other_source, other_target = map(int, other)
        review_schema.execute(
            "DELETE FROM annual_plan_change_proposal_detail " "WHERE proposal_id=%s",
            (other_id,),
        )
        review_schema.commit()
        with pytest.raises(psycopg.errors.RaiseException):
            review_schema.execute(
                "UPDATE annual_plan_change_proposal "
                "SET source_assessment_id=%s WHERE id=%s",
                (f["assessment1"], other_id),
            )
        review_schema.rollback()
        # the original proposal row is untouched
        row = review_schema.execute(
            "SELECT source_assessment_id, target_annual_growth_plan_id "
            "FROM annual_plan_change_proposal WHERE id=%s",
            (other_id,),
        ).fetchone()
        assert int(row[0]) == other_source
        assert int(row[1]) == other_target
        # and the original proposal's details are untouched
        detail = review_schema.execute(
            "SELECT proposal_id, assessment_id FROM "
            "annual_plan_change_proposal_detail WHERE id=%s",
            (f["detail_id"],),
        ).fetchone()
        assert int(detail[0]) == f["detail_proposal_id"]
        assert int(detail[1]) == f["detail_assessment_id"]
