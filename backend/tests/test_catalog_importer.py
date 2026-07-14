from __future__ import annotations

from pathlib import Path
from shutil import copy2

import psycopg
import pytest
from openpyxl import load_workbook

from app.catalog.importer import ensure_catalog_initialized, import_catalog
from app.catalog.schema import create_catalog_schema

WORKBOOK_DIR = Path("/capability-model")
MODEL_WORKBOOK = "技术架构与开发专业线能力胜任模型20260509_V1.0.xlsx"
PLAN_WORKBOOK = "团队成员年度学习计划模板_基于能力模型_V1.3.xlsx"


@pytest.fixture
def connection() -> psycopg.Connection:
    connection = psycopg.connect("postgresql://tcp:tcp_dev_only@postgres:5432/tcp")
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")
    try:
        yield connection
    finally:
        connection.close()


def count(connection: psycopg.Connection, table: str) -> int:
    return connection.execute(f"SELECT count(*) FROM {table}").fetchone()[0]


def test_import_requires_the_two_fixed_workbooks(
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
        47,
        310,
        95,
    )
    assert count(connection, "capability_model") == 1
    assert count(connection, "capability_node") == 363
    assert count(connection, "learning_resource") == 95
    assert {
        row[0]
        for row in connection.execute(
            "SELECT code FROM capability_node WHERE node_type = 'L1' ORDER BY code"
        )
    } == {"P01", "P02", "P03", "C01", "C02", "C03"}


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

    copy2(WORKBOOK_DIR / MODEL_WORKBOOK, tmp_path / MODEL_WORKBOOK)
    copied_plan = tmp_path / PLAN_WORKBOOK
    copy2(WORKBOOK_DIR / PLAN_WORKBOOK, copied_plan)
    workbook = load_workbook(copied_plan)
    worksheet = workbook["02_能力差距自评"]
    worksheet["B2"] = "X99"
    worksheet["C2"] = "Unknown capability"
    workbook.save(copied_plan)

    with pytest.raises(ValueError, match="unknown L1"):
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
