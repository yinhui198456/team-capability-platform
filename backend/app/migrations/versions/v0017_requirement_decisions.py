"""v0017: persist Member decisions for changed task requirements."""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        ALTER TABLE annual_plan_change_proposal_detail
        ADD COLUMN IF NOT EXISTS requirement_decision TEXT,
        ADD COLUMN IF NOT EXISTS decided_at TIMESTAMPTZ,
        ADD COLUMN IF NOT EXISTS decided_by BIGINT
            REFERENCES tcp_user(id) ON DELETE RESTRICT
        """
    )
    connection.execute(
        """
        ALTER TABLE annual_plan_change_proposal
        DROP CONSTRAINT IF EXISTS annual_plan_change_proposal_status_check,
        ADD CONSTRAINT annual_plan_change_proposal_status_check
        CHECK (status IN ('待处理', '已处理'))
        """
    )
    connection.execute(
        """
        ALTER TABLE annual_plan_change_proposal_detail
        DROP CONSTRAINT IF EXISTS proposal_detail_requirement_decision_check,
        ADD CONSTRAINT proposal_detail_requirement_decision_check
        CHECK (
            requirement_decision IS NULL
            OR requirement_decision IN ('adopt_new', 'keep_original')
        ),
        DROP CONSTRAINT IF EXISTS proposal_detail_requirement_decided_check,
        ADD CONSTRAINT proposal_detail_requirement_decided_check
        CHECK (
            (requirement_decision IS NULL AND decided_at IS NULL AND decided_by IS NULL)
            OR (
                requirement_decision IS NOT NULL
                AND decided_at IS NOT NULL AND decided_by IS NOT NULL
            )
        )
        """
    )
