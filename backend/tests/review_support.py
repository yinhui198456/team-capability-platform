"""Issue #62 shared review test support: full v0009 schema + approval helpers."""

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
)
from app.access.schema import create_access_schema
from app.assessment.repository import (
    get_assessment,
    save_assessment_draft,
    submit_assessment,
    submit_assessment_review,
)
from app.assessment.schema import create_assessment_schema
from tests.standard_target_support import (
    create_scoped_draft,
    ensure_capability_nodes,
    standard_target_payload,
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


@pytest.fixture
def review_schema(connection: psycopg.Connection) -> psycopg.Connection:
    reset_full_schema(connection)
    return connection


class ReviewTestBase:
    """Helpers for approval-flow tests on a full v0009 schema."""

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

    def submit(
        self,
        connection: psycopg.Connection,
        member_id: int,
        year: int,
        details: list[dict[str, object]],
    ) -> int:
        assessment_id = create_scoped_draft(connection, member_id, year)
        connection.execute(
            """
            UPDATE assessment
            SET member_current_level_snapshot = 'P4',
                member_target_level_snapshot = 'P5'
            WHERE id = %s
            """,
            (assessment_id,),
        )
        normalized = []
        for detail in details:
            item = dict(detail)
            if "current_level" not in item:
                item["current_level"] = 3
            normalized.append(item)
        payload = standard_target_payload(connection, assessment_id, normalized)
        save_assessment_draft(
            connection, assessment_id, member_id, payload, expected_revision=1
        )
        submit_assessment(connection, assessment_id, member_id, expected_revision=2)
        connection.commit()
        return assessment_id

    def approve(
        self,
        connection: psycopg.Connection,
        assessment_id: int,
        buddy_id: int,
        *,
        conclusion: str = "认可",
        feedback: str = "符合预期",
        expected_revision: int = 3,
        idempotency_key: str | None = None,
    ) -> dict[str, object]:
        review_id = connection.execute(
            "SELECT id FROM assessment_review WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()[0]
        result = submit_assessment_review(
            connection,
            int(review_id),
            buddy_id,
            conclusion,
            feedback,
            expected_revision=expected_revision,
            assessment_id_from_url=assessment_id,
            idempotency_key=idempotency_key,
        )
        connection.commit()
        return result

    def get_assessment(
        self, connection: psycopg.Connection, assessment_id: int
    ) -> dict[str, object] | None:
        return get_assessment(connection, assessment_id)
