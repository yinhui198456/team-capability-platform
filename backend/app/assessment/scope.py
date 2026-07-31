"""Deterministic assessment scope computation for scope-v1.

Preview and Create share this module as the only range source.  A scope is
frozen by its ``scope_token`` fingerprint; any change to the published
standard version, the member's job levels, or the resulting item set changes
the fingerprint and therefore the token.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any

import psycopg

SCOPE_ALGORITHM_VERSION = "scope-v1"
JOB_LEVELS = ("P4", "P5", "P6", "P7", "P8")


class AssessmentScopeError(ValueError):
    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 422,
        issues: list[dict[str, object]] | None = None,
        summary: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.issues = issues or []
        self.summary = summary


def _is_job_level(value: object) -> bool:
    return isinstance(value, str) and value in JOB_LEVELS


def _member_levels(
    connection: psycopg.Connection, member_id: int, *, lock: bool
) -> tuple[str, str]:
    suffix = " FOR UPDATE" if lock else ""
    row = connection.execute(
        "SELECT current_level, target_level FROM tcp_user WHERE id = %s" + suffix,
        (member_id,),
    ).fetchone()
    if row is None:
        raise AssessmentScopeError(
            "member_not_found", "member not found", status_code=404
        )
    current_level, target_level = row
    if not _is_job_level(current_level):
        raise AssessmentScopeError(
            "invalid_member_level",
            "member current_level is required",
            issues=[{"field": "current_level", "value": current_level}],
        )
    if not _is_job_level(target_level):
        raise AssessmentScopeError(
            "invalid_member_level",
            "member target_level is required",
            issues=[{"field": "target_level", "value": target_level}],
        )
    if int(str(current_level)[1:]) > int(str(target_level)[1:]):
        raise AssessmentScopeError(
            "member_level_regression",
            "member current_level cannot exceed target_level",
            issues=[
                {"field": "current_level", "value": current_level},
                {"field": "target_level", "value": target_level},
            ],
        )
    return str(current_level), str(target_level)


def _published_version(
    connection: psycopg.Connection, model_id: int
) -> tuple[int, str]:
    row = connection.execute(
        """
        SELECT id, label FROM capability_standard_version
        WHERE model_id = %s AND status = '已发布'
        """,
        (model_id,),
    ).fetchone()
    if row is None:
        raise AssessmentScopeError(
            "published_standard_not_found", "published standard not found"
        )
    return int(row[0]), str(row[1])


def compute_assessment_scope(
    connection: psycopg.Connection,
    *,
    member_id: int,
    year: int,
    assessment_type: str,
    lock_member: bool = False,
) -> dict[str, Any]:
    """Compute the deterministic scope for a member's new assessment.

    Lock discipline is owned by the caller; this function only reads.  The
    create path takes the model lock and the member row lock itself; the
    preview path relies on its REPEATABLE READ snapshot.  ``lock_member``
    pins the member row for the create path.
    """
    model = connection.execute(
        "SELECT id FROM capability_model ORDER BY id LIMIT 1"
    ).fetchone()
    if model is None:
        raise AssessmentScopeError(
            "capability_model_not_found",
            "capability model not found",
            status_code=404,
        )
    model_id = int(model[0])
    current_level, target_level = _member_levels(
        connection, member_id, lock=lock_member
    )
    version_id, version_label = _published_version(connection, model_id)

    rows = connection.execute(
        """
        SELECT n.id, n.code, n.name,
               l2.code AS l2_code, l2.name AS l2_name,
               l1.code AS l1_code, l1.name AS l1_name,
               ic.applicable, ic.target_level, ic.source,
               it.applicable, it.target_level, it.source
        FROM capability_node AS n
        JOIN capability_node AS l2 ON l2.id = n.parent_node_id
        JOIN capability_node AS l1 ON l1.id = l2.parent_node_id
        LEFT JOIN capability_standard_item AS ic
          ON ic.l3_node_id = n.id AND ic.version_id = %s AND ic.job_level = %s
        LEFT JOIN capability_standard_item AS it
          ON it.l3_node_id = n.id AND it.version_id = %s AND it.job_level = %s
        WHERE n.model_id = %s AND n.node_type = 'L3' AND n.enabled = TRUE
        ORDER BY l1.sort_order, l2.sort_order, n.sort_order
        """,
        (version_id, current_level, version_id, target_level, model_id),
    ).fetchall()

    items: list[dict[str, Any]] = []
    for row in rows:
        (
            node_id,
            code,
            name,
            l2_code,
            l2_name,
            l1_code,
            l1_name,
            c_applicable,
            c_target,
            c_source,
            t_applicable,
            t_target,
            t_source,
        ) = row
        if c_applicable is None or t_applicable is None:
            raise AssessmentScopeError(
                "published_standard_incomplete",
                "published standard matrix is incomplete",
                issues=[{"l3_node_id": int(node_id), "l3_code": str(code)}],
            )
        if bool(c_applicable):
            scope_type = "current_required"
            job_level_snapshot = current_level
            standard_target = int(c_target)
            source = str(c_source)
        elif bool(t_applicable):
            scope_type = "target_progressive"
            job_level_snapshot = target_level
            standard_target = int(t_target)
            source = str(t_source)
        else:
            continue
        items.append(
            {
                "l3_node_id": int(node_id),
                "l3_code": str(code),
                "l3_name": str(name),
                "l2_code": str(l2_code),
                "l2_name": str(l2_name),
                "l1_code": str(l1_code),
                "l1_name": str(l1_name),
                "scope_type": scope_type,
                "standard_job_level_snapshot": job_level_snapshot,
                "standard_target_level": standard_target,
                "source": source,
            }
        )

    by_l1: dict[str, dict[str, Any]] = {}
    for item in items:
        bucket = by_l1.setdefault(
            str(item["l1_code"]),
            {
                "l1_code": item["l1_code"],
                "l1_name": item["l1_name"],
                "current_required": 0,
                "target_progressive": 0,
                "total": 0,
            },
        )
        bucket[str(item["scope_type"])] += 1
        bucket["total"] += 1
    current_required = sum(
        1 for item in items if item["scope_type"] == "current_required"
    )
    summary: dict[str, Any] = {
        "total": len(items),
        "current_required": current_required,
        "target_progressive": len(items) - current_required,
        "by_l1": [by_l1[code] for code in sorted(by_l1)],
    }

    fingerprint_payload = {
        "member_id": member_id,
        "year": year,
        "assessment_type": assessment_type,
        "current_level": current_level,
        "target_level": target_level,
        "standard_version_id": version_id,
        "scope_version": SCOPE_ALGORITHM_VERSION,
        "items": [
            [item["l3_node_id"], item["scope_type"], item["standard_target_level"]]
            for item in sorted(items, key=lambda entry: int(entry["l3_node_id"]))
        ],
    }
    scope_token = hashlib.sha256(
        json.dumps(fingerprint_payload, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()

    return {
        "member_id": member_id,
        "year": year,
        "assessment_type": assessment_type,
        "member_current_level": current_level,
        "member_target_level": target_level,
        "standard_version": {"id": version_id, "label": version_label},
        "scope_version": SCOPE_ALGORITHM_VERSION,
        "items": items,
        "summary": summary,
        "empty_scope": len(items) == 0,
        "scope_token": scope_token,
    }
