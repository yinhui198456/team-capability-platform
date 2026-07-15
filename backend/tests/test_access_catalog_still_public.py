import asyncio
import json
from pathlib import Path
from typing import Any

import psycopg
import pytest

from app.main import app


@pytest.fixture
def catalog_initialized(connection: psycopg.Connection) -> None:
    from app.catalog.importer import import_catalog
    from app.catalog.schema import create_catalog_schema

    workbook_dir = Path("/capability-model")
    if not workbook_dir.exists():
        workbook_dir = Path(__file__).parents[2] / "capability-model"
    create_catalog_schema(connection)
    import_catalog(workbook_dir, connection)
    connection.commit()


async def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""

    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(body_bytes)).encode("utf-8")))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": body_bytes, "more_body": False}

    async def send(message: dict[str, Any]) -> None:
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("utf-8"),
            "query_string": b"",
            "headers": headers,
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )

    status_message = next(message for message in messages if "status" in message)
    status = status_message["status"]
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None

    response_headers: dict[bytes, list[str]] = {}
    for message in messages:
        for name, value in message.get("headers", []):
            response_headers.setdefault(name, []).append(value.decode("utf-8"))

    return status, parsed_body, response_headers


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    return asyncio.run(_asgi_request(method, path, body))


def test_catalog_capability_model_get_is_public(
    catalog_initialized: None,
) -> None:
    status, body, _ = _request("GET", "/api/capability-model")

    assert status == 200
    assert isinstance(body, dict)
    assert "domains" in body


def test_catalog_learning_resources_get_is_public(
    catalog_initialized: None,
) -> None:
    status, body, _ = _request("GET", "/api/learning-resources")

    assert status == 200
    assert isinstance(body, list)


def test_catalog_capability_model_post_rejected(
    catalog_initialized: None,
) -> None:
    status, _, _ = _request("POST", "/api/capability-model")

    assert status == 405
