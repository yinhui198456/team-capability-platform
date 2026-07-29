from concurrent.futures import ThreadPoolExecutor
from threading import Barrier

import psycopg

# ruff: noqa: E501
import pytest

from app.access.repository import create_user
from app.access.schema import create_access_schema
from app.assessment.schema import create_assessment_schema
from app.catalog.schema import create_catalog_schema
from app.catalog import standard_versions
from app.catalog.standard_versions import (
    StandardVersionError,
    catalog_drift,
    create_draft,
    publish_version,
    read_matrix,
    reconcile_catalog,
    update_matrix,
    validate_version,
)
from app.migrations.versions.v0004_legacy_draft_target_repair import (
    upgrade as upgrade_v0004,
)
from app.migrations.versions.v0005_capability_standard_versioning import (
    upgrade as upgrade_v0005,
)
from tests.conftest import TEST_DATABASE_URL


def test_standard_version_service_is_available() -> None:
    """The #59 service owns draft lifecycle; old overrides are not an API."""
    assert callable(create_draft)
    assert callable(validate_version)
    assert StandardVersionError("code", "message").code == "code"


def test_standard_version_error_keeps_structured_issues() -> None:
    error = StandardVersionError(
        "invalid_matrix", "matrix invalid", [{"l3_node_id": 1}]
    )
    assert error.issues == [{"l3_node_id": 1}]
    with pytest.raises(StandardVersionError):
        raise error


def _legacy_schema(connection) -> tuple[int, int]:
    """Build the v0004 shape deliberately, before exercising the v0005 upgrade."""
    for table in (
        "capability_standard_version_audit",
        "capability_standard_item",
        "capability_standard_version",
        "capability_standard_target_override",
        "assessment_detail",
        "assessment",
        "capability_node",
        "capability_model",
        "tcp_session",
        "tcp_user_role",
        "tcp_role",
        "tcp_user",
    ):
        connection.execute(f"DROP TABLE IF EXISTS {table} CASCADE")
    create_access_schema(connection)
    create_catalog_schema(connection)
    create_assessment_schema(connection)
    model_id = connection.execute(
        """
        INSERT INTO capability_model (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('versioning-model', 'Versioning model', '1', 'test.xlsx', 'model', 1)
        RETURNING id
        """
    ).fetchone()[0]
    l1_id = connection.execute(
        """
        INSERT INTO capability_node (model_id, node_type, code, name, sort_order, source_workbook, source_sheet, source_row)
        VALUES (%s, 'L1', 'P01', 'Domain', 1, 'test.xlsx', 'model', 2) RETURNING id
        """,
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """
        INSERT INTO capability_node (model_id, parent_node_id, node_type, code, name, sort_order, source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L2', 'P01.01', 'Area', 1, 'test.xlsx', 'model', 3) RETURNING id
        """,
        (model_id, l1_id),
    ).fetchone()[0]
    l3_id = connection.execute(
        """
        INSERT INTO capability_node (model_id, parent_node_id, node_type, code, name, sort_order,
                                     recommended_start_level, source_workbook, source_sheet, source_row)
        VALUES (%s, %s, 'L3', 'P01.01.01', 'Path', 1, 'P4', 'test.xlsx', 'model', 4)
        RETURNING id
        """,
        (model_id, l2_id),
    ).fetchone()[0]
    create_user(connection, "versioning-leader", "Versioning Leader", "secret")
    return int(model_id), int(l3_id)


def _additional_model(connection) -> tuple[int, int]:
    """Add a second model after v0005 to prove model-local baseline selection."""
    model_id = connection.execute(
        """
        INSERT INTO capability_model (code, name, version, source_workbook, source_sheet, source_row)
        VALUES ('versioning-model-b', 'Versioning model B', '1', 'test.xlsx', 'model', 10)
        RETURNING id
        """
    ).fetchone()[0]
    l1_id = connection.execute(
        """INSERT INTO capability_node
           (model_id,node_type,code,name,sort_order,source_workbook,source_sheet,source_row)
           VALUES (%s,'L1','Q01','Domain B',1,'test.xlsx','model',11) RETURNING id""",
        (model_id,),
    ).fetchone()[0]
    l2_id = connection.execute(
        """INSERT INTO capability_node
           (model_id,parent_node_id,node_type,code,name,sort_order,source_workbook,source_sheet,source_row)
           VALUES (%s,%s,'L2','Q01.01','Area B',1,'test.xlsx','model',12) RETURNING id""",
        (model_id, l1_id),
    ).fetchone()[0]
    l3_id = connection.execute(
        """INSERT INTO capability_node
           (model_id,parent_node_id,node_type,code,name,sort_order,recommended_start_level,
            source_workbook,source_sheet,source_row)
           VALUES (%s,%s,'L3','Q01.01.01','Path B',1,'P4','test.xlsx','model',13)
           RETURNING id""",
        (model_id, l2_id),
    ).fetchone()[0]
    return int(model_id), int(l3_id)


