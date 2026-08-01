# SQL statements intentionally retain their database-oriented layout.
# ruff: noqa: E501

from __future__ import annotations

import hashlib
import json
from collections.abc import Iterable
from typing import Any

import psycopg

JOB_LEVELS = ("P4", "P5", "P6", "P7", "P8")


def _canonical_json(obj: Any) -> str:
    """Stable JSON serialisation: sorted keys, stable separators."""
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def planning_snapshot_hash(
    *,
    l3_node_id: int,
    l3_code: str,
    l3_name: str,
    materials_text: str | None,
    resources: list[dict[str, Any]],
    expected_output: str | None,
    estimated_hours: str | None,
    output_type: str | None,
    notes: str | None,
    source_workbook: str | None,
    source_sheet: str | None,
    source_row: int | None,
    source_type: str,
) -> str:
    """SHA-256 over every frozen planning-source fact (stable key/array order).

    Any change in a frozen field changes the hash; the same facts produce the
    same hash across runs.  Resource arrays are sorted by code then name so the
    hash does not depend on join order.
    """
    ordered_resources = sorted(
        resources,
        key=lambda r: (str(r.get("code") or ""), str(r.get("name") or "")),
    )
    payload = {
        "l3_node_id": l3_node_id,
        "l3_code": l3_code,
        "l3_name": l3_name,
        "materials_text": materials_text,
        "resources": ordered_resources,
        "expected_output": expected_output,
        "estimated_hours": estimated_hours,
        "output_type": output_type,
        "notes": notes,
        "source_workbook": source_workbook,
        "source_sheet": source_sheet,
        "source_row": source_row,
        "source_type": source_type,
    }
    return hashlib.sha256(_canonical_json(payload).encode("utf-8")).hexdigest()


def load_node_resources(
    connection: psycopg.Connection, node_id: int
) -> list[dict[str, Any]]:
    """Frozen resource facts (code/name/type/source/purpose/status) for a node."""
    rows = connection.execute(
        """
        SELECT lr.material_code, lr.name, lr.material_type, lr.source_text,
               lr.purpose, lr.status
        FROM capability_node_resource cnr
        JOIN learning_resource lr ON lr.id = cnr.resource_id
        WHERE cnr.node_id = %s
        ORDER BY lr.material_code
        """,
        (node_id,),
    ).fetchall()
    return [
        {
            "code": str(row[0]),
            "name": str(row[1]),
            "resource_type": str(row[2]),
            "source": str(row[3]),
            "purpose": str(row[4]),
            "status": str(row[5]),
        }
        for row in rows
    ]


def capture_planning_snapshot(
    connection: psycopg.Connection,
    version_id: int,
    node_id: int,
    source_type: str,
) -> dict[str, Any] | None:
    """Capture the current catalog planning source for one L3 into the version.

    Used by the draft lifecycle (reconcile/publish).  Published/archived
    versions are frozen by the v0009 immutability trigger and never re-captured.
    Returns the captured row (or None when the node no longer exists).
    """
    row = connection.execute(
        """
        SELECT n.code, n.name, n.materials_text, n.expected_output,
               n.estimated_hours, n.output_type, n.notes,
               n.source_workbook, n.source_sheet, n.source_row
        FROM capability_node n
        WHERE n.id = %s AND n.node_type = 'L3'
        """,
        (node_id,),
    ).fetchone()
    if row is None:
        return None
    resources = load_node_resources(connection, node_id)
    source_hash = planning_snapshot_hash(
        l3_node_id=node_id,
        l3_code=str(row[0]),
        l3_name=str(row[1]),
        materials_text=row[2],
        resources=resources,
        expected_output=row[3],
        estimated_hours=row[4],
        output_type=row[5],
        notes=row[6],
        source_workbook=row[7],
        source_sheet=row[8],
        source_row=row[9],
        source_type=source_type,
    )
    inserted = connection.execute(
        """
        INSERT INTO capability_standard_planning_snapshot (
            capability_standard_version_id, l3_node_id, l3_code, l3_name,
            materials_text, resource_snapshot, expected_output, estimated_hours,
            output_type, notes, source_workbook, source_sheet, source_row,
            source_type, source_hash, captured_at
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        RETURNING id, l3_code, l3_name, source_hash
        """,
        (
            version_id,
            node_id,
            row[0],
            row[1],
            row[2],
            psycopg.types.json.Jsonb(resources),
            row[3],
            row[4],
            row[5],
            row[6],
            row[7],
            row[8],
            row[9],
            source_type,
            source_hash,
        ),
    ).fetchone()
    assert inserted is not None
    return {
        "id": int(inserted[0]),
        "l3_code": str(inserted[1]),
        "l3_name": str(inserted[2]),
        "source_hash": str(inserted[3]),
    }


