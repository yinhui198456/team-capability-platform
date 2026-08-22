import psycopg

from app.assessment.repository import create_assessment_draft
from app.assessment.scope import compute_assessment_scope
from app.migrations import run_migrations


def publish_test_standard(connection: psycopg.Connection, l3_codes: list[str]) -> None:
    """Publish a minimal standard covering the synthetic test nodes.

    The real workbook has no P01-* codes, so scope-preview's completeness
    check needs a published version whose matrix covers exactly the seeded
    nodes.  Always builds a fresh draft version so planning snapshots can
    be captured (v0009 forbids appending snapshots to a published/archived
    version), then archives the previous published one and publishes.
    """
    model_id = int(
        connection.execute(
            "SELECT id FROM capability_model ORDER BY id LIMIT 1"
        ).fetchone()[0]
    )
    old_row = connection.execute(
        "SELECT id FROM capability_standard_version "
        "WHERE status = '已发布' ORDER BY id LIMIT 1"
    ).fetchone()
    if old_row is None:
        version_id = int(
            connection.execute(
                """
                INSERT INTO capability_standard_version (
                    model_id, version_no, label, status, revision
                )
                VALUES (%s, 1, 'test-standard', '草稿', 1)
                RETURNING id
                """,
                (model_id,),
            ).fetchone()[0]
        )
    else:
        version_id = int(
            connection.execute(
                """
                INSERT INTO capability_standard_version (
                    model_id, version_no, label, status, revision
                )
                SELECT model_id, version_no + 1, 'test-standard', '草稿', 1
                FROM capability_standard_version WHERE id = %s
                RETURNING id
                """,
                (int(old_row[0]),),
            ).fetchone()[0]
        )
    for l3_code in dict.fromkeys(l3_codes):
        connection.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                materials_text, expected_output, estimated_hours,
                source_type, source_hash
            )
            SELECT %s, n.id, n.code, n.name, n.materials_text,
                   n.expected_output, n.estimated_hours,
                   'version_publish', 'test'
            FROM capability_node n WHERE n.code = %s
            """,
            (version_id, l3_code),
        )
        for job_level, target in (("P4", 3), ("P8", 5)):
            connection.execute(
                """
                INSERT INTO capability_standard_item (
                    version_id, l3_node_id, l1_code, l1_name, l2_code,
                    l2_name, l3_code, l3_name, job_level, applicable,
                    target_level, source
                )
                SELECT %s, n.id, l1.code, l1.name, l2.code, l2.name,
                       n.code, n.name, %s, TRUE, %s, 'explicit'
                FROM capability_node n
                JOIN capability_node l2 ON l2.id = n.parent_node_id
                JOIN capability_node l1 ON l1.id = l2.parent_node_id
                WHERE n.code = %s
                ON CONFLICT (version_id, l3_node_id, job_level) DO NOTHING
                """,
                (version_id, job_level, target, l3_code),
            )
    if old_row is not None:
        connection.execute(
            "UPDATE capability_standard_version SET status = '已归档' " "WHERE id = %s",
            (int(old_row[0]),),
        )
    connection.execute(
        "UPDATE capability_standard_version SET status = '已发布' " "WHERE id = %s",
        (version_id,),
    )


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
            ON CONFLICT (model_id, code) DO UPDATE
            SET recommended_start_level = 'P4', enabled = TRUE
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
        item = {key: value for key, value in old.items() if key != "target_level"}
        if node_id is not None:
            item.setdefault("l3_node_id", int(node_id))
        requested_target = old.get("target_level")
        if requested_target is not None:
            item.update(
                {
                    "target_adjusted": True,
                    "adjusted_target_level": requested_target,
                    "target_adjustment_reason": "测试场景目标",
                }
            )
        payload.append(item)
    return payload