def test_v0005_rejects_legacy_override_that_no_longer_matches_v1(connection) -> None:
    model_id, l3_id = _legacy_schema(connection)
    upgrade_v0004(connection)
    connection.commit()
    connection.execute(
        """
        INSERT INTO capability_standard_target_override (node_id, job_level, target_level)
        VALUES (%s, 'P5', 5)
        ON CONFLICT (node_id, job_level) DO UPDATE SET target_level = EXCLUDED.target_level
        """,
        (l3_id,),
    )
    connection.commit()

    with pytest.raises(ValueError, match="Legacy Baseline v1 does not match"):
        with connection.transaction():
            upgrade_v0005(connection)

    assert (
        connection.execute(
            """
        SELECT COUNT(*) FROM information_schema.columns
        WHERE table_name = 'capability_standard_item' AND column_name = 'l3_node_id'
        """
        ).fetchone()[0]
        == 0
    )
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version WHERE model_id = %s",
            (model_id,),
        ).fetchone()[0]
        == 1
    )


def test_v0005_rolls_back_when_legacy_item_has_no_unique_l3_identity(
    connection,
) -> None:
    _legacy_schema(connection)
    upgrade_v0004(connection)
    connection.execute("UPDATE capability_standard_item SET l3_code='missing.identity'")
    connection.commit()

    with pytest.raises(ValueError, match="cannot map Legacy Baseline item identity"):
        with connection.transaction():
            upgrade_v0005(connection)

    assert (
        connection.execute(
            """SELECT COUNT(*) FROM information_schema.columns
            WHERE table_name='capability_standard_item' AND column_name='l3_node_id'"""
        ).fetchone()[0]
        == 0
    )


def test_versioned_draft_copies_baseline_and_preserves_published_immutability(
    connection,
) -> None:
    model_id, l3_id = _legacy_schema(connection)
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()

    draft = create_draft(connection, model_id, actor_id, "Clarify P8")
    assert draft["version_no"] == 2
    matrix = read_matrix(connection, int(draft["id"]), include_draft_fields=True)
    assert {item["l3_node_id"] for item in matrix["items"]} == {l3_id}
    assert {item["source"] for item in matrix["items"]} == {"copied"}
    with pytest.raises(StandardVersionError, match="published standard not found"):
        read_matrix(connection, int(draft["id"]), include_draft_fields=False)

    updated = update_matrix(
        connection,
        int(draft["id"]),
        actor_id,
        1,
        [
            {
                "l3_node_id": l3_id,
                "l3_code": "P01.01.01",
                "job_level": "P4",
                "applicable": True,
                "target_level": 3,
            }
        ],
    )
    assert updated["revision"] == 2
    published = publish_version(connection, int(draft["id"]), actor_id, 2)
    assert published["status"] == "已发布"
    with pytest.raises(StandardVersionError, match="not a draft"):
        update_matrix(
            connection,
            int(draft["id"]),
            actor_id,
            int(published["revision"]),
            [
                {
                    "l3_node_id": l3_id,
                    "l3_code": "P01.01.01",
                    "job_level": "P4",
                    "applicable": True,
                    "target_level": 3,
                }
            ],
        )


def test_v0005_identity_constraints_reject_invalid_node_and_duplicate_level(
    connection,
) -> None:
    model_id, l3_id = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    version_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version WHERE model_id = %s",
            (model_id,),
        ).fetchone()[0]
    )
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        connection.execute(
            """
            INSERT INTO capability_standard_item
                (version_id,l3_node_id,l1_code,l1_name,l2_code,l2_name,l3_code,l3_name,job_level,applicable,target_level,source)
            VALUES (%s, 999999, 'P01','Domain','P01.01','Area','P01.01.99','Unknown','P4',TRUE,2,'explicit')
            """,
            (version_id,),
        )
    connection.rollback()
    with pytest.raises(psycopg.errors.UniqueViolation):
        connection.execute(
            """
            INSERT INTO capability_standard_item
                (version_id,l3_node_id,l1_code,l1_name,l2_code,l2_name,l3_code,l3_name,job_level,applicable,target_level,source)
            VALUES (%s, %s, 'P01','Domain','P01.01','Area','P01.01.01','Path','P4',TRUE,2,'explicit')
            """,
            (version_id, l3_id),
        )


