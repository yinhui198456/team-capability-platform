import psycopg
import pytest

from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.catalog.repository import (
    get_capability_model,
    get_learning_resource,
    list_learning_resources,
)
from app.catalog.schema import create_catalog_schema

WORKBOOK_DIR = resolve_workbook_dir()


@pytest.fixture(autouse=True)
def initialize_catalog(connection: psycopg.Connection) -> None:
    create_catalog_schema(connection)
    import_catalog(WORKBOOK_DIR, connection)


def test_capability_model_returns_only_the_six_enabled_domains(
    connection: psycopg.Connection,
) -> None:
    connection.execute(
        """
        UPDATE capability_node
        SET p4_description = CASE code
                WHEN 'P01.01' THEN 'L2 P4 description'
            END,
            p5_description = CASE code
                WHEN 'P01.01' THEN 'L2 P5 description'
            END,
            p6_description = CASE code
                WHEN 'P01.01' THEN 'L2 P6 description'
            END,
            p7_description = CASE code
                WHEN 'P01.01' THEN 'L2 P7 description'
            END,
            p8_description = CASE code
                WHEN 'P01.01' THEN 'L2 P8 description'
            END
        WHERE code IN ('P01.01', 'P01.01.01')
        """
    )
    model = get_capability_model(connection, None)

    assert model is not None
    assert {domain["code"] for domain in model["domains"]} == {
        "P01",
        "P02",
        "P03",
        "C01",
        "C02",
        "C03",
    }
    l2 = model["domains"][0]["children"][0]
    l3 = l2["children"][0]
    levels = {
        "p4_description",
        "p5_description",
        "p6_description",
        "p7_description",
        "p8_description",
    }
    assert {l2[level] for level in levels} == {
        "L2 P4 description",
        "L2 P5 description",
        "L2 P6 description",
        "L2 P7 description",
        "L2 P8 description",
    }
    assert not levels & set(l3)
    assert {
        "materials_text",
        "resources",
        "unmatched_materials",
        "output_type",
        "notes",
    } <= set(l3)
    assert "overview" in model["domains"][0]


def test_capability_model_filters_one_domain_and_returns_none_when_missing(
    connection: psycopg.Connection,
) -> None:
    model = get_capability_model(connection, "P01")

    assert model is not None
    assert [domain["code"] for domain in model["domains"]] == ["P01"]
    assert get_capability_model(connection, "X99") is None


def test_list_learning_resources_filters_by_name_status_and_l3(
    connection: psycopg.Connection,
) -> None:
    by_name = list_learning_resources(connection, "产品体系", None, None)
    by_status = list_learning_resources(connection, None, "已提供附件", None)
    by_l3 = list_learning_resources(connection, None, None, "P01.01.01")

    assert by_name and all("产品体系" in resource["name"] for resource in by_name)
    assert by_status
    assert all("已提供附件" in resource["status"] for resource in by_status)
    assert [resource["material_code"] for resource in by_l3] == ["P01-M001"]


def test_resource_detail_has_reverse_l3_links_and_missing_resource_is_none(
    connection: psycopg.Connection,
) -> None:
    resource = get_learning_resource(connection, "P01-M001")

    assert resource is not None
    assert resource["l3_nodes"][0] == {
        "code": "P01.01.01",
        "name": "TDC / TDH / ArgoDB / TDS 产品定位",
        "l1_code": "P01",
        "l1_name": "Data Infra 能力",
        "l2_code": "P01.01",
        "l2_name": "Data Infra 产品体系认知",
    }
    assert get_learning_resource(connection, "P99-M999") is None


def test_valid_unlinked_resource_is_listed_and_has_no_reverse_links(
    connection: psycopg.Connection,
) -> None:
    resource = next(
        resource
        for resource in list_learning_resources(connection, None, None, None)
        if resource["l3_count"] == 0
    )

    detail = get_learning_resource(connection, resource["material_code"])

    assert detail is not None
    assert detail["l3_nodes"] == []
