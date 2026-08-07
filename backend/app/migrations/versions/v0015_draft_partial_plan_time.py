"""v0015: Draft saves may hold partially-completed plan state.

Drafts must save the intermediate state of a positive-gap row that has
include_in_plan=TRUE but no plan quarter/month yet — the member may save
progress and decide timing later (docs/03_Data.md "草稿允许部分完成").
The assessment_detail_plan_time_required CHECK (v0007 §6) made that state
unrepresentable at the row level: every draft save of include=TRUE without
timing raised a CheckViolation.

Completeness is still enforced where it matters: the submit gate
(_validate_submission) runs inside the submit transaction and requires
priority + an explicit include decision + valid month/derived quarter for
every positive-gap item, and Buddy approval re-validates the canonical
detail before accepting it.  All other plan constraints stay: quarter-month
consistency, no timing when include=FALSE/NULL, the 暂缓↔include mutex, and
the domain checks.

This migration drops every CHECK on assessment_detail whose definition is
the "include=TRUE requires quarter+month" predicate — both the named v0007
constraint and the auto-named duplicate created by the base CREATE TABLE
(assessment_detail_check3).  Dropping by predicate (not by name) covers
databases built by either path.  Re-running is a no-op (no matching
constraints remain).
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        DO $$
        DECLARE
            c RECORD;
        BEGIN
            FOR c IN
                SELECT conname
                FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND contype = 'c'
                  AND pg_get_constraintdef(oid) LIKE '%IS DISTINCT FROM true%'
                  AND pg_get_constraintdef(oid) LIKE '%plan_quarter IS NOT NULL%'
            LOOP
                EXECUTE format(
                    'ALTER TABLE assessment_detail DROP CONSTRAINT %I',
                    c.conname
                );
            END LOOP;
        END $$;
        """
    )
