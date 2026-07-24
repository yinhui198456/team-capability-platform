import asyncio
import json
from typing import Any

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_session,
    create_user,
    create_user_admin,
    get_user_by_username,
    get_user_with_roles,
    list_system_configs,
    update_system_config,
    update_user_admin,
)
from app.access.schema import create_access_schema
from app.main import app

SESSION_COOKIE = "tcp_session"


async def _asgi_request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    messages: list[dict[str, Any]] = []
    headers: list[tuple[bytes, bytes]] = []
    body_bytes = b""
    if body is not None:
        body_bytes = json.dumps(body).encode("utf-8")
        headers.extend(
            [
                (b"content-type", b"application/json"),
                (b"content-length", str(len(body_bytes)).encode("utf-8")),
            ]
        )
    if cookies:
        cookie = "; ".join(f"{key}={value}" for key, value in cookies.items())
        headers.append((b"cookie", cookie.encode("utf-8")))

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
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    return status_message["status"], json.loads(raw_body) if raw_body else None


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    return asyncio.run(_asgi_request(method, path, body, cookies))


def _cookies_for_user(connection: psycopg.Connection, user_id: int) -> dict[str, str]:
    return {SESSION_COOKIE: create_session(connection, user_id, 3600)}


def _reset_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_system_config")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    connection.commit()


@pytest.fixture
def access_schema(connection: psycopg.Connection) -> psycopg.Connection:
    _reset_schema(connection)
    return connection


def test_admin_user_update_replaces_fixed_roles(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "member", "Member", "secret")
    assign_role(access_schema, user_id, "Member")

    updated = update_user_admin(
        access_schema, user_id, "Updated Member", False, ["Leader", "Admin"]
    )

    assert updated["full_name"] == "Updated Member"
    assert updated["is_active"] is False
    assert updated["roles"] == ["Admin", "Leader"]
    assert "Buddy" not in updated["roles"]
    assert get_user_with_roles(access_schema, user_id) == updated


def test_admin_user_update_rejects_unknown_or_empty_roles(
    access_schema: psycopg.Connection,
) -> None:
    user_id = create_user(access_schema, "member", "Member", "secret")

    with pytest.raises(ValueError):
        update_user_admin(access_schema, user_id, "Member", True, [])
    with pytest.raises(ValueError):
        update_user_admin(access_schema, user_id, "Member", True, ["Custom"])


def test_admin_can_create_user_with_multiple_fixed_roles(
    access_schema: psycopg.Connection,
) -> None:
    created = create_user_admin(
        access_schema,
        "new_admin",
        "New Admin",
        "secret",
        True,
        ["Admin", "Leader"],
    )

    assert created["username"] == "new_admin"
    assert created["roles"] == ["Admin", "Leader"]

    with pytest.raises(ValueError, match="username already exists"):
        create_user_admin(
            access_schema,
            "new_admin",
            "Duplicate",
            "secret",
            True,
            ["Member"],
        )


def test_system_config_defaults_and_update(access_schema: psycopg.Connection) -> None:
    configs = {config["code"]: config for config in list_system_configs(access_schema)}
    assert set(configs) == {
        "assessment_window",
        "homepage_todo_rule",
        "default_plan_cycle",
    }

    updated = update_system_config(access_schema, "default_plan_cycle", "6", False)
    assert updated["value"] == "6"
    assert updated["enabled"] is False

    with pytest.raises(KeyError):
        update_system_config(access_schema, "unknown", "value", True)


def test_system_api_is_admin_only_and_never_exposes_password_hash(
    access_schema: psycopg.Connection,
) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    member_id = create_user(access_schema, "member", "Member", "secret")
    assign_role(access_schema, member_id, "Member")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    member_cookies = _cookies_for_user(access_schema, member_id)
    access_schema.commit()

    status, body = _request("GET", "/api/system/users", cookies=member_cookies)
    assert status == 403
    assert body == {"detail": "insufficient permissions"}

    status, body = _request("GET", "/api/system/users", cookies=admin_cookies)
    assert status == 200
    assert isinstance(body, list)
    assert all("password_hash" not in system_user for system_user in body)

    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "leader_admin",
            "full_name": "Leader Admin",
            "password": "secret",
            "is_active": True,
            "roles": ["Leader", "Admin"],
        },
        admin_cookies,
    )
    assert status == 201
    assert body["roles"] == ["Admin", "Leader"]
    assert "password_hash" not in body

    status, body = _request(
        "PUT",
        "/api/system/settings/default_plan_cycle",
        {"value": "6", "enabled": True},
        admin_cookies,
    )
    assert status == 200
    assert body["value"] == "6"

    status, body = _request(
        "GET", "/api/planning/evidence-reviews/pending", cookies=admin_cookies
    )
    assert status == 403
    assert body == {"detail": "insufficient permissions"}


