import asyncio
import json
from urllib.parse import urlencode

import psycopg
import pytest

from app.catalog.api import router
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.catalog.schema import create_catalog_schema
from app.main import app

WORKBOOK_DIR = resolve_workbook_dir()


@pytest.fixture(autouse=True)
def initialize_catalog(connection: psycopg.Connection) -> None:
    create_catalog_schema(connection)
    import_catalog(WORKBOOK_DIR, connection)
    connection.commit()


def request(
    method: str, path: str, params: dict[str, str] | None = None
) -> tuple[int, object]:
    messages: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    asyncio.run(
        app(
            {
                "type": "http",
                "asgi": {"version": "3.0"},
                "http_version": "1.1",
                "method": method,
                "scheme": "http",
                "path": path,
                "raw_path": path.encode(),
                "query_string": urlencode(params or {}).encode(),
                "headers": [],
                "client": ("testclient", 50000),
                "server": ("testserver", 80),
            },
            receive,
            send,
        )
    )
    status = next(message["status"] for message in messages if "status" in message)
    body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    return status, json.loads(body)


def test_capability_model_returns_the_six_enabled_domains(
    connection: psycopg.Connection,
) -> None:
    assert router
    connection.execute(
        """
        UPDATE capability_node
        SET p4_description = CASE code
                WHEN 'P01.01' THEN 'API L2 P4'
            END,
            p5_description = CASE code
                WHEN 'P01.01' THEN 'API L2 P5'
            END,
            p6_description = CASE code
                WHEN 'P01.01' THEN 'API L2 P6'
            END,
            p7_description = CASE code
                WHEN 'P01.01' THEN 'API L2 P7'
            END,
            p8_description = CASE code
                WHEN 'P01.01' THEN 'API L2 P8'
            END
        WHERE code IN ('P01.01', 'P01.01.01')
        """
    )
    connection.commit()
    status, payload = request("GET", "/api/capability-model")

    assert status == 200
    domains = payload["domains"]
    assert {domain["code"] for domain in domains} == {
        "P01",
        "P02",
        "P03",
        "C01",
        "C02",
        "C03",
    }
    l2 = domains[0]["children"][0]
    l3 = l2["children"][0]
    for level in (
        "p4_description",
        "p5_description",
        "p6_description",
        "p7_description",
        "p8_description",
    ):
        assert l2[level].startswith("API L2")
        assert level not in l3
    assert {
        "materials_text",
        "resources",
        "unmatched_materials",
        "output_type",
        "notes",
    } <= set(l3)
    assert "overview" in domains[0]


def test_capability_model_returns_404_for_unknown_domain(
    connection: psycopg.Connection,
) -> None:
    status, _ = request("GET", "/api/capability-model", {"domain_code": "X99"})

    assert status == 404


def test_resource_list_filters_by_name(connection: psycopg.Connection) -> None:
    status, resources = request("GET", "/api/learning-resources", {"name": "产品体系"})

    assert status == 200
    assert resources
    assert all("产品体系" in resource["name"] for resource in resources)


def test_resource_list_filters_by_status(connection: psycopg.Connection) -> None:
    status, resources = request(
        "GET", "/api/learning-resources", {"status": "已提供附件"}
    )

    assert status == 200
    assert resources
    assert all(resource["status"] == "已提供附件" for resource in resources)


def test_resource_list_filters_by_l3(connection: psycopg.Connection) -> None:
    status, resources = request(
        "GET", "/api/learning-resources", {"l3_code": "P01.01.01"}
    )

    assert status == 200
    assert [resource["material_code"] for resource in resources] == ["P01-M001"]


def test_resource_detail_returns_reverse_l3_links(
    connection: psycopg.Connection,
) -> None:
    status, resource = request("GET", "/api/learning-resources/P01-M001")

    assert status == 200
    assert resource["l3_nodes"][0] == {
        "code": "P01.01.01",
        "name": "TDC / TDH / ArgoDB / TDS 产品定位",
        "l1_code": "P01",
        "l1_name": "Data Infra 能力",
        "l2_code": "P01.01",
        "l2_name": "Data Infra 产品体系认知",
    }


def test_resource_detail_returns_404_for_unknown_resource(
    connection: psycopg.Connection,
) -> None:
    status, _ = request("GET", "/api/learning-resources/P99-M999")

    assert status == 404


def test_valid_unlinked_resource_is_visible(connection: psycopg.Connection) -> None:
    _, resources = request("GET", "/api/learning-resources")
    unused = next(resource for resource in resources if resource["l3_count"] == 0)

    status, resource = request(
        "GET", f"/api/learning-resources/{unused['material_code']}"
    )

    assert status == 200
    assert resource["l3_nodes"] == []


@pytest.mark.parametrize("method", ["post", "put", "patch", "delete"])
@pytest.mark.parametrize(
    "path",
    [
        "/api/capability-model",
        "/api/learning-resources",
        "/api/learning-resources/P01-M001",
    ],
)
def test_anonymous_write_methods_are_rejected(
    connection: psycopg.Connection, method: str, path: str
) -> None:
    status, _ = request(method.upper(), path)

    protected_mutation = (path, method) in {
        ("/api/learning-resources", "post"),
        ("/api/learning-resources/P01-M001", "put"),
    }
    assert status == (401 if protected_mutation else 405)
