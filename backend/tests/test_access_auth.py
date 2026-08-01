import asyncio
import json
from typing import Any

import psycopg
import pytest

from app.access.repository import assign_role, create_session, create_user
from app.access.schema import create_access_schema
from app.access.security import hash_session_token
from app.main import app
from app.settings import settings

SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute(
            "DROP TABLE IF EXISTS annual_plan_change_proposal_detail CASCADE"
        )
        connection.execute("DROP TABLE IF EXISTS annual_plan_change_proposal CASCADE")
        connection.execute("DROP TABLE IF EXISTS review_idempotency_key CASCADE")
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    connection.commit()


def _create_test_user(
    connection: psycopg.Connection,
    username: str,
    password: str,
    roles: list[str],
    full_name: str | None = None,
    is_active: bool = True,
) -> int:
    user_id = create_user(
        connection,
        username,
        full_name or username,
        password,
        is_active,
    )
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.commit()
    return user_id


@pytest.fixture
def access_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_access_schema(connection)
    return connection


@pytest.fixture
def catalog_initialized(connection: psycopg.Connection) -> None:
    from app.catalog.importer import import_catalog, resolve_workbook_dir
    from app.catalog.schema import create_catalog_schema

    workbook_dir = resolve_workbook_dir()
    create_catalog_schema(connection)
    import_catalog(workbook_dir, connection)
    connection.commit()


async def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, str], dict[str, list[str]]]:
    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""

    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers.append((b"content-type", b"application/json"))
        headers.append((b"content-length", str(len(body_bytes)).encode("utf-8")))

    if cookies:
        cookie_header = "; ".join(f"{name}={value}" for name, value in cookies.items())
        headers.append((b"cookie", cookie_header.encode("utf-8")))

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
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None, dict[str, list[str]]]:
    return asyncio.run(_asgi_request(method, path, body, cookies))


def _cookie_attributes(headers: dict[str, list[str]]) -> dict[str, str]:
    """Return the attributes of the first Set-Cookie header as a dict."""
    set_cookie = headers.get(b"set-cookie", [""])[0]
    attributes: dict[str, str] = {}
    parts = [part.strip() for part in set_cookie.split(";")]
    if parts and "=" in parts[0]:
        name, value = parts[0].split("=", 1)
        attributes[name] = value
    for part in parts[1:]:
        if "=" in part:
            key, val = part.split("=", 1)
            attributes[key] = val
        elif part:
            attributes[part] = ""
    return attributes


def test_login_sets_http_only_cookie(access_schema: psycopg.Connection) -> None:
    _create_test_user(access_schema, "alice", "secret", ["Member"], "Alice Smith")

    status, body, headers = _request(
        "POST", "/api/auth/login", {"username": "alice", "password": "secret"}
    )

    assert status == 200
    assert body == {
        "id": body["id"],
        "username": "alice",
        "full_name": "Alice Smith",
        "roles": ["Member"],
    }

    attrs = _cookie_attributes(headers)
    assert SESSION_COOKIE in attrs
    assert attrs.get("HttpOnly") == ""
    assert attrs.get("SameSite", attrs.get("samesite")) in ("Lax", "lax")
    assert attrs.get("Path") == "/"
    assert attrs.get("Max-Age") == str(settings.session_max_age_seconds)
    assert "Secure" not in attrs
    assert "secure" not in attrs


def test_login_response_does_not_expose_token_or_password(
    access_schema: psycopg.Connection,
) -> None:
    _create_test_user(access_schema, "bob", "secret", ["Buddy"], "Bob Brown")

    status, body, headers = _request(
        "POST", "/api/auth/login", {"username": "bob", "password": "secret"}
    )

    assert status == 200
    assert isinstance(body, dict)
    assert set(body.keys()) == {"id", "username", "full_name", "roles"}
    assert "token" not in body
    assert "password_hash" not in body

    attrs = _cookie_attributes(headers)
    cookie_value = attrs[SESSION_COOKIE]
    assert cookie_value
    assert cookie_value not in json.dumps(body)
    assert hash_session_token(cookie_value) != cookie_value


def test_login_rejects_bad_password(access_schema: psycopg.Connection) -> None:
    _create_test_user(access_schema, "carol", "secret", ["Member"])

    status, body, _ = _request(
        "POST", "/api/auth/login", {"username": "carol", "password": "wrong"}
    )

    assert status == 401
    assert body == {"detail": "invalid credentials"}


def test_login_rejects_unknown_user(access_schema: psycopg.Connection) -> None:
    status, body, _ = _request(
        "POST", "/api/auth/login", {"username": "nobody", "password": "secret"}
    )

    assert status == 401
    assert body == {"detail": "invalid credentials"}


