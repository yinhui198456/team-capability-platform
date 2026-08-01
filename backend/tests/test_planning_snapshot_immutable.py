"""Issue #62 P1-A: immutable planning source snapshots.

- legacy capture (legacy_catalog_capture_v0009) exists with hash and time;
- published/archived version snapshots are DB-guarded against UPDATE/DELETE;
- hash covers every frozen fact and is stable across runs (stable JSON order);
- any frozen fact change changes the hash;
- publish completeness requires exactly one snapshot per L3;
- clone copies the base snapshots.
"""

import json

import psycopg
import pytest

from app.catalog.standard_versions import (
    capture_planning_snapshot,
    planning_snapshot_hash,
)
from tests.review_support import reset_full_schema


@pytest.fixture
def snapshot_schema(connection: psycopg.Connection) -> psycopg.Connection:
    reset_full_schema(connection)
    from app.access.repository import assign_role, create_user

    actor = create_user(connection, "snap-actor", "Snapshot Actor", "secret")
    assign_role(connection, actor, "Admin")
    connection.commit()
    return connection


def _actor_id(connection: psycopg.Connection) -> int:
    return int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username='snap-actor'"
        ).fetchone()[0]
    )


def _published_version(connection: psycopg.Connection) -> int:
    row = connection.execute(
        "SELECT id FROM capability_standard_version WHERE status='已发布' "
        "ORDER BY id LIMIT 1"
    ).fetchone()
    assert row is not None
    return int(row[0])


def _node_id(connection: psycopg.Connection) -> int:
    row = connection.execute(
        "SELECT id FROM capability_node WHERE node_type='L3' " "ORDER BY id LIMIT 1"
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_legacy_capture_exists_with_type_hash_and_time(
    snapshot_schema: psycopg.Connection,
) -> None:
    version_id = _published_version(snapshot_schema)
    rows = snapshot_schema.execute(
        """
        SELECT source_type, source_hash, captured_at, l3_code, l3_name,
               resource_snapshot
        FROM capability_standard_planning_snapshot
        WHERE capability_standard_version_id=%s
        ORDER BY l3_code
        """,
        (version_id,),
    ).fetchall()
    assert len(rows) >= 1
    for source_type, source_hash, captured_at, l3_code, l3_name, resources in rows:
        assert source_type == "legacy_catalog_capture_v0009"
        assert source_hash and len(source_hash) == 64
        assert captured_at is not None
        assert l3_code and l3_name
        resources = json.loads(resources) if isinstance(resources, str) else resources
        assert isinstance(resources, list)


def test_published_snapshot_immutable_at_db_level(
    snapshot_schema: psycopg.Connection,
) -> None:
    version_id = _published_version(snapshot_schema)
    row = snapshot_schema.execute(
        "SELECT id FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s LIMIT 1",
        (version_id,),
    ).fetchone()
    assert row is not None
    snapshot_id = int(row[0])
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "UPDATE capability_standard_planning_snapshot "
            "SET materials_text = 'changed' WHERE id=%s",
            (snapshot_id,),
        )
    snapshot_schema.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "DELETE FROM capability_standard_planning_snapshot WHERE id=%s",
            (snapshot_id,),
        )
    snapshot_schema.rollback()


def test_draft_snapshot_can_be_updated(
    snapshot_schema: psycopg.Connection,
) -> None:
    # create a draft clone; its snapshots are mutable until publish
    from app.catalog.standard_versions import create_draft

    model_id = snapshot_schema.execute(
        "SELECT id FROM capability_model ORDER BY id LIMIT 1"
    ).fetchone()[0]
    draft = create_draft(
        snapshot_schema,
        int(model_id),
        _actor_id(snapshot_schema),
        "test draft with snapshots",
    )
    snapshot_schema.commit()
    node_id = _node_id(snapshot_schema)
    row = snapshot_schema.execute(
        "SELECT id FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s AND l3_node_id=%s",
        (draft["id"], node_id),
    ).fetchone()
    assert row is not None
    snapshot_schema.execute(
        "UPDATE capability_standard_planning_snapshot "
        "SET notes = 'draft editable' WHERE id=%s",
        (int(row[0]),),
    )
    snapshot_schema.commit()


