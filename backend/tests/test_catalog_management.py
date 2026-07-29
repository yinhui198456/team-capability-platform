import asyncio
import json
from typing import Any

import psycopg
import pytest

from app.access.repository import assign_role, create_session, create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.importer import import_catalog, resolve_workbook_dir
from app.catalog.schema import create_catalog_schema
from app.main import app
from app.migrations import run_migrations

WORKBOOK_DIR = resolve_workbook_dir()
SESSION_COOKIE = "tcp_session"


def _reset_access_schema(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS buddy_relationship")
        connection.execute("DROP TABLE IF EXISTS tcp_session")
        connection.execute("DROP TABLE IF EXISTS tcp_user_role")
        connection.execute("DROP TABLE IF EXISTS tcp_role")
        connection.execute("DROP TABLE IF EXISTS tcp_user")
    create_access_schema(connection)
    connection.commit()


@pytest.fixture(autouse=True)
def initialize_catalog_and_access(connection: psycopg.Connection) -> None:
    connection.execute("DROP TABLE IF EXISTS schema_migration")
    _reset_access_schema(connection)
    create_catalog_schema(connection)
    create_assessment_schema(connection)
    import_catalog(WORKBOOK_DIR, connection)
    run_migrations(connection)
    connection.commit()


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


def _session_cookie(connection: psycopg.Connection, user_id: int) -> str:
    token = create_session(connection, user_id, max_age_seconds=3600)
    connection.commit()
    return token


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

    status = next(message["status"] for message in messages if "status" in message)
    raw_body = b"".join(
        message["body"]
        for message in messages
        if message["type"] == "http.response.body"
    )
    parsed_body = json.loads(raw_body) if raw_body else None
    return status, parsed_body


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, Any | None]:
    return asyncio.run(_asgi_request(method, path, body, cookies))


@pytest.fixture
def leader_cookie(connection: psycopg.Connection) -> str:
    user_id = _create_test_user(connection, "leader", "secret", ["Leader", "Member"])
    return _session_cookie(connection, user_id)


@pytest.fixture
def member_cookie(connection: psycopg.Connection) -> str:
    user_id = _create_test_user(connection, "member", "secret", ["Member"])
    return _session_cookie(connection, user_id)


@pytest.fixture
def buddy_cookie(connection: psycopg.Connection) -> str:
    user_id = _create_test_user(connection, "buddy", "secret", ["Buddy", "Member"])
    return _session_cookie(connection, user_id)


@pytest.fixture
def admin_without_leader_cookie(connection: psycopg.Connection) -> str:
    user_id = _create_test_user(connection, "admin", "secret", ["Admin"])
    return _session_cookie(connection, user_id)


class TestPublicGetRemainsOpen:
    def test_capability_model_get_is_public(
        self, connection: psycopg.Connection
    ) -> None:
        status, body = _request("GET", "/api/capability-model")
        assert status == 200
        assert isinstance(body, dict)
        assert "domains" in body

    def test_learning_resources_get_is_public(
        self, connection: psycopg.Connection
    ) -> None:
        status, body = _request("GET", "/api/learning-resources")
        assert status == 200
        assert isinstance(body, list)

    def test_learning_resource_detail_get_is_public(
        self, connection: psycopg.Connection
    ) -> None:
        status, body = _request("GET", "/api/learning-resources/P01-M001")
        assert status == 200
        assert isinstance(body, dict)


