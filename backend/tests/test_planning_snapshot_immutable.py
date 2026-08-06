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
    """P1-1: the DB trigger blocks INSERT *and* UPDATE/DELETE once the version
    is published."""
    version_id = _published_version(snapshot_schema)
    row = snapshot_schema.execute(
        "SELECT id, l3_node_id, l3_code "
        "FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s LIMIT 1",
        (version_id,),
    ).fetchone()
    assert row is not None
    snapshot_id, node_id, l3_code = (int(row[0]), int(row[1]), str(row[2]))
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
    # INSERT on a published version must be blocked too.
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                source_type, source_hash
            )
            VALUES (%s, %s, %s, 'injected', 'version_publish', 'deadbeef')
            """,
            (version_id, node_id, l3_code),
        )
    snapshot_schema.rollback()


def test_archived_snapshot_immutable_at_db_level(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: the same trigger applies to archived versions."""
    version_id = _published_version(snapshot_schema)
    snapshot_schema.execute(
        "UPDATE capability_standard_version SET status='已归档', archived_at=NOW() "
        "WHERE id=%s",
        (version_id,),
    )
    snapshot_schema.commit()
    row = snapshot_schema.execute(
        "SELECT id, l3_node_id, l3_code "
        "FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s LIMIT 1",
        (version_id,),
    ).fetchone()
    assert row is not None
    snapshot_id, node_id, l3_code = (int(row[0]), int(row[1]), str(row[2]))
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "INSERT INTO capability_standard_planning_snapshot ("
            "capability_standard_version_id, l3_node_id, l3_code, l3_name,"
            "source_type, source_hash) VALUES (%s, %s, %s, 'injected',"
            "'version_publish', 'deadbeef')",
            (version_id, node_id, l3_code),
        )
    snapshot_schema.rollback()
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "UPDATE capability_standard_planning_snapshot SET notes='x' WHERE id=%s",
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


