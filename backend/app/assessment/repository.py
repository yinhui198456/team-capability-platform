import hashlib
import json
from typing import Any

import psycopg

from ..access.repository import (
    get_primary_buddy,
    is_current_responsible_buddy,
)
from ..catalog.repository import DOMAIN_CODES, get_l3_contexts
from .scope import AssessmentScopeError, compute_assessment_scope


class AssessmentValidationError(ValueError):
    def __init__(
        self,
        l3_code: str,
        reason: str,
        message: str,
        *,
        l3_node_id: int | None = None,
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = "assessment_validation_failed"
        self.l3_code = l3_code
        self.l3_node_id = l3_node_id
        self.field = field
        self.reason = reason


class ReviewError(ValueError):
    """Structured Review write failure (409/422/403).

    ``status_code`` is the HTTP status the API should return; never a 500 and
    never a raw database constraint exception.
    """

    def __init__(
        self,
        code: str,
        message: str,
        *,
        status_code: int = 409,
        l3_node_id: int | None = None,
        l3_code: str | None = None,
        field: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status_code = status_code
        self.l3_node_id = l3_node_id
        self.l3_code = l3_code
        self.field = field


class DetailValidationError(ValueError):
    """Business-rule violation during draft save/patch."""

    def __init__(
        self,
        code: str,
        message: str,
        *,
        l3_node_id: int | None = None,
        l3_code: str | None = None,
        field: str | None = None,
        reason: str | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.l3_node_id = l3_node_id
        self.l3_code = l3_code
        self.field = field
        self.reason = reason


class DraftTargetRepairError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


_JOB_LEVELS = ("P4", "P5", "P6", "P7", "P8")


def _is_job_level(value: object) -> bool:
    return isinstance(value, str) and value in _JOB_LEVELS


def _repair_l3_lookup_codes(code: str) -> tuple[str, ...]:
    return tuple(dict.fromkeys((code, code.replace("-", "."), code.replace(".", "-"))))


def _draft_repair_baseline(
    connection: psycopg.Connection, model_id: int
) -> tuple[int, int] | None:
    rows = connection.execute(
        """
        SELECT id, version_no
        FROM capability_standard_version
        WHERE model_id = %s AND status = '已发布' AND label = 'Legacy Baseline v1'
        ORDER BY id
        """,
        (model_id,),
    ).fetchall()
    if len(rows) != 1:
        return None
    return int(rows[0][0]), int(rows[0][1])


def _draft_repair_profile(
    row: tuple[object, ...],
) -> tuple[str | None, str | None, str | None, str | None]:
    snapshot_current, snapshot_target, profile_current, profile_target = row
    current = (
        str(snapshot_current)
        if _is_job_level(snapshot_current)
        else str(profile_current) if _is_job_level(profile_current) else None
    )
    target = (
        str(snapshot_target)
        if _is_job_level(snapshot_target)
        else str(profile_target) if _is_job_level(profile_target) else None
    )
    current_source = (
        "assessment_snapshot"
        if _is_job_level(snapshot_current)
        else "repair_time_user_profile" if current is not None else None
    )
    target_source = (
        "assessment_snapshot"
        if _is_job_level(snapshot_target)
        else "repair_time_user_profile" if target is not None else None
    )
    if current is None or target is None or int(current[1:]) > int(target[1:]):
        return None, None, current_source, target_source
    return current, target, current_source, target_source


def _draft_repair_detail_rows(
    connection: psycopg.Connection, assessment_id: int
) -> list[tuple[object, ...]]:
    return connection.execute(
        """
        SELECT id, l3_code, current_level, current_level_explicitly_cleared,
               target_level, standard_target_applicable, standard_target_level,
               target_adjusted, adjusted_target_level, target_adjustment_reason,
               target_snapshot_source, target_compatibility_error, gap_value,
               evidence_note, plan_candidate
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()


def _canonical_l3_code(code: str) -> str:
    return code.replace("-", ".")


def _draft_repair_gap_rows(
    connection: psycopg.Connection, assessment_id: int
) -> list[tuple[object, ...]]:
    return connection.execute(
        """
            SELECT id, l3_code, current_level, target_level, gap_value,
                   priority, plan_candidate
            FROM gap WHERE assessment_id = %s
            ORDER BY l3_code
            """,
        (assessment_id,),
    ).fetchall()


def _baseline_item_for_detail(
    connection: psycopg.Connection,
    version_id: int,
    l3_code: str,
    job_level: str,
) -> tuple[bool, int | None] | None:
    rows = connection.execute(
        """
        SELECT applicable, target_level
        FROM capability_standard_item
        WHERE version_id = %s AND l3_code = ANY(%s) AND job_level = %s
        ORDER BY l3_code
        """,
        (version_id, list(_repair_l3_lookup_codes(l3_code)), job_level),
    ).fetchall()
    if len(rows) != 1:
        return None
    return bool(rows[0][0]), rows[0][1]


def get_draft_target_repair_preview(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object]:
    """Build a strictly read-only repair plan for one legacy draft."""
    assessment = connection.execute(
        """
        SELECT a.id, a.status, a.revision, a.member_id,
               a.member_current_level_snapshot, a.member_target_level_snapshot,
               a.capability_standard_version_id, u.current_level, u.target_level
        FROM assessment a JOIN tcp_user u ON u.id = a.member_id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchone()
    if assessment is None:
        raise DraftTargetRepairError("assessment_not_found", "assessment not found")
    (
        _,
        status,
        revision,
        member_id,
        snapshot_current,
        snapshot_target,
        existing_version_id,
        profile_current,
        profile_target,
    ) = assessment
    if status not in ("草稿", "建议调整"):
        raise DraftTargetRepairError(
            "draft_repair_state_conflict", "assessment is not repairable"
        )

    current_job, target_job, current_source, target_source = _draft_repair_profile(
        (snapshot_current, snapshot_target, profile_current, profile_target)
    )
    rows = _draft_repair_detail_rows(connection, assessment_id)
    raw_gaps = _draft_repair_gap_rows(connection, assessment_id)
    details: list[dict[str, object]] = []
    summary = {
        "rebuild_count": 0,
        "preserve_count": 0,
        "not_applicable_count": 0,
        "unrepairable_count": 0,
        "actionable_count": 0,
    }
    detail_models: set[int] = set()
    ambiguous = False
    for row in rows:
        matches = connection.execute(
            """
            SELECT id, model_id FROM capability_node
            WHERE node_type = 'L3' AND code = ANY(%s)
            """,
            (list(_repair_l3_lookup_codes(str(row[1]))),),
        ).fetchall()
        if len(matches) != 1:
            ambiguous = True
        else:
            detail_models.add(int(matches[0][1]))
    model_id = next(iter(detail_models)) if len(detail_models) == 1 else None
    baseline = (
        _draft_repair_baseline(connection, model_id) if model_id is not None else None
    )
    detail_codes = [_canonical_l3_code(str(row[1])) for row in rows]
    gap_codes = [_canonical_l3_code(str(row[1])) for row in raw_gaps]
    gaps = {code: row for code, row in zip(gap_codes, raw_gaps, strict=True)}
    gap_invalid = (
        len(set(detail_codes)) != len(detail_codes)
        or len(set(gap_codes)) != len(gap_codes)
        or not set(gap_codes).issubset(set(detail_codes))
    )
    if (
        ambiguous
        or model_id is None
        or gap_invalid
        or baseline is None
        or current_job is None
        or target_job is None
    ):
        reason = (
            "明细或 Gap 无法唯一映射到同一能力模型"
            if ambiguous or model_id is None or gap_invalid
            else (
                "缺少该能力模型唯一已发布 Legacy Baseline v1"
                if baseline is None
                else "成员当前职级或目标职级不可追溯"
            )
        )
        for row in rows:
            details.append(
                {
                    "id": row[0],
                    "l3_code": row[1],
                    "action": "unrepairable",
                    "reason": reason,
                }
            )
        summary["unrepairable_count"] = max(len(details), 1)
        return {
            "assessment_id": assessment_id,
            "status": status,
            "revision": int(revision),
            "member_id": int(member_id),
            "member_current_level": {"value": current_job, "source": current_source},
            "member_target_level": {"value": target_job, "source": target_source},
            "standard_version": None,
            "summary": summary,
            "details": details,
            "unrepairable_details": details,
            "needs_assessment_update": True,
            "is_noop": False,
        }

    version_id, version_no = baseline
    needs_assessment_update = (
        snapshot_current != current_job
        or snapshot_target != target_job
        or existing_version_id != version_id
    )
    for row in rows:
        (
            detail_id,
            l3_code,
            current_level,
            explicitly_cleared,
            target_level,
            standard_applicable,
            standard_target,
            target_adjusted,
            adjusted_target,
            adjustment_reason,
            snapshot_source,
            compatibility_error,
            gap_value,
            evidence_note,
            plan_candidate,
        ) = row
        baseline_item = _baseline_item_for_detail(
            connection, version_id, str(l3_code), target_job
        )
        reason: str | None = None
        action = "rebuild"
        expected_applicable: bool | None = None
        expected_standard: int | None = None
        expected_target: int | None = None
        expected_gap: int | None = None
        existing_gap_id: int | None = None
        if baseline_item is None:
            reason = "L3 无法唯一映射到 Legacy Baseline v1"
        else:
            expected_applicable, expected_standard = baseline_item
            if not expected_applicable:
                if (
                    current_level is not None
                    or bool(target_adjusted)
                    or adjusted_target is not None
                    or adjustment_reason is not None
                    or bool(plan_candidate)
                    or str(l3_code) in gaps
                ):
                    reason = "不适用明细含有不能安全清空的业务值"
                else:
                    action = "not_applicable"
            elif bool(target_adjusted):
                if (
                    not isinstance(adjusted_target, int)
                    or isinstance(adjusted_target, bool)
                    or not 1 <= adjusted_target <= 5
                    or not isinstance(adjustment_reason, str)
                    or not adjustment_reason.strip()
                ):
                    reason = "个人调整不完整，不能确定生效目标"
                else:
                    expected_target = int(adjusted_target)
            elif adjusted_target is not None or adjustment_reason is not None:
                reason = "未启用的个人调整含有残留字段"
            else:
                expected_target = expected_standard

            if reason is None and expected_applicable:
                expected_gap = (
                    max(int(expected_target) - int(current_level), 0)
                    if current_level is not None
                    else None
                )
                if bool(plan_candidate) and (
                    current_level is None or expected_gap is None or expected_gap <= 0
                ):
                    reason = "计划候选与重建后的目标不一致"
                existing_gap = gaps.get(_canonical_l3_code(str(l3_code)))
                existing_gap_id = (
                    int(existing_gap[0]) if existing_gap is not None else None
                )
                if existing_gap is not None and expected_gap != int(existing_gap[4]):
                    if expected_gap is None or expected_gap <= 0:
                        reason = "既有 Gap 不能在修复中删除"

        if reason is not None:
            action = "unrepairable"
            summary["unrepairable_count"] += 1
        else:
            existing_gap = gaps.get(_canonical_l3_code(str(l3_code)))
            existing_gap_id = int(existing_gap[0]) if existing_gap is not None else None
            gap_matches = (
                (expected_gap is None or expected_gap <= 0) and existing_gap is None
            ) or (
                expected_gap is not None
                and expected_gap > 0
                and existing_gap is not None
                and int(existing_gap[2]) == int(current_level)
                and int(existing_gap[3]) == int(expected_target)
                and int(existing_gap[4]) == expected_gap
                and bool(existing_gap[6]) == bool(plan_candidate)
            )
            detail_matches = (
                standard_applicable is expected_applicable
                and standard_target == expected_standard
                and target_level == expected_target
                and gap_value == expected_gap
                and snapshot_source == "legacy_baseline_v1_repaired"
                and compatibility_error is None
            )
            if action == "not_applicable":
                summary["not_applicable_count"] += 1
            if detail_matches and gap_matches:
                action = "preserve"
                summary["preserve_count"] += 1
            else:
                summary["rebuild_count"] += 1
                summary["actionable_count"] += 1
        details.append(
            {
                "id": int(detail_id),
                "l3_code": str(l3_code),
                "action": action,
                "reason": reason,
                "current_level": current_level,
                "current_level_explicitly_cleared": bool(explicitly_cleared),
                "target_adjusted": bool(target_adjusted),
                "adjusted_target_level": adjusted_target,
                "target_adjustment_reason": adjustment_reason,
                "evidence_note": evidence_note,
                "plan_candidate": bool(plan_candidate),
                "expected_applicable": expected_applicable,
                "expected_standard_target_level": expected_standard,
                "expected_target_level": expected_target,
                "expected_gap_value": expected_gap,
                "existing_gap_id": existing_gap_id,
                "needs_gap_update": reason is None and action != "preserve",
            }
        )
    if needs_assessment_update:
        summary["actionable_count"] += 1
    return {
        "assessment_id": assessment_id,
        "status": status,
        "revision": int(revision),
        "member_id": int(member_id),
        "member_current_level": {"value": current_job, "source": current_source},
        "member_target_level": {"value": target_job, "source": target_source},
        "standard_version": {
            "id": version_id,
            "version_no": version_no,
            "status": "已发布",
            "source": "legacy_derived",
        },
        "summary": summary,
        "details": details,
        "unrepairable_details": [
            detail for detail in details if detail["action"] == "unrepairable"
        ],
        "needs_assessment_update": needs_assessment_update,
        "is_noop": summary["unrepairable_count"] == 0
        and summary["rebuild_count"] == 0
        and not needs_assessment_update,
    }


def repair_draft_target_snapshots(
    connection: psycopg.Connection,
    assessment_id: int,
    actor_user_id: int,
    *,
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        locked = connection.execute(
            """
            SELECT status, member_id, revision, member_current_level_snapshot,
                   member_target_level_snapshot, capability_standard_version_id
            FROM assessment WHERE id = %s FOR UPDATE
            """,
            (assessment_id,),
        ).fetchone()
        if locked is None:
            raise DraftTargetRepairError("assessment_not_found", "assessment not found")
        status, _, revision, old_current, old_target, old_version = locked
        if status not in ("草稿", "建议调整"):
            raise DraftTargetRepairError(
                "draft_repair_state_conflict", "assessment is not repairable"
            )
        if int(revision) != expected_revision:
            raise DraftTargetRepairError(
                "draft_repair_revision_conflict", "assessment revision has changed"
            )
        preview = get_draft_target_repair_preview(connection, assessment_id)
        if int(preview["summary"]["unrepairable_count"]) > 0:
            raise DraftTargetRepairError(
                "draft_repair_has_unrepairable_details",
                "assessment has unrepairable draft details",
            )
        if bool(preview["is_noop"]):
            return {
                "result": "noop",
                "assessment_id": assessment_id,
                "old_revision": int(revision),
                "revision": int(revision),
                "audit_id": None,
                "summary": preview["summary"],
                "unrepairable_details": [],
            }

        for detail in preview["details"]:
            if detail["action"] == "preserve":
                continue
            connection.execute(
                """
                UPDATE assessment_detail
                SET standard_target_applicable = %s,
                    standard_target_level = %s,
                    target_level = %s,
                    gap_value = %s,
                    target_snapshot_source = 'legacy_baseline_v1_repaired',
                    target_compatibility_error = NULL
                WHERE id = %s
                """,
                (
                    detail["expected_applicable"],
                    detail["expected_standard_target_level"],
                    detail["expected_target_level"],
                    detail["expected_gap_value"],
                    detail["id"],
                ),
            )
            expected_gap = detail["expected_gap_value"]
            if expected_gap is not None and int(expected_gap) > 0:
                existing_gap_id = detail["existing_gap_id"]
                if existing_gap_id is None:
                    connection.execute(
                        """
                        INSERT INTO gap (
                            assessment_id, l3_code, current_level, target_level,
                            gap_value, plan_candidate
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                        """,
                        (
                            assessment_id,
                            detail["l3_code"],
                            detail["current_level"],
                            detail["expected_target_level"],
                            expected_gap,
                            detail["plan_candidate"],
                        ),
                    )
                else:
                    connection.execute(
                        """
                        UPDATE gap
                        SET current_level = %s,
                            target_level = %s,
                            gap_value = %s,
                            plan_candidate = %s
                        WHERE id = %s
                        """,
                        (
                            detail["current_level"],
                            detail["expected_target_level"],
                            expected_gap,
                            detail["plan_candidate"],
                            existing_gap_id,
                        ),
                    )
        new_revision = int(revision) + 1
        standard_version = preview["standard_version"]
        assert isinstance(standard_version, dict)
        current_job = preview["member_current_level"]
        target_job = preview["member_target_level"]
        assert isinstance(current_job, dict) and isinstance(target_job, dict)
        connection.execute(
            """
            UPDATE assessment
            SET member_current_level_snapshot = %s,
                member_target_level_snapshot = %s,
                capability_standard_version_id = %s,
                revision = %s
            WHERE id = %s
            """,
            (
                current_job["value"],
                target_job["value"],
                standard_version["id"],
                new_revision,
                assessment_id,
            ),
        )
        audit = connection.execute(
            """
            INSERT INTO assessment_draft_target_repair_audit (
                assessment_id, actor_user_id, old_revision, new_revision,
                old_current_level_source, new_current_level_source,
                old_target_level_source, new_target_level_source,
                old_standard_version_id, new_standard_version_id, result, summary
            ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'repaired', %s::jsonb)
            RETURNING id
            """,
            (
                assessment_id,
                actor_user_id,
                int(revision),
                new_revision,
                "assessment_snapshot" if _is_job_level(old_current) else None,
                current_job["source"],
                "assessment_snapshot" if _is_job_level(old_target) else None,
                target_job["source"],
                old_version,
                standard_version["id"],
                json.dumps(preview["summary"]),
            ),
        ).fetchone()
        assert audit is not None
        return {
            "result": "repaired",
            "assessment_id": assessment_id,
            "old_revision": int(revision),
            "revision": new_revision,
            "audit_id": int(audit[0]),
            "summary": preview["summary"],
            "unrepairable_details": [],
        }


def _now(connection: psycopg.Connection) -> Any:
    return connection.execute("SELECT NOW()").fetchone()[0]


def _scope_response(
    scope: dict[str, Any], assessment_id: int, revision: int
) -> dict[str, Any]:
    return {
        "id": assessment_id,
        "revision": revision,
        "scope_version": scope["scope_version"],
        "member_current_level": scope["member_current_level"],
        "member_target_level": scope["member_target_level"],
        "standard_version": scope["standard_version"],
        "summary": scope["summary"],
        "scope_token": scope["scope_token"],
    }


def create_assessment_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    assessment_type: str = "年度",
    *,
    scope_token: str,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    # Fingerprint from request identity only — independent of current domain state.
    fingerprint = hashlib.sha256(
        json.dumps(
            {
                "year": year,
                "assessment_type": assessment_type,
                "scope_token": scope_token,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode()
    ).hexdigest()

    with connection.transaction():
        # 0. idempotency check first, before any domain recomputation.
        if idempotency_key is not None:
            existing_key = connection.execute(
                """
                SELECT request_fingerprint, response
                FROM assessment_idempotency_key
                WHERE member_id = %s AND idempotency_key = %s
                """,
                (member_id, idempotency_key),
            ).fetchone()
            if existing_key is not None:
                if str(existing_key[0]) != fingerprint:
                    raise AssessmentScopeError(
                        "idempotency_key_reused",
                        "idempotency key reused with a different request",
                        status_code=409,
                    )
                stored = existing_key[1]
                if isinstance(stored, str):
                    stored = json.loads(stored)
                return stored

        # 1. model lock → 2. member row lock → 3. assessment writes.
        model = connection.execute(
            "SELECT id FROM capability_model ORDER BY id LIMIT 1 FOR SHARE"
        ).fetchone()
        if model is None:
            raise AssessmentScopeError(
                "capability_model_not_found",
                "capability model not found",
                status_code=404,
            )
        scope = compute_assessment_scope(
            connection,
            member_id=member_id,
            year=year,
            assessment_type=assessment_type,
            lock_member=True,
        )

        # 2. Re-check idempotency after acquiring locks to close the concurrent
        #    window where two callers both pass the first check, then race to
        #    acquire locks and write.
        if idempotency_key is not None:
            existing_key = connection.execute(
                """
                SELECT request_fingerprint, response
                FROM assessment_idempotency_key
                WHERE member_id = %s AND idempotency_key = %s
                """,
                (member_id, idempotency_key),
            ).fetchone()
            if existing_key is not None:
                if str(existing_key[0]) != fingerprint:
                    raise AssessmentScopeError(
                        "idempotency_key_reused",
                        "idempotency key reused with a different request",
                        status_code=409,
                    )
                stored = existing_key[1]
                if isinstance(stored, str):
                    stored = json.loads(stored)
                return stored

        if scope_token != scope["scope_token"]:
            raise AssessmentScopeError(
                "assessment_scope_changed",
                "assessment scope changed since preview",
                status_code=409,
                summary={
                    "member_current_level": scope["member_current_level"],
                    "member_target_level": scope["member_target_level"],
                    "standard_version": scope["standard_version"],
                    "summary": scope["summary"],
                    "empty_scope": scope["empty_scope"],
                    "scope_token": scope["scope_token"],
                },
            )
        if scope["empty_scope"]:
            raise AssessmentScopeError(
                "assessment_scope_empty",
                "assessment scope is empty",
            )

        try:
            open_draft = connection.execute(
                """
                SELECT id FROM assessment
                WHERE member_id = %s AND year = %s AND assessment_type = %s
                  AND status IN ('草稿', '建议调整')
                """,
                (member_id, year, assessment_type),
            ).fetchone()
        except psycopg.errors.UniqueViolation:  # ponytail: defensive, SELECT cannot
            raise AssessmentScopeError(
                "open_draft_exists",
                "an open assessment already exists",
                status_code=409,
            ) from None
        if open_draft is not None:
            raise AssessmentScopeError(
                "open_draft_exists",
                "an open assessment already exists",
                status_code=409,
                issues=[{"assessment_id": int(open_draft[0])}],
            )

        source = get_latest_approved_assessment_for_member(connection, member_id)
        inherited_by_node: dict[int, tuple[object, ...]] = {}
        inherited_legacy_by_code: dict[str, tuple[object, ...]] = {}
        if source is not None:
            for row in connection.execute(
                """
                SELECT l3_code, current_level, evidence_note, l3_node_id
                FROM assessment_detail
                WHERE assessment_id = %s
                """,
                (source["id"],),
            ).fetchall():
                node_id = row[3]
                if node_id is not None:
                    inherited_by_node[int(node_id)] = (row[0], row[1], row[2])
                else:
                    inherited_legacy_by_code[str(row[0])] = (row[0], row[1], row[2])

        row = connection.execute(
            """
            SELECT COALESCE(MAX(version), 0) + 1
            FROM assessment
            WHERE member_id = %s AND year = %s
            """,
            (member_id, year),
        ).fetchone()
        assert row is not None
        version = row[0]

        # INSERT is the true last line of defence for the unique open-draft
        # index.  Wrap it in a savepoint so a UniqueViolation does not abort
        # the outer transaction.
        try:
            with connection.transaction():
                row = connection.execute(
                    """
                    INSERT INTO assessment (
                        member_id, year, version, assessment_type, status,
                        member_current_level_snapshot, member_target_level_snapshot,
                        capability_standard_version_id, assessment_scope_version
                    )
                    VALUES (%s, %s, %s, %s, '草稿', %s, %s, %s, %s)
                    RETURNING id
                    """,
                    (
                        member_id,
                        year,
                        version,
                        assessment_type,
                        scope["member_current_level"],
                        scope["member_target_level"],
                        scope["standard_version"]["id"],
                        scope["scope_version"],
                    ),
                ).fetchone()
                assert row is not None
                assessment_id = int(row[0])
        except psycopg.errors.UniqueViolation:
            # Concurrent winner already inserted; find its id and return 409.
            existing = connection.execute(
                """
                SELECT id FROM assessment
                WHERE member_id = %s AND year = %s AND assessment_type = %s
                  AND status IN ('草稿', '建议调整')
                ORDER BY id
                """,
                (member_id, year, assessment_type),
            ).fetchone()
            raise AssessmentScopeError(
                "open_draft_exists",
                "an open assessment already exists",
                status_code=409,
                issues=(
                    [{"assessment_id": int(existing[0])}]
                    if existing is not None
                    else []
                ),
            ) from None

        with connection.cursor() as cursor:
            cursor.executemany(
                """
                INSERT INTO assessment_detail (
                    assessment_id, l3_code, current_level, target_level,
                    standard_target_applicable, standard_target_level,
                    target_adjusted, adjusted_target_level,
                    target_adjustment_reason, target_snapshot_source,
                    target_compatibility_error, gap_value, evidence_note,
                    plan_candidate, inherited_from_assessment_id,
                    inherited_current_level, inherited_evidence_note,
                    l3_node_id, scope_type, standard_job_level_snapshot,
                    l1_code, l1_name, l2_code, l2_name, l3_name
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, FALSE, NULL, NULL, %s,
                    NULL, NULL, %s, FALSE, %s, %s, %s, %s, %s, %s,
                    %s, %s, %s, %s, %s
                )
                """,
                [
                    (
                        assessment_id,
                        item["l3_code"],
                        inherited_current,
                        item["standard_target_level"],
                        True,
                        item["standard_target_level"],
                        (
                            f"published_standard_version:"
                            f"{scope['standard_version']['id']}:{item['source']}"
                        ),
                        inherited_evidence,
                        inherited_source,
                        inherited_current,
                        inherited_evidence,
                        item["l3_node_id"],
                        item["scope_type"],
                        item["standard_job_level_snapshot"],
                        item["l1_code"],
                        item["l1_name"],
                        item["l2_code"],
                        item["l2_name"],
                        item["l3_name"],
                    )
                    for item in scope["items"]
                    for inherited_row in (
                        (
                            inherited_by_node.get(item["l3_node_id"])
                            or inherited_legacy_by_code.get(item["l3_code"])
                        ),
                    )
                    for inherited_current in (
                        (
                            inherited_row[1]
                            if inherited_row is not None
                            and inherited_row[1] is not None
                            and 1 <= int(inherited_row[1]) <= 5
                            else None
                        ),
                    )
                    for inherited_evidence in (
                        (
                            str(inherited_row[2]).strip()
                            if inherited_row is not None
                            and inherited_current is not None
                            and isinstance(inherited_row[2], str)
                            and inherited_row[2].strip()
                            else None
                        ),
                    )
                    for inherited_source in (
                        (
                            source["id"]
                            if source is not None
                            and (inherited_current is not None or inherited_evidence)
                            else None
                        ),
                    )
                ],
            )

        response = _scope_response(scope, assessment_id, 1)
        if idempotency_key is not None:
            connection.execute(
                """
                INSERT INTO assessment_idempotency_key (
                    member_id, idempotency_key, request_fingerprint,
                    assessment_id, response
                )
                VALUES (%s, %s, %s, %s, %s::jsonb)
                """,
                (
                    member_id,
                    idempotency_key,
                    fingerprint,
                    assessment_id,
                    json.dumps(response, ensure_ascii=False),
                ),
            )
        return response


def get_latest_approved_assessment_for_member(
    connection: psycopg.Connection, member_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT a.id, a.member_id, a.year, a.version, a.assessment_type,
               a.status, r.reviewed_at
        FROM assessment a
        JOIN assessment_review r ON r.assessment_id = a.id
        WHERE a.member_id = %s
          AND a.status IN ('已复核', '已归档')
          AND r.status = '已闭环'
          AND r.conclusion = '认可'
          AND r.reviewed_at = (
              SELECT MAX(r2.reviewed_at)
              FROM assessment_review r2
              WHERE r2.assessment_id = a.id
                AND r2.status = '已闭环'
          )
        ORDER BY r.reviewed_at DESC, a.id DESC
        LIMIT 1
        """,
        (member_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "version": row[3],
        "assessment_type": row[4],
        "status": row[5],
        "reviewed_at": row[6],
    }


def get_assessment(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT a.id, a.member_id, a.year, a.version, a.assessment_type, a.status,
               a.created_at, a.submitted_at, a.archived_at, a.revision,
               u.current_level, u.target_level,
               a.member_current_level_snapshot, a.member_target_level_snapshot,
               a.capability_standard_version_id, a.assessment_scope_version,
               sv.label
        FROM assessment AS a
        JOIN tcp_user AS u ON u.id = a.member_id
        LEFT JOIN capability_standard_version AS sv
          ON sv.id = a.capability_standard_version_id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchone()
    if row is None:
        return None

    details = _get_assessment_details(connection, assessment_id)
    status_value = str(row[5])
    scope_version = row[15]
    payload: dict[str, object] = {
        "id": row[0],
        "member_id": row[1],
        "year": row[2],
        "version": row[3],
        "assessment_type": row[4],
        "status": status_value,
        "created_at": row[6],
        "submitted_at": row[7],
        "archived_at": row[8],
        "revision": row[9],
        "member_current_level": row[10],
        "member_target_level": row[11],
        "member_current_level_snapshot": row[12],
        "member_target_level_snapshot": row[13],
        "capability_standard_version_id": row[14],
        "assessment_scope_version": scope_version,
        "standard_version_label": row[16],
        "details": details,
        "l2_groups": _get_assessment_l2_groups(
            connection,
            details,
            include_requirements=status_value in {"草稿", "待复核", "建议调整"},
            frozen=scope_version is not None,
        ),
        "gap_summary": _get_gap_summary(connection, assessment_id),
    }
    if scope_version is not None:
        payload["scope_summary"] = _scope_summary_from_details(details)
    else:
        payload["scope_summary"] = None
    return payload


def _scope_summary_from_details(
    details: list[dict[str, object]],
) -> dict[str, object]:
    """Frozen summary for scope-v1 assessments: details + snapshots only."""
    by_l1: dict[str, dict[str, object]] = {}
    for detail in details:
        l1_code = detail.get("l1_code")
        if not isinstance(l1_code, str):
            continue
        bucket = by_l1.setdefault(
            l1_code,
            {
                "l1_code": l1_code,
                "l1_name": detail.get("l1_name"),
                "current_required": 0,
                "target_progressive": 0,
                "total": 0,
            },
        )
        scope_type = detail.get("scope_type")
        if scope_type in ("current_required", "target_progressive"):
            bucket[str(scope_type)] += 1  # type: ignore[operator]
        bucket["total"] += 1  # type: ignore[operator]
    current_required = sum(
        1 for detail in details if detail.get("scope_type") == "current_required"
    )
    return {
        "total": len(details),
        "current_required": current_required,
        "target_progressive": len(details) - current_required,
        "by_l1": [by_l1[code] for code in sorted(by_l1)],
    }


def _get_assessment_details(
    connection: psycopg.Connection, assessment_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT ad.id, ad.l3_code, ad.current_level, ad.target_level, ad.gap_value,
               ad.evidence_note, ad.plan_candidate,
               ad.standard_target_applicable, ad.standard_target_level,
               ad.target_adjusted, ad.adjusted_target_level,
               ad.target_adjustment_reason, ad.target_snapshot_source,
               ad.target_compatibility_error,
               ad.inherited_from_assessment_id,
               ad.inherited_current_level,
               ad.inherited_evidence_note,
               ad.current_level_explicitly_cleared,
               ad.l3_node_id, ad.scope_type, ad.standard_job_level_snapshot,
               ad.l1_code, ad.l1_name, ad.l2_code, ad.l2_name, ad.l3_name,
               ad.member_priority, ad.include_in_plan,
               ad.plan_quarter, ad.plan_month
        FROM assessment_detail ad
        WHERE ad.assessment_id = %s
        ORDER BY ad.l3_code
        """,
        (assessment_id,),
    ).fetchall()
    details = [
        {
            "id": row[0],
            "l3_code": row[1],
            "current_level": row[2],
            "target_level": row[3],
            "gap_value": row[4],
            "evidence_note": row[5],
            "plan_candidate": row[6],
            "standard_target_applicable": row[7],
            "standard_target_level": row[8],
            "target_adjusted": row[9],
            "adjusted_target_level": row[10],
            "target_adjustment_reason": row[11],
            "target_snapshot_source": row[12],
            "target_compatibility_error": row[13],
            "inherited_from_assessment_id": row[14],
            "inherited_current_level": row[15],
            "inherited_evidence_note": row[16],
            "current_level_explicitly_cleared": row[17],
            "l3_node_id": row[18],
            "scope_type": row[19],
            "standard_job_level_snapshot": row[20],
            "member_priority": row[26],
            "include_in_plan": row[27],
            "plan_quarter": row[28],
            "plan_month": row[29],
        }
        for row in rows
    ]
    legacy_codes = [
        str(detail["l3_code"]) for detail in details if detail["l3_node_id"] is None
    ]
    contexts = get_l3_contexts(connection, legacy_codes) if legacy_codes else {}
    for index, detail in enumerate(details):
        row = rows[index]
        if detail["l3_node_id"] is not None:
            # Frozen path snapshots: catalog moves/renames must not rewrite them.
            detail.update(
                {
                    "l3_name": row[25],
                    "recommended_start_level": None,
                    "l2_code": row[23],
                    "l2_name": row[24],
                    "l1_code": row[21],
                    "l1_name": row[22],
                }
            )
            continue
        context = contexts[str(detail["l3_code"])]
        detail.update(
            {
                "l3_name": context["l3_name"],
                "recommended_start_level": context["l3_recommended_start_level"],
                "l2_code": context["l2_code"],
                "l2_name": context["l2_name"],
                "l1_code": context["l1_code"],
                "l1_name": context["l1_name"],
            }
        )
    return details


def _get_assessment_l2_groups(
    connection: psycopg.Connection,
    details: list[dict[str, object]],
    include_requirements: bool,
    *,
    frozen: bool = False,
) -> list[dict[str, object]]:
    if frozen:
        return _frozen_l2_groups(connection, details, include_requirements)
    rows = connection.execute(
        """
        SELECT l1.code, l1.name, l2.code, l2.name,
               l2.p4_description, l2.p5_description, l2.p6_description,
               l2.p7_description, l2.p8_description,
               COUNT(l3.id)
        FROM capability_node AS l2
        JOIN capability_node AS l1 ON l1.id = l2.parent_node_id
        LEFT JOIN capability_node AS l3
          ON l3.parent_node_id = l2.id AND l3.node_type = 'L3'
        WHERE l1.node_type = 'L1'
          AND l1.code = ANY(%s)
          AND l2.node_type = 'L2'
          AND l2.enabled = TRUE
        GROUP BY l1.id, l2.id
        ORDER BY l1.sort_order, l2.sort_order
        """,
        (list(DOMAIN_CODES),),
    ).fetchall()
    groups: list[dict[str, object]] = []
    by_l2: dict[str, dict[str, object]] = {}
    for row in rows:
        group: dict[str, object] = {
            "l1_code": row[0],
            "l1_name": row[1],
            "l2_code": row[2],
            "l2_name": row[3],
            "l3_count": int(row[9]),
            "is_empty": int(row[9]) == 0,
            "details": [],
        }
        if include_requirements:
            group["requirements"] = {
                "P4": row[4],
                "P5": row[5],
                "P6": row[6],
                "P7": row[7],
                "P8": row[8],
            }
        groups.append(group)
        by_l2[str(row[2])] = group
    unmapped_details: list[dict[str, object]] = []
    for detail in details:
        l2_code = detail.get("l2_code")
        if isinstance(l2_code, str) and l2_code in by_l2:
            by_l2[l2_code]["details"].append(detail)
        else:
            unmapped_details.append(detail)

    # Historical assessment details are immutable facts.  A later catalog change
    # must not make them disappear from a Buddy review simply because their L3 no
    # longer maps to a current L2.
    if unmapped_details:
        groups.append(
            {
                "l1_code": None,
                "l1_name": None,
                "l2_code": None,
                "l2_name": "未映射历史项",
                "l3_count": len(unmapped_details),
                "is_empty": False,
                "details": unmapped_details,
            }
        )
    return groups


def _frozen_l2_groups(
    connection: psycopg.Connection,
    details: list[dict[str, object]],
    include_requirements: bool,
) -> list[dict[str, object]]:
    """scope-v1 grouping comes from frozen detail snapshots only."""
    groups: list[dict[str, object]] = []
    by_l2: dict[str, dict[str, object]] = {}
    for detail in details:
        l2_code = detail.get("l2_code")
        if not isinstance(l2_code, str):
            continue
        group = by_l2.get(l2_code)
        if group is None:
            group = {
                "l1_code": detail.get("l1_code"),
                "l1_name": detail.get("l1_name"),
                "l2_code": l2_code,
                "l2_name": detail.get("l2_name"),
                "l3_count": 0,
                "is_empty": False,
                "details": [],
            }
            by_l2[l2_code] = group
            groups.append(group)
        group["l3_count"] += 1  # type: ignore[operator]
        group["details"].append(detail)
    if include_requirements and by_l2:
        requirement_rows = {
            str(row[0]): row
            for row in connection.execute(
                """
                SELECT code, p4_description, p5_description, p6_description,
                       p7_description, p8_description
                FROM capability_node
                WHERE node_type = 'L2' AND code = ANY(%s)
                """,
                (list(by_l2),),
            ).fetchall()
        }
        for l2_code, group in by_l2.items():
            row = requirement_rows.get(l2_code)
            if row is not None:
                group["requirements"] = {
                    "P4": row[1],
                    "P5": row[2],
                    "P6": row[3],
                    "P7": row[4],
                    "P8": row[5],
                }
    return groups


def _get_gap_summary(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object]:
    """Aggregate gap + plan statistics from the canonical assessment_detail."""
    rows = connection.execute(
        """
        SELECT gap_value, member_priority, include_in_plan,
               plan_quarter
        FROM assessment_detail
        WHERE assessment_id = %s AND gap_value IS NOT NULL AND gap_value > 0
        """,
        (assessment_id,),
    ).fetchall()
    total = len(rows)
    avg = round(sum(int(row[0]) for row in rows) / total, 1) if total > 0 else 0
    by_priority: dict[str, int] = {"高": 0, "中": 0, "低": 0, "暂缓": 0}
    in_plan = 0
    by_quarter: dict[str, int] = {"Q1": 0, "Q2": 0, "Q3": 0, "Q4": 0}
    for row in rows:
        pri = str(row[1]) if row[1] in ("高", "中", "低", "暂缓") else None
        if pri:
            by_priority[pri] += 1
        if row[2] is True:
            in_plan += 1
            q = str(row[3]) if row[3] in ("Q1", "Q2", "Q3", "Q4") else None
            if q:
                by_quarter[q] += 1
    return {
        "total_gaps": total,
        "avg_gap": avg,
        "high_priority": by_priority["高"],
        "medium_priority": by_priority["中"],
        "low_priority": by_priority["低"],
        "on_hold": by_priority["暂缓"],
        "in_plan": in_plan,
        "by_quarter": by_quarter,
    }


def list_member_assessments(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT a.id, a.member_id, a.year, a.version, a.assessment_type, a.status,
               a.created_at, a.submitted_at, a.archived_at, a.revision,
               a.member_current_level_snapshot, a.member_target_level_snapshot,
               a.assessment_scope_version, sv.label
        FROM assessment AS a
        LEFT JOIN capability_standard_version AS sv
          ON sv.id = a.capability_standard_version_id
        WHERE a.member_id = %s
        ORDER BY a.created_at DESC
        """,
        (member_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "member_id": row[1],
            "year": row[2],
            "version": row[3],
            "assessment_type": row[4],
            "status": row[5],
            "created_at": row[6],
            "submitted_at": row[7],
            "archived_at": row[8],
            "revision": row[9],
            "member_current_level_snapshot": row[10],
            "member_target_level_snapshot": row[11],
            "assessment_scope_version": row[12],
            "standard_version_label": row[13],
        }
        for row in rows
    ]


def save_assessment_draft(
    connection: psycopg.Connection,
    assessment_id: int,
    member_id: int,
    details: list[dict[str, object]],
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        row = connection.execute(
            """
            SELECT status, member_id, revision, assessment_scope_version
            FROM assessment
            WHERE id = %s
            FOR UPDATE
            """,
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id, revision, scope_version = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not editable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")
        if int(revision) != expected_revision:
            raise ValueError("revision conflict")

        snapshot_rows = connection.execute(
            """
            SELECT id, l3_code, standard_target_applicable,
                   standard_target_level, target_compatibility_error,
                   target_level, gap_value, target_snapshot_source,
                   inherited_current_level, inherited_evidence_note,
                   current_level_explicitly_cleared, l3_node_id,
                   member_priority AS existing_priority,
                   include_in_plan AS existing_plan,
                   plan_quarter AS existing_quarter,
                   plan_month AS existing_month
            FROM assessment_detail
            WHERE assessment_id = %s
            ORDER BY l3_code
            """,
            (assessment_id,),
        ).fetchall()

        # R1: scope-v1 — every snapshot detail must have l3_node_id.
        if scope_version is not None:
            for srow in snapshot_rows:
                if srow[11] is None:
                    raise DetailValidationError(
                        "l3_node_id_required",
                        f"scope-v1 assessment detail {srow[1]} missing "
                        f"l3_node_id; cannot save without catalog mapping",
                        l3_code=str(srow[1]),
                        field="l3_node_id",
                        reason="required_for_scope_v1",
                    )

        # R1: scope-v1 uses node_id keys only (no code fallback).
        # Legacy assessments keep both.
        snapshots: dict[int | str, tuple] = {}
        for srow in snapshot_rows:
            node_id = srow[11]  # l3_node_id
            if node_id is not None:
                snapshots[int(node_id)] = srow
            if scope_version is None:
                snapshots[srow[1]] = srow  # l3_code fallback for legacy only

        def _snapshot_row(detail: dict[str, object]) -> tuple:
            l3_node_id = detail.get("l3_node_id")
            l3_code = detail.get("l3_code")

            if scope_version is not None:
                # scope-v1: node_id required; no code fallback.
                if not isinstance(l3_node_id, int):
                    raise DetailValidationError(
                        "l3_node_id_required",
                        f"scope-v1 PUT requires l3_node_id for {l3_code}",
                        l3_code=str(l3_code),
                        field="l3_node_id",
                        reason="required_for_scope_v1",
                    )
                if l3_node_id not in snapshots:
                    raise DetailValidationError(
                        "l3_node_id_not_found",
                        f"l3_node_id {l3_node_id} not in assessment scope",
                        l3_node_id=l3_node_id,
                        l3_code=str(l3_code),
                        field="l3_node_id",
                        reason="not_in_scope",
                    )
                snap = snapshots[l3_node_id]
                if str(snap[1]) != str(l3_code):
                    raise DetailValidationError(
                        "l3_code_mismatch",
                        f"l3_code_mismatch: node {l3_node_id} → {snap[1]}, "
                        f"got {l3_code}",
                        l3_node_id=l3_node_id,
                        l3_code=str(l3_code),
                        field="l3_code",
                        reason="mismatch",
                    )
                return snap

            # Legacy path
            if isinstance(l3_node_id, int) and l3_node_id in snapshots:
                snap = snapshots[l3_node_id]
                if str(snap[1]) != str(l3_code):
                    raise DetailValidationError(
                        "l3_code_mismatch",
                        f"l3_code_mismatch: node {l3_node_id} → {snap[1]}, "
                        f"got {l3_code}",
                        l3_node_id=l3_node_id,
                        l3_code=str(l3_code),
                        field="l3_code",
                        reason="mismatch",
                    )
                return snap
            return snapshots[str(l3_code)]

        submitted_codes = [str(detail.get("l3_code", "")) for detail in details]
        if len(submitted_codes) != len(set(submitted_codes)):
            raise DetailValidationError(
                "duplicate_detail", "duplicate assessment detail"
            )
        if set(submitted_codes) != {row[1] for row in snapshot_rows}:
            raise DetailValidationError(
                "batch_coverage", "batch must include every assessment detail"
            )

        forbidden_fields = {
            "target_level",
            "standard_target_applicable",
            "standard_target_level",
            "target_snapshot_source",
            "target_compatibility_error",
            "gap_value",
        }
        auto_cleared: list[dict[str, object]] = []
        for detail in details:
            forbidden = forbidden_fields.intersection(detail)
            if forbidden:
                raise DetailValidationError(
                    "forbidden_field",
                    "member cannot set calculated target fields: "
                    + ", ".join(sorted(forbidden)),
                    field=sorted(forbidden)[0],
                )
            row = _snapshot_row(detail)
            (
                detail_id,
                code,
                applicable,
                standard_target,
                compatibility_error,
                existing_target,
                existing_gap,
                snapshot_source,
                inherited_current_level,
                inherited_evidence,
                existing_explicitly_cleared,
                l3_node_id,
                _existing_priority,
                _existing_plan,
                _existing_quarter,
                _existing_month,
            ) = row
            if compatibility_error and detail.get("_detail_present", True):
                raise DetailValidationError(
                    "compatibility_repair_required",
                    f"assessment detail {code} requires compatibility repair",
                    l3_code=str(code),
                    field="target_compatibility_error",
                    reason="compatibility_repair_required",
                )

            cl = detail.get("current_level")
            current_level = int(cl) if cl is not None else None
            current_level_present = bool(detail.get("_current_level_present", True))
            explicitly_cleared = current_level is None and current_level_present
            if current_level is None and not current_level_present:
                explicitly_cleared = bool(existing_explicitly_cleared)
            if current_level is not None and (
                isinstance(cl, bool) or not 0 <= current_level <= 5
            ):
                raise DetailValidationError(
                    "plan_validation",
                    "current_level must be between 0 and 5",
                    l3_code=str(code),
                    field="current_level",
                    reason="invalid_range",
                )

            target_adjusted = detail.get("target_adjusted", False)
            if not isinstance(target_adjusted, bool):
                raise DetailValidationError(
                    "plan_validation",
                    "target_adjusted must be boolean",
                    l3_code=str(code),
                    field="target_adjusted",
                    reason="invalid_type",
                )
            adjusted = detail.get("adjusted_target_level")
            reason = detail.get("target_adjustment_reason")

            # ── Canonical plan fields ──────────────────────────
            member_priority = detail.get("member_priority")
            include_in_plan = detail.get("include_in_plan")  # tri-state
            plan_quarter = detail.get("plan_quarter")
            plan_month = detail.get("plan_month")

            legacy_preserved = (
                snapshot_source == "legacy_preserved"
                and applicable is None
                and existing_target is not None
            )
            if legacy_preserved:
                if target_adjusted or adjusted is not None or reason is not None:
                    raise DetailValidationError(
                        "plan_validation",
                        f"legacy preserved target {code} cannot be adjusted",
                        l3_code=str(code),
                        field="target_adjusted",
                        reason="legacy_preserved_readonly",
                    )
                final_target = int(existing_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else existing_gap
                )
            elif applicable is not True:
                if target_adjusted or adjusted is not None or reason is not None:
                    raise DetailValidationError(
                        "plan_validation",
                        f"not applicable item {code} cannot be adjusted or planned",
                        l3_code=str(code),
                        field="target_adjusted",
                        reason="not_applicable",
                    )
                current_level = None
                final_target = None
                gap_value = None
                # Clear all plan fields for non-applicable items.
                member_priority = None
                include_in_plan = None
                plan_quarter = None
                plan_month = None
            else:
                if standard_target is None:
                    raise DetailValidationError(
                        "plan_validation",
                        f"assessment detail {code} has no standard target",
                        l3_code=str(code),
                        field="standard_target_level",
                        reason="missing_standard_target",
                    )
                if target_adjusted:
                    if (
                        isinstance(adjusted, bool)
                        or not isinstance(adjusted, int)
                        or not 1 <= adjusted <= 5
                    ):
                        raise DetailValidationError(
                            "plan_validation",
                            "adjusted_target_level must be between 1 and 5",
                            l3_code=str(code),
                            field="adjusted_target_level",
                            reason="invalid_range",
                        )
                    if not isinstance(reason, str) or not reason.strip():
                        raise DetailValidationError(
                            "plan_validation",
                            "adjustment reason is required",
                            l3_code=str(code),
                            field="target_adjustment_reason",
                            reason="missing_required",
                        )
                    final_target = adjusted
                    reason = reason.strip()
                else:
                    if adjusted is not None or reason is not None:
                        raise DetailValidationError(
                            "plan_validation",
                            "adjustment fields require target_adjusted",
                            l3_code=str(code),
                            field="target_adjusted",
                            reason="adjustment_fields_without_flag",
                        )
                    final_target = int(standard_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else None
                )

            # ── Plan field business rules ──────────────────────
            can_plan = (
                applicable is True
                and current_level is not None
                and final_target is not None
                and gap_value is not None
                and gap_value > 0
            )

            # ── P1-3: Atomic plan field cleanup ──
            cleared_fields: list[str] = []
            orig_priority = member_priority
            orig_include_in_plan = include_in_plan
            orig_quarter = plan_quarter
            orig_month = plan_month

            if not can_plan:
                # Gap<=0 / unassessed / target invalid / not applicable
                # → ALL plan fields must be NULL
                member_priority = None
                include_in_plan = None
                plan_quarter = None
                plan_month = None

            # Priority allowed only for positive-gap items
            # (auto-clear above handles can_plan=False, this gate rejects
            # priority on items that still have it despite the auto-clear).
            if member_priority is not None and not can_plan:
                raise DetailValidationError(
                    "plan_validation",
                    f"priority not allowed for {code}: no positive gap",
                    l3_code=str(code),
                    l3_node_id=l3_node_id if isinstance(l3_node_id, int) else None,
                    field="member_priority",
                    reason="no_positive_gap",
                )

            # 暂缓 auto-sets include_in_plan=FALSE and clears timing.
            # The mutex 422 fires only when include_in_plan=TRUE was sent
            # explicitly in THIS request; a DB-carried TRUE (sparse PATCH
            # changing only priority) is auto-cleared instead.
            include_present = bool(detail.get("_include_in_plan_present", True))
            if member_priority == "暂缓":
                if include_in_plan is True and include_present:
                    raise DetailValidationError(
                        "plan_validation",
                        f"暂缓 and include_in_plan are mutually exclusive for {code}",
                        l3_code=str(code),
                        l3_node_id=l3_node_id if isinstance(l3_node_id, int) else None,
                        field="include_in_plan",
                        reason="hold_plan_mutex",
                    )
                include_in_plan = False
                plan_quarter = None
                plan_month = None

            # NULL or FALSE → clear quarter/month
            if include_in_plan is None or include_in_plan is False:
                plan_quarter = None
                plan_month = None

            # include_in_plan tri-state validation.
            if include_in_plan is True:
                if member_priority is None or member_priority == "暂缓":
                    raise DetailValidationError(
                        "plan_validation",
                        f"include_in_plan requires valid priority for {code}",
                        l3_code=str(code),
                        l3_node_id=l3_node_id if isinstance(l3_node_id, int) else None,
                        field="include_in_plan",
                        reason="requires_valid_priority",
                    )
                if plan_quarter is None or plan_month is None:
                    raise DetailValidationError(
                        "plan_validation",
                        f"include_in_plan requires quarter and month for {code}",
                        l3_code=str(code),
                        l3_node_id=l3_node_id if isinstance(l3_node_id, int) else None,
                        field="include_in_plan",
                        reason="requires_quarter_and_month",
                    )
                # Validate quarter-month mapping
                if plan_quarter is not None and plan_month is not None:
                    valid = True
                    if plan_quarter == "Q1" and not (1 <= plan_month <= 3):
                        valid = False
                    elif plan_quarter == "Q2" and not (4 <= plan_month <= 6):
                        valid = False
                    elif plan_quarter == "Q3" and not (7 <= plan_month <= 9):
                        valid = False
                    elif plan_quarter == "Q4" and not (10 <= plan_month <= 12):
                        valid = False
                    if not valid:
                        raise DetailValidationError(
                            "plan_validation",
                            f"invalid quarter-month combination: "
                            f"{plan_quarter}+{plan_month}",
                            l3_code=str(code),
                            l3_node_id=(
                                l3_node_id if isinstance(l3_node_id, int) else None
                            ),
                            field="plan_quarter",
                            reason="invalid_quarter_month",
                        )

            # Track auto-cleared fields
            if orig_priority != member_priority:
                cleared_fields.append("member_priority")
            if orig_include_in_plan != include_in_plan:
                cleared_fields.append("include_in_plan")
            if orig_quarter != plan_quarter:
                cleared_fields.append("plan_quarter")
            if orig_month != plan_month:
                cleared_fields.append("plan_month")
            if cleared_fields:
                auto_cleared.append(
                    {
                        "l3_node_id": (
                            l3_node_id if isinstance(l3_node_id, int) else None
                        ),
                        "l3_code": str(code),
                        "fields": cleared_fields,
                    }
                )

            connection.execute(
                """
                UPDATE assessment_detail
                SET current_level = %s,
                    current_level_explicitly_cleared = %s,
                    target_adjusted = %s,
                    adjusted_target_level = %s,
                    target_adjustment_reason = %s,
                    target_level = %s,
                    gap_value = %s,
                    evidence_note = %s,
                    member_priority = %s,
                    include_in_plan = %s,
                    plan_quarter = %s,
                    plan_month = %s
                WHERE id = %s
                """,
                (
                    current_level,
                    explicitly_cleared,
                    target_adjusted,
                    adjusted if target_adjusted else None,
                    reason if target_adjusted else None,
                    final_target,
                    gap_value,
                    detail.get("evidence_note"),
                    member_priority,
                    include_in_plan,
                    plan_quarter,
                    plan_month,
                    detail_id,
                ),
            )

        generate_gaps_for_assessment(connection, assessment_id)
        next_revision = int(revision) + 1
        connection.execute(
            "UPDATE assessment SET revision = %s WHERE id = %s",
            (next_revision, assessment_id),
        )
        return {
            "revision": next_revision,
            "auto_cleared": auto_cleared,
            "gap_summary": _get_gap_summary(connection, assessment_id),
        }


def patch_assessment_draft(
    connection: psycopg.Connection,
    assessment_id: int,
    member_id: int,
    expected_revision: int,
    details: list[dict[str, object]],
) -> dict[str, object]:
    rows = connection.execute(
        """
        SELECT l3_code, current_level, target_adjusted,
               adjusted_target_level, target_adjustment_reason,
               evidence_note, member_priority, include_in_plan,
               plan_quarter, plan_month,
               current_level_explicitly_cleared, l3_node_id
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    merged = {
        row[0]: {
            "l3_node_id": row[11],
            "l3_code": row[0],
            "current_level": row[1],
            "target_adjusted": row[2],
            "adjusted_target_level": row[3],
            "target_adjustment_reason": row[4],
            "evidence_note": row[5],
            "member_priority": row[6],
            "include_in_plan": row[7],
            "plan_quarter": row[8],
            "plan_month": row[9],
            "current_level_explicitly_cleared": row[10],
            "_current_level_present": False,
            "_include_in_plan_present": False,
            "_detail_present": False,
        }
        for row in rows
    }
    allowed = {
        "current_level",
        "target_adjusted",
        "adjusted_target_level",
        "target_adjustment_reason",
        "evidence_note",
        "member_priority",
        "include_in_plan",
        "plan_quarter",
        "plan_month",
    }
    scope_row = connection.execute(
        "SELECT assessment_scope_version FROM assessment WHERE id = %s",
        (assessment_id,),
    ).fetchone()
    scope_version = scope_row[0] if scope_row else None
    node_index: dict[int, str] = {}
    if scope_version is not None:
        for row in rows:
            if row[11] is not None:
                node_index[int(row[11])] = row[0]
    seen_codes: set[str] = set()
    seen_nodes: set[int] = set()
    for detail in details:
        code = str(detail.get("l3_code", ""))
        if code in seen_codes:
            raise DetailValidationError(
                "duplicate_detail",
                "duplicate assessment detail",
                l3_code=code,
                field="l3_code",
                reason="duplicate",
            )
        seen_codes.add(code)
        if scope_version is not None:
            # scope-v1: l3_node_id is the stable identity — required, known,
            # unique within the batch, and consistent with l3_code.
            node_id = detail.get("l3_node_id")
            if not isinstance(node_id, int) or isinstance(node_id, bool):
                raise DetailValidationError(
                    "l3_node_id_required",
                    f"scope-v1 PATCH requires l3_node_id for {code}",
                    l3_code=code,
                    field="l3_node_id",
                    reason="required_for_scope_v1",
                )
            if node_id in seen_nodes:
                raise DetailValidationError(
                    "duplicate_detail",
                    "duplicate l3_node_id in batch",
                    l3_node_id=node_id,
                    l3_code=code,
                    field="l3_node_id",
                    reason="duplicate",
                )
            seen_nodes.add(node_id)
            if node_id not in node_index:
                raise DetailValidationError(
                    "l3_node_id_not_found",
                    f"l3_node_id {node_id} not in assessment scope",
                    l3_node_id=node_id,
                    l3_code=code,
                    field="l3_node_id",
                    reason="not_in_scope",
                )
            if node_index[node_id] != code:
                raise DetailValidationError(
                    "l3_code_mismatch",
                    f"l3_code_mismatch: node {node_id} → {node_index[node_id]}, "
                    f"got {code}",
                    l3_node_id=node_id,
                    l3_code=code,
                    field="l3_code",
                    reason="mismatch",
                )
        if code not in merged:
            raise DetailValidationError(
                "unknown_detail",
                f"unknown assessment detail: {code}",
                l3_code=code,
            )
        forbidden = set(detail) - (allowed | {"l3_code", "l3_node_id"})
        if forbidden:
            raise DetailValidationError(
                "forbidden_field",
                "member cannot set calculated target fields: "
                + ", ".join(sorted(forbidden)),
                field=sorted(forbidden)[0],
            )
        if "current_level" in detail:
            merged[code]["_current_level_present"] = True
        if "include_in_plan" in detail:
            merged[code]["_include_in_plan_present"] = True
        merged[code]["_detail_present"] = True
        merged[code].update({key: detail[key] for key in allowed if key in detail})
    return save_assessment_draft(
        connection,
        assessment_id,
        member_id,
        list(merged.values()),
        expected_revision=expected_revision,
    )


def batch_fill_l2(
    connection: psycopg.Connection,
    assessment_id: int,
    member_id: int,
    l2_code: str,
    current_level: int,
    expected_revision: int,
) -> dict[str, object]:
    if current_level not in (0, 1, 2):
        raise ValueError("batch current_level must be 0, 1, or 2")
    rows = connection.execute(
        """
        SELECT ad.l3_code, ad.l3_node_id
        FROM assessment_detail ad
        LEFT JOIN capability_node l3n ON l3n.id = ad.l3_node_id
        LEFT JOIN capability_node l3c
          ON ad.l3_node_id IS NULL AND l3c.code = ad.l3_code
         AND l3c.node_type = 'L3'
        LEFT JOIN capability_node l2
          ON l2.id = COALESCE(l3n.parent_node_id, l3c.parent_node_id)
        WHERE ad.assessment_id = %s AND COALESCE(ad.l2_code, l2.code) = %s
          AND ad.current_level IS NULL
          AND ad.current_level_explicitly_cleared = FALSE
          AND ad.inherited_current_level IS NULL
          AND ad.standard_target_applicable = TRUE
          AND ad.target_compatibility_error IS NULL
        ORDER BY ad.l3_code
        """,
        (assessment_id, l2_code),
    ).fetchall()
    all_rows = connection.execute(
        """
        SELECT ad.l3_code, ad.current_level
        FROM assessment_detail ad
        LEFT JOIN capability_node l3n ON l3n.id = ad.l3_node_id
        LEFT JOIN capability_node l3c
          ON ad.l3_node_id IS NULL AND l3c.code = ad.l3_code
         AND l3c.node_type = 'L3'
        LEFT JOIN capability_node l2
          ON l2.id = COALESCE(l3n.parent_node_id, l3c.parent_node_id)
        WHERE ad.assessment_id = %s AND COALESCE(ad.l2_code, l2.code) = %s
        ORDER BY ad.l3_code
        """,
        (assessment_id, l2_code),
    ).fetchall()
    if not all_rows:
        raise ValueError("L2 is not part of assessment")
    if not rows:
        with connection.transaction():
            locked = connection.execute(
                """
                SELECT status, member_id, revision
                FROM assessment
                WHERE id = %s
                FOR UPDATE
                """,
                (assessment_id,),
            ).fetchone()
            if locked is None:
                raise ValueError("assessment not found")
            if locked[0] not in ("草稿", "建议调整"):
                raise ValueError("assessment is not editable")
            if locked[1] != member_id:
                raise ValueError("assessment does not belong to member")
            if int(locked[2]) != expected_revision:
                raise ValueError("revision conflict")
        return {
            "updated_l3_codes": [],
            "skipped_l3_codes": [row[0] for row in all_rows],
            "revision": expected_revision,
            "auto_cleared": [],
            "gap_summary": _get_gap_summary(connection, assessment_id),
        }
    result = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        expected_revision,
        [
            {
                "l3_node_id": row[1],
                "l3_code": row[0],
                "current_level": current_level,
            }
            for row in rows
        ],
    )
    updated_codes = [row[0] for row in rows]
    return {
        "updated_l3_codes": updated_codes,
        "skipped_l3_codes": [row[0] for row in all_rows if row[0] not in updated_codes],
        **result,
    }


def _evidence_is_valid(
    current_level: int | None,
    evidence: object,
    inherited_current: int | None,
    inherited_evidence: str | None,
) -> bool:
    text = evidence.strip() if isinstance(evidence, str) else ""
    if current_level is None:
        return True
    if current_level >= 3 and not text:
        return False
    if inherited_current is not None and current_level > inherited_current:
        return bool(text) and text != (inherited_evidence or "").strip()
    return True


def _validate_submission(connection: psycopg.Connection, assessment_id: int) -> None:
    rows = connection.execute(
        """
        SELECT l3_code, current_level, standard_target_applicable,
               target_level, target_compatibility_error,
               member_priority, include_in_plan, plan_quarter, plan_month,
               gap_value, l3_node_id
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    if not rows:
        raise ValueError("assessment has no details")
    for (
        code,
        current_level,
        applicable,
        target_level,
        compatibility_error,
        member_priority,
        include_in_plan,
        plan_quarter,
        plan_month,
        gap_value,
        l3_node_id,
    ) in rows:
        if compatibility_error:
            raise AssessmentValidationError(
                code,
                "compatibility_repair_required",
                f"assessment detail {code} requires compatibility repair",
                l3_node_id=l3_node_id,
                field="target_compatibility_error",
            )
        if applicable is False:
            if current_level is not None or target_level is not None:
                raise AssessmentValidationError(
                    code,
                    "not_applicable_incomplete",
                    f"not applicable item {code} is incomplete",
                    l3_node_id=l3_node_id,
                    field="target_level",
                )
            continue
        # All applicable items must have current_level 0–5 (NULL = not yet assessed).
        if current_level is None:
            raise AssessmentValidationError(
                code,
                "requires_current_level",
                f"assessment detail {code} requires current level (0–5)",
                l3_node_id=l3_node_id,
                field="current_level",
            )
        if target_level is None:
            raise AssessmentValidationError(
                code,
                "requires_target_level",
                f"assessment detail {code} has no effective target",
                l3_node_id=l3_node_id,
                field="target_level",
            )

        # ── Plan field validation ──────────────────────────────
        has_positive_gap = gap_value is not None and int(gap_value) > 0
        if has_positive_gap:
            # Must have a priority.
            if member_priority is None:
                raise AssessmentValidationError(
                    code,
                    "priority_required",
                    f"positive gap item {code} requires member_priority",
                    l3_node_id=l3_node_id,
                    field="member_priority",
                )
            # include_in_plan must be explicitly decided (not NULL).
            if include_in_plan is None:
                raise AssessmentValidationError(
                    code,
                    "plan_decision_required",
                    f"positive gap item {code} requires include_in_plan decision",
                    l3_node_id=l3_node_id,
                    field="include_in_plan",
                )
            if include_in_plan is True:
                if member_priority == "暂缓":
                    raise AssessmentValidationError(
                        code,
                        "hold_plan_conflict",
                        f"暂缓 item {code} cannot be include_in_plan=TRUE",
                        l3_node_id=l3_node_id,
                        field="include_in_plan",
                    )
                if plan_quarter is None or plan_month is None:
                    raise AssessmentValidationError(
                        code,
                        "plan_time_required",
                        f"include_in_plan=TRUE requires quarter and month for {code}",
                        l3_node_id=l3_node_id,
                        field="plan_quarter",
                    )
            # include_in_plan=FALSE with 暂缓 is valid.
        else:
            # Gap<=0: plan fields must be cleared.
            if member_priority is not None:
                raise AssessmentValidationError(
                    code,
                    "priority_not_applicable",
                    f"item {code} with gap<=0 cannot have priority",
                    l3_node_id=l3_node_id,
                    field="member_priority",
                )
            if include_in_plan is not None:
                raise AssessmentValidationError(
                    code,
                    "plan_not_applicable",
                    f"item {code} with gap<=0 cannot have plan selection",
                    l3_node_id=l3_node_id,
                    field="include_in_plan",
                )


def submit_assessment(
    connection: psycopg.Connection,
    assessment_id: int,
    member_id: int,
    expected_revision: int,
) -> dict[str, object]:
    with connection.transaction():
        row = connection.execute(
            """
            SELECT status, member_id, revision
            FROM assessment
            WHERE id = %s
            FOR UPDATE
            """,
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id, revision = row
        if status not in ("草稿", "建议调整"):
            raise ValueError("assessment is not submittable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")
        if int(revision) != expected_revision:
            raise ValueError("revision conflict")

        _validate_submission(connection, assessment_id)

        incompatible_detail = connection.execute(
            """
            SELECT l3_code, target_compatibility_error
            FROM assessment_detail
            WHERE assessment_id = %s
              AND target_compatibility_error IS NOT NULL
            ORDER BY l3_code
            LIMIT 1
            """,
            (assessment_id,),
        ).fetchone()
        if incompatible_detail is not None:
            code, compatibility_error = incompatible_detail
            raise ValueError(
                f"assessment detail {code} requires compatibility repair: "
                f"{compatibility_error}"
            )

        submitted_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment
            SET status = '待复核', submitted_at = %s
            WHERE id = %s
            """,
            (submitted_at, assessment_id),
        )

        primary_buddy = get_primary_buddy(connection, member_id)
        buddy_id = primary_buddy["id"] if primary_buddy else None
        next_sequence = _next_review_sequence(connection, assessment_id)

        connection.execute(
            """
            INSERT INTO assessment_review (
                assessment_id, sequence, buddy_id, status
            )
            VALUES (%s, %s, %s, '待复核')
            """,
            (assessment_id, next_sequence, buddy_id),
        )

        generate_gaps_for_assessment(connection, assessment_id)

        next_revision = int(revision) + 1
        connection.execute(
            "UPDATE assessment SET revision = %s WHERE id = %s",
            (next_revision, assessment_id),
        )
        return {"revision": next_revision, "auto_cleared": []}


def generate_gaps_for_assessment(
    connection: psycopg.Connection, assessment_id: int
) -> None:
    """One-way compat projection: assessment_detail → gap table.

    The canonical source is assessment_detail.  Gap rows are derived within
    the same transaction for the legacy Planning read path.  If this projection
    fails the whole Detail transaction rolls back.

    Priority is projected only when Member has explicitly set it (not NULL,
    not 暂缓).  include_in_plan=TRUE is projected as plan_candidate=TRUE.
    """
    rows = connection.execute(
        """
        SELECT l3_code, current_level, target_level, gap_value,
               member_priority, include_in_plan
        FROM assessment_detail
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchall()
    for row in rows:
        code = str(row[0])
        cl = row[1]
        tl = row[2]
        gv = row[3]
        mpri = row[4]
        iip = row[5]

        if gv is None:
            connection.execute(
                "DELETE FROM gap WHERE assessment_id=%s AND l3_code=%s",
                (assessment_id, code),
            )
            continue
        gap_value = int(gv)
        if gap_value > 0:
            # Only project Member-confirmed priority (not NULL, not 暂缓).
            gap_priority = str(mpri) if mpri in ("高", "中", "低") else None
            connection.execute(
                """
                INSERT INTO gap (
                    assessment_id, l3_code, current_level, target_level,
                    gap_value, priority, plan_candidate
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (assessment_id, l3_code)
                DO UPDATE SET
                    current_level = EXCLUDED.current_level,
                    target_level = EXCLUDED.target_level,
                    gap_value = EXCLUDED.gap_value,
                    priority = EXCLUDED.priority,
                    plan_candidate = EXCLUDED.plan_candidate
                """,
                (
                    assessment_id,
                    code,
                    cl,
                    tl,
                    gap_value,
                    gap_priority,
                    bool(iip) if iip is True else False,
                ),
            )
        else:
            connection.execute(
                "DELETE FROM gap WHERE assessment_id=%s AND l3_code=%s",
                (assessment_id, code),
            )


def list_gaps(
    connection: psycopg.Connection,
    member_id: int | None = None,
    assessment_id: int | None = None,
) -> list[dict[str, object]]:
    where_clauses: list[str] = []
    params: list[object] = []
    if assessment_id is not None:
        where_clauses.append("g.assessment_id = %s")
        params.append(assessment_id)
    if member_id is not None:
        where_clauses.append("a.member_id = %s")
        params.append(member_id)

    where = "WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    rows = connection.execute(
        f"""
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate,
               a.member_id, a.assessment_scope_version
        FROM gap g
        JOIN assessment a ON a.id = g.assessment_id
        {where}
        ORDER BY g.l3_code
        """,
        tuple(params),
    ).fetchall()
    return [
        {
            "id": row[0],
            "assessment_id": row[1],
            "l3_code": row[2],
            "current_level": row[3],
            "target_level": row[4],
            "gap_value": row[5],
            "priority": row[6],
            "plan_candidate": row[7],
            "member_id": row[8],
            "assessment_scope_version": row[9],
        }
        for row in rows
    ]


def get_gap(connection: psycopg.Connection, gap_id: int) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate,
               a.member_id, a.assessment_scope_version
        FROM gap g
        JOIN assessment a ON a.id = g.assessment_id
        WHERE g.id = %s
        """,
        (gap_id,),
    ).fetchone()
    if row is None:
        return None
    return {
        "id": row[0],
        "assessment_id": row[1],
        "l3_code": row[2],
        "current_level": row[3],
        "target_level": row[4],
        "gap_value": row[5],
        "priority": row[6],
        "plan_candidate": row[7],
        "member_id": row[8],
        "assessment_scope_version": row[9],
    }


def update_gap(
    connection: psycopg.Connection,
    gap_id: int,
    member_id: int,
    priority: str,
    plan_candidate: bool,
) -> None:
    if priority not in ("高", "中", "低"):
        raise ValueError("invalid priority")

    with connection.transaction():
        row = connection.execute(
            """
            SELECT a.member_id
            FROM gap g
            JOIN assessment a ON a.id = g.assessment_id
            WHERE g.id = %s
            """,
            (gap_id,),
        ).fetchone()
        if row is None:
            raise ValueError("gap not found")
        if int(row[0]) != member_id:
            raise ValueError("gap does not belong to member")

        connection.execute(
            """
            UPDATE gap
            SET priority = %s, plan_candidate = %s
            WHERE id = %s
            """,
            (priority, plan_candidate, gap_id),
        )


def _next_review_sequence(connection: psycopg.Connection, assessment_id: int) -> int:
    row = connection.execute(
        """
        SELECT COALESCE(MAX(sequence), 0) + 1
        FROM assessment_review
        WHERE assessment_id = %s
        """,
        (assessment_id,),
    ).fetchone()
    assert row is not None
    return row[0]


def archive_assessment(
    connection: psycopg.Connection, assessment_id: int, member_id: int
) -> None:
    with connection.transaction():
        row = connection.execute(
            "SELECT status, member_id FROM assessment WHERE id = %s",
            (assessment_id,),
        ).fetchone()
        if row is None:
            raise ValueError("assessment not found")
        status, owner_id = row
        if status != "已复核":
            raise ValueError("assessment is not in reviewed status")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")

        archived_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment
            SET status = '已归档', archived_at = %s
            WHERE id = %s
            """,
            (archived_at, assessment_id),
        )


def get_assessment_reviews(
    connection: psycopg.Connection, assessment_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT id, assessment_id, sequence, buddy_id, conclusion,
               feedback, reviewed_at, status
        FROM assessment_review
        WHERE assessment_id = %s
        ORDER BY sequence
        """,
        (assessment_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "assessment_id": row[1],
            "sequence": row[2],
            "buddy_id": row[3],
            "conclusion": row[4],
            "feedback": row[5],
            "reviewed_at": row[6],
            "status": row[7],
        }
        for row in rows
    ]


def get_pending_reviews_for_buddy(
    connection: psycopg.Connection, buddy_id: int
) -> list[dict[str, object]]:
    """Pending assessment reviews for the member's *current* responsible Buddy.

    Authorisation is dynamic: after a relationship switch the new Buddy sees
    (and may take over) the pending task while the old Buddy immediately loses
    access.  ``assessment_review.buddy_id`` stays the assignment-time snapshot.
    """
    rows = connection.execute(
        """
        SELECT ar.id, ar.assessment_id, ar.sequence, ar.buddy_id, ar.status,
               a.member_id, a.year, a.version, a.status AS assessment_status,
               a.submitted_at
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        JOIN buddy_relationship br ON br.member_id = a.member_id
        JOIN tcp_user u ON u.id = br.buddy_id
        JOIN tcp_user_role ur ON ur.user_id = u.id
        JOIN tcp_role r ON r.id = ur.role_id AND r.code = 'Buddy'
        WHERE br.buddy_id = %s
          AND br.is_primary = TRUE
          AND br.effective_date <= CURRENT_DATE
          AND (br.expiry_date IS NULL OR br.expiry_date >= CURRENT_DATE)
          AND u.is_active = TRUE
          AND ar.status = '待复核'
        ORDER BY a.submitted_at ASC NULLS LAST
        """,
        (buddy_id,),
    ).fetchall()
    return [
        {
            "id": row[0],
            "assessment_id": row[1],
            "sequence": row[2],
            "buddy_id": row[3],
            "status": row[4],
            "member_id": row[5],
            "year": row[6],
            "version": row[7],
            "assessment_status": row[8],
            "submitted_at": row[9],
        }
        for row in rows
    ]


_REVIEW_LOCK_NAMESPACE = "tcp62_review_plan"


def _review_fingerprint(
    assessment_id: int,
    expected_revision: int,
    conclusion: str,
    feedback_token: str,
    buddy_id: int,
    review_sequence: int,
) -> str:
    payload = (
        f"{assessment_id}|{expected_revision}|{conclusion}|"
        f"{feedback_token}|{buddy_id}|{review_sequence}"
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _lookup_idempotency(
    connection: psycopg.Connection,
    buddy_id: int,
    idempotency_key: str,
    fingerprint: str,
) -> dict[str, object] | None:
    """Return the stored response for a matching key, or raise on key reuse."""
    row = connection.execute(
        """
        SELECT fingerprint, response FROM review_idempotency_key
        WHERE buddy_id = %s AND idempotency_key = %s
        """,
        (buddy_id, idempotency_key),
    ).fetchone()
    if row is None:
        return None
    stored_fingerprint = str(row[0])
    if stored_fingerprint != fingerprint:
        raise ReviewError(
            "idempotency_key_reused",
            "idempotency key was already used with a different payload",
        )
    response = json.loads(row[1]) if isinstance(row[1], str) else row[1]
    return {**response, "idempotent_replayed": True}


def _save_idempotency(
    connection: psycopg.Connection,
    buddy_id: int,
    idempotency_key: str,
    assessment_id: int,
    review_id: int,
    fingerprint: str,
    response: dict[str, object],
) -> dict[str, object]:
    """Insert the idempotency row; a concurrent unique conflict is handled with
    a savepoint: re-read and replay (same fingerprint) or 409 (reused)."""
    connection.execute("SAVEPOINT idem_sp")
    try:
        connection.execute(
            """
            INSERT INTO review_idempotency_key (
                buddy_id, idempotency_key, assessment_id, review_id,
                fingerprint, response
            )
            VALUES (%s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                buddy_id,
                idempotency_key,
                assessment_id,
                review_id,
                fingerprint,
                json.dumps(response, ensure_ascii=False),
            ),
        )
        connection.execute("RELEASE SAVEPOINT idem_sp")
    except psycopg.errors.UniqueViolation:
        connection.execute("ROLLBACK TO SAVEPOINT idem_sp")
        replay = _lookup_idempotency(connection, buddy_id, idempotency_key, fingerprint)
        if replay is not None:
            return replay
        raise ReviewError(
            "idempotency_key_reused",
            "idempotency key was already used with a different payload",
        ) from None
    return response


def _frozen_detail_rows(
    connection: psycopg.Connection, assessment_id: int
) -> list[tuple[Any, ...]]:
    return connection.execute(
        """
        SELECT ad.id, ad.l3_node_id, ad.l3_code, ad.l3_name,
               ad.l1_code, ad.l1_name, ad.l2_code, ad.l2_name,
               ad.scope_type, ad.current_level, ad.standard_target_level,
               ad.adjusted_target_level, ad.target_level, ad.gap_value,
               ad.member_priority, ad.include_in_plan, ad.plan_quarter,
               ad.plan_month, ad.standard_job_level_snapshot, ad.target_adjusted,
               ad.target_adjustment_reason, ad.target_compatibility_error
        FROM assessment_detail ad
        WHERE ad.assessment_id = %s AND ad.include_in_plan = TRUE
        ORDER BY ad.l3_code
        """,
        (assessment_id,),
    ).fetchall()


def _planning_snapshot_for(
    connection: psycopg.Connection,
    version_id: int,
    l3_node_id: int,
) -> tuple[Any, ...] | None:
    return connection.execute(
        """
        SELECT id, materials_text, expected_output, estimated_hours, l3_name
        FROM capability_standard_planning_snapshot
        WHERE capability_standard_version_id = %s AND l3_node_id = %s
        """,
        (version_id, l3_node_id),
    ).fetchone()


def _insert_plan_item_and_task(
    connection: psycopg.Connection,
    plan_id: int,
    assessment: dict[str, object],
    detail: tuple[Any, ...],
    snapshot: tuple[Any, ...],
) -> tuple[int, int]:
    """Insert one Plan Item (full frozen source snapshot) and its 1:1 Task."""
    (
        detail_id,
        l3_node_id,
        l3_code,
        l3_name,
        l1_code,
        l1_name,
        l2_code,
        l2_name,
        scope_type,
        current_level,
        standard_target_level,
        adjusted_target_level,
        effective_target_level,
        gap_value,
        member_priority,
        include_in_plan,
        plan_quarter,
        plan_month,
        standard_job_level_snapshot,
        _target_adjusted,
        _adjustment_reason,
        _compatibility_error,
    ) = detail
    snapshot_id = int(snapshot[0])
    item = connection.execute(
        """
        INSERT INTO plan_item (
            annual_growth_plan_id, growth_goal_id, l3_code, current_level,
            target_level, priority, learning_material, learning_task_content,
            expected_output, estimated_hours, plan_start_date, plan_end_date,
            target_month, status, source_assessment_id,
            source_assessment_detail_id, capability_standard_version_id,
            planning_snapshot_id, l3_node_id, l1_code, l1_name, l2_code,
            l2_name, l3_name, scope_type, standard_target_level,
            adjusted_target_level, effective_target_level,
            standard_job_level_snapshot, member_current_level_snapshot,
            member_target_level_snapshot, plan_quarter, plan_month,
            planning_source_type, assessment_revision, gap_value,
            include_in_plan
        )
        VALUES (
            %s, NULL, %s, %s, %s, %s, %s, %s, %s, %s, NULL, NULL, NULL,
            '未开始', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
            %s, %s, %s, %s, %s, 'assessment_approval', %s, %s, TRUE
        )
        RETURNING id
        """,
        (
            plan_id,
            l3_code,
            current_level,
            effective_target_level,
            member_priority,
            snapshot[1],
            snapshot[4],
            snapshot[2],
            snapshot[3],
            int(assessment["id"]),
            detail_id,
            int(assessment["capability_standard_version_id"]),
            snapshot_id,
            l3_node_id,
            l1_code,
            l1_name,
            l2_code,
            l2_name,
            l3_name,
            scope_type,
            standard_target_level,
            adjusted_target_level,
            effective_target_level,
            standard_job_level_snapshot,
            assessment["member_current_level_snapshot"],
            assessment["member_target_level_snapshot"],
            plan_quarter,
            plan_month,
            int(assessment["revision"]),
            gap_value,
        ),
    ).fetchone()
    assert item is not None
    task = connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, '未开始')
        RETURNING id
        """,
        (int(item[0]), l3_code),
    ).fetchone()
    assert task is not None
    return int(item[0]), int(task[0])


def _approve_first_assessment(
    connection: psycopg.Connection,
    assessment: dict[str, object],
    member_id: int,
    year: int,
) -> dict[str, object]:
    """Create the formal Annual Plan (shell included), one Item + one Task per
    include_in_plan=TRUE detail.  All writes share the caller's transaction."""
    plan_row = connection.execute(
        """
        INSERT INTO annual_growth_plan (
            member_id, year, status, source_assessment_id, planning_source_type
        )
        VALUES (%s, %s, '制定中', %s, 'assessment_approval')
        RETURNING id
        """,
        (member_id, year, int(assessment["id"])),
    ).fetchone()
    assert plan_row is not None
    plan_id = int(plan_row[0])
    version_id = int(assessment["capability_standard_version_id"])
    items_created = 0
    tasks_created = 0
    for detail in _frozen_detail_rows(connection, int(assessment["id"])):
        snapshot = _planning_snapshot_for(connection, version_id, int(detail[1]))
        if snapshot is None:
            raise ReviewError(
                "planning_snapshot_missing",
                "missing immutable planning source snapshot",
                status_code=422,
                l3_node_id=int(detail[1]),
                l3_code=str(detail[2]),
            )
        item_id, task_id = _insert_plan_item_and_task(
            connection, plan_id, assessment, detail, snapshot
        )
        items_created += 1
        tasks_created += 1
    return {
        "created": True,
        "plan_id": plan_id,
        "items_created": items_created,
        "tasks_created": tasks_created,
        "target_is_legacy": None,
    }


def _approve_with_proposal(
    connection: psycopg.Connection,
    assessment: dict[str, object],
    member_id: int,
    year: int,
    buddy_id: int,
    target_plan_id: int,
    target_is_legacy: bool,
) -> dict[str, object]:
    """Subsequent approval: only an atomic Change Proposal with full frozen
    details; the formal plan, its items and tasks are never touched."""
    items = _frozen_detail_rows(connection, int(assessment["id"]))
    summary = {
        "source_assessment_id": int(assessment["id"]),
        "source_assessment_version": int(assessment["version"]),
        "source_assessment_revision": int(assessment["revision"]),
        "year": year,
        "member_id": member_id,
        "items_count": len(items),
        "target_annual_growth_plan_id": target_plan_id,
        "target_is_legacy": target_is_legacy,
    }
    proposal = connection.execute(
        """
        INSERT INTO annual_plan_change_proposal (
            member_id, year, source_assessment_id,
            target_annual_growth_plan_id, status, created_by, summary
        )
        VALUES (%s, %s, %s, %s, '待处理', %s, %s::jsonb)
        RETURNING id
        """,
        (
            member_id,
            year,
            int(assessment["id"]),
            target_plan_id,
            buddy_id,
            json.dumps(summary, ensure_ascii=False),
        ),
    ).fetchone()
    assert proposal is not None
    proposal_id = int(proposal[0])
    version_id = int(assessment["capability_standard_version_id"])
    for detail in items:
        snapshot = _planning_snapshot_for(connection, version_id, int(detail[1]))
        if snapshot is None:
            raise ReviewError(
                "planning_snapshot_missing",
                "missing immutable planning source snapshot",
                status_code=422,
                l3_node_id=int(detail[1]),
                l3_code=str(detail[2]),
            )
        (
            detail_id,
            l3_node_id,
            l3_code,
            l3_name,
            l1_code,
            l1_name,
            l2_code,
            l2_name,
            scope_type,
            current_level,
            standard_target_level,
            adjusted_target_level,
            effective_target_level,
            gap_value,
            member_priority,
            include_in_plan,
            plan_quarter,
            plan_month,
            standard_job_level_snapshot,
            _target_adjusted,
            _adjustment_reason,
            _compatibility_error,
        ) = detail
        connection.execute(
            """
            INSERT INTO annual_plan_change_proposal_detail (
                proposal_id, source_assessment_detail_id, assessment_id,
                l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_code,
                l3_name, scope_type, current_level, standard_target_level,
                adjusted_target_level, effective_target_level, gap_value,
                member_priority, include_in_plan, plan_quarter, plan_month,
                standard_job_level_snapshot, member_current_level_snapshot,
                member_target_level_snapshot, capability_standard_version_id,
                planning_snapshot_id, assessment_revision, planning_source_type
            )
            VALUES (
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'assessment_approval'
            )
            """,
            (
                proposal_id,
                detail_id,
                int(assessment["id"]),
                l3_node_id,
                l1_code,
                l1_name,
                l2_code,
                l2_name,
                l3_code,
                l3_name,
                scope_type,
                current_level,
                standard_target_level,
                adjusted_target_level,
                effective_target_level,
                gap_value,
                member_priority,
                include_in_plan,
                plan_quarter,
                plan_month,
                standard_job_level_snapshot,
                assessment["member_current_level_snapshot"],
                assessment["member_target_level_snapshot"],
                version_id,
                int(snapshot[0]),
                int(assessment["revision"]),
            ),
        )
    return {
        "created": True,
        "proposal_id": proposal_id,
        "target_annual_growth_plan_id": target_plan_id,
        "target_is_legacy": target_is_legacy,
    }


def validate_assessment_canonical(
    connection: psycopg.Connection,
    assessment_id: int,
    *,
    require_planning_snapshot: bool = False,
) -> None:
    """Full #61 canonical submission validation, reused by the approval lock.

    Runs the exact same rules as member submit; approval additionally requires
    an immutable planning snapshot for every include_in_plan=TRUE detail.
    """
    _validate_submission(connection, assessment_id)
    if not require_planning_snapshot:
        return
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise ReviewError("assessment_not_found", "assessment not found")
    version_id = assessment.get("capability_standard_version_id")
    if version_id is None:
        raise ReviewError(
            "assessment_scope_required",
            "assessment has no bound standard version",
            status_code=422,
        )
    missing = connection.execute(
        """
        SELECT ad.l3_node_id, ad.l3_code
        FROM assessment_detail ad
        WHERE ad.assessment_id = %s AND ad.include_in_plan = TRUE
          AND NOT EXISTS (
              SELECT 1 FROM capability_standard_planning_snapshot sp
              WHERE sp.capability_standard_version_id = %s
                AND sp.l3_node_id = ad.l3_node_id
          )
        ORDER BY ad.l3_code
        """,
        (assessment_id, int(version_id)),
    ).fetchall()
    for node_id, code in missing:
        raise ReviewError(
            "planning_snapshot_missing",
            "missing immutable planning source snapshot",
            status_code=422,
            l3_node_id=int(node_id),
            l3_code=str(code),
        )
    # P1-2 (2nd review): the frozen plan-item/proposal-detail contract requires
    # the member level snapshots and a scope_type on every included row.  The
    # DB CHECK is the last line; here the approval path returns a structured
    # 422 instead of letting a DB CheckViolation surface as 500.
    if not assessment.get("member_current_level_snapshot") or not assessment.get(
        "member_target_level_snapshot"
    ):
        raise ReviewError(
            "assessment_scope_required",
            "assessment member level snapshots are required for approval",
            status_code=422,
        )
    unscoped = connection.execute(
        """
        SELECT l3_node_id, l3_code
        FROM assessment_detail
        WHERE assessment_id = %s AND include_in_plan = TRUE
          AND scope_type IS NULL
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    for node_id, code in unscoped:
        raise ReviewError(
            "planning_snapshot_incomplete",
            "included detail requires a frozen scope_type",
            status_code=422,
            l3_node_id=int(node_id),
            l3_code=str(code),
        )
    # P1-C (3rd review): the standard target is unconditionally frozen on
    # every included row — the DB CHECK is the last line; here the approval
    # path returns a structured 422 instead of a CheckViolation 500.
    missing_standard_target = connection.execute(
        """
        SELECT l3_node_id, l3_code
        FROM assessment_detail
        WHERE assessment_id = %s AND include_in_plan = TRUE
          AND standard_target_level IS NULL
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    for node_id, code in missing_standard_target:
        raise ReviewError(
            "planning_snapshot_incomplete",
            "included detail requires a frozen standard target level",
            status_code=422,
            l3_node_id=int(node_id),
            l3_code=str(code),
        )


def submit_assessment_review(
    connection: psycopg.Connection,
    review_id: int,
    buddy_id: int,
    conclusion: str,
    feedback: str | None,
    *,
    expected_revision: int,
    assessment_id_from_url: int,
    idempotency_key: str | None = None,
) -> dict[str, object]:
    if conclusion not in ("认可", "建议调整"):
        raise ReviewError("invalid_conclusion", "invalid conclusion", status_code=422)
    feedback_token = (feedback or "").strip()
    if conclusion == "建议调整" and not feedback_token:
        raise ReviewError(
            "feedback_required",
            "建议调整 requires non-empty feedback",
            status_code=422,
        )

    # Phase 0: read member/year without locks to acquire the business lock.
    pre = connection.execute(
        """
        SELECT ar.assessment_id, ar.sequence, ar.status, a.member_id, a.year
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        WHERE ar.id = %s
        """,
        (review_id,),
    ).fetchone()
    if pre is None:
        raise ReviewError("review_not_found", "review not found", status_code=404)
    assessment_id = int(pre[0])
    sequence = int(pre[1])
    member_id = int(pre[3])
    year = int(pre[4])
    if assessment_id != assessment_id_from_url:
        raise ReviewError(
            "assessment_mismatch",
            "review does not belong to the assessment in the URL",
            status_code=409,
        )
    fingerprint = _review_fingerprint(
        assessment_id,
        expected_revision,
        conclusion,
        feedback_token,
        buddy_id,
        sequence,
    )

    with connection.transaction():
        # 1. Early idempotency replay (pre-lock).
        if idempotency_key:
            replay = _lookup_idempotency(
                connection, buddy_id, idempotency_key, fingerprint
            )
            if replay is not None:
                return replay

        # 2. P1-2: fixed global lock order — buddy relationship lock first,
        # then the member+year review/plan lock, then the row locks.  The
        # relationship write path takes only the first lock, so the orders can
        # never deadlock; holding the relationship lock until commit closes the
        # TOCTOU where an Admin switches/ends the relationship between the
        # permission re-read and the Review commit.
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            (f"tcp_buddy_relationship:{member_id}",),
        )
        connection.execute(
            "SELECT pg_advisory_xact_lock(hashtext(%s))",
            (f"{_REVIEW_LOCK_NAMESPACE}:{member_id}:{year}",),
        )
        arow = connection.execute(
            """
            SELECT id, member_id, year, revision, status,
                   capability_standard_version_id, version,
                   member_current_level_snapshot, member_target_level_snapshot
            FROM assessment WHERE id = %s FOR UPDATE
            """,
            (assessment_id,),
        ).fetchone()
        if arow is None:
            raise ReviewError(
                "assessment_not_found", "assessment not found", status_code=404
            )
        if int(arow[1]) != member_id or int(arow[2]) != year:
            raise ReviewError(
                "assessment_mismatch",
                "assessment membership changed during review",
            )
        # Locked idempotency re-check: after the business locks are held but
        # before any state validation, so a concurrent same-key request replays
        # instead of being rejected as already-reviewed.
        if idempotency_key:
            replay = _lookup_idempotency(
                connection, buddy_id, idempotency_key, fingerprint
            )
            if replay is not None:
                return replay
        if str(arow[4]) != "待复核":
            if str(arow[4]) in ("已复核", "已归档", "建议调整"):
                raise ReviewError(
                    "assessment_already_reviewed",
                    "assessment was already reviewed",
                )
            raise ReviewError("review_not_pending", "assessment is not pending review")
        if int(arow[3]) != expected_revision:
            raise ReviewError(
                "revision_conflict",
                "revision conflict",
            )

        rrow = connection.execute(
            """
            SELECT id, assessment_id, status FROM assessment_review
            WHERE id = %s FOR UPDATE
            """,
            (review_id,),
        ).fetchone()
        if rrow is None or int(rrow[1]) != assessment_id or str(rrow[2]) != "待复核":
            raise ReviewError(
                "review_not_pending",
                "review is not pending",
            )

        # 3. Canonical Buddy permission re-check inside the lock.
        if not is_current_responsible_buddy(connection, member_id, buddy_id):
            raise ReviewError(
                "insufficient_permissions",
                "buddy is not the current responsible buddy for this member",
                status_code=403,
            )

        assessment: dict[str, object] = {
            "id": int(arow[0]),
            "member_id": int(arow[1]),
            "year": int(arow[2]),
            "revision": int(arow[3]),
            "status": str(arow[4]),
            "capability_standard_version_id": arow[5],
            "version": int(arow[6]),
            "member_current_level_snapshot": arow[7],
            "member_target_level_snapshot": arow[8],
        }

        # 5. Close the review (immutable history, actual closer recorded).
        reviewed_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment_review
            SET conclusion = %s, feedback = %s, reviewed_at = %s,
                status = '已闭环', reviewed_by_buddy_id = %s
            WHERE id = %s
            """,
            (conclusion, feedback_token or None, reviewed_at, buddy_id, review_id),
        )

        plan_payload: dict[str, object] | None = None
        proposal_payload: dict[str, object] | None = None
        if conclusion == "认可":
            validate_assessment_canonical(
                connection, assessment_id, require_planning_snapshot=True
            )
            plan_row = connection.execute(
                """
                SELECT id, source_assessment_id FROM annual_growth_plan
                WHERE member_id = %s AND year = %s
                FOR UPDATE
                """,
                (member_id, year),
            ).fetchone()
            if plan_row is None:
                plan_payload = _approve_first_assessment(
                    connection, assessment, member_id, year
                )
            elif plan_row[1] is not None and int(plan_row[1]) == assessment_id:
                raise ReviewError(
                    "inconsistent_plan_source",
                    "a formal plan already exists for this assessment",
                )
            else:
                proposal_payload = _approve_with_proposal(
                    connection,
                    assessment,
                    member_id,
                    year,
                    buddy_id,
                    int(plan_row[0]),
                    target_is_legacy=plan_row[1] is None,
                )
            # Final visible state is archived (passing through 已复核 internally;
            # submitted_at is untouched).
            connection.execute(
                """
                UPDATE assessment
                SET status = '已复核'
                WHERE id = %s
                """,
                (assessment_id,),
            )
            archive_assessment(connection, assessment_id, member_id)
            assessment_status = "已归档"
        else:
            connection.execute(
                """
                UPDATE assessment
                SET status = '建议调整'
                WHERE id = %s
                """,
                (assessment_id,),
            )
            assessment_status = "建议调整"

        next_revision = int(arow[3]) + 1
        connection.execute(
            "UPDATE assessment SET revision = %s WHERE id = %s",
            (next_revision, assessment_id),
        )

        response: dict[str, object] = {
            "ok": True,
            "assessment_status": assessment_status,
            "assessment_id": assessment_id,
            "revision": next_revision,
            "review": {
                "id": review_id,
                "sequence": sequence,
                "conclusion": conclusion,
                "feedback": feedback_token or None,
                "reviewed_by_buddy_id": buddy_id,
            },
            "plan": plan_payload,
            "proposal": proposal_payload,
            "idempotent_replayed": False,
        }
        if idempotency_key:
            response = _save_idempotency(
                connection,
                buddy_id,
                idempotency_key,
                assessment_id,
                review_id,
                fingerprint,
                response,
            )
        return response


def get_assessment_review_summary_for_buddy(
    connection: psycopg.Connection,
    buddy_id: int,
    year: int,
) -> dict[str, int]:
    """Return pending and completed assessment review counts for a Buddy in a year."""
    row = connection.execute(
        """
        SELECT
            COUNT(*) FILTER (
                WHERE ar.status = '待复核'
            ) AS pending_count,
            COUNT(*) FILTER (
                WHERE ar.status = '已闭环'
                  AND EXTRACT(YEAR FROM ar.reviewed_at)::INT = %s
            ) AS completed_count
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        WHERE ar.buddy_id = %s AND a.year = %s
        """,
        (year, buddy_id, year),
    ).fetchone()
    if row is None:
        return {"pending_count": 0, "completed_count": 0}
    return {
        "pending_count": int(row[0] or 0),
        "completed_count": int(row[1] or 0),
    }


def _frozen_data_issues(details: list[dict[str, object]]) -> int:
    """Count inconsistencies visible in frozen details (never fixes them).

    Re-computation is advisory only: canonical target/gap values are never
    overwritten, mismatches merely surface as data issues for the Buddy.
    """
    issues = 0
    for detail in details:
        current = detail.get("current_level")
        target = detail.get("target_level")
        gap = detail.get("gap_value")
        if (
            current is not None
            and target is not None
            and gap is not None
            and int(gap) != max(int(target) - int(current), 0)
        ):
            issues += 1
            continue
        include = detail.get("include_in_plan")
        quarter = detail.get("plan_quarter")
        month = detail.get("plan_month")
        if include is True and (quarter is None or month is None):
            issues += 1
            continue
        if include is False and (quarter is not None or month is not None):
            issues += 1
            continue
        if detail.get("member_priority") == "暂缓" and include is True:
            issues += 1
            continue
        if (
            detail.get("target_adjusted")
            and not (detail.get("target_adjustment_reason") or "").strip()
        ):
            issues += 1
            continue
        if (
            quarter is not None
            and month is not None
            and not (
                (quarter == "Q1" and 1 <= int(month) <= 3)
                or (quarter == "Q2" and 4 <= int(month) <= 6)
                or (quarter == "Q3" and 7 <= int(month) <= 9)
                or (quarter == "Q4" and 10 <= int(month) <= 12)
            )
        ):
            issues += 1
    return issues


def _detail_data_issue(detail: dict[str, object]) -> bool:
    """Advisory per-detail consistency flag (never fixes canonical values)."""
    current = detail.get("current_level")
    target = detail.get("target_level")
    gap = detail.get("gap_value")
    if (
        current is not None
        and target is not None
        and gap is not None
        and int(gap) != max(int(target) - int(current), 0)
    ):
        return True
    include = detail.get("include_in_plan")
    quarter = detail.get("plan_quarter")
    month = detail.get("plan_month")
    if include is True and (quarter is None or month is None):
        return True
    if include is False and (quarter is not None or month is not None):
        return True
    if detail.get("member_priority") == "暂缓" and include is True:
        return True
    if (
        detail.get("target_adjusted")
        and not (detail.get("target_adjustment_reason") or "").strip()
    ):
        return True
    if (
        quarter is not None
        and month is not None
        and not (
            (quarter == "Q1" and 1 <= int(month) <= 3)
            or (quarter == "Q2" and 4 <= int(month) <= 6)
            or (quarter == "Q3" and 7 <= int(month) <= 9)
            or (quarter == "Q4" and 10 <= int(month) <= 12)
        )
    ):
        return True
    return False


def get_buddy_review_workspace(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object] | None:
    """Buddy Review workspace DTO — frozen facts only, no live catalog reads.

    effective target and gap are read straight from the canonical
    assessment_detail columns; advisory recomputation only feeds data_issues.
    """
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        return None
    details = [d for d in assessment["details"] if d.get("l3_node_id") is not None]
    scope_details = [d for d in assessment["details"] if d.get("scope_type")]
    member_id = int(assessment["member_id"])
    year = int(assessment["year"])

    plan_row = connection.execute(
        """
        SELECT id, source_assessment_id FROM annual_growth_plan
        WHERE member_id = %s AND year = %s
        """,
        (member_id, year),
    ).fetchone()
    existing_formal_plan = plan_row is not None
    will_create_proposal = existing_formal_plan and (
        plan_row[1] is None or int(plan_row[1]) != assessment_id
    )

    by_quarter = {"Q1": 0, "Q2": 0, "Q3": 0, "Q4": 0}
    in_plan = 0
    adjustments = 0
    for detail in details:
        if detail.get("include_in_plan") is True:
            in_plan += 1
            quarter = detail.get("plan_quarter")
            if quarter in by_quarter:
                by_quarter[quarter] += 1
        if detail.get("target_adjusted"):
            adjustments += 1

    summary = {
        "total": len(assessment["details"]),
        "current_required": sum(
            1 for d in scope_details if d.get("scope_type") == "current_required"
        ),
        "target_progressive": sum(
            1 for d in scope_details if d.get("scope_type") == "target_progressive"
        ),
        "assessed": sum(
            1 for d in assessment["details"] if d.get("current_level") is not None
        ),
        "gap_items": sum(
            1 for d in assessment["details"] if (d.get("gap_value") or 0) > 0
        ),
        "high": sum(1 for d in details if d.get("member_priority") == "高"),
        "medium": sum(1 for d in details if d.get("member_priority") == "中"),
        "low": sum(1 for d in details if d.get("member_priority") == "低"),
        "hold": sum(1 for d in details if d.get("member_priority") == "暂缓"),
        "in_plan": in_plan,
        "by_quarter": by_quarter,
        "adjustments": adjustments,
        "data_issues": _frozen_data_issues(assessment["details"]),
        "existing_formal_plan": existing_formal_plan,
        "will_create_proposal": will_create_proposal,
        "target_is_legacy": (
            bool(plan_row is not None and plan_row[1] is None)
            if existing_formal_plan
            else None
        ),
    }
    workspace_details = []
    for detail in assessment["details"]:
        detail = dict(detail)
        detail["data_issue"] = _detail_data_issue(detail)
        workspace_details.append(detail)

    return {
        "assessment_id": assessment_id,
        "member_id": member_id,
        "year": year,
        "version": int(assessment["version"]),
        "assessment_status": str(assessment["status"]),
        "revision": int(assessment["revision"]),
        "member_current_level_snapshot": assessment.get(
            "member_current_level_snapshot"
        ),
        "member_target_level_snapshot": assessment.get("member_target_level_snapshot"),
        "standard_version": {
            "id": assessment.get("capability_standard_version_id"),
            "label": assessment.get("standard_version_label"),
        },
        "summary": summary,
        "details": workspace_details,
    }