class StandardVersionError(ValueError):
    def __init__(
        self, code: str, message: str, issues: list[dict[str, object]] | None = None
    ) -> None:
        super().__init__(message)
        self.code = code
        self.issues = issues or []


def _lock_model(connection: psycopg.Connection, model_id: int, *, shared: bool) -> None:
    mode = "FOR SHARE" if shared else "FOR UPDATE"
    row = connection.execute(
        f"SELECT id FROM capability_model WHERE id = %s {mode}", (model_id,)
    ).fetchone()
    if row is None:
        raise StandardVersionError("model_not_found", "capability model not found")


def _version(
    connection: psycopg.Connection, version_id: int, *, lock: bool = False
) -> tuple[Any, ...]:
    suffix = " FOR UPDATE" if lock else ""
    row = connection.execute(
        """
        SELECT id, model_id, version_no, label, status, revision, based_on_version_id,
               change_summary, created_at, published_at, archived_at
        FROM capability_standard_version WHERE id = %s
        """
        + suffix,
        (version_id,),
    ).fetchone()
    if row is None:
        raise StandardVersionError(
            "standard_version_not_found", "standard version not found"
        )
    return row


def _version_payload(
    version: tuple[Any, ...], *, include_draft_fields: bool
) -> dict[str, object]:
    payload: dict[str, object] = {
        "id": int(version[0]),
        "model_id": int(version[1]),
        "version_no": int(version[2]),
        "label": str(version[3]),
        "status": str(version[4]),
        "published_at": version[9],
    }
    if include_draft_fields:
        payload.update(
            {
                "revision": int(version[5]),
                "based_on_version_id": version[6],
                "change_summary": version[7],
                "created_at": version[8],
                "archived_at": version[10],
            }
        )
    return payload


def _require_draft(
    connection: psycopg.Connection,
    version_id: int,
    expected_revision: int | None = None,
) -> tuple[Any, ...]:
    unlocked = _version(connection, version_id)
    _lock_model(connection, int(unlocked[1]), shared=False)
    version = _version(connection, version_id, lock=True)
    if version[4] != "草稿":
        raise StandardVersionError(
            "standard_version_not_draft", "standard version is not a draft"
        )
    if expected_revision is not None and int(version[5]) != expected_revision:
        raise StandardVersionError(
            "standard_revision_conflict", "standard revision conflict"
        )
    return version


