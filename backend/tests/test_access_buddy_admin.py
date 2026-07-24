import asyncio
import json
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from typing import Any

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_session,
    create_user,
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
    cookies = {SESSION_COOKIE: create_session(connection, user_id, 3600)}
    connection.commit()
    return cookies


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


def _create_user_with_roles(
    connection: psycopg.Connection,
    username: str,
    roles: list[str],
    is_active: bool = True,
) -> int:
    user_id = create_user(connection, username, username, "secret", is_active)
    for role_code in roles:
        assign_role(connection, user_id, role_code)
    connection.commit()
    return user_id


def _create_member_and_buddies(
    connection: psycopg.Connection,
) -> tuple[int, int, int]:
    member_id = _create_user_with_roles(connection, "member", ["Member"])
    buddy_one_id = _create_user_with_roles(connection, "buddy1", ["Buddy"])
    buddy_two_id = _create_user_with_roles(connection, "buddy2", ["Buddy"])
    return member_id, buddy_one_id, buddy_two_id


def _assert_relationship_response(body: dict[str, object]) -> None:
    assert "id" in body
    assert "member_id" in body
    assert "buddy_id" in body
    assert "buddy_name" in body
    assert "effective_date" in body
    assert "expiry_date" in body
    assert "is_primary" in body
    assert "created_at" in body
    assert "updated_at" in body


