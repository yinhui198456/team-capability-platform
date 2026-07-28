from __future__ import annotations

from pathlib import Path
from shutil import copy2

import psycopg
import pytest
from openpyxl import load_workbook

from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import (
    ensure_catalog_initialized,
    import_catalog,
    resolve_workbook_dir,
)
from app.catalog.schema import create_catalog_schema

WORKBOOK_DIR = resolve_workbook_dir()
MODEL_WORKBOOK = "技术架构与开发_角色能力模型.xlsx"


def count(connection: psycopg.Connection, table: str) -> int:
    return connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def seed_catalog_nodes(connection: psycopg.Connection) -> dict[str, int]:
    model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('test-model', 'Test model', '1', 'test.xlsx', 'Sheet1', 1)
        RETURNING id
        """
    ).fetchone()[0]

    def insert_node(
        node_type: str, code: str, parent_node_id: int | None = None
    ) -> int:
        return connection.execute(
            """
            INSERT INTO capability_node (
                model_id, parent_node_id, node_type, code, name, sort_order,
                source_workbook, source_sheet, source_row
            ) VALUES (%s, %s, %s, %s, %s, 1, 'test.xlsx', 'Sheet1', 1)
            RETURNING id
            """,
            (model_id, parent_node_id, node_type, code, code),
        ).fetchone()[0]

    l1_id = insert_node("L1", "T01")
    l2_id = insert_node("L2", "T01.01", l1_id)
    l3_id = insert_node("L3", "T01.01.01", l2_id)
    resource_id = connection.execute(
        """
        INSERT INTO learning_resource (
            material_code, name, material_type, source_text, purpose, status,
            source_workbook, source_sheet, source_row
        ) VALUES ('T01-M001', 'Test resource', 'test', 'test', 'test', 'active',
                  'test.xlsx', 'Sheet1', 1)
        RETURNING id
        """
    ).fetchone()[0]
    return {
        "model": model_id,
        "l1": l1_id,
        "l2": l2_id,
        "l3": l3_id,
        "resource": resource_id,
    }


@pytest.mark.parametrize(
    ("node_type", "parent_key", "code"),
    [
        ("L1", "l1", "T02"),
        ("L2", "l3", "T02.01"),
        ("L3", "l1", "T02.01.01"),
    ],
)
def test_rejects_invalid_capability_node_parent_hierarchy(
    connection: psycopg.Connection, node_type: str, parent_key: str, code: str
) -> None:
    create_catalog_schema(connection)
    ids = seed_catalog_nodes(connection)

    with pytest.raises(psycopg.Error):
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO capability_node (
                    model_id, parent_node_id, node_type, code, name, sort_order,
                    source_workbook, source_sheet, source_row
                ) VALUES (%s, %s, %s, %s, %s, 1, 'test.xlsx', 'Sheet1', 1)
                """,
                (ids["model"], ids[parent_key], node_type, code, code),
            )


def test_rejects_learning_resource_link_for_non_l3_node(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)
    ids = seed_catalog_nodes(connection)

    with pytest.raises(psycopg.Error):
        with connection.transaction():
            connection.execute(
                """
                INSERT INTO capability_node_resource (node_id, resource_id)
                VALUES (%s, %s)
                """,
                (ids["l2"], ids["resource"]),
            )


@pytest.mark.parametrize(
    ("node_key", "parent_key"),
    [("l2", "l3"), ("l3", "l1")],
)
def test_rejects_invalid_capability_node_parent_updates(
    connection: psycopg.Connection, node_key: str, parent_key: str
) -> None:
    create_catalog_schema(connection)
    ids = seed_catalog_nodes(connection)

    with pytest.raises(psycopg.Error):
        with connection.transaction():
            connection.execute(
                "UPDATE capability_node SET parent_node_id = %s WHERE id = %s",
                (ids[parent_key], ids[node_key]),
            )