def test_capture_rejects_published_and_archived_versions(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: repository capture is draft-only — a structured error before any
    write, for both published and archived versions."""
    from app.catalog.standard_versions import StandardVersionError

    version_id = _published_version(snapshot_schema)
    node_id = _node_id(snapshot_schema)
    with pytest.raises(StandardVersionError) as excinfo:
        capture_planning_snapshot(
            snapshot_schema, version_id, node_id, "version_publish"
        )
    assert excinfo.value.code == "standard_version_not_draft"
    snapshot_schema.rollback()
    # Archive a published version, then the same guard must reject it.
    archived = snapshot_schema.execute(
        """
        UPDATE capability_standard_version
        SET status = '已归档', archived_at = NOW()
        WHERE id = %s
        RETURNING id
        """,
        (version_id,),
    ).fetchone()
    assert archived is not None
    snapshot_schema.commit()
    with pytest.raises(StandardVersionError) as excinfo:
        capture_planning_snapshot(
            snapshot_schema, version_id, node_id, "version_publish"
        )
    assert excinfo.value.code == "standard_version_not_draft"
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
    issues = excinfo.value.issues
    assert any(i["issue"] == "missing_snapshot" for i in issues)
    snapshot_schema.rollback()


def _draft_version(snapshot_schema: psycopg.Connection, label: str) -> tuple[int, int]:
    from app.catalog.standard_versions import create_draft

    model_id = snapshot_schema.execute(
        "SELECT id FROM capability_model ORDER BY id LIMIT 1"
    ).fetchone()[0]
    draft = create_draft(
        snapshot_schema, int(model_id), _actor_id(snapshot_schema), label
    )
    snapshot_schema.commit()
    return int(draft["id"]), int(model_id)


def _publish(snapshot_schema: psycopg.Connection, draft_id: int) -> None:
    from app.catalog.standard_versions import (
        StandardVersionError,
        publish_version,
    )

    try:
        publish_version(snapshot_schema, draft_id, _actor_id(snapshot_schema), 1)
        snapshot_schema.commit()
    except StandardVersionError:
        snapshot_schema.rollback()
        raise


def test_publish_rejects_extra_snapshot(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: a snapshot with no version item blocks publish (structured 422)."""
    from app.catalog.standard_versions import StandardVersionError

    draft_id, model_id = _draft_version(snapshot_schema, "extra snapshot draft")
    # A second L3 in the same model that is *not* part of the version.
    l1 = snapshot_schema.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'X1', 'Extra L1', 'L1', 99, 'x.xlsx', 's1', 1) RETURNING id
        """,
        (model_id,),
    ).fetchone()
    l2 = snapshot_schema.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, parent_node_id, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'X1.01', 'Extra L2', 'L2', %s, 99, 'x.xlsx', 's1', 1) RETURNING id
        """,
        (model_id, int(l1[0])),
    ).fetchone()
    extra_node = snapshot_schema.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, parent_node_id, sort_order,
            enabled, source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'X1.01.01', 'Extra L3', 'L3', %s, 99, FALSE, 'x.xlsx', 's1', 1)
        RETURNING id, code, name
        """,
        (model_id, int(l2[0])),
    ).fetchone()
    snapshot_schema.commit()
    snapshot_schema.execute(
        """
        INSERT INTO capability_standard_planning_snapshot (
            capability_standard_version_id, l3_node_id, l3_code, l3_name,
            source_type, source_hash
        )
        VALUES (%s, %s, %s, %s, 'version_publish', 'injected')
        """,
        (draft_id, int(extra_node[0]), str(extra_node[1]), str(extra_node[2])),
    )
    snapshot_schema.commit()
    with pytest.raises(StandardVersionError) as excinfo:
        _publish(snapshot_schema, draft_id)
    assert excinfo.value.code == "planning_snapshot_incomplete"
    assert any(i["issue"] == "extra_snapshot" for i in excinfo.value.issues)
    # zero partial writes: version still a draft, no items touched
    status = snapshot_schema.execute(
        "SELECT status FROM capability_standard_version WHERE id=%s",
        (draft_id,),
    ).fetchone()
    assert status[0] == "草稿"


def test_publish_rejects_cross_model_snapshot(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: a snapshot node from another capability model blocks publish."""
    from app.catalog.standard_versions import StandardVersionError

    draft_id, model_id = _draft_version(snapshot_schema, "cross model draft")
    other = snapshot_schema.execute(
        "SELECT id FROM capability_model WHERE id <> %s ORDER BY id LIMIT 1",
        (model_id,),
    ).fetchone()
    if other is None:
        snapshot_schema.execute(
            """
            INSERT INTO capability_model (
                code, name, version, source_workbook, source_sheet, source_row
            )
            VALUES ('XMODEL', 'Other Model', 'v1', 'x.xlsx', 'sheet', 1)
            """
        )
        other = snapshot_schema.execute(
            "SELECT id FROM capability_model WHERE name='Other Model'"
        ).fetchone()
        snapshot_schema.commit()
    other_node = snapshot_schema.execute(
        """
        SELECT n.id, n.code, n.name FROM capability_node n
        WHERE n.node_type='L3' AND n.model_id=%s ORDER BY n.id LIMIT 1
        """,
        (int(other[0]),),
    ).fetchone()
    if other_node is None:
        l1 = snapshot_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, 'O1', 'Other L1', 'L1', 99, 'x.xlsx', 's1', 1) RETURNING id
            """,
            (int(other[0]),),
        ).fetchone()
        l2 = snapshot_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, parent_node_id, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, 'O1.01', 'Other L2', 'L2', %s, 99, 'x.xlsx', 's1', 1)
            RETURNING id
            """,
            (int(other[0]), int(l1[0])),
        ).fetchone()
        other_node = snapshot_schema.execute(
            """
            INSERT INTO capability_node (
                model_id, code, name, node_type, parent_node_id, sort_order,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, 'O1.01.01', 'Other L3', 'L3', %s, 99, 'x.xlsx', 's1', 1)
            RETURNING id, code, name
            """,
            (int(other[0]), int(l2[0])),
        ).fetchone()
        snapshot_schema.commit()
    snapshot_schema.execute(
        """
        INSERT INTO capability_standard_planning_snapshot (
            capability_standard_version_id, l3_node_id, l3_code, l3_name,
            source_type, source_hash
        )
        VALUES (%s, %s, %s, %s, 'version_publish', 'injected')
        """,
        (draft_id, int(other_node[0]), str(other_node[1]), str(other_node[2])),
    )
    snapshot_schema.commit()
    with pytest.raises(StandardVersionError) as excinfo:
        _publish(snapshot_schema, draft_id)
    assert excinfo.value.code == "planning_snapshot_incomplete"
    assert any(i["issue"] == "cross_model_snapshot" for i in excinfo.value.issues)