def create_draft(
    connection: psycopg.Connection,
    model_id: int,
    actor_user_id: int,
    change_summary: str | None = None,
) -> dict[str, object]:
    with connection.transaction():
        _lock_model(connection, model_id, shared=False)
        existing = connection.execute(
            "SELECT id FROM capability_standard_version WHERE model_id = %s AND status = '草稿'",
            (model_id,),
        ).fetchone()
        if existing is not None:
            raise StandardVersionError("draft_already_exists", "a draft already exists")
        base = connection.execute(
            """
            SELECT id, version_no FROM capability_standard_version
            WHERE model_id = %s AND status = '已发布'
            """,
            (model_id,),
        ).fetchone()
        if base is None:
            raise StandardVersionError(
                "published_standard_not_found", "published standard not found"
            )
        version_no = int(
            connection.execute(
                "SELECT COALESCE(MAX(version_no), 0) + 1 FROM capability_standard_version WHERE model_id = %s",
                (model_id,),
            ).fetchone()[0]
        )
        row = connection.execute(
            """
            INSERT INTO capability_standard_version
                (model_id, version_no, label, status, based_on_version_id, revision,
                 created_by, change_summary, updated_at)
            VALUES (%s, %s, %s, '草稿', %s, 1, %s, %s, NOW())
            RETURNING id, revision
            """,
            (
                model_id,
                version_no,
                f"标准版本 v{version_no}",
                base[0],
                actor_user_id,
                change_summary,
            ),
        ).fetchone()
        assert row is not None
        version_id = int(row[0])
        connection.execute(
            """
            INSERT INTO capability_standard_item
                (version_id, l3_node_id, l1_code, l1_name, l2_code, l2_name,
                 l3_code, l3_name, job_level, applicable, target_level, source,
                 updated_by, updated_at)
            SELECT %s, l3_node_id, l1_code, l1_name, l2_code, l2_name,
                   l3_code, l3_name, job_level, applicable, target_level,
                   'copied', %s, NOW()
            FROM capability_standard_item WHERE version_id = %s
            """,
            (version_id, actor_user_id, base[0]),
        )
        # Copy the published base's immutable planning snapshots into the draft
        # so the draft inherits the frozen planning source.
        connection.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                materials_text, resource_snapshot, expected_output,
                estimated_hours, output_type, notes, source_workbook,
                source_sheet, source_row, source_type, source_hash, captured_at
            )
            SELECT %s, l3_node_id, l3_code, l3_name, materials_text,
                   resource_snapshot, expected_output, estimated_hours,
                   output_type, notes, source_workbook, source_sheet,
                   source_row, source_type, source_hash, captured_at
            FROM capability_standard_planning_snapshot
            WHERE capability_standard_version_id = %s
            """,
            (version_id, base[0]),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "created",
            None,
            1,
            {"based_on_version_id": base[0]},
        )
        return {
            "id": version_id,
            "version_no": version_no,
            "status": "草稿",
            "revision": 1,
        }


def list_versions(
    connection: psycopg.Connection, model_id: int, *, include_drafts: bool
) -> list[dict[str, object]]:
    _lock_model(connection, model_id, shared=True)
    statuses = ("草稿", "已发布", "已归档") if include_drafts else ("已发布",)
    rows = connection.execute(
        """
        SELECT id, model_id, version_no, label, status, revision, based_on_version_id,
               change_summary, created_at, published_at, archived_at
        FROM capability_standard_version
        WHERE model_id=%s AND status = ANY(%s)
        ORDER BY version_no DESC
        """,
        (model_id, statuses),
    ).fetchall()
    return [_version_payload(row, include_draft_fields=include_drafts) for row in rows]


def read_matrix(
    connection: psycopg.Connection, version_id: int, *, include_draft_fields: bool
) -> dict[str, object]:
    version = _version(connection, version_id)
    if not include_draft_fields and version[4] != "已发布":
        raise StandardVersionError(
            "published_standard_not_found", "published standard not found"
        )
    rows = connection.execute(
        """
        SELECT l3_node_id,l1_code,l1_name,l2_code,l2_name,l3_code,l3_name,
               job_level,applicable,target_level,source
        FROM capability_standard_item WHERE version_id=%s
        ORDER BY l1_code,l2_code,l3_code,job_level
        """,
        (version_id,),
    ).fetchall()
    return {
        "version": _version_payload(version, include_draft_fields=include_draft_fields),
        "items": [
            {
                "l3_node_id": int(row[0]),
                "l1_code": row[1],
                "l1_name": row[2],
                "l2_code": row[3],
                "l2_name": row[4],
                "l3_code": row[5],
                "l3_name": row[6],
                "job_level": row[7],
                "applicable": bool(row[8]),
                "target_level": row[9],
                "source": row[10],
            }
            for row in rows
        ],
    }


def _audit(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    action: str,
    old_revision: int | None,
    new_revision: int | None,
    summary: dict[str, object],
) -> None:
    connection.execute(
        """
        INSERT INTO capability_standard_version_audit
            (version_id, actor_user_id, action, old_revision, new_revision, summary)
        VALUES (%s, %s, %s, %s, %s, %s::jsonb)
        """,
        (
            version_id,
            actor_user_id,
            action,
            old_revision,
            new_revision,
            psycopg.types.json.Jsonb(summary),
        ),
    )


def validate_version(
    connection: psycopg.Connection, version_id: int
) -> dict[str, object]:
    version = _version(connection, version_id)
    model_id = int(version[1])
    enabled = connection.execute(
        """
        SELECT id, code FROM capability_node
        WHERE model_id = %s AND node_type = 'L3' AND enabled = TRUE ORDER BY code
        """,
        (model_id,),
    ).fetchall()
    rows = connection.execute(
        """
        SELECT l3_node_id, l3_code, job_level, applicable, target_level
        FROM capability_standard_item WHERE version_id = %s
        ORDER BY l3_node_id, job_level
        """,
        (version_id,),
    ).fetchall()
    by_node: dict[int, list[tuple[Any, ...]]] = {}
    for row in rows:
        by_node.setdefault(int(row[0]), []).append(row)
    issues: list[dict[str, object]] = []
    enabled_ids = {int(row[0]) for row in enabled}
    for node_id, code in enabled:
        cells = by_node.get(int(node_id), [])
        if len(cells) != 5 or {str(cell[2]) for cell in cells} != set(JOB_LEVELS):
            issues.append(
                {
                    "l3_node_id": int(node_id),
                    "l3_code": str(code),
                    "job_level": None,
                    "rule": "incomplete_matrix",
                    "message": "L3 must have P4–P8 cells",
                }
            )
            continue
        applicable_seen = False
        last_target: int | None = None
        for _, _, level, applicable, target in cells:
            if not applicable:
                if applicable_seen or target is not None:
                    issues.append(
                        {
                            "l3_node_id": int(node_id),
                            "l3_code": str(code),
                            "job_level": str(level),
                            "rule": "applicability_monotonic",
                            "message": "applicability cannot return to false",
                        }
                    )
                continue
            if target is None or not 1 <= int(target) <= 5:
                issues.append(
                    {
                        "l3_node_id": int(node_id),
                        "l3_code": str(code),
                        "job_level": str(level),
                        "rule": "target_range",
                        "message": "target must be 1–5",
                    }
                )
                continue
            if last_target is not None and int(target) < last_target:
                issues.append(
                    {
                        "l3_node_id": int(node_id),
                        "l3_code": str(code),
                        "job_level": str(level),
                        "rule": "target_non_decreasing",
                        "message": "target cannot decrease",
                    }
                )
            applicable_seen = True
            last_target = int(target)
    for node_id in set(by_node) - enabled_ids:
        issues.append(
            {
                "l3_node_id": node_id,
                "l3_code": None,
                "job_level": None,
                "rule": "catalog_drift",
                "message": "draft contains disabled or foreign L3",
            }
        )
    return {
        "version_id": version_id,
        "valid": not issues,
        "issues": issues,
        "summary": {
            "enabled_l3_count": len(enabled),
            "item_count": len(rows),
            "issue_count": len(issues),
        },
    }


def update_matrix(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    expected_revision: int,
    items: Iterable[dict[str, object]],
) -> dict[str, object]:
    changes = list(items)
    with connection.transaction():
        version = _require_draft(connection, version_id, expected_revision)
        model_id = int(version[1])
        validated: list[tuple[int, str, str, bool, int | None]] = []
        seen_identities: set[tuple[int, str]] = set()
        for item in changes:
            node_id = item.get("l3_node_id")
            level = item.get("job_level")
            applicable = item.get("applicable")
            target = item.get("target_level")
            if (
                not isinstance(node_id, int)
                or level not in JOB_LEVELS
                or not isinstance(applicable, bool)
            ):
                raise StandardVersionError("invalid_matrix_item", "invalid matrix item")
            if applicable != (
                isinstance(target, int)
                and not isinstance(target, bool)
                and 1 <= target <= 5
            ):
                if applicable or target is not None:
                    raise StandardVersionError(
                        "invalid_matrix_item", "invalid applicable/target pair"
                    )
            identity = (int(node_id), str(level))
            if identity in seen_identities:
                raise StandardVersionError(
                    "duplicate_matrix_cell",
                    "duplicate matrix cell in request",
                    [{"l3_node_id": int(node_id), "job_level": str(level)}],
                )
            seen_identities.add(identity)
            node = connection.execute(
                """
                SELECT n.code FROM capability_node n
                WHERE n.id = %s AND n.model_id = %s AND n.node_type = 'L3' AND n.enabled = TRUE
                """,
                (node_id, model_id),
            ).fetchone()
            if node is None or (
                item.get("l3_code") is not None and item["l3_code"] != node[0]
            ):
                raise StandardVersionError(
                    "matrix_identity_mismatch",
                    "matrix L3 identity mismatch",
                    [{"l3_node_id": node_id}],
                )
            validated.append(
                (
                    node_id,
                    str(node[0]),
                    str(level),
                    applicable,
                    target if isinstance(target, int) else None,
                )
            )
        if not validated:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "updated_count": 0,
                "noop": True,
            }
        pending: list[tuple[int, str, str, bool, int | None]] = []
        for node_id, code, level, applicable, target in validated:
            existing = connection.execute(
                """
                SELECT applicable, target_level
                FROM capability_standard_item
                WHERE version_id=%s AND l3_node_id=%s AND job_level=%s
                """,
                (version_id, node_id, level),
            ).fetchone()
            if (
                existing is None
                or bool(existing[0]) != applicable
                or existing[1] != target
            ):
                pending.append((node_id, code, level, applicable, target))
        if not pending:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "updated_count": 0,
                "noop": True,
            }
        for node_id, code, level, applicable, target in pending:
            context = connection.execute(
                """
                SELECT l1.code, l1.name, l2.code, l2.name, l3.name
                FROM capability_node l3 JOIN capability_node l2 ON l2.id = l3.parent_node_id
                JOIN capability_node l1 ON l1.id = l2.parent_node_id WHERE l3.id = %s
                """,
                (node_id,),
            ).fetchone()
            assert context is not None
            connection.execute(
                """
                INSERT INTO capability_standard_item
                    (version_id, l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code, l3_name,
                     job_level, applicable, target_level, source, updated_by, updated_at)
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'explicit',%s,NOW())
                ON CONFLICT (version_id, l3_node_id, job_level) DO UPDATE SET
                  applicable=EXCLUDED.applicable, target_level=EXCLUDED.target_level,
                  source='explicit', updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at
                """,
                (
                    version_id,
                    node_id,
                    *context[:4],
                    code,
                    context[4],
                    level,
                    applicable,
                    target,
                    actor_user_id,
                ),
            )
        new_revision = int(version[5]) + 1
        connection.execute(
            "UPDATE capability_standard_version SET revision=%s, updated_at=NOW() WHERE id=%s",
            (new_revision, version_id),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "edited",
            int(version[5]),
            new_revision,
            {"updated_count": len(pending)},
        )
        return {
            "version_id": version_id,
            "revision": new_revision,
            "updated_count": len(pending),
            "noop": False,
        }


_ADJACENT_COPY = {"P4": "P5", "P5": "P6", "P6": "P7", "P7": "P8"}


def copy_previous_level(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    expected_revision: int,
    from_level: str,
    to_level: str,
    l3_node_ids: Iterable[int],
) -> dict[str, object]:
    if from_level not in _ADJACENT_COPY or _ADJACENT_COPY[from_level] != to_level:
        raise StandardVersionError(
            "invalid_copy_levels",
            "only adjacent copy is allowed: P4→P5, P5→P6, P6→P7, P7→P8",
        )
    node_ids = sorted(set(l3_node_ids))
    with connection.transaction():
        version = _require_draft(connection, version_id, expected_revision)
        model_id = int(version[1])
        if not node_ids:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "updated_count": 0,
                "noop": True,
            }
        rows = connection.execute(
            """
            SELECT l3_node_id, applicable, target_level
            FROM capability_standard_item
            WHERE version_id=%s AND job_level=%s AND l3_node_id=ANY(%s)
            """,
            (version_id, from_level, node_ids),
        ).fetchall()
        if len(rows) != len(node_ids):
            raise StandardVersionError(
                "matrix_source_missing", "source matrix cells are missing"
            )
        # Collect existing targets to detect true noop
        existing_targets = {
            int(node_id): (bool(applicable), target)
            for node_id, applicable, target in connection.execute(
                """
                SELECT l3_node_id, applicable, target_level
                FROM capability_standard_item
                WHERE version_id=%s AND job_level=%s AND l3_node_id=ANY(%s)
                """,
                (version_id, to_level, node_ids),
            ).fetchall()
        }
        # Build source map
        source_map: dict[int, tuple[bool, int | None]] = {}
        for node_id, applicable, target in rows:
            source_map[int(node_id)] = (bool(applicable), target)
        # Determine actually-changed cells
        pending: list[tuple[int, bool, int | None]] = []
        for node_id, applicable, target in rows:
            nid = int(node_id)
            existing = existing_targets.get(nid)
            if existing != (bool(applicable), target):
                pending.append((nid, bool(applicable), target))
        if not pending:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "updated_count": 0,
                "noop": True,
            }
        for node_id, applicable, target in pending:
            context = connection.execute(
                """
                SELECT l1.code, l1.name, l2.code, l2.name, l3.code, l3.name
                FROM capability_node l3
                JOIN capability_node l2 ON l2.id = l3.parent_node_id
                JOIN capability_node l1 ON l1.id = l2.parent_node_id
                WHERE l3.id = %s AND l3.model_id = %s
                """,
                (node_id, model_id),
            ).fetchone()
            if context is None:
                raise StandardVersionError(
                    "matrix_identity_mismatch",
                    "matrix L3 identity mismatch",
                    [{"l3_node_id": node_id}],
                )
            connection.execute(
                """
                INSERT INTO capability_standard_item
                    (version_id, l3_node_id, l1_code, l1_name, l2_code, l2_name,
                     l3_code, l3_name, job_level, applicable, target_level, source,
                     updated_by, updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'copied', %s, NOW())
                ON CONFLICT (version_id, l3_node_id, job_level) DO UPDATE SET
                    applicable = EXCLUDED.applicable,
                    target_level = EXCLUDED.target_level,
                    source = 'copied',
                    updated_by = EXCLUDED.updated_by,
                    updated_at = EXCLUDED.updated_at
                """,
                (
                    version_id,
                    node_id,
                    *context,
                    to_level,
                    applicable,
                    target,
                    actor_user_id,
                ),
            )
        new_revision = int(version[5]) + 1
        connection.execute(
            "UPDATE capability_standard_version SET revision=%s,updated_at=NOW() WHERE id=%s",
            (new_revision, version_id),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "edited",
            int(version[5]),
            new_revision,
            {
                "copied_from": from_level,
                "copied_to": to_level,
                "updated_count": len(pending),
            },
        )
        return {
            "version_id": version_id,
            "revision": new_revision,
            "updated_count": len(pending),
            "noop": False,
        }


def catalog_drift(connection: psycopg.Connection, version_id: int) -> dict[str, object]:
    version = _version(connection, version_id)
    model_id = int(version[1])
    current = {
        int(row[0]): row
        for row in connection.execute(
            """
            SELECT l3.id, l1.code, l1.name, l2.code, l2.name, l3.code, l3.name, l3.enabled
            FROM capability_node l3 JOIN capability_node l2 ON l2.id=l3.parent_node_id
            JOIN capability_node l1 ON l1.id=l2.parent_node_id
            WHERE l3.model_id=%s AND l3.node_type='L3'
            """,
            (model_id,),
        ).fetchall()
    }
    snapshots = {
        int(row[0]): row
        for row in connection.execute(
            """SELECT DISTINCT l3_node_id,l1_code,l1_name,l2_code,l2_name,l3_code,l3_name
               FROM capability_standard_item WHERE version_id=%s""",
            (version_id,),
        ).fetchall()
    }
    added = [
        {"l3_node_id": node_id, "l3_code": row[5], "l3_name": row[6]}
        for node_id, row in current.items()
        if bool(row[7]) and node_id not in snapshots
    ]
    disabled = [
        {"l3_node_id": node_id, "l3_code": row[5] if row else snapshot[5]}
        for node_id, snapshot in snapshots.items()
        if (row := current.get(node_id)) is None or not bool(row[7])
    ]
    renamed = [
        {"l3_node_id": node_id, "before": snapshot[1:], "after": row[1:7]}
        for node_id, snapshot in snapshots.items()
        if (row := current.get(node_id)) is not None
        and tuple(snapshot[1:]) != tuple(row[1:7])
    ]
    return {
        "version_id": version_id,
        "has_drift": bool(added or disabled or renamed),
        "added_enabled_l3": added,
        "disabled_l3": disabled,
        "renamed_or_moved_l3": renamed,
    }


def _planning_snapshot_table_exists(connection: psycopg.Connection) -> bool:
    row = connection.execute(
        """
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'capability_standard_planning_snapshot'
        """
    ).fetchone()
    return row is not None


def _ensure_planning_snapshots(connection: psycopg.Connection, version_id: int) -> int:
    """Fill missing planning snapshots for every L3 present in the version.

    Existing snapshots are never overwritten (immutability: published versions
    are frozen at the DB level; drafts keep the first captured value).
    Versions managed before v0009 (no snapshot table) are left untouched.
    """
    if not _planning_snapshot_table_exists(connection):
        return 0
    node_ids = connection.execute(
        """
        SELECT DISTINCT l3_node_id FROM capability_standard_item
        WHERE version_id = %s ORDER BY l3_node_id
        """,
        (version_id,),
    ).fetchall()
    captured = 0
    for (node_id,) in node_ids:
        existing = connection.execute(
            """
            SELECT 1 FROM capability_standard_planning_snapshot
            WHERE capability_standard_version_id = %s AND l3_node_id = %s
            """,
            (version_id, node_id),
        ).fetchone()
        if existing is None:
            result = capture_planning_snapshot(
                connection, version_id, int(node_id), "version_publish"
            )
            if result is not None:
                captured += 1
    return captured


def _assert_planning_snapshots_complete(
    connection: psycopg.Connection, version_id: int
) -> None:
    """Publish gate: every L3 in the version has exactly one planning snapshot."""
    if not _planning_snapshot_table_exists(connection):
        return
    row = connection.execute(
        """
        SELECT
            (SELECT COUNT(DISTINCT l3_node_id) FROM capability_standard_item
             WHERE version_id = %s) AS item_nodes,
            (SELECT COUNT(*) FROM capability_standard_planning_snapshot
             WHERE capability_standard_version_id = %s) AS snapshot_rows
        """,
        (version_id, version_id),
    ).fetchone()
    item_nodes, snapshot_rows = (int(row[0] or 0), int(row[1] or 0))
    if item_nodes != snapshot_rows:
        raise StandardVersionError(
            "planning_snapshot_incomplete",
            "every enabled L3 requires exactly one planning snapshot",
            [{"item_nodes": item_nodes, "snapshot_rows": snapshot_rows}],
        )


def reconcile_catalog(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        version = _require_draft(connection, version_id, expected_revision)
        _ensure_planning_snapshots(connection, version_id)
        drift = catalog_drift(connection, version_id)
        if not drift["has_drift"]:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "noop": True,
                "drift": drift,
            }
        removed = [row["l3_node_id"] for row in drift["disabled_l3"]]
        changed = drift["renamed_or_moved_l3"]
        # True noop: only added_enabled_l3, nothing to actually reconcile
        if not removed and not changed:
            return {
                "version_id": version_id,
                "revision": int(version[5]),
                "noop": True,
                "drift": drift,
            }
        if removed:
            connection.execute(
                "DELETE FROM capability_standard_item WHERE version_id=%s AND l3_node_id=ANY(%s)",
                (version_id, removed),
            )
            # Draft snapshots follow their L3 items (published versions are
            # frozen by the v0009 immutability trigger and never touched here).
            connection.execute(
                "DELETE FROM capability_standard_planning_snapshot "
                "WHERE capability_standard_version_id=%s AND l3_node_id=ANY(%s)",
                (version_id, removed),
            )
        for change in changed:
            node_id = change["l3_node_id"]
            row = connection.execute(
                """SELECT l1.code,l1.name,l2.code,l2.name,l3.code,l3.name FROM capability_node l3
                JOIN capability_node l2 ON l2.id=l3.parent_node_id JOIN capability_node l1 ON l1.id=l2.parent_node_id
                WHERE l3.id=%s""",
                (node_id,),
            ).fetchone()
            assert row is not None
            connection.execute(
                """UPDATE capability_standard_item SET l1_code=%s,l1_name=%s,l2_code=%s,l2_name=%s,l3_code=%s,l3_name=%s,
                updated_by=%s,updated_at=NOW() WHERE version_id=%s AND l3_node_id=%s""",
                (*row, actor_user_id, version_id, node_id),
            )
        new_revision = int(version[5]) + 1
        connection.execute(
            "UPDATE capability_standard_version SET revision=%s,updated_at=NOW() WHERE id=%s",
            (new_revision, version_id),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "reconciled",
            int(version[5]),
            new_revision,
            {
                "removed_disabled_l3": len(removed),
                "refreshed_l3": len(changed),
                "missing_enabled_l3": len(drift["added_enabled_l3"]),
            },
        )
        return {
            "version_id": version_id,
            "revision": new_revision,
            "noop": False,
            "drift": catalog_drift(connection, version_id),
        }


def publish_version(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        version = _require_draft(connection, version_id, expected_revision)
        drift = catalog_drift(connection, version_id)
        if drift["has_drift"]:
            raise StandardVersionError(
                "catalog_drift_unreconciled",
                "catalog drift must be reconciled",
                [{"rule": "catalog_drift"}],
            )
        validation = validate_version(connection, version_id)
        if not validation["valid"]:
            raise StandardVersionError(
                "standard_version_invalid",
                "standard version is invalid",
                validation["issues"],
            )
        # Fill any remaining snapshot gaps, then require exactly one snapshot
        # per L3 before freezing the version.
        _ensure_planning_snapshots(connection, version_id)
        _assert_planning_snapshots_complete(connection, version_id)
        previous = connection.execute(
            "SELECT id,revision FROM capability_standard_version WHERE model_id=%s AND status='已发布' FOR UPDATE",
            (version[1],),
        ).fetchone()
        if previous is not None:
            connection.execute(
                "UPDATE capability_standard_version SET status='已归档',archived_at=NOW(),archived_by=%s,updated_at=NOW() WHERE id=%s",
                (actor_user_id, previous[0]),
            )
            _audit(
                connection,
                int(previous[0]),
                actor_user_id,
                "archived",
                int(previous[1]),
                int(previous[1]),
                {"reason": "superseded"},
            )
        new_revision = int(version[5]) + 1
        connection.execute(
            "UPDATE capability_standard_version SET status='已发布',published_by=%s,published_at=NOW(),revision=%s,updated_at=NOW() WHERE id=%s",
            (actor_user_id, new_revision, version_id),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "published",
            int(version[5]),
            new_revision,
            {"replaced_version_id": previous[0] if previous else None},
        )
        return {
            "version_id": version_id,
            "revision": new_revision,
            "status": "已发布",
            "archived_version_id": previous[0] if previous else None,
        }


def publish_preview(
    connection: psycopg.Connection, version_id: int
) -> dict[str, object]:
    version = _version(connection, version_id)
    if version[4] != "草稿":
        raise StandardVersionError(
            "standard_version_not_draft", "standard version is not a draft"
        )
    drift = catalog_drift(connection, version_id)
    validation = validate_version(connection, version_id)
    try:
        _ensure_planning_snapshots(connection, version_id)
        _assert_planning_snapshots_complete(connection, version_id)
        snapshots_ok = True
    except StandardVersionError:
        snapshots_ok = False
    return {
        "version_id": version_id,
        "revision": int(version[5]),
        "can_publish": (
            not drift["has_drift"] and bool(validation["valid"]) and snapshots_ok
        ),
        "catalog_drift": drift,
        "validation": validation,
        "planning_snapshots_ok": snapshots_ok,
    }


def abandon_draft(
    connection: psycopg.Connection,
    version_id: int,
    actor_user_id: int,
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        version = _require_draft(connection, version_id, expected_revision)
        new_revision = int(version[5]) + 1
        connection.execute(
            """
            UPDATE capability_standard_version
            SET status='已归档', archived_at=NOW(), archived_by=%s,
                revision=%s, updated_at=NOW()
            WHERE id=%s
            """,
            (actor_user_id, new_revision, version_id),
        )
        _audit(
            connection,
            version_id,
            actor_user_id,
            "abandoned",
            int(version[5]),
            new_revision,
            {},
        )
        return {"version_id": version_id, "revision": new_revision, "status": "已归档"}


def published_matrix_for_model(
    connection: psycopg.Connection, model_id: int, job_level: str
) -> tuple[int, list[tuple[Any, ...]]]:
    if job_level not in JOB_LEVELS:
        raise StandardVersionError("invalid_job_level", "invalid member job level")
    _lock_model(connection, model_id, shared=True)
    version = connection.execute(
        "SELECT id FROM capability_standard_version WHERE model_id=%s AND status='已发布'",
        (model_id,),
    ).fetchone()
    if version is None:
        raise StandardVersionError(
            "published_standard_not_found", "published standard not found"
        )
    rows = connection.execute(
        """SELECT n.code,i.applicable,i.target_level,i.source FROM capability_node n
        LEFT JOIN capability_standard_item i ON i.l3_node_id=n.id AND i.version_id=%s AND i.job_level=%s
        WHERE n.model_id=%s AND n.node_type='L3' AND n.enabled=TRUE ORDER BY n.code""",
        (version[0], job_level, model_id),
    ).fetchall()
    if len(rows) != len({row[0] for row in rows}) or any(
        row[1] is None for row in rows
    ):
        raise StandardVersionError(
            "published_standard_incomplete", "published standard matrix is incomplete"
        )
    return int(version[0]), rows
