"""v0007: Relax current_level to 0–5; add member_priority, include_in_plan (tri-state),
plan_quarter, plan_month.  Assessment detail becomes the canonical source for
Gap, priority, plan selection and timing.

Old gap.priority / assessment_detail.plan_candidate are preserved read-only
but NOT mapped to the new canonical columns — historical automatic values
must not be presented as Member-confirmed choices.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    # 1. Relax current_level from 1–5 to 0–5 (NULL stays NULL).
    connection.execute(
        "ALTER TABLE assessment_detail "
        "DROP CONSTRAINT IF EXISTS assessment_detail_current_level_check"
    )
    connection.execute(
        "ALTER TABLE assessment_detail ADD CONSTRAINT "
        "assessment_detail_current_level_check "
        "CHECK (current_level IS NULL OR current_level BETWEEN 0 AND 5)"
    )

    # 2. Add canonical plan columns (all nullable — old rows stay NULL).
    connection.execute(
        "ALTER TABLE assessment_detail "
        "ADD COLUMN IF NOT EXISTS member_priority TEXT"
    )
    connection.execute(
        "ALTER TABLE assessment_detail "
        "ADD COLUMN IF NOT EXISTS include_in_plan BOOLEAN"
    )
    connection.execute(
        "ALTER TABLE assessment_detail "
        "ADD COLUMN IF NOT EXISTS plan_quarter TEXT"
    )
    connection.execute(
        "ALTER TABLE assessment_detail "
        "ADD COLUMN IF NOT EXISTS plan_month INT"
    )

    # 3. Gap table: priority becomes nullable (historical auto-values stay;
    #    new rows may be NULL when not yet decided by Member).
    connection.execute(
        "ALTER TABLE gap ALTER COLUMN priority DROP NOT NULL"
    )
    connection.execute(
        "ALTER TABLE gap ALTER COLUMN priority DROP DEFAULT"
    )

    # 4. Domain CHECKs.
    for name, stmt in [
        (
            "assessment_detail_member_priority_check",
            "ALTER TABLE assessment_detail ADD CONSTRAINT "
            "assessment_detail_member_priority_check "
            "CHECK (member_priority IS NULL "
            "OR member_priority IN ('高','中','低','暂缓'))",
        ),
        (
            "assessment_detail_plan_quarter_check",
            "ALTER TABLE assessment_detail ADD CONSTRAINT "
            "assessment_detail_plan_quarter_check "
            "CHECK (plan_quarter IS NULL OR plan_quarter IN ('Q1','Q2','Q3','Q4'))",
        ),
        (
            "assessment_detail_plan_month_check",
            "ALTER TABLE assessment_detail ADD CONSTRAINT "
            "assessment_detail_plan_month_check "
            "CHECK (plan_month IS NULL OR plan_month BETWEEN 1 AND 12)",
        ),
    ]:
        connection.execute(
            f"""
            DO $$ BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conrelid = 'assessment_detail'::regclass
                      AND conname = '{name}'
                ) THEN {stmt}; END IF;
            END $$
            """
        )

    # 5. Quarter-month consistency.
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_quarter_month_consistent'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_quarter_month_consistent
                CHECK (
                    plan_quarter IS NULL OR plan_month IS NULL
                    OR (plan_quarter = 'Q1' AND plan_month BETWEEN 1 AND 3)
                    OR (plan_quarter = 'Q2' AND plan_month BETWEEN 4 AND 6)
                    OR (plan_quarter = 'Q3' AND plan_month BETWEEN 7 AND 9)
                    OR (plan_quarter = 'Q4' AND plan_month BETWEEN 10 AND 12)
                );
            END IF;
        END $$
        """
    )

    # 6. include_in_plan=TRUE requires quarter+month.
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
                    OR (plan_quarter IS NOT NULL AND plan_month IS NOT NULL)
                );
            END IF;
        END $$
        """
    )

    # 7. 暂缓 ↔ include_in_plan mutual exclusion.
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_hold_plan_mutex'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_hold_plan_mutex
                CHECK (
                    NOT (member_priority = '暂缓' AND include_in_plan = TRUE)
                );
            END IF;
        END $$
        """
    )

    # 8. include_in_plan=FALSE → quarter+month must be NULL.
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_no_plan_time_when_false'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_no_plan_time_when_false
                CHECK (
                    include_in_plan IS DISTINCT FROM FALSE
                    OR (plan_quarter IS NULL AND plan_month IS NULL)
                );
            END IF;
        END $$
        """
    )

    # 9. gap.priority CHECK widened (NULL + 暂缓 for legacy compat reads).
    connection.execute(
        """
        DO $$ BEGIN
            IF EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'gap'::regclass
                  AND conname = 'gap_priority_check'
            ) THEN
                ALTER TABLE gap DROP CONSTRAINT gap_priority_check;
            END IF;
        END $$
        """
    )
    connection.execute(
        """
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'gap'::regclass
                  AND conname = 'gap_priority_check'
            ) THEN
                ALTER TABLE gap ADD CONSTRAINT gap_priority_check
                CHECK (priority IS NULL OR priority IN ('高','中','低','暂缓'));
            END IF;
        END $$
        """
    )