class TestAdminBuddyLifecycle:
    def test_admin_can_create_and_list_relationship(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        cookies = _cookies_for_user(access_schema, admin_id)

        status, body = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(date.today()),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201
        _assert_relationship_response(body)
        assert body["member_id"] == member_id
        assert body["buddy_id"] == buddy_id

        status, body = _request(
            "GET", f"/api/system/buddy-relationships/{member_id}", cookies=cookies
        )
        assert status == 200
        assert isinstance(body, list)
        assert len(body) == 1
        _assert_relationship_response(body[0])

    def test_admin_can_update_and_end_relationship(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, created = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201
        rel_id = created["id"]

        status, body = _request(
            "PUT",
            f"/api/system/buddy-relationships/{rel_id}",
            {
                "buddy_id": buddy_two_id,
                "effective_date": str(today),
                "expiry_date": str(today + timedelta(days=30)),
            },
            cookies,
        )
        assert status == 200
        _assert_relationship_response(body)
        assert body["buddy_id"] == buddy_two_id
        assert body["expiry_date"] == str(today + timedelta(days=30))

        status, body = _request(
            "POST",
            f"/api/system/buddy-relationships/{rel_id}/end",
            {"end_date": str(today + timedelta(days=15))},
            cookies,
        )
        assert status == 200
        _assert_relationship_response(body)
        assert body["expiry_date"] == str(today + timedelta(days=15))


class TestBuddyAdminPermissions:
    def test_non_admin_cannot_access_buddy_endpoints(
        self, access_schema: psycopg.Connection
    ) -> None:
        member_id = _create_user_with_roles(access_schema, "member", ["Member"])
        buddy_id = _create_user_with_roles(access_schema, "buddy", ["Buddy"])
        leader_id = _create_user_with_roles(access_schema, "leader", ["Leader"])
        cookies = _cookies_for_user(access_schema, leader_id)

        endpoints = [
            ("GET", f"/api/system/buddy-relationships/{member_id}"),
            ("GET", "/api/system/available-buddies"),
            (
                "POST",
                "/api/system/buddy-relationships",
                {
                    "member_id": member_id,
                    "buddy_id": buddy_id,
                    "effective_date": str(date.today()),
                    "expiry_date": None,
                },
            ),
            (
                "PUT",
                "/api/system/buddy-relationships/1",
                {
                    "buddy_id": buddy_id,
                    "effective_date": str(date.today()),
                    "expiry_date": None,
                },
            ),
            (
                "POST",
                "/api/system/buddy-relationships/1/end",
                {"end_date": str(date.today())},
            ),
        ]

        for method, path, *payload in endpoints:
            body = payload[0] if payload else None
            status, _ = _request(method, path, body, cookies)
            assert status == 403, f"{method} {path} should return 403"


class TestBuddyValidation:
    def test_invalid_date_format_returns_422(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        cookies = _cookies_for_user(access_schema, admin_id)

        status, body = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": "not-a-date",
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422
        assert "effective_date" in str(body) or "date" in str(body).lower()

    def test_inverted_dates_return_422(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today),
                "expiry_date": str(today - timedelta(days=1)),
            },
            cookies,
        )
        assert status == 422

    def test_self_buddy_return_422(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id = _create_user_with_roles(
            access_schema, "solo", ["Member", "Buddy"]
        )
        cookies = _cookies_for_user(access_schema, admin_id)

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": member_id,
                "effective_date": str(date.today()),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422

    def test_inactive_buddy_return_422(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id = _create_user_with_roles(access_schema, "member", ["Member"])
        buddy_id = _create_user_with_roles(
            access_schema, "inactive_buddy", ["Buddy"], is_active=False
        )
        cookies = _cookies_for_user(access_schema, admin_id)

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(date.today()),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422

    def test_missing_buddy_role_return_422(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id = _create_user_with_roles(access_schema, "member", ["Member"])
        non_buddy_id = _create_user_with_roles(access_schema, "non_buddy", ["Member"])
        cookies = _cookies_for_user(access_schema, admin_id)

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": non_buddy_id,
                "effective_date": str(date.today()),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422


class TestBuddyOverlap:
    def test_overlapping_current_relationship_rejected(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201

        status, body = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_two_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422
        assert "日期不可重叠" in str(body)

    def test_non_overlapping_history_allowed(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today - timedelta(days=30)),
                "expiry_date": str(today - timedelta(days=1)),
            },
            cookies,
        )
        assert status == 201

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_two_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201

    def test_adjacent_boundary_allowed(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today - timedelta(days=30)),
                "expiry_date": str(today - timedelta(days=1)),
            },
            cookies,
        )
        assert status == 201

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_two_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201

    def test_update_overlaps_future_relationship_rejected(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, past = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today - timedelta(days=30)),
                "expiry_date": str(today + timedelta(days=2)),
            },
            cookies,
        )
        assert status == 201

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_two_id,
                "effective_date": str(today + timedelta(days=3)),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201

        status, body = _request(
            "PUT",
            f"/api/system/buddy-relationships/{past['id']}",
            {
                "buddy_id": buddy_one_id,
                "effective_date": str(today - timedelta(days=30)),
                "expiry_date": str(today + timedelta(days=4)),
            },
            cookies,
        )
        assert status == 422
        assert "日期不可重叠" in str(body)

    def test_end_cannot_extend_existing_expiry(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, created = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today),
                "expiry_date": str(today + timedelta(days=10)),
            },
            cookies,
        )
        assert status == 201

        status, _ = _request(
            "POST",
            f"/api/system/buddy-relationships/{created['id']}/end",
            {"end_date": str(today + timedelta(days=15))},
            cookies,
        )
        assert status == 422


class TestBuddyConcurrency:
    def test_concurrent_create_for_same_member_only_one_succeeds(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        results: list[tuple[int, Any | None]] = []
        lock = threading.Lock()

        def attempt(buddy_id: int) -> None:
            status, body = _request(
                "POST",
                "/api/system/buddy-relationships",
                {
                    "member_id": member_id,
                    "buddy_id": buddy_id,
                    "effective_date": str(today),
                    "expiry_date": None,
                },
                cookies,
            )
            with lock:
                results.append((status, body))

        with ThreadPoolExecutor(max_workers=2) as executor:
            executor.submit(attempt, buddy_one_id)
            executor.submit(attempt, buddy_two_id)

        successes = [r for r in results if r[0] == 201]
        failures = [r for r in results if r[0] == 422]
        assert len(successes) == 1
        assert len(failures) == 1


class TestBuddyPermissionsRealtime:
    def test_buddy_gains_and_loses_member_access_via_relationship_change(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        admin_cookies = _cookies_for_user(access_schema, admin_id)
        buddy_cookies = _cookies_for_user(access_schema, buddy_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today - timedelta(days=1)),
                "expiry_date": None,
            },
            admin_cookies,
        )
        assert status == 201

        status, body = _request("GET", "/api/auth/me", cookies=buddy_cookies)
        assert status == 200
        assert any(m["id"] == member_id for m in body["assigned_members"])

        rels = _request(
            "GET", f"/api/system/buddy-relationships/{member_id}", cookies=admin_cookies
        )[1]
        assert len(rels) == 1
        _request(
            "POST",
            f"/api/system/buddy-relationships/{rels[0]['id']}/end",
            {"end_date": str(today - timedelta(days=1))},
            admin_cookies,
        )

        status, body = _request("GET", "/api/auth/me", cookies=buddy_cookies)
        assert status == 200
        assert not any(m["id"] == member_id for m in body["assigned_members"])


