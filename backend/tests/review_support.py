"""Shared full-schema test fixtures for current planning flows."""

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)
from app.access.schema import create_access_schema
from app.assessment.repository import (
    generate_plan_items_for_selection,
    patch_assessment_draft,
)
from app.assessment.schema import create_assessment_schema
from tests.standard_target_support import (
    create_scoped_draft,
    ensure_capability_nodes,
)

_ALL_TABLES = (
    "task_requirement_decision",
    "annual_plan_change_proposal_detail",
    "annual_plan_change_proposal",
    "review_idempotency_key",
    "assessment_review",
    "gap",
    "assessment_detail",
    "assessment",
    "buddy_relationship",
    "tcp_session",
    "tcp_user_role",
    "tcp_role",
    "tcp_user",
    "plan_item",
    "growth_goal",
    "annual_growth_plan",
    "task_transition_history",
    "learning_task",
    "evidence",
    "evidence_review",
    "learning_progress_log",
    "capability_profile",
    "team_annual_capability_plan_domain",
    "team_annual_capability_plan",
    "capability_standard_planning_snapshot",
    "capability_node_resource",
    "learning_resource",
    "capability_standard_target_override",
    "capability_node",
    "capability_model",
    "capability_standard_version_audit",
    "capability_standard_item",
    "capability_standard_version",
    "schema_migration",
)


def reset_full_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        for table in _ALL_TABLES:
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_assessment_schema(connection)
    from app.catalog.schema import create_catalog_schema
    from app.planning.schema import create_planning_schema

    create_catalog_schema(connection)
    create_planning_schema(connection)
    # Nodes must exist before migrations run: v0004 materialises the published
    # Legacy Baseline from the catalog and v0009 captures its planning
    # snapshots, so tests get a real published version + snapshots.
    from tests.standard_target_support import ensure_capability_nodes

    ensure_capability_nodes(connection, ["P01-L2A-L3A"])
    connection.commit()


def save_canonical_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    details: list[dict[str, object]],
    *,
    assessment_type: str = "年度",
) -> int:
    """Seed a current M02 canonical draft without retired review writes."""
    codes = [str(detail["l3_code"]) for detail in details]
    ensure_capability_nodes(connection, codes)
    assessment_id = create_scoped_draft(connection, member_id, year, assessment_type)
    rows = connection.execute(
        "SELECT l3_code, l3_node_id FROM assessment_detail WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchall()
    node_ids = {
        str(code): int(node_id) for code, node_id in rows if node_id is not None
    }
    payload = []
    for detail in details:
        code = str(detail["l3_code"])
        payload.append({**detail, "l3_node_id": node_ids[code]})
    patch_assessment_draft(
        connection, assessment_id, member_id, expected_revision=1, details=payload
    )
    connection.commit()
    return assessment_id


def create_generated_plan_items(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    details: list[dict[str, object]],
    *,
    assessment_type: str = "年度",
) -> int:
    """Seed current M02 flow: canonical draft, then explicit generation."""
    assessment_id = save_canonical_draft(
        connection, member_id, year, details, assessment_type=assessment_type
    )
    codes = [str(detail["l3_code"]) for detail in details]
    generate_plan_items_for_selection(
        connection,
        assessment_id,
        member_id,
        codes,
        expected_revision=2,
    )
    connection.commit()
    return assessment_id


@pytest.fixture
def review_schema(connection: psycopg.Connection) -> psycopg.Connection:
    reset_full_schema(connection)
    return connection


class ReviewTestBase:
    """Shared full-schema user and capability-node fixture helpers."""

    def setup_users(self, connection: psycopg.Connection) -> tuple[int, int]:
        member_id = create_user(connection, "rv-member", "RV Member", "secret")
        assign_role(connection, member_id, "Member")
        buddy_id = create_user(connection, "rv-buddy", "RV Buddy", "secret")
        assign_role(connection, buddy_id, "Buddy")
        connection.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (member_id,),
        )
        create_buddy_relationship(connection, member_id, buddy_id)
        connection.commit()
        return member_id, buddy_id

    def ensure_nodes(self, connection: psycopg.Connection, l3_codes: list[str]) -> None:
        ensure_capability_nodes(connection, l3_codes)
        connection.commit()
