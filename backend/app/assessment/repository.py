import json
from typing import Any

import psycopg

from ..access.repository import get_primary_buddy, is_member_assigned_to_buddy
from ..catalog.repository import DOMAIN_CODES, get_l3_contexts
from ..catalog.standard_versions import StandardVersionError, published_matrix_for_model


class AssessmentValidationError(ValueError):
    def __init__(self, l3_code: str, reason: str, message: str) -> None:
        super().__init__(message)
        self.code = "assessment_validation_failed"
        self.l3_code = l3_code
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
    row: tuple[object, ...]
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


def create_assessment_draft(
    connection: psycopg.Connection,
    member_id: int,
    year: int,
    assessment_type: str = "年度",
) -> int:
    with connection.transaction():
        member_row = connection.execute(
            "SELECT current_level, target_level FROM tcp_user WHERE id = %s",
            (member_id,),
        ).fetchone()
        if member_row is None:
            raise ValueError("member not found")
        member_current_level, member_target_level = member_row
        if not _is_job_level(member_current_level):
            raise ValueError("member current_level is required")
        if not _is_job_level(member_target_level):
            raise ValueError("member target_level is required")
        if int(member_current_level[1:]) > int(member_target_level[1:]):
            raise ValueError("member current_level cannot exceed target_level")
        model = connection.execute(
            "SELECT id FROM capability_model ORDER BY id LIMIT 1"
        ).fetchone()
        if model is None:
            raise ValueError("capability model not found")
        try:
            standard_version_id, capability_rows = published_matrix_for_model(
                connection, int(model[0]), str(member_target_level)
            )
        except StandardVersionError as exc:
            raise ValueError(str(exc)) from exc
        source = get_latest_approved_assessment_for_member(connection, member_id)
        inherited = {}
        if source is not None:
            inherited = {
                row[0]: row
                for row in connection.execute(
                    """
                    SELECT l3_code, current_level, evidence_note
                    FROM assessment_detail
                    WHERE assessment_id = %s
                    """,
                    (source["id"],),
                ).fetchall()
            }
        snapshots = []
        for code, applicable, standard_target, standard_source in capability_rows:
            inherited_row = inherited.get(code)
            inherited_current = inherited_row[1] if inherited_row else None
            inherited_evidence = inherited_row[2] if inherited_row else None
            can_inherit_level = (
                applicable is True
                and inherited_row is not None
                and inherited_current is not None
                and 1 <= int(inherited_current) <= 5
            )
            can_inherit_evidence = (
                can_inherit_level
                and isinstance(inherited_evidence, str)
                and bool(inherited_evidence.strip())
            )
            can_inherit = can_inherit_level or can_inherit_evidence
            snapshots.append(
                (
                    code,
                    bool(applicable),
                    standard_target,
                    standard_target,
                    f"published_standard_version:{standard_version_id}:{standard_source}",
                    inherited_current if can_inherit_level else None,
                    inherited_evidence.strip() if can_inherit_evidence else None,
                    source["id"] if can_inherit and source else None,
                )
            )

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

        row = connection.execute(
            """
            INSERT INTO assessment (
                member_id, year, version, assessment_type, status,
                member_current_level_snapshot, member_target_level_snapshot,
                capability_standard_version_id
            )
            VALUES (%s, %s, %s, %s, '草稿', %s, %s, %s)
            RETURNING id
            """,
            (
                member_id,
                year,
                version,
                assessment_type,
                member_current_level,
                member_target_level,
                standard_version_id,
            ),
        ).fetchone()
        assert row is not None
        assessment_id = row[0]

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
                    inherited_current_level, inherited_evidence_note
                )
                VALUES (
                    %s, %s, %s, %s, %s, %s, FALSE, NULL, NULL, %s,
                    NULL, NULL, %s, FALSE, %s, %s, %s
                )
                """,
                [
                    (
                        assessment_id,
                        code,
                        inherited_current,
                        target,
                        applicable,
                        standard,
                        snapshot_source,
                        inherited_evidence,
                        inherited_source,
                        inherited_current,
                        inherited_evidence,
                    )
                    for (
                        code,
                        applicable,
                        standard,
                        target,
                        snapshot_source,
                        inherited_current,
                        inherited_evidence,
                        inherited_source,
                    ) in snapshots
                ],
            )

    return assessment_id


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
               u.current_level, u.target_level
        FROM assessment AS a
        JOIN tcp_user AS u ON u.id = a.member_id
        WHERE a.id = %s
        """,
        (assessment_id,),
    ).fetchone()
    if row is None:
        return None

    details = _get_assessment_details(connection, assessment_id)
    status_value = str(row[5])
    return {
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
        "details": details,
        "l2_groups": _get_assessment_l2_groups(
            connection,
            details,
            include_requirements=status_value in {"草稿", "待复核", "建议调整"},
        ),
        "gap_summary": _get_gap_summary(connection, assessment_id),
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
               ad.current_level_explicitly_cleared
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
        }
        for row in rows
    ]
    contexts = get_l3_contexts(
        connection, [str(detail["l3_code"]) for detail in details]
    )
    for detail in details:
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
) -> list[dict[str, object]]:
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


