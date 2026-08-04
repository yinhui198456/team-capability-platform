"""v0012: Team Analytics Phase 2 — read scope and aggregation indexes.

Additive, forward-only. Adds indexes to support the new team-level read
queries without changing existing tables or data:

- ``idx_plan_item_include_in_plan_year_member`` — filters formal plan items
  by year and member quickly for the Team Annual Plan list.
- ``idx_plan_item_plan_month_status`` — supports month/status filtering and
  ordering on the PlanItem list.
- ``idx_assessment_detail_scope_type`` — supports the gap_summary scope split.
"""

import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plan_item_include_in_plan_year_member
            ON plan_item (include_in_plan, l3_code)
            WHERE include_in_plan = TRUE
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_plan_item_plan_month_status
            ON plan_item (plan_month, status)
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS idx_assessment_detail_scope_type
            ON assessment_detail (scope_type)
            WHERE scope_type IS NOT NULL
        """
    )
