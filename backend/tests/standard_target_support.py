import psycopg

from app.assessment.repository import create_assessment_draft
from app.assessment.scope import compute_assessment_scope
from app.migrations import run_migrations


def create_scoped_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    assessment_type: str = "年度",
    *,
    idempotency_key: str | None = None,
) -> int:
    """Test helper: preview-equivalent token then create; returns the new id."""
    scope = compute_assessment_scope(
        connection,
        member_id=member_id,
        year=year,
        assessment_type=assessment_type,
    )
    result = create_assessment_draft(
        connection,
        member_id,
        year,
        assessment_type,
        scope_token=str(scope["scope_token"]),
        idempotency_key=idempotency_key,
    )
    # compute_assessment_scope opened an implicit transaction, so the create
    # ran in a savepoint; commit so other connections see the new draft.
    connection.commit()
    return int(result["id"])


def ensure_capability_nodes(
    connection: psycopg.Connection, l3_codes: list[str]
) -> None:
    model_row = connection.execute(
        "SELECT id FROM capability_model ORDER BY id LIMIT 1"
    ).fetchone()
    if model_row is None:
        model_row = connection.execute(
            """
            INSERT INTO capability_model (
                code, name, version, source_workbook, source_sheet, source_row
            )
            VALUES ('test-model', 'Test Model', '1', 'test.xlsx', 'sheet', 1)
            RETURNING id
            """
        ).fetchone()
    assert model_row is not None
    model_id = model_row[0]

    for order, l3_code in enumerate(dict.fromkeys(l3_codes), 1):
        domain_code = l3_code[:3]
        l2_code = l3_code.rsplit("-", 1)[0]
        l1_row = connection.execute(
            """
            INSERT INTO capability_node (
                model_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, 'L1', %s, %s, %s, 'test.xlsx', 'sheet', %s)
            ON CONFLICT (model_id, code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            (model_id, domain_code, domain_code, order, order),
        ).fetchone()
        assert l1_row is not None
        l2_row = connection.execute(
            """
            INSERT INTO capability_node (
                model_id, parent_node_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, %s, 'L2', %s, %s, %s, 'test.xlsx', 'sheet', %s)
            ON CONFLICT (model_id, code) DO UPDATE SET name = EXCLUDED.name
            RETURNING id
            """,
            (model_id, l1_row[0], l2_code, l2_code, order, order),
        ).fetchone()
        assert l2_row is not None
        connection.execute(
            """
            INSERT INTO capability_node (
                model_id, parent_node_id, node_type, code, name, sort_order,
                recommended_start_level,
                source_workbook, source_sheet, source_row
            )
            VALUES (
                %s, %s, 'L3', %s, %s, %s, 'P4',
                'test.xlsx', 'sheet', %s
            )
            ON CONFLICT (model_id, code) DO NOTHING
            """,
            (model_id, l2_row[0], l3_code, l3_code, order, order),
        )
    # Test fixtures create users directly.  #59 deliberately requires both
    # snapshots for a new Assessment, so fixture users receive explicit valid
    # values here rather than weakening the production validation.
    connection.execute(
        """
        UPDATE tcp_user
        SET current_level = COALESCE(current_level, 'P4'),
            target_level = COALESCE(target_level, 'P8')
        """
    )
    # Migrations (incl. v0009) ALTER planning tables, so the planning schema
    # must exist first.
    from app.planning.schema import create_planning_schema

    create_planning_schema(connection)
    run_migrations(connection)
    connection.commit()


def standard_target_payload(
    connection: psycopg.Connection,
    assessment_id: int,
    desired_details: list[dict[str, object]],
) -> list[dict[str, object]]:
    """
    Build a PATCH payload for the given assessment using standard targets.

    Per #100, personal target adjustments are no longer allowed. Tests that
    previously specified target_level in desired_details now use the standard
    target computed from the member's job level.
    """
    desired = {str(detail["l3_code"]): detail for detail in desired_details}
    rows = connection.execute(
        """
        SELECT l3_code, standard_target_applicable, target_level, l3_node_id
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    payload = []
    for l3_code, applicable, target_level, node_id in rows:
        old = desired.get(str(l3_code))
        if old is None:
            item: dict[str, object] = {
                "l3_code": l3_code,
                "current_level": target_level if applicable else None,
                "evidence_note": "测试辅助已达标项",
            }
            if node_id is not None:
                item["l3_node_id"] = int(node_id)
            payload.append(item)
            continue
        # Use only fields allowed for member self-assessment.
        # Exclude target_level (adjustment fields removed per #100).
        item = {key: value for key, value in old.items() if key != "target_level"}
        if node_id is not None:
            item.setdefault("l3_node_id", int(node_id))
        payload.append(item)
    return payload


def record_submitted_history_state(
    connection: psycopg.Connection, assessment_id: int
) -> None:
    """Fixture-only: build the historical 'submitted' state directly.

    The submit write path is retired (#178): ratings land via draft save and
    learning tasks only via explicit generate-plan-items.  Tests and seed
    data that still need a submitted assessment with a pending review
    (historical review/approval flows) construct that state with SQL plus
    the planning helper instead of the retired business call.  Replicates the
    old submit side effects exactly: status 待复核 + submitted_at, one
    review row (sequence 1, buddy = the primary buddy at submit time),
    revision +1, gaps projection, and Issue #82 plan/task generation for
    include_in_plan rows.
    """
    connection.execute(
        """
        UPDATE assessment
        SET status = '待复核', submitted_at = now(), revision = revision + 1
        WHERE id = %s
        """,
        (assessment_id,),
    )
    # The retired submit resolved the member's primary buddy (assignment-time
    # snapshot) and appended the next review sequence (review history
    # accumulates per submission) — replicate both.
    next_sequence = connection.execute(
        """
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM assessment_review WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchone()[0]
    buddy_id = connection.execute(
        """
        SELECT u.id
        FROM tcp_user u
        JOIN buddy_relationship br ON br.buddy_id = u.id
        WHERE br.member_id = (SELECT member_id FROM assessment WHERE id = %s)
          AND br.is_primary = TRUE
          AND br.effective_date <= CURRENT_DATE
          AND (br.expiry_date IS NULL OR br.expiry_date >= CURRENT_DATE)
          AND u.is_active = TRUE
        """,
        (assessment_id,),
    ).fetchone()
    connection.execute(
        """
        INSERT INTO assessment_review (assessment_id, sequence, buddy_id, status)
        VALUES (%s, %s, %s, '待复核')
        """,
        (assessment_id, next_sequence, buddy_id[0] if buddy_id else None),
    )
    from app.assessment.repository import generate_gaps_for_assessment
    from app.planning.atomic_generation import (
        generate_plan_and_tasks_from_assessment,
    )

    generate_gaps_for_assessment(connection, assessment_id)
    generate_plan_and_tasks_from_assessment(connection, assessment_id)
