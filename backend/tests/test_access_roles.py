import asyncio
from typing import Any

import psycopg
import pytest
from fastapi import APIRouter, FastAPI

from app.access.policies import SESSION_COOKIE_NAME, require_any_role
from app.access.repository import assign_role, create_session, create_user
from app.access.schema import create_access_schema


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)


def _create_test_user(
    connection: psycopg.Connection,
    username: str,
    password: str,
    roles: list[str],
) -> int:
    user_id = create_user(connection, username, username, password)
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.commit()
    return user_id


@pytest.fixture
def access_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    return connection


async def _asgi_request(
    app: FastAPI,
    method: str,
    path: str,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []

    if cookies:
        cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
        headers.append((b"cookie", cookie_header.encode("utf-8")))

    async def receive() -> dict[str, Any]:
        return {"type": "http.request", "body": b"", "more_body": False}

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
    parsed_body = __import__("json").loads(raw_body) if raw_body else None

    response_headers: dict[bytes, list[str]] = {}
    for message in messages:
        for name, value in message.get("headers", []):
            response_headers.setdefault(name, []).append(value.decode("utf-8"))

    return status, parsed_body, response_headers


def _request(
    app: FastAPI,
    method: str,
    path: str,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    return asyncio.run(_asgi_request(app, method, path, cookies))


@pytest.fixture
def leader_only_app() -> FastAPI:
    router = APIRouter(prefix="/api/test")

    @router.get("/leader-only", dependencies=[require_any_role("Leader")])
    def leader_only() -> dict[str, object]:
        return {"ok": True}

    test_app = FastAPI()
    test_app.include_router(router)
    return test_app


def _session_cookie(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
) -> str:
    user_id = _create_test_user(connection, username, "secret", roles)
    token = create_session(connection, user_id, max_age_seconds=3600)
    connection.commit()
    return token


def test_leader_only_requires_session(
    access_schema: psycopg.Connection,
    leader_only_app: FastAPI,
) -> None:
    status, body, _ = _request(leader_only_app, "GET", "/api/test/leader-only")

    assert status == 401
    assert body == {"detail": "not authenticated"}


def test_member_only_receives_403(
    access_schema: psycopg.Connection,
    leader_only_app: FastAPI,
) -> None:
    token = _session_cookie(access_schema, "member_only", ["Member"])

    status, body, _ = _request(
        leader_only_app,
        "GET",
        "/api/test/leader-only",
        {SESSION_COOKIE_NAME: token},
    )

    assert status == 403
    assert body == {"detail": "insufficient permissions"}


def test_leader_user_succeeds(
    access_schema: psycopg.Connection,
    leader_only_app: FastAPI,
) -> None:
    token = _session_cookie(access_schema, "leader_user", ["Leader"])

    status, body, _ = _request(
        leader_only_app,
        "GET",
        "/api/test/leader-only",
        {SESSION_COOKIE_NAME: token},
    )

    assert status == 200
    assert body == {"ok": True}


def test_admin_only_receives_403(
    access_schema: psycopg.Connection,
    leader_only_app: FastAPI,
) -> None:
    token = _session_cookie(access_schema, "admin_only", ["Admin"])

    status, body, _ = _request(
        leader_only_app,
        "GET",
        "/api/test/leader-only",
        {SESSION_COOKIE_NAME: token},
    )

    assert status == 403
    assert body == {"detail": "insufficient permissions"}