class TestBuddyUnchangedRoles:
    def test_buddy_api_does_not_affect_user_roles_or_levels(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201

        status, body = _request("GET", "/api/system/users", cookies=cookies)
        assert status == 200
        member = next(u for u in body if u["id"] == member_id)
        assert member["roles"] == ["Member"]
        assert member["current_level"] is None
        assert member["target_level"] is None


class TestBuddyResponseSchema:
    def test_create_update_end_return_unified_schema(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_one_id, buddy_two_id = _create_member_and_buddies(
            access_schema
        )
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, created = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_one_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 201
        _assert_relationship_response(created)

        status, updated = _request(
            "PUT",
            f"/api/system/buddy-relationships/{created['id']}",
            {
                "buddy_id": buddy_two_id,
                "effective_date": str(today),
                "expiry_date": str(today + timedelta(days=10)),
            },
            cookies,
        )
        assert status == 200
        _assert_relationship_response(updated)
        assert updated["buddy_name"] == "buddy2"

        status, ended = _request(
            "POST",
            f"/api/system/buddy-relationships/{created['id']}/end",
            {"end_date": str(today + timedelta(days=5))},
            cookies,
        )
        assert status == 200
        _assert_relationship_response(ended)


class TestBuddyLifecycleStates:
    def test_unrelated_member_has_no_buddy_and_empty_history(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id = _create_user_with_roles(access_schema, "member", ["Member"])
        cookies = _cookies_for_user(access_schema, admin_id)

        status, body = _request(
            "GET", f"/api/system/buddy-relationships/{member_id}", cookies=cookies
        )
        assert status == 200
        assert body == []

    def test_expired_relationship_is_not_current(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        member_cookies = _cookies_for_user(access_schema, member_id)
        admin_cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today - timedelta(days=30)),
                "expiry_date": str(today - timedelta(days=1)),
            },
            admin_cookies,
        )
        assert status == 201

        status, body = _request("GET", "/api/auth/me", cookies=member_cookies)
        assert status == 200
        assert body["primary_buddy"] is None

    def test_future_relationship_is_not_current(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        member_id, buddy_id, _ = _create_member_and_buddies(access_schema)
        member_cookies = _cookies_for_user(access_schema, member_id)
        admin_cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, _ = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today + timedelta(days=1)),
                "expiry_date": None,
            },
            admin_cookies,
        )
        assert status == 201

        status, body = _request("GET", "/api/auth/me", cookies=member_cookies)
        assert status == 200
        assert body["primary_buddy"] is None

    def test_non_member_cannot_have_buddy_relationship(
        self, access_schema: psycopg.Connection
    ) -> None:
        admin_id = _create_user_with_roles(access_schema, "admin", ["Admin"])
        non_member_id = _create_user_with_roles(access_schema, "buddy_only", ["Buddy"])
        buddy_id = _create_user_with_roles(access_schema, "buddy", ["Buddy"])
        cookies = _cookies_for_user(access_schema, admin_id)
        today = date.today()

        status, body = _request(
            "POST",
            "/api/system/buddy-relationships",
            {
                "member_id": non_member_id,
                "buddy_id": buddy_id,
                "effective_date": str(today),
                "expiry_date": None,
            },
            cookies,
        )
        assert status == 422
        assert "Member" in str(body)
