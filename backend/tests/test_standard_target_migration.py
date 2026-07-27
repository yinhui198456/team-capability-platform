import psycopg

from app.access.repository import create_user
from app.access.schema import create_access_schema
from app.assessment.repository import save_assessment_draft
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.migrations import run_migrations


def _reset_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        for table in (
            "schema_migration",
            "assessment_review",
            "gap",
            "assessment_detail",
            "assessment",
            "capability_standard_target_override",
            "capability_node_resource",
            "learning_resource",
            "capability_node",
            "capability_model",
            "buddy_relationship",
            "tcp_session",
            "tcp_user_role",
            "tcp_role",
            "tcp_user",
        ):
            connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_catalog_schema(connection)
    create_assessment_schema(connection)
    connection.commit()


def _seed_catalog(connection: psycopg.Connection) -> None:
    model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('model', 'Model', '1', 'model.xlsx', 'sheet', 1)
        RETURNING id
        """
    ).fetchone()[0]
    l1_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'model.xlsx', 'sheet', 1)
        RETURNING id
        """,
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """
        INSERT INTO capability_node
            (model_id, parent_node_id, node_type, code, name, sort_order,
             source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P01.01', 'Area', 1, 'plan.xlsx', 'sheet', 2)
        RETURNING id
        """,
        (model_id, l1_id),
    ).fetchone()[0]
    for order, (code, start) in enumerate(
        (("P01.01.01", "P4"), ("P01.01.02", "P6-P8")), 1
    ):
        connection.execute(
            """
            INSERT INTO capability_node
                (model_id, parent_node_id, node_type, code, name, sort_order,
                 recommended_start_level, source_workbook, source_sheet, source_row)
            VALUES (%s, %s, 'L3', %s, %s, %s, %s, 'plan.xlsx', 'sheet', %s)
            """,
            (model_id, l2_id, code, code, order, start, order + 2),
        )


def _assessment(
    connection: psycopg.Connection, member_id: int, status: str, version: int
) -> int:
    return connection.execute(
        """
        INSERT INTO assessment
            (member_id, year, version, assessment_type, status)
        VALUES (%s, 2026, %s, '年度', %s)
        RETURNING id
        """,
        (member_id, version, status),
    ).fetchone()[0]


def test_standard_target_migration_is_idempotent_and_preserves_history(
    connection: psycopg.Connection,
) -> None:
    _reset_schema(connection)
    _seed_catalog(connection)
    member_id = create_user(connection, "member", "Member", "secret")
    connection.execute(
        "UPDATE tcp_user SET target_level = 'P5' WHERE id = %s", (member_id,)
    )

    draft_id = _assessment(connection, member_id, "草稿", 1)
    pending_id = _assessment(connection, member_id, "待复核", 2)
    archived_id = _assessment(connection, member_id, "已归档", 3)
    legacy_draft_id = _assessment(connection, member_id, "草稿", 4)
    connection.execute(
        """
        INSERT INTO assessment_detail
            (assessment_id, l3_code, current_level, target_level, gap_value)
        VALUES
            (%s, 'P01.01.01', 2, NULL, 0),
            (%s, 'P01.01.02', NULL, NULL, 0),
            (%s, 'P01.01.01', 2, 4, 2),
            (%s, 'P01.01.01', 2, NULL, 0),
            (%s, 'P01.01.01', 2, 5, 3)
        """,
        (draft_id, draft_id, pending_id, archived_id, legacy_draft_id),
    )
    connection.commit()

    run_migrations(connection)
    run_migrations(connection)

    assert (
        connection.execute("SELECT COUNT(*) FROM schema_migration").fetchone()[0] == 1
    )
    assert (
        connection.execute(
            "SELECT to_regclass('capability_standard_target_override')"
        ).fetchone()[0]
        == "capability_standard_target_override"
    )

    rows = connection.execute(
        """
        SELECT assessment_id, l3_code, standard_target_applicable,
               standard_target_level, target_level, gap_value,
               target_snapshot_source, target_compatibility_error
        FROM assessment_detail
        ORDER BY assessment_id, l3_code
        """
    ).fetchall()
    assert rows == [
        (draft_id, "P01.01.01", True, 3, 3, 1, "legacy_draft_migrated", None),
        (
            draft_id,
            "P01.01.02",
            False,
            None,
            None,
            None,
            "legacy_draft_migrated",
            None,
        ),
        (pending_id, "P01.01.01", None, None, 4, 2, "legacy_preserved", None),
        (
            archived_id,
            "P01.01.01",
            None,
            None,
            None,
            None,
            "legacy_preserved",
            "历史明细缺少目标快照",
        ),
        (
            legacy_draft_id,
            "P01.01.01",
            None,
            None,
            5,
            3,
            "legacy_preserved",
            None,
        ),
    ]

    save_assessment_draft(
        connection,
        legacy_draft_id,
        member_id,
        [
            {
                "l3_code": "P01.01.01",
                "current_level": 2,
                "evidence_note": "补充历史草稿依据",
                "plan_candidate": True,
            }
        ],
    )
    preserved = connection.execute(
        """
        SELECT target_level, gap_value, target_snapshot_source
        FROM assessment_detail
        WHERE assessment_id = %s
        """,
        (legacy_draft_id,),
    ).fetchone()
    assert preserved == (5, 3, "legacy_preserved")

    constraint_names = {
        row[0]
        for row in connection.execute(
            """
            SELECT conname FROM pg_constraint
            WHERE conrelid = 'assessment_detail'::regclass
            """
        ).fetchall()
    }
    assert "assessment_detail_target_adjustment_check" in constraint_names
