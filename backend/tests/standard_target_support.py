import psycopg

from app.migrations import run_migrations


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
        SELECT l3_code, standard_target_applicable, target_level
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    payload = []
    for l3_code, applicable, target_level in rows:
        old = desired.get(str(l3_code))
        if old is None:
            payload.append(
                {
                    "l3_code": l3_code,
                    "current_level": target_level if applicable else None,
                    "evidence_note": "测试辅助已达标项",
                    "plan_candidate": False,
                }
            )
            continue
        item = {key: value for key, value in old.items() if key != "target_level"}
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