def test_draft_isolated_to_its_model_baseline_and_true_noop_has_no_audit(
    connection,
) -> None:
    model_a, l3_a = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    model_b, l3_b = _additional_model(connection)
    upgrade_v0004(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )

    draft = create_draft(connection, model_a, actor_id, None)
    matrix = read_matrix(connection, int(draft["id"]), include_draft_fields=True)
    assert {item["l3_node_id"] for item in matrix["items"]} == {l3_a}
    assert l3_b not in {item["l3_node_id"] for item in matrix["items"]}
    before_audit = int(
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit WHERE version_id=%s",
            (draft["id"],),
        ).fetchone()[0]
    )
    p4 = next(item for item in matrix["items"] if item["job_level"] == "P4")
    result = update_matrix(
        connection,
        int(draft["id"]),
        actor_id,
        int(draft["revision"]),
        [
            {
                "l3_node_id": l3_a,
                "l3_code": p4["l3_code"],
                "job_level": "P4",
                "applicable": p4["applicable"],
                "target_level": p4["target_level"],
            }
        ],
    )
    assert result["noop"] is True
    assert result["revision"] == draft["revision"]
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit WHERE version_id=%s",
            (draft["id"],),
        ).fetchone()[0]
        == before_audit
    )


def test_catalog_drift_is_explicit_and_reconcile_does_not_fill_new_cells(
    connection,
) -> None:
    model_id, l3_id = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    connection.execute("UPDATE capability_node SET enabled=FALSE WHERE id=%s", (l3_id,))
    connection.commit()
    drift = catalog_drift(connection, int(draft["id"]))
    assert drift["has_drift"] is True
    assert drift["disabled_l3"][0]["l3_node_id"] == l3_id
    reconciled = reconcile_catalog(
        connection, int(draft["id"]), actor_id, int(draft["revision"])
    )
    assert reconciled["noop"] is False
    assert reconciled["drift"]["has_drift"] is False
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_item WHERE version_id=%s",
            (draft["id"],),
        ).fetchone()[0]
        == 0
    )
    published = publish_version(
        connection, int(draft["id"]), actor_id, int(reconciled["revision"])
    )
    assert published["status"] == "已发布"


def test_added_enabled_l3_stays_missing_after_reconcile_and_blocks_publish(
    connection,
) -> None:
    model_id, _ = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    parent_id = int(
        connection.execute(
            "SELECT id FROM capability_node WHERE model_id=%s AND node_type='L2'",
            (model_id,),
        ).fetchone()[0]
    )
    added_id = int(
        connection.execute(
            """INSERT INTO capability_node
            (model_id,parent_node_id,node_type,code,name,sort_order,recommended_start_level,
             source_workbook,source_sheet,source_row)
            VALUES (%s,%s,'L3','P01.01.02','New path',2,'P4','test.xlsx','model',5)
            RETURNING id""",
            (model_id, parent_id),
        ).fetchone()[0]
    )
    connection.commit()

    assert catalog_drift(connection, int(draft["id"]))["added_enabled_l3"] == [
        {"l3_node_id": added_id, "l3_code": "P01.01.02", "l3_name": "New path"}
    ]
    reconciled = reconcile_catalog(
        connection, int(draft["id"]), actor_id, int(draft["revision"])
    )
    assert reconciled["drift"]["has_drift"] is True
    with pytest.raises(StandardVersionError, match="catalog drift"):
        publish_version(
            connection, int(draft["id"]), actor_id, int(reconciled["revision"])
        )


