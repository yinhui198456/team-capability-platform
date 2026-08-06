"""v0013: drop the obsolete NOT NULL on plan_item.growth_goal_id.

Issue #65: the assessment-approval domain path deliberately creates plan
items without a growth goal — the v0009 approval-completeness contract
excludes growth_goal_id, the approval INSERT writes NULL, and the fresh
bootstrap schema (planning/schema.py) already defines the column nullable.
Databases upgraded from the pre-v0009 schema kept the legacy NOT NULL
because no migration dropped it, which surfaced in UAT as an uncontrolled
HTTP 500 on first-assessment approval (Member-B).

Forward-only schema alignment: no row rewrites, no data changes.
Already-populated growth_goal_id values, the FK and the UNIQUE constraint
are untouched.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        "ALTER TABLE plan_item ALTER COLUMN growth_goal_id DROP NOT NULL"
    )
