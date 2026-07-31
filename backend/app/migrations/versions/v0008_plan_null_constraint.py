"""v0008: Add include_in_plan IS NULL → plan_quarter/month NULL constraint.

This completes the tri-state include_in_plan validation at the DB level.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_no_plan_time_when_null'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_no_plan_time_when_null
                CHECK (
                    include_in_plan IS NOT NULL
                    OR (plan_quarter IS NULL AND plan_month IS NULL)
                );
            END IF;
        END $$
        """
    )