def test_reconcile_refreshes_only_draft_identity_snapshots(connection) -> None:
    model_id, l3_id = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    baseline_id = int(
        connection.execute(
            "SELECT id FROM capability_standard_version WHERE model_id=%s AND version_no=1",
            (model_id,),
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    l1_id = int(
        connection.execute(
            "SELECT id FROM capability_node WHERE model_id=%s AND node_type='L1'",
            (model_id,),
        ).fetchone()[0]
    )
    second_l2 = int(
        connection.execute(
            """INSERT INTO capability_node
            (model_id,parent_node_id,node_type,code,name,sort_order,source_workbook,source_sheet,source_row)
            VALUES (%s,%s,'L2','P01.02','Moved area',2,'test.xlsx','model',6) RETURNING id""",
            (model_id, l1_id),
        ).fetchone()[0]
    )
    connection.execute(
        "UPDATE capability_node SET parent_node_id=%s,name='Renamed path' WHERE id=%s",
        (second_l2, l3_id),
    )
    connection.commit()

    reconciled = reconcile_catalog(
        connection, int(draft["id"]), actor_id, int(draft["revision"])
    )
    assert reconciled["drift"]["has_drift"] is False
    baseline_name = connection.execute(
        "SELECT l3_name FROM capability_standard_item WHERE version_id=%s LIMIT 1",
        (baseline_id,),
    ).fetchone()[0]
    draft_snapshot = connection.execute(
        "SELECT l2_code,l3_name FROM capability_standard_item WHERE version_id=%s LIMIT 1",
        (draft["id"],),
    ).fetchone()
    assert baseline_name == "Path"
    assert draft_snapshot == ("P01.02", "Renamed path")


def test_stale_matrix_revision_is_rejected_without_audit(connection) -> None:
    model_id, l3_id = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    update_matrix(
        connection,
        int(draft["id"]),
        actor_id,
        1,
        [
            {
                "l3_node_id": l3_id,
                "job_level": "P4",
                "applicable": True,
                "target_level": 3,
            }
        ],
    )
    audit_count = int(
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit WHERE version_id=%s",
            (draft["id"],),
        ).fetchone()[0]
    )
    with pytest.raises(StandardVersionError, match="revision conflict"):
        update_matrix(
            connection,
            int(draft["id"]),
            actor_id,
            1,
            [
                {
                    "l3_node_id": l3_id,
                    "job_level": "P4",
                    "applicable": True,
                    "target_level": 4,
                }
            ],
        )
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit WHERE version_id=%s",
            (draft["id"],),
        ).fetchone()[0]
        == audit_count
    )


def test_concurrent_draft_creation_allows_one_writer(connection) -> None:
    model_id, _ = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    barrier = Barrier(2)

    def create() -> str:
        with psycopg.connect(TEST_DATABASE_URL) as second:
            barrier.wait()
            try:
                create_draft(second, model_id, actor_id, None)
                return "created"
            except StandardVersionError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = sorted(executor.map(lambda _: create(), range(2)))
    assert outcomes == ["created", "draft_already_exists"]


def test_concurrent_publish_allows_one_writer(connection) -> None:
    model_id, _ = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    connection.commit()
    barrier = Barrier(2)

    def publish() -> str:
        with psycopg.connect(TEST_DATABASE_URL) as second:
            barrier.wait()
            try:
                publish_version(second, int(draft["id"]), actor_id, 1)
                return "published"
            except StandardVersionError as error:
                return error.code

    with ThreadPoolExecutor(max_workers=2) as executor:
        outcomes = sorted(executor.map(lambda _: publish(), range(2)))
    assert outcomes == ["published", "standard_version_not_draft"]


def test_publish_audit_failure_rolls_back_all_version_changes(
    connection, monkeypatch
) -> None:
    model_id, _ = _legacy_schema(connection)
    upgrade_v0004(connection)
    upgrade_v0005(connection)
    connection.commit()
    actor_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'versioning-leader'"
        ).fetchone()[0]
    )
    draft = create_draft(connection, model_id, actor_id, None)
    before = connection.execute(
        """SELECT id,status,revision FROM capability_standard_version
        WHERE model_id=%s ORDER BY version_no""",
        (model_id,),
    ).fetchall()
    audit_count = int(
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit"
        ).fetchone()[0]
    )

    def fail_audit(*_args, **_kwargs) -> None:
        raise RuntimeError("simulated audit SQL failure")

    monkeypatch.setattr(standard_versions, "_audit", fail_audit)
    with pytest.raises(RuntimeError, match="simulated audit SQL failure"):
        publish_version(connection, int(draft["id"]), actor_id, 1)

    assert (
        connection.execute(
            """SELECT id,status,revision FROM capability_standard_version
            WHERE model_id=%s ORDER BY version_no""",
            (model_id,),
        ).fetchall()
        == before
    )
    assert (
        connection.execute(
            "SELECT COUNT(*) FROM capability_standard_version_audit"
        ).fetchone()[0]
        == audit_count
    )