def test_admin_can_create_user_with_p_levels(access_schema: psycopg.Connection) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "p6_member",
            "full_name": "P6 Member",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "P6",
            "target_level": "P7",
        },
        admin_cookies,
    )
    assert status == 201
    assert body["current_level"] == "P6"
    assert body["target_level"] == "P7"
    assert body["roles"] == ["Member"]


def test_admin_can_update_user_levels(access_schema: psycopg.Connection) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "updatable",
            "full_name": "Updatable",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
        },
        admin_cookies,
    )
    assert status == 201
    user_id = body["id"]
    assert body["current_level"] is None

    status, body = _request(
        "PUT",
        f"/api/system/users/{user_id}",
        {
            "full_name": "Updatable",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "P5",
            "target_level": "P8",
        },
        admin_cookies,
    )
    assert status == 200
    assert body["current_level"] == "P5"
    assert body["target_level"] == "P8"


def test_null_levels_can_be_saved(access_schema: psycopg.Connection) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "null_levels",
            "full_name": "Null Levels",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
            "current_level": None,
            "target_level": None,
        },
        admin_cookies,
    )
    assert status == 201
    assert body["current_level"] is None
    assert body["target_level"] is None


def test_invalid_level_rejected_and_no_user_left_behind(
    access_schema: psycopg.Connection,
) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    users_before = _request("GET", "/api/system/users", cookies=admin_cookies)[1]
    count_before = len(users_before)

    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "invalid_p9",
            "full_name": "Invalid P9",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "P9",
            "target_level": "P5",
        },
        admin_cookies,
    )
    assert status == 422

    # Verify no user was created
    users_after = _request("GET", "/api/system/users", cookies=admin_cookies)[1]
    assert len(users_after) == count_before

    # Verify the user doesn't exist in the database
    u = get_user_with_roles(access_schema, int(users_after[-1]["id"]))
    assert u is not None
    assert u["username"] != "invalid_p9"


def test_empty_string_level_rejected(access_schema: psycopg.Connection) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "empty_level",
            "full_name": "Empty Level",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "",
            "target_level": "P5",
        },
        admin_cookies,
    )
    assert status == 422


def test_non_admin_cannot_modify_levels(access_schema: psycopg.Connection) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "member_level",
            "full_name": "Member Level",
            "password": "secret",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "P4",
            "target_level": "P5",
        },
        admin_cookies,
    )
    assert status == 201
    user_id = body["id"]

    # Login as member
    member_id = get_user_by_username(access_schema, "member_level")
    assert member_id is not None
    member_cookies = _cookies_for_user(access_schema, member_id["id"])
    access_schema.commit()

    status, _ = _request(
        "PUT",
        f"/api/system/users/{user_id}",
        {
            "full_name": "Hacked",
            "is_active": True,
            "roles": ["Member"],
            "current_level": "P8",
            "target_level": "P8",
        },
        member_cookies,
    )
    assert status == 403

    # Verify user was not modified
    status, body = _request("GET", "/api/system/users", cookies=admin_cookies)
    admin_users = [u for u in body if u["id"] == user_id]
    assert len(admin_users) == 1
    assert admin_users[0]["current_level"] == "P4"


def test_existing_roles_unaffected_by_level_update(
    access_schema: psycopg.Connection,
) -> None:
    admin_id = create_user(access_schema, "admin", "Admin", "secret")
    assign_role(access_schema, admin_id, "Admin")
    admin_cookies = _cookies_for_user(access_schema, admin_id)
    access_schema.commit()
    status, body = _request(
        "POST",
        "/api/system/users",
        {
            "username": "multi_role",
            "full_name": "Multi Role",
            "password": "secret",
            "is_active": True,
            "roles": ["Member", "Buddy"],
            "current_level": "P4",
            "target_level": "P6",
        },
        admin_cookies,
    )
    assert status == 201
    user_id = body["id"]
    assert set(body["roles"]) == {"Buddy", "Member"}

    # Update only level, keep roles unchanged
    status, body = _request(
        "PUT",
        f"/api/system/users/{user_id}",
        {
            "full_name": "Multi Role",
            "is_active": True,
            "roles": ["Member", "Buddy"],
            "current_level": "P7",
            "target_level": "P8",
        },
        admin_cookies,
    )
    assert status == 200
    assert set(body["roles"]) == {"Buddy", "Member"}
    assert body["current_level"] == "P7"
    assert body["target_level"] == "P8"