def test_publish_rejects_stale_source_hash(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: a snapshot whose stored hash does not match its frozen fields
    blocks publish (structured 422, zero writes)."""
    from app.catalog.standard_versions import StandardVersionError

    draft_id, _ = _draft_version(snapshot_schema, "stale hash draft")
    snapshot_schema.execute(
        "UPDATE capability_standard_planning_snapshot SET source_hash='stale' "
        "WHERE capability_standard_version_id=%s",
        (draft_id,),
    )
    snapshot_schema.commit()
    with pytest.raises(StandardVersionError) as excinfo:
        _publish(snapshot_schema, draft_id)
    assert excinfo.value.code == "planning_snapshot_incomplete"
    assert any(i["issue"] == "stale_source_hash" for i in excinfo.value.issues)
    status = snapshot_schema.execute(
        "SELECT status FROM capability_standard_version WHERE id=%s",
        (draft_id,),
    ).fetchone()
    assert status[0] == "草稿"


def test_publish_version_still_succeeds_with_exact_set(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: a complete draft with correct hashes publishes normally."""
    draft_id, _ = _draft_version(snapshot_schema, "exact set draft")
    from app.catalog.standard_versions import _assert_planning_snapshots_complete

    _assert_planning_snapshots_complete(snapshot_schema, draft_id)
    _publish(snapshot_schema, draft_id)
    status = snapshot_schema.execute(
        "SELECT status FROM capability_standard_version WHERE id=%s",
        (draft_id,),
    ).fetchone()
    assert status[0] == "已发布"


def test_publish_preview_is_read_only(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: preview never writes snapshots — missing ones stay missing and
    can_publish is False; a complete draft keeps its count after preview."""
    from app.catalog.standard_versions import (
        publish_preview,
    )

    draft_id, _ = _draft_version(snapshot_schema, "preview read-only draft")
    count_before = int(
        snapshot_schema.execute(
            "SELECT COUNT(*) FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (draft_id,),
        ).fetchone()[0]
    )
    # Delete one snapshot → preview must NOT refill it.
    snapshot_schema.execute(
        """
        DELETE FROM capability_standard_planning_snapshot
        WHERE id IN (
            SELECT id FROM capability_standard_planning_snapshot
            WHERE capability_standard_version_id=%s LIMIT 1
        )
        """,
        (draft_id,),
    )
    snapshot_schema.commit()
    count_missing = int(
        snapshot_schema.execute(
            "SELECT COUNT(*) FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (draft_id,),
        ).fetchone()[0]
    )
    preview = publish_preview(snapshot_schema, draft_id)
    snapshot_schema.rollback()
    assert preview["can_publish"] is False
    assert preview["planning_snapshots_ok"] is False
    count_after = int(
        snapshot_schema.execute(
            "SELECT COUNT(*) FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (draft_id,),
        ).fetchone()[0]
    )
    assert count_after == count_missing < count_before
    # Refill the missing draft snapshot via the repository (draft lifecycle
    # allows it), then preview on the now-complete draft is a no-op.
    from app.catalog.standard_versions import _ensure_planning_snapshots

    _ensure_planning_snapshots(snapshot_schema, draft_id)
    snapshot_schema.commit()
    count_complete = int(
        snapshot_schema.execute(
            "SELECT COUNT(*) FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (draft_id,),
        ).fetchone()[0]
    )
    assert count_complete == count_before
    preview2 = publish_preview(snapshot_schema, draft_id)
    snapshot_schema.rollback()
    assert preview2["can_publish"] is True
    assert preview2["planning_snapshots_ok"] is True
    count2_after = int(
        snapshot_schema.execute(
            "SELECT COUNT(*) FROM capability_standard_planning_snapshot "
            "WHERE capability_standard_version_id=%s",
            (draft_id,),
        ).fetchone()[0]
    )
    assert count2_after == count_complete


# ── P1-1 (2nd review): UPDATE cannot move a snapshot into a published/ ──────
# archived version, and identity fields never drift.


def _snapshot_row(
    connection: psycopg.Connection, version_id: int
) -> tuple[int, int, str]:
    row = connection.execute(
        "SELECT id, l3_node_id, l3_code FROM capability_standard_planning_snapshot "
        "WHERE capability_standard_version_id=%s ORDER BY id LIMIT 1",
        (version_id,),
    ).fetchone()
    assert row is not None, f"no snapshot for version {version_id}"
    return int(row[0]), int(row[1]), str(row[2])


def _another_l3_node(
    connection: psycopg.Connection, model_id: int, exclude_node_id: int
) -> int:
    row = connection.execute(
        "SELECT id FROM capability_node WHERE node_type='L3' AND model_id=%s "
        "AND id <> %s ORDER BY id LIMIT 1",
        (model_id, exclude_node_id),
    ).fetchone()
    if row is not None:
        return int(row[0])
    l1 = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'M-L1', 'M L1', 'L1', 99, 'x.xlsx', 's1', 1) RETURNING id
        """,
        (model_id,),
    ).fetchone()
    l2 = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, parent_node_id, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'M-L2', 'M L2', 'L2', %s, 99, 'x.xlsx', 's1', 1) RETURNING id
        """,
        (model_id, int(l1[0])),
    ).fetchone()
    l3 = connection.execute(
        """
        INSERT INTO capability_node (
            model_id, code, name, node_type, parent_node_id, sort_order,
            source_workbook, source_sheet, source_row
        )
        VALUES (%s, 'M-L3', 'M L3', 'L3', %s, 99, 'x.xlsx', 's1', 1) RETURNING id
        """,
        (model_id, int(l2[0])),
    ).fetchone()
    connection.commit()
    return int(l3[0])


def test_update_cannot_move_draft_snapshot_into_published_version(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: a draft snapshot must never be UPDATE-moved into a published
    version (the trigger only checked OLD's status before)."""
    draft_id, model_id = _draft_version(snapshot_schema, "move-to-published")
    published_id = _published_version(snapshot_schema)
    snapshot_id, node_id, l3_code = _snapshot_row(snapshot_schema, draft_id)
    other_node = _another_l3_node(snapshot_schema, model_id, node_id)
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            """
            UPDATE capability_standard_planning_snapshot
            SET capability_standard_version_id = %s, l3_node_id = %s
            WHERE id = %s
            """,
            (published_id, other_node, snapshot_id),
        )
    snapshot_schema.rollback()
    # zero partial writes: the row still belongs to the draft, unchanged
    row = snapshot_schema.execute(
        "SELECT capability_standard_version_id, l3_node_id FROM "
        "capability_standard_planning_snapshot WHERE id=%s",
        (snapshot_id,),
    ).fetchone()
    assert (int(row[0]), int(row[1])) == (draft_id, node_id)


