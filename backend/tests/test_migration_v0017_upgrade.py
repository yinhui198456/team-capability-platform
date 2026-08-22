"""v0017 requirement-decision upgrade proof."""

import psycopg

from app.migrations.versions.v0017_requirement_decisions import upgrade
from tests.conftest import TEST_DATABASE_URL, _clear_assessment, _clear_catalog
from tests.review_support import ReviewTestBase
from tests.test_migration_v0015_upgrade import _bootstrap

_L3 = "P01-L2A-L3A"


class TestV0017Upgrade(ReviewTestBase):
    def test_upgrade_preserves_real_proposal_and_non_target_rows(
        self, review_schema: psycopg.Connection
    ) -> None:
        connection = review_schema
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
        proposal_before = connection.execute(
            "SELECT id, member_id, year, source_assessment_id, "
            "target_annual_growth_plan_id, status, created_by, summary "
            "FROM annual_plan_change_proposal"
        ).fetchone()
        detail_before = connection.execute(
            "SELECT id, proposal_id, source_assessment_detail_id, assessment_id, "
            "l3_node_id, l3_code, l3_name, capability_standard_version_id, "
            "planning_snapshot_id, assessment_revision, planning_source_type "
            "FROM annual_plan_change_proposal_detail"
        ).fetchone()
        item_before = connection.execute(
            "SELECT id, l3_code, status, planning_snapshot_id, revision "
            "FROM plan_item"
        ).fetchone()
        task_before = connection.execute(
            "SELECT id, plan_item_id, l3_code, status, revision FROM learning_task"
        ).fetchone()
        assert proposal_before is not None and detail_before is not None
        assert item_before is not None and task_before is not None

        # Fixture construction only: turn real v0017 data/schema into its
        # immediate predecessor without hand-building an incomplete detail.
        connection.execute(
            "ALTER TABLE annual_plan_change_proposal_detail "
            "DROP CONSTRAINT IF EXISTS proposal_detail_requirement_decision_check, "
            "DROP CONSTRAINT IF EXISTS proposal_detail_requirement_decided_check, "
            "DROP COLUMN requirement_decision, "
            "DROP COLUMN previous_planning_snapshot_id, "
            "DROP COLUMN decided_at, DROP COLUMN decided_by"
        )
        connection.execute(
            "ALTER TABLE annual_plan_change_proposal "
            "DROP CONSTRAINT IF EXISTS annual_plan_change_proposal_status_check, "
            "ADD CONSTRAINT annual_plan_change_proposal_status_check "
            "CHECK (status IN ('待处理'))"
        )
        connection.commit()

        upgrade(connection)
        upgrade(connection)
        connection.commit()

        assert (
            connection.execute(
                "SELECT id, member_id, year, source_assessment_id, "
                "target_annual_growth_plan_id, status, created_by, summary "
                "FROM annual_plan_change_proposal"
            ).fetchone()
            == proposal_before
        )
        assert (
            connection.execute(
                "SELECT id, proposal_id, source_assessment_detail_id, assessment_id, "
                "l3_node_id, l3_code, l3_name, capability_standard_version_id, "
                "planning_snapshot_id, assessment_revision, planning_source_type "
                "FROM annual_plan_change_proposal_detail"
            ).fetchone()
            == detail_before
        )
        assert connection.execute(
            "SELECT requirement_decision, previous_planning_snapshot_id, "
            "decided_at, decided_by FROM annual_plan_change_proposal_detail"
        ).fetchone() == (None, None, None, None)
        assert (
            connection.execute(
                "SELECT id, l3_code, status, planning_snapshot_id, revision "
                "FROM plan_item"
            ).fetchone()
            == item_before
        )
        assert (
            connection.execute(
                "SELECT id, plan_item_id, l3_code, status, revision FROM learning_task"
            ).fetchone()
            == task_before
        )

        constraints = {
            row[0]
            for row in connection.execute(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid='annual_plan_change_proposal_detail'::regclass"
            ).fetchall()
        }
        assert {
            "proposal_detail_requirement_decision_check",
            "proposal_detail_requirement_decided_check",
        } <= constraints
        foreign_keys = {
            row[0]
            for row in connection.execute(
                "SELECT a.attname FROM pg_constraint c "
                "JOIN pg_attribute a ON a.attrelid = c.conrelid "
                "AND a.attnum = ANY(c.conkey) "
                "WHERE c.conrelid='annual_plan_change_proposal_detail'::regclass "
                "AND c.contype='f'"
            ).fetchall()
        }
        assert {"previous_planning_snapshot_id", "decided_by"} <= foreign_keys


def test_v0017_fresh_full_chain_has_requirement_decision_contract() -> None:
    with psycopg.connect(TEST_DATABASE_URL) as connection:
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()
        _bootstrap(connection, through_v0014=False)
        columns = {
            row[0]
            for row in connection.execute(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_name='annual_plan_change_proposal_detail'"
            ).fetchall()
        }
        assert {
            "requirement_decision",
            "decided_at",
            "decided_by",
            "previous_planning_snapshot_id",
        } <= columns
        constraints = {
            row[0]
            for row in connection.execute(
                "SELECT conname FROM pg_constraint "
                "WHERE conrelid='annual_plan_change_proposal_detail'::regclass"
            ).fetchall()
        }
        assert {
            "proposal_detail_requirement_decision_check",
            "proposal_detail_requirement_decided_check",
        } <= constraints
        assert (
            connection.execute(
                "SELECT COUNT(*) FROM schema_migration "
                "WHERE version='0017_requirement_decisions'"
            ).fetchone()[0]
            == 1
        )
        _clear_assessment(connection)
        _clear_catalog(connection)
        connection.commit()