def _get_gap_summary(
    connection: psycopg.Connection, assessment_id: int
) -> dict[str, object]:
    """Aggregate gap statistics for the assessment's Gap sidebar."""
    gaps = [
        max(int(row[0]) - int(row[1]), 0)
        for row in connection.execute(
            """
            SELECT target_level, current_level
            FROM assessment_detail
            WHERE assessment_id = %s AND target_level > current_level
            """,
            (assessment_id,),
        ).fetchall()
    ]
    total = len(gaps)
    avg = round(sum(gaps) / total, 1) if total > 0 else 0
    by_priority: dict[str, int] = {"高": 0, "中": 0, "低": 0}
    for g in gaps:
        if g >= 3:
            by_priority["高"] += 1
        elif g > 0:
            by_priority["中"] += 1
        else:
            by_priority["低"] += 1
    return {
        "total_gaps": total,
        "avg_gap": avg,
        "high_priority": by_priority["高"],
        "medium_priority": by_priority["中"],
        "low_priority": by_priority["低"],
    }


def list_member_assessments(
    connection: psycopg.Connection, member_id: int
) -> list[dict[str, object]]:
    rows = connection.execute(
        """
        SELECT id, member_id, year, version, assessment_type, status,
               created_at, submitted_at, archived_at, revision
        FROM assessment
        WHERE member_id = %s
        ORDER BY created_at DESC
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
            raise ValueError("assessment is not editable")
        if owner_id != member_id:
            raise ValueError("assessment does not belong to member")
        if int(revision) != expected_revision:
            raise ValueError("revision conflict")

        snapshot_rows = connection.execute(
            """
            SELECT id, l3_code, standard_target_applicable,
                   standard_target_level, target_compatibility_error,
                   target_level, gap_value, target_snapshot_source, plan_candidate,
                   inherited_current_level, inherited_evidence_note,
                   current_level_explicitly_cleared
            FROM assessment_detail
            WHERE assessment_id = %s
            ORDER BY l3_code
            """,
            (assessment_id,),
        ).fetchall()
        snapshots = {row[1]: row for row in snapshot_rows}
        submitted_codes = [str(detail.get("l3_code", "")) for detail in details]
        if len(submitted_codes) != len(set(submitted_codes)):
            raise ValueError("duplicate assessment detail")
        if set(submitted_codes) != set(snapshots):
            raise ValueError("batch must include every assessment detail")

        forbidden_fields = {
            "target_level",
            "standard_target_applicable",
            "standard_target_level",
            "target_snapshot_source",
            "target_compatibility_error",
            "gap_value",
        }
        auto_cancelled: list[str] = []
        for detail in details:
            forbidden = forbidden_fields.intersection(detail)
            if forbidden:
                raise ValueError(
                    "member cannot set calculated target fields: "
                    + ", ".join(sorted(forbidden))
                )
            (
                detail_id,
                code,
                applicable,
                standard_target,
                compatibility_error,
                existing_target,
                existing_gap,
                snapshot_source,
                existing_plan_candidate,
                inherited_current_level,
                inherited_evidence,
                existing_explicitly_cleared,
            ) = snapshots[str(detail["l3_code"])]
            if compatibility_error and detail.get("_detail_present", True):
                raise ValueError(
                    f"assessment detail {code} requires compatibility repair"
                )

            cl = detail.get("current_level")
            current_level = int(cl) if cl is not None else None
            current_level_present = bool(detail.get("_current_level_present", True))
            explicitly_cleared = current_level is None and current_level_present
            if current_level is None and not current_level_present:
                explicitly_cleared = bool(existing_explicitly_cleared)
            if current_level is not None and (
                isinstance(cl, bool) or not 1 <= current_level <= 5
            ):
                raise ValueError("current_level must be between 1 and 5")

            target_adjusted = detail.get("target_adjusted", False)
            if not isinstance(target_adjusted, bool):
                raise ValueError("target_adjusted must be boolean")
            adjusted = detail.get("adjusted_target_level")
            reason = detail.get("target_adjustment_reason")
            plan_candidate = detail.get("plan_candidate", False)
            if not isinstance(plan_candidate, bool):
                raise ValueError("plan_candidate must be boolean")

            legacy_preserved = (
                snapshot_source == "legacy_preserved"
                and applicable is None
                and existing_target is not None
            )
            if legacy_preserved:
                if target_adjusted or adjusted is not None or reason is not None:
                    raise ValueError(
                        f"legacy preserved target {code} cannot be adjusted"
                    )
                final_target = int(existing_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else existing_gap
                )
            elif applicable is not True:
                if target_adjusted or adjusted is not None or reason is not None:
                    raise ValueError(
                        f"not applicable item {code} cannot be adjusted or planned"
                    )
                current_level = None
                final_target = None
                gap_value = None
                if plan_candidate and not existing_plan_candidate:
                    raise ValueError(
                        f"not applicable item {code} cannot be adjusted or planned"
                    )
                plan_candidate = False
            else:
                if standard_target is None:
                    raise ValueError(f"assessment detail {code} has no standard target")
                if target_adjusted:
                    if (
                        isinstance(adjusted, bool)
                        or not isinstance(adjusted, int)
                        or not 1 <= adjusted <= 5
                    ):
                        raise ValueError(
                            "adjusted_target_level must be between 1 and 5"
                        )
                    if not isinstance(reason, str) or not reason.strip():
                        raise ValueError("adjustment reason is required")
                    final_target = adjusted
                    reason = reason.strip()
                else:
                    if adjusted is not None or reason is not None:
                        raise ValueError("adjustment fields require target_adjusted")
                    final_target = int(standard_target)
                gap_value = (
                    max(final_target - current_level, 0)
                    if current_level is not None
                    else None
                )

            if plan_candidate:
                evidence = detail.get("evidence_note")
                valid_evidence = _evidence_is_valid(
                    current_level,
                    evidence,
                    inherited_current_level,
                    inherited_evidence,
                )
                candidate_valid = (
                    (applicable is True or legacy_preserved)
                    and current_level is not None
                    and final_target is not None
                    and gap_value > 0
                    and not compatibility_error
                    and valid_evidence
                )
                if not candidate_valid:
                    if existing_plan_candidate:
                        plan_candidate = False
                        auto_cancelled.append(code)
                    else:
                        raise ValueError(f"invalid plan candidate for {code}")

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
                    plan_candidate = %s
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
                    plan_candidate,
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
            "auto_cancelled_plan_candidates": auto_cancelled,
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
               evidence_note, plan_candidate,
               current_level_explicitly_cleared
        FROM assessment_detail
        WHERE assessment_id = %s
        ORDER BY l3_code
        """,
        (assessment_id,),
    ).fetchall()
    merged = {
        row[0]: {
            "l3_code": row[0],
            "current_level": row[1],
            "target_adjusted": row[2],
            "adjusted_target_level": row[3],
            "target_adjustment_reason": row[4],
            "evidence_note": row[5],
            "plan_candidate": row[6],
            "current_level_explicitly_cleared": row[7],
            "_current_level_present": False,
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
        "plan_candidate",
    }
    for detail in details:
        code = str(detail.get("l3_code", ""))
        if code not in merged:
            raise ValueError("unknown assessment detail")
        forbidden = set(detail) - (allowed | {"l3_code"})
        if forbidden:
            raise ValueError("member cannot set calculated target fields")
        if "current_level" in detail:
            merged[code]["_current_level_present"] = True
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
    if current_level not in (1, 2):
        raise ValueError("batch current_level must be 1 or 2")
    rows = connection.execute(
        """
        SELECT ad.l3_code
        FROM assessment_detail ad
        JOIN capability_node l3 ON l3.code = ad.l3_code AND l3.node_type = 'L3'
        JOIN capability_node l2 ON l2.id = l3.parent_node_id
        WHERE ad.assessment_id = %s AND l2.code = %s
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
        JOIN capability_node l3 ON l3.code = ad.l3_code AND l3.node_type = 'L3'
        JOIN capability_node l2 ON l2.id = l3.parent_node_id
        WHERE ad.assessment_id = %s AND l2.code = %s
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
            "auto_cancelled_plan_candidates": [],
            "gap_summary": _get_gap_summary(connection, assessment_id),
        }
    result = patch_assessment_draft(
        connection,
        assessment_id,
        member_id,
        expected_revision,
        [{"l3_code": row[0], "current_level": current_level} for row in rows],
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
               target_level, evidence_note, target_compatibility_error,
               plan_candidate, inherited_current_level, inherited_evidence_note
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
        evidence,
        compatibility_error,
        plan_candidate,
        inherited_current,
        inherited_evidence,
    ) in rows:
        if compatibility_error:
            raise AssessmentValidationError(
                code,
                "compatibility_repair_required",
                f"assessment detail {code} requires compatibility repair",
            )
        if applicable is False:
            if current_level is not None or target_level is not None or plan_candidate:
                raise AssessmentValidationError(
                    code,
                    "not_applicable_incomplete",
                    f"not applicable item {code} is incomplete",
                )
            continue
        if current_level is None or target_level is None:
            raise AssessmentValidationError(
                code,
                "requires_current_level",
                f"assessment detail {code} requires current level",
            )
        if not _evidence_is_valid(
            current_level, evidence, inherited_current, inherited_evidence
        ):
            reason = (
                "requires_updated_evidence"
                if inherited_current is not None and current_level > inherited_current
                else "requires_evidence"
            )
            message = (
                f"assessment detail {code} requires updated evidence"
                if reason == "requires_updated_evidence"
                else f"assessment detail {code} requires evidence"
            )
            raise AssessmentValidationError(code, reason, message)
        if plan_candidate and (target_level - current_level) <= 0:
            raise AssessmentValidationError(
                code,
                "invalid_plan_candidate",
                f"invalid plan candidate for {code}",
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
        return {"revision": next_revision, "auto_cancelled_plan_candidates": []}


def generate_gaps_for_assessment(
    connection: psycopg.Connection, assessment_id: int
) -> None:
    details = _get_assessment_details(connection, assessment_id)
    for detail in details:
        raw_gap_value = detail["gap_value"]
        if raw_gap_value is None:
            connection.execute(
                """
                DELETE FROM gap
                WHERE assessment_id = %s AND l3_code = %s
                """,
                (assessment_id, detail["l3_code"]),
            )
            continue
        gap_value = int(raw_gap_value)
        if gap_value > 0:
            connection.execute(
                """
                INSERT INTO gap (
                    assessment_id, l3_code, current_level, target_level,
                    gap_value, plan_candidate
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                ON CONFLICT (assessment_id, l3_code)
                DO UPDATE SET
                    current_level = EXCLUDED.current_level,
                    target_level = EXCLUDED.target_level,
                    gap_value = EXCLUDED.gap_value,
                    plan_candidate = EXCLUDED.plan_candidate
                """,
                (
                    assessment_id,
                    detail["l3_code"],
                    detail["current_level"],
                    detail["target_level"],
                    gap_value,
                    detail["plan_candidate"],
                ),
            )
        else:
            connection.execute(
                """
                DELETE FROM gap
                WHERE assessment_id = %s AND l3_code = %s
                """,
                (assessment_id, detail["l3_code"]),
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
               a.member_id
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
        }
        for row in rows
    ]


def get_gap(connection: psycopg.Connection, gap_id: int) -> dict[str, object] | None:
    row = connection.execute(
        """
        SELECT g.id, g.assessment_id, g.l3_code, g.current_level,
               g.target_level, g.gap_value, g.priority, g.plan_candidate,
               a.member_id
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
    rows = connection.execute(
        """
        SELECT ar.id, ar.assessment_id, ar.sequence, ar.buddy_id, ar.status,
               a.member_id, a.year, a.version, a.status AS assessment_status,
               a.submitted_at
        FROM assessment_review ar
        JOIN assessment a ON a.id = ar.assessment_id
        WHERE ar.buddy_id = %s AND ar.status = '待复核'
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


def submit_assessment_review(
    connection: psycopg.Connection,
    review_id: int,
    buddy_id: int,
    conclusion: str,
    feedback: str | None,
) -> None:
    if conclusion not in ("认可", "建议调整"):
        raise ValueError("invalid conclusion")

    with connection.transaction():
        row = connection.execute(
            """
            SELECT ar.assessment_id, ar.buddy_id, ar.status, a.member_id
            FROM assessment_review ar
            JOIN assessment a ON a.id = ar.assessment_id
            WHERE ar.id = %s
            """,
            (review_id,),
        ).fetchone()
        if row is None:
            raise ValueError("review not found")
        assessment_id, review_buddy_id, review_status, member_id = row
        if review_status != "待复核":
            raise ValueError("review is not pending")
        if int(review_buddy_id) != buddy_id:
            raise ValueError("review is not assigned to this buddy")
        if not is_member_assigned_to_buddy(connection, int(member_id), buddy_id):
            raise ValueError("buddy is not assigned to member")

        reviewed_at = _now(connection)
        connection.execute(
            """
            UPDATE assessment_review
            SET conclusion = %s, feedback = %s, reviewed_at = %s, status = '已闭环'
            WHERE id = %s
            """,
            (conclusion, feedback, reviewed_at, review_id),
        )

        if conclusion == "认可":
            connection.execute(
                """
                UPDATE assessment
                SET status = '已复核'
                WHERE id = %s
                """,
                (assessment_id,),
            )
            archive_assessment(connection, assessment_id, int(member_id))
        else:
            connection.execute(
                """
                UPDATE assessment
                SET status = '建议调整'
                WHERE id = %s
                """,
                (assessment_id,),
            )


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
