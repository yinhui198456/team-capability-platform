import asyncio
import json

import psycopg

from app.catalog.importer import resolve_workbook_dir
from app.main import app, lifespan

WORKBOOK_DIR = resolve_workbook_dir()
WORKBOOKS = ("技术架构与开发_角色能力模型.xlsx",)


def reset_catalog(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
        connection.execute("DROP TABLE IF EXISTS capability_standard_target_override")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")


def test_image_workbooks_bootstrap_the_catalog_baseline(
    connection: psycopg.Connection,
) -> None:
    assert all((WORKBOOK_DIR / workbook).is_file() for workbook in WORKBOOKS)

    reset_catalog(connection)
    model_status, model, resource_status, resources = asyncio.run(
        _initialize_and_request_catalog()
    )

    assert model_status == 200
    assert model is not None
    domains = model["domains"]
    assert len(domains) == 6
    assert {domain["code"] for domain in domains} == {
        "P01",
        "P02",
        "P03",
        "C01",
        "C02",
        "C03",
    }
    assert sum(len(domain["children"]) for domain in domains) == 51
    assert (
        sum(len(l2["children"]) for domain in domains for l2 in domain["children"])
        == 310
    )
    assert resource_status == 200
    assert len(resources) == 95


async def _initialize_and_request_catalog() -> tuple[int, object, int, object]:
    async with lifespan(None):
        model_status, model = await _request("/api/capability-model")
        resource_status, resources = await _request("/api/learning-resources")
    return model_status, model, resource_status, resources


async def _request(path: str) -> tuple[int, object]:
    messages: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message: dict[str, object]) -> None:
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": "GET",
            "scheme": "http",
            "path": path,
            "raw_path": path.encode(),
            "query_string": b"",
            "headers": [],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )
    status = next(message["status"] for message in messages if "status" in message)
    body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    return status, json.loads(body)