def test_rejects_capability_node_parent_update_across_models(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)
    ids = seed_catalog_nodes(connection)
    other_model_id = connection.execute(
        """
        INSERT INTO capability_model
            (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('other-model', 'Other model', '1', 'test.xlsx', 'Sheet1', 1)
        RETURNING id
        """
    ).fetchone()[0]
    other_l1_id = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, parent_node_id, node_type, code, name, sort_order,
            source_workbook, source_sheet, source_row
        ) VALUES (%s, NULL, 'L1', 'U01', 'U01', 1, 'test.xlsx', 'Sheet1', 1)
        RETURNING id
        """,
        (other_model_id,),
    ).fetchone()[0]

    with pytest.raises(psycopg.Error):
        with connection.transaction():
            connection.execute(
                "UPDATE capability_node SET parent_node_id = %s WHERE id = %s",
                (other_l1_id, ids["l2"]),
            )


def test_rejects_learning_resource_link_update_for_non_l3_node(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)
    ids = seed_catalog_nodes(connection)
    connection.execute(
        """
        INSERT INTO capability_node_resource (node_id, resource_id)
        VALUES (%s, %s)
        """,
        (ids["l3"], ids["resource"]),
    )

    with pytest.raises(psycopg.Error):
        with connection.transaction():
            connection.execute(
                "UPDATE capability_node_resource SET node_id = %s "
                "WHERE resource_id = %s",
                (ids["l2"], ids["resource"]),
            )


def test_import_requires_the_fixed_workbook(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    with pytest.raises(FileNotFoundError):
        import_catalog(tmp_path, connection)


def test_imports_six_domains_and_catalog_baseline(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)

    report = import_catalog(WORKBOOK_DIR, connection)

    assert report.model_count == 1
    assert (
        report.l1_count,
        report.l2_count,
        report.l3_count,
        report.resource_count,
    ) == (
        6,
        51,
        310,
        95,
    )
    assert count(connection, "capability_model") == 1
    assert count(connection, "capability_node") == 367
    assert count(connection, "learning_resource") == 95
    assert {
        row[0]
        for row in connection.execute(
            "SELECT code FROM capability_node WHERE node_type = 'L1' ORDER BY code"
        )
    } == {"P01", "P02", "P03", "C01", "C02", "C03"}
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_node WHERE node_type = 'L2' "
            "AND p4_description IS NOT NULL AND p8_description IS NOT NULL"
        ).fetchone()[0]
        == 51
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_node WHERE node_type IN ('L1', 'L3') "
            "AND (p4_description IS NOT NULL OR p5_description IS NOT NULL OR "
            "p6_description IS NOT NULL OR p7_description IS NOT NULL OR "
            "p8_description IS NOT NULL)"
        ).fetchone()[0]
        == 0
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_node WHERE node_type = 'L3' "
            "AND output_type IS NULL"
        ).fetchone()[0]
        == 115
    )
    assert (
        connection.execute(
            "SELECT count(*) FROM capability_node "
            "WHERE node_type = 'L3' AND notes IS NULL"
        ).fetchone()[0]
        == 291
    )


def test_preserves_materials_text_and_warns_for_unmatched_a8(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)

    report = import_catalog(WORKBOOK_DIR, connection)

    materials_text = connection.execute(
        "SELECT materials_text FROM capability_node WHERE code = %s", ("P01.01.03",)
    ).fetchone()[0]
    assert materials_text == "P01-M001、P01-M007"
    assert "A8" in report.unmatched_materials
    assert (
        connection.execute(
            "SELECT count(*) FROM learning_resource WHERE material_code = %s", ("A8",)
        ).fetchone()[0]
        == 0
    )
    assert count(connection, "capability_node_resource") > 0


def test_unknown_l1_rejects_import_without_replacing_existing_catalog(
    connection: psycopg.Connection, tmp_path: Path
) -> None:
    create_catalog_schema(connection)
    import_catalog(WORKBOOK_DIR, connection)
    before = (
        count(connection, "capability_model"),
        count(connection, "capability_node"),
    )

    copied_workbook = tmp_path / MODEL_WORKBOOK
    copy2(WORKBOOK_DIR / MODEL_WORKBOOK, copied_workbook)
    workbook = load_workbook(copied_workbook)
    worksheet = workbook["02_职级要求矩阵"]
    worksheet["B2"] = "X99"
    worksheet["C2"] = "Unknown capability"
    workbook.save(copied_workbook)

    with pytest.raises(ValueError, match="invalid L2 parent"):
        import_catalog(tmp_path, connection)

    assert (
        count(connection, "capability_model"),
        count(connection, "capability_node"),
    ) == before


def test_second_initialization_does_not_reimport(
    connection: psycopg.Connection,
) -> None:
    first_report = ensure_catalog_initialized(connection, WORKBOOK_DIR)
    first_model_id = connection.execute("SELECT id FROM capability_model").fetchone()[0]

    second_report = ensure_catalog_initialized(connection, WORKBOOK_DIR)

    assert first_report is not None
    assert second_report is None
    assert (
        connection.execute("SELECT id FROM capability_model").fetchone()[0]
        == first_model_id
    )


def test_upgrade_keeps_existing_ids_and_adds_only_the_four_empty_l2(
    connection: psycopg.Connection,
) -> None:
    create_catalog_schema(connection)
    import_catalog(WORKBOOK_DIR, connection)
    ids_before = dict(
        connection.execute(
            "SELECT code, id FROM capability_node "
            "WHERE code IN ('P01', 'P01.01', 'P01.01.01')"
        )
    )
    l3_id = ids_before["P01.01.01"]
    connection.execute(
        "INSERT INTO capability_standard_target_override "
        "(node_id, job_level, target_level) "
        "VALUES (%s, 'P4', 3)",
        (l3_id,),
    )
    create_access_schema(connection)
    create_assessment_schema(connection)
    member_id = connection.execute(
        "INSERT INTO tcp_user (username, full_name, password_hash) "
        "VALUES ('importer-member', 'Importer member', 'x') RETURNING id"
    ).fetchone()[0]
    assessment_id = connection.execute(
        """
        INSERT INTO assessment (member_id, year, assessment_type, status)
        VALUES (%s, 2026, '年度', '草稿') RETURNING id
        """,
        (member_id,),
    ).fetchone()[0]
    connection.execute(
        "INSERT INTO assessment_detail (assessment_id, l3_code) "
        "VALUES (%s, 'P01.01.01')",
        (assessment_id,),
    )
    connection.execute(
        "DELETE FROM capability_node WHERE code = ANY(%s)",
        (["P02.07", "P02.08", "P02.09", "P02.10"],),
    )
    connection.execute(
        "UPDATE capability_model SET version = 'legacy', "
        "source_workbook = 'legacy.xlsx'"
    )

    report = import_catalog(WORKBOOK_DIR, connection)

    ids_after = dict(
        connection.execute(
            "SELECT code, id FROM capability_node "
            "WHERE code IN ('P01', 'P01.01', 'P01.01.01')"
        )
    )
    assert ids_after == ids_before
    assert report.added_l2_codes == ("P02.07", "P02.08", "P02.09", "P02.10")
    assert (
        connection.execute(
            "SELECT target_level FROM capability_standard_target_override "
            "WHERE node_id = %s AND job_level = 'P4'",
            (l3_id,),
        ).fetchone()[0]
        == 3
    )
    assert (
        connection.execute(
            "SELECT l3_code FROM assessment_detail WHERE assessment_id = %s",
            (assessment_id,),
        ).fetchone()[0]
        == "P01.01.01"
    )
