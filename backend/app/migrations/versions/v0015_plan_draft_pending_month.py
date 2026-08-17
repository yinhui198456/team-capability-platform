"""v0015: 待补计划月份 — include_in_plan=TRUE may persist with
plan_quarter/plan_month NULL (Issue #178, #187 story contract: the plan
draft must survive exit/re-entry with the month still pending).

Rebuilds assessment_detail_plan_time_required:
- pending (both NULL) is now allowed;
- complete (both set, consistency still enforced by
  assessment_detail_quarter_month_consistent) stays allowed;
- half-filled (exactly one set) stays invalid, as before.

Every previously-legal row stays legal, so existing data needs no repair.
The submit/generation gate (_validate_submission plan_time_required) is an
application-level check and is deliberately unchanged by this migration.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_plan_time_required'
            ) THEN
                ALTER TABLE assessment_detail
                DROP CONSTRAINT assessment_detail_plan_time_required;
            END IF;
        END $$
        """
    )
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_plan_time_required'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_plan_time_required
                CHECK (
                    include_in_plan IS DISTINCT FROM TRUE
                    OR (plan_quarter IS NULL AND plan_month IS NULL)
                    OR (plan_quarter IS NOT NULL AND plan_month IS NOT NULL)
                );
            END IF;
        END $$
        """
    )