def test_login_rejects_inactive_user(access_schema: psycopg.Connection) -> None:
    _create_test_user(
        access_schema,
        "inactive",
        "secret",
        ["Member"],
        is_active=False,
    )

    status, body, _ = _request(
        "POST", "/api/auth/login", {"username": "inactive", "password": "secret"}
    )

    assert status == 401
    assert body == {"detail": "invalid credentials"}


def test_me_requires_cookie(access_schema: psycopg.Connection) -> None:
    status, body, _ = _request("GET", "/api/auth/me")

    assert status == 401
    assert body == {"detail": "not authenticated"}


def test_me_returns_public_identity_and_buddy_info(
    access_schema: psycopg.Connection,
) -> None:
    from app.access.repository import create_buddy_relationship

    buddy_id = _create_test_user(
        access_schema, "buddy", "secret", ["Buddy", "Member"], "Buddy One"
    )
    member_id = _create_test_user(
        access_schema, "member", "secret", ["Member"], "Member One"
    )
    create_buddy_relationship(access_schema, member_id, buddy_id)
    access_schema.commit()

    _, login_body, headers = _request(
        "POST", "/api/auth/login", {"username": "member", "password": "secret"}
    )
    cookies = {SESSION_COOKIE: _cookie_attributes(headers)[SESSION_COOKIE]}

    status, body, _ = _request("GET", "/api/auth/me", cookies=cookies)

    assert status == 200
    assert isinstance(body, dict)
    assert set(body.keys()) == {
        "id",
        "username",
        "full_name",
        "roles",
        "current_level",
        "target_level",
        "primary_buddy",
        "assigned_members",
    }
    assert body["username"] == "member"
    assert body["roles"] == ["Member"]
    assert body["primary_buddy"] == {
        "id": buddy_id,
        "username": "buddy",
        "full_name": "Buddy One",
        "is_active": True,
    }
    assert body["assigned_members"] == []

    _, login_body, headers = _request(
        "POST", "/api/auth/login", {"username": "buddy", "password": "secret"}
    )
    cookies = {SESSION_COOKIE: _cookie_attributes(headers)[SESSION_COOKIE]}

    status, body, _ = _request("GET", "/api/auth/me", cookies=cookies)

    assert status == 200
    assert body["username"] == "buddy"
    assert body["roles"] == ["Buddy", "Member"]
    assert body["primary_buddy"] is None
    assert [m["username"] for m in body["assigned_members"]] == ["member"]


def test_logout_requires_authentication(access_schema: psycopg.Connection) -> None:
    status, body, _ = _request("POST", "/api/auth/logout")

    assert status == 401
    assert body == {"detail": "not authenticated"}


def test_logout_deletes_session_and_clears_cookie(
    access_schema: psycopg.Connection,
) -> None:
    _create_test_user(access_schema, "dave", "secret", ["Member"], "Dave Smith")

    _, _, headers = _request(
        "POST", "/api/auth/login", {"username": "dave", "password": "secret"}
    )
    cookies = {SESSION_COOKIE: _cookie_attributes(headers)[SESSION_COOKIE]}

    status, body, headers = _request("POST", "/api/auth/logout", cookies=cookies)

    assert status == 200
    assert body == {"ok": True}

    attrs = _cookie_attributes(headers)
    assert SESSION_COOKIE in attrs
    assert attrs["Max-Age"] == "0"
    assert attrs.get("HttpOnly") == ""
    assert attrs.get("SameSite", attrs.get("samesite")) in ("Lax", "lax")
    assert attrs.get("Path") == "/"

    status, body, _ = _request("GET", "/api/auth/me", cookies=cookies)
    assert status == 401


def test_expired_session_is_rejected(access_schema: psycopg.Connection) -> None:
    user_id = _create_test_user(access_schema, "eve", "secret", ["Member"])
    expired_token = create_session(access_schema, user_id, max_age_seconds=-1)
    access_schema.commit()

    status, body, _ = _request(
        "GET", "/api/auth/me", cookies={SESSION_COOKIE: expired_token}
    )

    assert status == 401
    assert body == {"detail": "not authenticated"}


@pytest.mark.parametrize("secure,expect_secure", [(True, True), (False, False)])
def test_cookie_secure_flag_follows_settings(
    access_schema: psycopg.Connection,
    monkeypatch: pytest.MonkeyPatch,
    secure: bool,
    expect_secure: bool,
) -> None:
    monkeypatch.setattr(settings, "session_cookie_secure", secure)
    _create_test_user(access_schema, "frank", "secret", ["Member"])

    _, _, headers = _request(
        "POST", "/api/auth/login", {"username": "frank", "password": "secret"}
    )

    attrs = _cookie_attributes(headers)
    assert ("Secure" in attrs) is expect_secure


def test_catalog_get_remains_public(
    access_schema: psycopg.Connection,
    catalog_initialized: None,
) -> None:
    status, body, _ = _request("GET", "/api/capability-model")

    assert status == 200
    assert isinstance(body, dict)
    assert "domains" in body