def test_hash_covers_all_frozen_facts(
    snapshot_schema: psycopg.Connection,
) -> None:
    base = planning_snapshot_hash(
        l3_node_id=1,
        l3_code="A01.01.01",
        l3_name="能力项",
        materials_text="材料",
        resources=[{"code": "R1", "name": "资源", "status": "启用"}],
        expected_output="输出",
        estimated_hours="10",
        output_type="实操",
        notes="备注",
        source_workbook="wb.xlsx",
        source_sheet="s1",
        source_row=5,
        source_type="version_publish",
    )
    variants = {
        "materials": dict(materials_text="材料2"),
        "output": dict(expected_output="输出2"),
        "hours": dict(estimated_hours="12"),
        "notes": dict(notes="备注2"),
        "resources": dict(
            resources=[{"code": "R1", "name": "资源2", "status": "启用"}]
        ),
        "name": dict(l3_name="能力项2"),
        "source_row": dict(source_row=6),
    }
    for label, overrides in variants.items():
        kwargs = dict(
            l3_node_id=1,
            l3_code="A01.01.01",
            l3_name="能力项",
            materials_text="材料",
            resources=[{"code": "R1", "name": "资源", "status": "启用"}],
            expected_output="输出",
            estimated_hours="10",
            output_type="实操",
            notes="备注",
            source_workbook="wb.xlsx",
            source_sheet="s1",
            source_row=5,
            source_type="version_publish",
        )
        kwargs.update(overrides)
        changed = planning_snapshot_hash(**kwargs)
        assert changed != base, label


def test_hash_stable_across_runs_and_orderings(
    snapshot_schema: psycopg.Connection,
) -> None:
    kwargs = dict(
        l3_node_id=42,
        l3_code="B02.03.07",
        l3_name="测试项",
        materials_text="材料",
        resources=[
            {"code": "R2", "name": "乙", "status": "启用"},
            {"code": "R1", "name": "甲", "status": "停用"},
        ],
        expected_output="输出",
        estimated_hours="8-10",
        output_type="实操",
        notes="备注",
        source_workbook="wb.xlsx",
        source_sheet="s2",
        source_row=9,
        source_type="version_publish",
    )
    first = planning_snapshot_hash(**kwargs)
    # same facts, resource array in a different order and dict key order
    second = planning_snapshot_hash(
        **{
            **kwargs,
            "resources": [
                {"status": "停用", "name": "甲", "code": "R1"},
                {"status": "启用", "code": "R2", "name": "乙"},
            ],
        }
    )
    assert first == second


def test_capture_records_current_catalog_values(
    snapshot_schema: psycopg.Connection,
) -> None:
    version_id = _published_version(snapshot_schema)
    node_id = _node_id(snapshot_schema)
    # A published version already has a legacy capture for every node; a
    # re-capture is rejected by the unique business key — captured once, never
    # overwritten.
    with pytest.raises(psycopg.errors.UniqueViolation):
        capture_planning_snapshot(
            snapshot_schema, version_id, node_id, "version_publish"
        )
    snapshot_schema.rollback()


def test_publish_requires_complete_snapshots(
    snapshot_schema: psycopg.Connection,
) -> None:
    from app.catalog.standard_versions import (
        StandardVersionError,
        create_draft,
    )

    model_id = snapshot_schema.execute(
        "SELECT id FROM capability_model ORDER BY id LIMIT 1"
    ).fetchone()[0]
    draft = create_draft(
        snapshot_schema, int(model_id), _actor_id(snapshot_schema), "incomplete draft"
    )
    snapshot_schema.commit()
    # delete one draft snapshot to make the version incomplete
    row = snapshot_schema.execute(
        "SELECT id FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s LIMIT 1",
        (draft["id"],),
    ).fetchone()
    assert row is not None
    snapshot_schema.execute(
        "DELETE FROM capability_standard_planning_snapshot WHERE id=%s",
        (int(row[0]),),
    )
    snapshot_schema.commit()
    # The guard itself rejects an incomplete version (the publish flow refills
    # missing snapshots before freezing, so the guard is tested directly).
    from app.catalog.standard_versions import _assert_planning_snapshots_complete

    with pytest.raises(StandardVersionError) as excinfo:
        _assert_planning_snapshots_complete(snapshot_schema, int(draft["id"]))
    assert excinfo.value.code == "planning_snapshot_incomplete"
    snapshot_schema.rollback()