def test_update_cannot_move_draft_snapshot_into_archived_version(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: same protection against archived versions."""
    draft_id, model_id = _draft_version(snapshot_schema, "move-to-archived")
    published_id = _published_version(snapshot_schema)
    archived_id = snapshot_schema.execute(
        "UPDATE capability_standard_version SET status='已归档', archived_at=NOW() "
        "WHERE id=%s RETURNING id",
        (published_id,),
    ).fetchone()[0]
    snapshot_schema.commit()
    snapshot_id, node_id, l3_code = _snapshot_row(snapshot_schema, draft_id)
    other_node = _another_l3_node(snapshot_schema, model_id, node_id)
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            """
            UPDATE capability_standard_planning_snapshot
            SET capability_standard_version_id = %s, l3_node_id = %s
            WHERE id = %s
            """,
            (int(archived_id), other_node, snapshot_id),
        )
    snapshot_schema.rollback()
    row = snapshot_schema.execute(
        "SELECT capability_standard_version_id, l3_node_id FROM "
        "capability_standard_planning_snapshot WHERE id=%s",
        (snapshot_id,),
    ).fetchone()
    assert (int(row[0]), int(row[1])) == (draft_id, node_id)


def test_update_cannot_change_snapshot_identity_fields(
    snapshot_schema: psycopg.Connection,
) -> None:
    """P1-1: identity fields (version, node) are immutable for ANY snapshot,
    even between two drafts."""
    draft_id, model_id = _draft_version(snapshot_schema, "identity-a")
    # A second draft on its own model (created directly: create_draft allows
    # only one open draft per model).
    model_b = snapshot_schema.execute(
        """
        INSERT INTO capability_model (
            code, name, version, source_workbook, source_sheet, source_row
        )
        VALUES ('MB', 'Model B', 'v1', 'x.xlsx', 's1', 1) RETURNING id
        """
    ).fetchone()
    draft_b = snapshot_schema.execute(
        """
        INSERT INTO capability_standard_version (
            model_id, version_no, label, status, created_by
        )
        VALUES (%s, 1, 'identity-b', '草稿', %s) RETURNING id
        """,
        (int(model_b[0]), _actor_id(snapshot_schema)),
    ).fetchone()
    draft_b_id = int(draft_b[0])
    snapshot_schema.commit()
    snapshot_id, node_id, l3_code = _snapshot_row(snapshot_schema, draft_id)
    # version drift to another draft
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "UPDATE capability_standard_planning_snapshot "
            "SET capability_standard_version_id=%s WHERE id=%s",
            (draft_b_id, snapshot_id),
        )
    snapshot_schema.rollback()
    # node drift within the same draft
    other_node = _another_l3_node(snapshot_schema, model_id, node_id)
    with pytest.raises(psycopg.errors.RaiseException):
        snapshot_schema.execute(
            "UPDATE capability_standard_planning_snapshot "
            "SET l3_node_id=%s WHERE id=%s",
            (other_node, snapshot_id),
        )
    snapshot_schema.rollback()
    row = snapshot_schema.execute(
        "SELECT capability_standard_version_id, l3_node_id FROM "
        "capability_standard_planning_snapshot WHERE id=%s",
        (snapshot_id,),
    ).fetchone()
    assert (int(row[0]), int(row[1])) == (draft_id, node_id)