class TestUpdateCapabilityNode:
    def test_legacy_override_field_is_not_available_at_runtime(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"standard_target_overrides": {"P4": 3, "P5": None}},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422
        assert "standard_target_overrides" in str(body["detail"])

        status, model = _request("GET", "/api/capability-model")
        assert status == 200
        node = next(
            l3
            for domain in model["domains"]
            for l2 in domain["children"]
            for l3 in l2["children"]
            if l3["code"] == "P01.01.01"
        )
        assert "standard_target_overrides" not in node

    def test_catalog_node_update_never_reads_or_writes_legacy_overrides(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        cookie = {SESSION_COOKIE: leader_cookie}
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"standard_target_overrides": {"P4": 3}},
            cookies=cookie,
        )
        assert status == 422
        assert "standard_target_overrides" in str(body["detail"])

    def test_recommended_start_level_is_not_a_standard_matrix_constraint(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        row = connection.execute(
            """
            SELECT code FROM capability_node
            WHERE node_type = 'L3' AND recommended_start_level = 'P6'
            ORDER BY code LIMIT 1
            """
        ).fetchone()
        assert row is not None

        status, body = _request(
            "PUT",
            f"/api/capability-model/nodes/{row[0]}",
            {"recommended_start_level": "P7"},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["recommended_start_level"] == "P7"

    def test_recommended_start_level_can_change_without_matrix_side_effects(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        cookie = {SESSION_COOKIE: leader_cookie}
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"recommended_start_level": "P5"},
            cookies=cookie,
        )

        assert status == 200
        assert body["recommended_start_level"] == "P5"

    @pytest.mark.parametrize(
        "overrides",
        [
            {"P3": 3},
            {"P4": 0},
            {"P4": 6},
            {"P4": True},
        ],
    )
    def test_invalid_standard_target_override_is_rejected(
        self,
        connection: psycopg.Connection,
        leader_cookie: str,
        overrides: dict[str, object],
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"standard_target_overrides": overrides},
            cookies={SESSION_COOKIE: leader_cookie},
        )
        assert status == 422

    def test_leader_updates_l3_node(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {
                "name": "Updated L3 Name",
                "recommended_start_level": "P5",
                "materials_text": "P01-M001",
                "expected_output": "updated output",
                "estimated_hours": "10h",
                "output_type": "测试输出",
                "notes": "测试备注",
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["code"] == "P01.01.01"
        assert body["name"] == "Updated L3 Name"
        assert "p4_description" not in body
        assert body["recommended_start_level"] == "P5"
        assert body["output_type"] == "测试输出"

    def test_leader_updates_domain_overview(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01",
            {
                "name": "Data Infra 能力",
                "enabled": True,
                "overview": "更新后的一级概述",
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["code"] == "P01"
        assert body["overview"] == "更新后的一级概述"

    def test_node_type_field_whitelist_rejects_cross_level_fields(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        cookie = {SESSION_COOKIE: leader_cookie}
        for code, body in (
            ("P01", {"p4_description": "not L1"}),
            ("P01.01", {"estimated_hours": "4–6"}),
            ("P01.01.01", {"p4_description": "not L3"}),
        ):
            status, response = _request(
                "PUT", f"/api/capability-model/nodes/{code}", body, cookies=cookie
            )
            assert status == 422
            assert "invalid fields" in response["detail"]

    def test_leader_replaces_l3_resource_links(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"resource_codes": ["P01-M001"]},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert {resource["material_code"] for resource in body["resources"]} == {
            "P01-M001"
        }

        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"resource_codes": []},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["resources"] == []

    def test_update_unknown_node_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/X99.99.99",
            {"name": "Nope"},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 404

    def test_l3_only_fields_rejected_on_l1(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01",
            {"recommended_start_level": "P5"},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_hierarchy_fields_are_rejected(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"parent_node_id": 1},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_unknown_resource_code_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"resource_codes": ["P99-M999"]},
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_member_cannot_update_node(
        self, connection: psycopg.Connection, member_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"name": "Nope"},
            cookies={SESSION_COOKIE: member_cookie},
        )

        assert status == 403

    def test_buddy_cannot_update_node(
        self, connection: psycopg.Connection, buddy_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"name": "Nope"},
            cookies={SESSION_COOKIE: buddy_cookie},
        )

        assert status == 403

    def test_admin_without_leader_cannot_update_node(
        self, connection: psycopg.Connection, admin_without_leader_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"name": "Nope"},
            cookies={SESSION_COOKIE: admin_without_leader_cookie},
        )

        assert status == 403

    def test_anonymous_cannot_update_node(self, connection: psycopg.Connection) -> None:
        status, _ = _request(
            "PUT",
            "/api/capability-model/nodes/P01.01.01",
            {"name": "Nope"},
        )

        assert status == 401


class TestLearningResourceMutations:
    def test_leader_creates_resource(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M900",
                "name": "New Resource",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": ["P01.01.01"],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 201
        assert body["material_code"] == "P01-M900"
        assert body["name"] == "New Resource"
        assert {node["code"] for node in body["l3_nodes"]} == {"P01.01.01"}

    def test_leader_creates_unlinked_resource(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M901",
                "name": "Unlinked Resource",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "reference",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 201
        assert body["l3_nodes"] == []

    def test_create_duplicate_resource_code_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M001",
                "name": "Duplicate",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 409

    def test_create_with_unknown_l3_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M902",
                "name": "Bad Link",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": ["X99.99.99"],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_create_with_invalid_material_code_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "BAD-CODE",
                "name": "Bad Code",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_leader_updates_resource_and_replaces_links(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "PUT",
            "/api/learning-resources/P01-M001",
            {
                "name": "Updated Resource",
                "material_type": "视频",
                "source_text": "updated source",
                "purpose": "deep study",
                "status": "active",
                "l3_codes": ["P01.01.02"],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["name"] == "Updated Resource"
        assert body["material_type"] == "视频"
        assert {node["code"] for node in body["l3_nodes"]} == {"P01.01.02"}

    def test_update_resource_url_code_is_immutable(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/learning-resources/P01-M001",
            {
                "material_code": "P01-M999",
                "name": "Renamed",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 422

    def test_update_unknown_resource_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/learning-resources/P99-M999",
            {
                "name": "Missing",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 404

    def test_leader_archives_resource(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, body = _request(
            "POST",
            "/api/learning-resources/P01-M001/archive",
            None,
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 200
        assert body["status"] == "archived"
        assert body["material_code"] == "P01-M001"

    def test_archive_unknown_resource_fails(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources/P99-M999/archive",
            None,
            cookies={SESSION_COOKIE: leader_cookie},
        )

        assert status == 404

    def test_member_cannot_create_resource(
        self, connection: psycopg.Connection, member_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M903",
                "name": "Nope",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: member_cookie},
        )

        assert status == 403

    def test_buddy_cannot_update_resource(
        self, connection: psycopg.Connection, buddy_cookie: str
    ) -> None:
        status, _ = _request(
            "PUT",
            "/api/learning-resources/P01-M001",
            {
                "name": "Nope",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: buddy_cookie},
        )

        assert status == 403

    def test_admin_without_leader_cannot_archive_resource(
        self, connection: psycopg.Connection, admin_without_leader_cookie: str
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources/P01-M001/archive",
            None,
            cookies={SESSION_COOKIE: admin_without_leader_cookie},
        )

        assert status == 403

    def test_anonymous_cannot_create_resource(
        self, connection: psycopg.Connection
    ) -> None:
        status, _ = _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M904",
                "name": "Nope",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
        )

        assert status == 401


class TestProvenancePreservation:
    def test_imported_resource_source_provenance_unchanged(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        before = connection.execute(
            """
            SELECT source_workbook, source_sheet, source_row
            FROM learning_resource WHERE material_code = %s
            """,
            ("P01-M001",),
        ).fetchone()

        _request(
            "PUT",
            "/api/learning-resources/P01-M001",
            {
                "name": "Renamed",
                "material_type": "视频",
                "source_text": "updated",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        after = connection.execute(
            """
            SELECT source_workbook, source_sheet, source_row
            FROM learning_resource WHERE material_code = %s
            """,
            ("P01-M001",),
        ).fetchone()

        assert after == before

    def test_new_resource_has_manual_provenance(
        self, connection: psycopg.Connection, leader_cookie: str
    ) -> None:
        _request(
            "POST",
            "/api/learning-resources",
            {
                "material_code": "P01-M905",
                "name": "Manual Resource",
                "material_type": "文档",
                "source_text": "internal",
                "purpose": "study",
                "status": "active",
                "l3_codes": [],
            },
            cookies={SESSION_COOKIE: leader_cookie},
        )

        row = connection.execute(
            """
            SELECT source_workbook, source_sheet, source_row
            FROM learning_resource WHERE material_code = %s
            """,
            ("P01-M905",),
        ).fetchone()

        assert row[0] == "manual"
        assert row[1] == "manual"
        assert row[2] == 0


class TestCapabilityStandardVersionAccess:
    def test_only_leader_can_create_or_read_a_draft(
        self,
        connection: psycopg.Connection,
        leader_cookie: str,
        member_cookie: str,
        buddy_cookie: str,
        admin_without_leader_cookie: str,
    ) -> None:
        model_id = int(
            connection.execute("SELECT id FROM capability_model").fetchone()[0]
        )
        status, draft = _request(
            "POST",
            "/api/capability-standard-versions/drafts",
            {"model_id": model_id, "change_summary": "校准 P8"},
            cookies={SESSION_COOKIE: leader_cookie},
        )
        assert status == 201
        assert draft["status"] == "草稿"

        status, body = _request(
            "GET",
            f"/api/capability-standard-versions/{draft['id']}",
            cookies={SESSION_COOKIE: member_cookie},
        )
        assert status == 404
        assert body["detail"]["code"] == "published_standard_not_found"

        status, matrix = _request(
            "GET",
            f"/api/capability-standard-versions/{draft['id']}",
            cookies={SESSION_COOKIE: leader_cookie},
        )
        assert status == 200
        assert matrix["version"]["revision"] == 1
        assert len(matrix["items"]) == 310 * 5

        status, _ = _request(
            "POST",
            "/api/capability-standard-versions/drafts",
            {"model_id": model_id},
            cookies={SESSION_COOKIE: member_cookie},
        )
        assert status == 403

        for cookie in (buddy_cookie, admin_without_leader_cookie):
            status, body = _request(
                "GET",
                f"/api/capability-standard-versions/{draft['id']}",
                cookies={SESSION_COOKIE: cookie},
            )
            assert status == 404
            assert body["detail"]["code"] == "published_standard_not_found"
            status, _ = _request(
                "POST",
                "/api/capability-standard-versions/drafts",
                {"model_id": model_id},
                cookies={SESSION_COOKIE: cookie},
            )
            assert status == 403
