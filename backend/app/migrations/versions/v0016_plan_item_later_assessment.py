"""v0016: Allow later assessments to add items to the same annual plan.

An annual growth plan is one container per member and year.  Its
``source_assessment_id`` records the assessment that first created the plan,
while every plan item records the exact assessment/detail that created that
item.  The v0009 composite FK incorrectly required every item to come from
the plan's *first* assessment, so a later assessment for the same member/year
failed when it tried to add a new item.

Replace that over-strict FK with a scope guard: an item's source assessment
must belong to the same member and year as its annual plan.  Exact detail and
node provenance remains protected by
``plan_item_source_detail_assessment_node_fk``.  No rows are rewritten.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        "ALTER TABLE plan_item " "DROP CONSTRAINT IF EXISTS plan_item_plan_source_fk"
    )
    connection.execute(
        """
        CREATE OR REPLACE FUNCTION guard_plan_item_source_member_year()
        RETURNS trigger AS $$
        BEGIN
            IF NEW.source_assessment_id IS NULL THEN
                RETURN NEW;
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM annual_growth_plan agp
                JOIN assessment a
                  ON a.id = NEW.source_assessment_id
                 AND a.member_id = agp.member_id
                 AND a.year = agp.year
                WHERE agp.id = NEW.annual_growth_plan_id
            ) THEN
                RAISE EXCEPTION
                    'plan item source assessment must match plan member and year'
                    USING ERRCODE = '23503',
                          CONSTRAINT = 'plan_item_source_member_year_guard';
            END IF;

            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    connection.execute(
        "DROP TRIGGER IF EXISTS trg_plan_item_source_member_year ON plan_item"
    )
    connection.execute(
        """
        CREATE TRIGGER trg_plan_item_source_member_year
        BEFORE INSERT OR UPDATE OF annual_growth_plan_id, source_assessment_id
        ON plan_item
        FOR EACH ROW EXECUTE FUNCTION guard_plan_item_source_member_year()
        """
    )
