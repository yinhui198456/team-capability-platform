import psycopg
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ..access.policies import Connection, CurrentUser, require_any_role
from . import policies
from .repository import (
    DetailValidationError,
    DraftTargetRepairError,
    batch_fill_l2,
    create_assessment_draft,
    generate_plan_items_for_selection,
    get_assessment,
    get_assessment_review_summary_for_buddy,
    get_assessment_reviews,
    get_buddy_review_workspace,
    get_draft_target_repair_preview,
    get_gap,
    get_pending_reviews_for_buddy,
    list_gaps,
    list_member_assessments,
    patch_assessment_draft,
    repair_draft_target_snapshots,
    update_gap,
)
from .scope import AssessmentScopeError, compute_assessment_scope

_VALID_ASSESSMENT_TYPES = frozenset({"年度", "年中更新", "晋升复核"})
_DEPRECATED_FIELDS = frozenset({"plan_candidate"})
_READ_ONLY_TARGET_ADJUSTMENT_FIELDS = frozenset(
    {"target_adjusted", "adjusted_target_level", "target_adjustment_reason"}
)


def _validate_assessment_type(assessment_type: str) -> None:
    if assessment_type not in _VALID_ASSESSMENT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_assessment_type",
                "message": (
                    f"assessment_type must be one of "
                    f"{', '.join(sorted(_VALID_ASSESSMENT_TYPES))}"
                ),
            },
        )


class CreateAssessmentRequest(BaseModel):
    year: int
    assessment_type: str = Field(default="年度")
    scope_token: str = Field(min_length=64, max_length=64)


# ── PUT model: full replacement, all fields required ──────────────
class DetailItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    l3_node_id: int | None = None
    l3_code: str
    current_level: int | None = Field(default=None, ge=0, le=5)
    target_adjusted: bool = False
    adjusted_target_level: int | None = Field(default=None, ge=1, le=5)
    target_adjustment_reason: str | None = None
    evidence_note: str | None = None
    # Canonical plan fields (Issue #194: plan_month is TEXT 'YYYY-MM';
    # plan_quarter is derived server-side and never accepted as input)
    member_priority: str | None = Field(default=None, pattern=r"^(高|中|低|暂缓)$")
    include_in_plan: bool | None = None  # tri-state: None=未决定
    plan_quarter: str | None = Field(default=None, pattern=r"^(Q1|Q2|Q3|Q4)$")
    plan_month: str | None = Field(default=None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
    # Accepted for backward compat but rejected in handler
    plan_candidate: bool = False


class SaveDraftRequest(BaseModel):
    details: list[DetailItem]
    expected_revision: int = Field(ge=1)


# ── PATCH model: sparse, null = explicit clear ────────────────────
class PatchDetailItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    l3_node_id: int | None = None
    l3_code: str
    current_level: int | None = Field(default=None, ge=0, le=5)
    target_adjusted: bool | None = None
    adjusted_target_level: int | None = Field(default=None, ge=1, le=5)
    target_adjustment_reason: str | None = None
    evidence_note: str | None = None
    member_priority: str | None = Field(default=None, pattern=r"^(高|中|低|暂缓)$")
    include_in_plan: bool | None = None
    plan_quarter: str | None = Field(default=None, pattern=r"^(Q1|Q2|Q3|Q4)$")
    plan_month: str | None = Field(default=None, pattern=r"^[0-9]{4}-(0[1-9]|1[0-2])$")
    # Accepted for backward compat but rejected in handler
    plan_candidate: bool | None = None


# ponytail: distinguish from PUT model by field-set introspection.
# Fields not present in the JSON body are absent from model_fields_set;
# fields sent as explicit null are present with value None.


class PatchSaveDraftRequest(BaseModel):
    details: list[PatchDetailItem]
    expected_revision: int = Field(ge=1)


class BatchLevelRequest(BaseModel):
    l2_code: str
    current_level: int = Field(ge=0, le=2)
    expected_revision: int = Field(ge=1)


class SubmitRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class GeneratePlanItemsRequest(BaseModel):
    l3_codes: list[str] = Field(min_length=1)
    expected_revision: int = Field(ge=1)


def _reject_plan_quarter(item: DetailItem) -> None:
    """Issue #194: plan_quarter is a derived compat column — the frontend
    must not send it (derive only happens from plan_month server-side)."""
    quarter = item.plan_quarter
    if quarter is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "plan_quarter_derived",
                "field": "plan_quarter",
                "reason": "derived_from_plan_month",
                "message": (
                    "plan_quarter 由 plan_month 自动推导，不接受前端输入；"
                    "请仅提交 plan_month（YYYY-MM）"
                ),
            },
        )


def _reject_target_adjustment(item: DetailItem | PatchDetailItem) -> None:
    fields = _READ_ONLY_TARGET_ADJUSTMENT_FIELDS & item.model_fields_set
    if fields:
        field = sorted(fields)[0]
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "target_adjustment_read_only",
                "field": field,
                "message": "个人调整目标为历史只读信息，不能创建或编辑",
            },
        )


class DraftTargetRepairRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class SubmitReviewRequest(BaseModel):
    conclusion: str = Field(pattern=r"^(认可|建议调整)$")
    feedback: str | None = None
    expected_revision: int = Field(ge=1)


assessment_router = APIRouter(prefix="/api/assessments")


def _detail_validation_error(exc: DetailValidationError) -> HTTPException:
    detail: dict[str, object] = {
        "code": exc.code,
        "message": str(exc),
    }
    if exc.l3_node_id is not None:
        detail["l3_node_id"] = exc.l3_node_id
    if exc.l3_code is not None:
        detail["l3_code"] = exc.l3_code
    if exc.field is not None:
        detail["field"] = exc.field
    if exc.reason is not None:
        detail["reason"] = exc.reason
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=detail,
    )


def _draft_repair_error(exc: DraftTargetRepairError) -> HTTPException:
    status_code = {
        "assessment_not_found": status.HTTP_404_NOT_FOUND,
        "draft_repair_forbidden": status.HTTP_403_FORBIDDEN,
        "draft_repair_state_conflict": status.HTTP_409_CONFLICT,
        "draft_repair_revision_conflict": status.HTTP_409_CONFLICT,
        "draft_repair_has_unrepairable_details": (status.HTTP_422_UNPROCESSABLE_ENTITY),
    }.get(exc.code, status.HTTP_422_UNPROCESSABLE_ENTITY)
    return HTTPException(
        status_code=status_code,
        detail={"code": exc.code, "message": str(exc)},
    )


def _scope_error(exc: AssessmentScopeError) -> HTTPException:
    detail: dict[str, object] = {
        "code": exc.code,
        "message": str(exc),
        "issues": exc.issues,
    }
    if exc.summary is not None:
        detail["summary"] = exc.summary
    return HTTPException(status_code=exc.status_code, detail=detail)


@assessment_router.get("/scope-preview")
def scope_preview(
    user: CurrentUser,
    connection: Connection,
    year: int,
    assessment_type: str = "年度",
) -> dict[str, object]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    _validate_assessment_type(assessment_type)
    try:
        # Fixed consistency scheme: one read-only REPEATABLE READ snapshot.
        # The auth dependency already queried on this connection, so close
        # that implicit transaction before pinning the isolation level.
        connection.rollback()
        connection.isolation_level = psycopg.IsolationLevel.REPEATABLE_READ
        connection.read_only = True
        try:
            with connection.transaction():
                scope = compute_assessment_scope(
                    connection,
                    member_id=int(user["id"]),
                    year=year,
                    assessment_type=assessment_type,
                )
                open_draft = connection.execute(
                    """
                    SELECT id FROM assessment
                    WHERE member_id = %s AND year = %s AND assessment_type = %s
                      AND status IN ('草稿', '建议调整')
                    """,
                    (int(user["id"]), year, assessment_type),
                ).fetchone()
        finally:
            connection.read_only = False
            connection.isolation_level = None
    except AssessmentScopeError as exc:
        raise _scope_error(exc) from exc
    scope["open_draft_id"] = int(open_draft[0]) if open_draft is not None else None
    return scope


@assessment_router.post("")
def create_assessment(
    request: CreateAssessmentRequest,
    user: CurrentUser,
    connection: Connection,
    idempotency_key: str | None = Header(default=None),
) -> dict[str, object]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    _validate_assessment_type(request.assessment_type)
    try:
        return create_assessment_draft(
            connection,
            int(user["id"]),
            request.year,
            request.assessment_type,
            scope_token=request.scope_token,
            idempotency_key=idempotency_key,
        )
    except AssessmentScopeError as exc:
        raise _scope_error(exc) from exc


@assessment_router.get("")
def list_assessments(
    user: CurrentUser,
    connection: Connection,
) -> list[dict[str, object]]:
    roles: list[str] = user["roles"]

    if "Admin" in roles or "Leader" in roles:
        # ponytail: MVP single-team leader view returns all assessments.
        rows = connection.execute(
            """
            SELECT a.id, a.member_id, a.year, a.version, a.assessment_type,
                   a.status, a.created_at, a.submitted_at, a.archived_at,
                   a.revision, a.member_current_level_snapshot,
                   a.member_target_level_snapshot, a.assessment_scope_version,
                   sv.label
            FROM assessment AS a
            LEFT JOIN capability_standard_version AS sv
              ON sv.id = a.capability_standard_version_id
            ORDER BY a.created_at DESC
            """
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

    if "Buddy" in roles:
        from ..access.repository import get_assigned_members

        assigned = get_assigned_members(connection, int(user["id"]))
        member_ids = [int(member["id"]) for member in assigned]
        # Buddy is often also a Member; include own assessments too if Member.
        if "Member" in roles:
            member_ids.append(int(user["id"]))
        if not member_ids:
            return []
        rows = connection.execute(
            """
            SELECT a.id, a.member_id, a.year, a.version, a.assessment_type,
                   a.status, a.created_at, a.submitted_at, a.archived_at,
                   a.revision, a.member_current_level_snapshot,
                   a.member_target_level_snapshot, a.assessment_scope_version,
                   sv.label
            FROM assessment AS a
            LEFT JOIN capability_standard_version AS sv
              ON sv.id = a.capability_standard_version_id
            WHERE a.member_id = ANY(%s)
            ORDER BY a.created_at DESC
            """,
            (member_ids,),
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

    # Member only
    return list_member_assessments(connection, int(user["id"]))


@assessment_router.get("/reviews/pending")
def list_pending_reviews(
    user: CurrentUser,
    connection: Connection,
) -> list[dict[str, object]]:
    if "Buddy" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return get_pending_reviews_for_buddy(connection, int(user["id"]))


@assessment_router.get("/reviews/summary")
def get_assessment_review_summary(
    user: CurrentUser,
    connection: Connection,
    year: int,
) -> dict[str, int]:
    if "Buddy" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return get_assessment_review_summary_for_buddy(connection, int(user["id"]), year)


@assessment_router.get("/{assessment_id}")
def get_assessment_detail(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if not policies.can_view_assessment(connection, user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return assessment


@assessment_router.get("/{assessment_id}/draft-target-repair/preview")
def preview_draft_target_repair(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "assessment_not_found", "message": "assessment not found"},
        )
    if not policies.can_repair_draft(user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "draft_repair_forbidden",
                "message": "insufficient permissions",
            },
        )
    try:
        return get_draft_target_repair_preview(connection, assessment_id)
    except DraftTargetRepairError as exc:
        raise _draft_repair_error(exc) from exc


@assessment_router.post("/{assessment_id}/draft-target-repair")
def execute_draft_target_repair(
    assessment_id: int,
    request: DraftTargetRepairRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"code": "assessment_not_found", "message": "assessment not found"},
        )
    if not policies.can_repair_draft(user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "code": "draft_repair_forbidden",
                "message": "insufficient permissions",
            },
        )
    try:
        return repair_draft_target_snapshots(
            connection,
            assessment_id,
            int(user["id"]),
            expected_revision=request.expected_revision,
        )
    except DraftTargetRepairError as exc:
        raise _draft_repair_error(exc) from exc


@assessment_router.put("/{assessment_id}/draft")
def save_draft(
    assessment_id: int,
    request: SaveDraftRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if not policies.can_member_edit(user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    # R1: scope-v1 requires l3_node_id on every detail.
    assessment_scope_version = assessment.get("assessment_scope_version")
    if assessment_scope_version is not None:
        missing = [item.l3_code for item in request.details if item.l3_node_id is None]
        if missing:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "l3_node_id_required",
                    "field": "l3_node_id",
                    "reason": "required_for_scope_v1",
                    "message": (
                        "scope-v1 assessment requires l3_node_id for "
                        f"every detail; missing: {', '.join(missing)}"
                    ),
                },
            )
    # Reject deprecated fields.
    for item in request.details:
        deprecated = _DEPRECATED_FIELDS & item.model_fields_set
        if deprecated:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "deprecated_field",
                    "field": sorted(deprecated)[0],
                    "message": (
                        f"'{sorted(deprecated)[0]}' is deprecated; "
                        f"use include_in_plan"
                    ),
                },
            )
        _reject_plan_quarter(item)
        _reject_target_adjustment(item)
    details: list[dict[str, object]] = [
        {
            "l3_node_id": item.l3_node_id,
            "l3_code": item.l3_code,
            "current_level": item.current_level,
            "evidence_note": item.evidence_note,
            "member_priority": item.member_priority,
            "include_in_plan": item.include_in_plan,
            "plan_month": item.plan_month,
        }
        for item in request.details
    ]
    try:
        result = patch_assessment_draft(
            connection,
            assessment_id,
            int(user["id"]),
            request.expected_revision,
            details,
        )
    except DetailValidationError as exc:
        raise _detail_validation_error(exc) from exc
    except ValueError as exc:
        if str(exc) == "revision conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return {"ok": True, **result}


@assessment_router.patch("/{assessment_id}/draft")
def patch_draft(
    assessment_id: int,
    request: PatchSaveDraftRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="assessment not found"
        )
    if not policies.can_member_edit(user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="insufficient permissions"
        )
    # Reject deprecated fields.
    for item in request.details:
        deprecated = _DEPRECATED_FIELDS & item.model_fields_set
        if deprecated:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail={
                    "code": "deprecated_field",
                    "field": sorted(deprecated)[0],
                    "message": (
                        f"'{sorted(deprecated)[0]}' is deprecated; "
                        f"use include_in_plan"
                    ),
                },
            )
        _reject_plan_quarter(item)
        _reject_target_adjustment(item)
    # Distinguish unset vs explicit-null via model_fields_set.
    details: list[dict[str, object]] = []
    for item in request.details:
        merged: dict[str, object] = {
            "l3_node_id": item.l3_node_id,
            "l3_code": item.l3_code,
        }
        for key in (
            "current_level",
            "evidence_note",
            "member_priority",
            "include_in_plan",
            "plan_month",
        ):
            if key in item.model_fields_set:
                merged[key] = getattr(item, key)
        details.append(merged)
    try:
        result = patch_assessment_draft(
            connection,
            assessment_id,
            int(user["id"]),
            request.expected_revision,
            details,
        )
    except DetailValidationError as exc:
        raise _detail_validation_error(exc) from exc
    except ValueError as exc:
        code = (
            status.HTTP_409_CONFLICT
            if str(exc) == "revision conflict"
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc
    return {"ok": True, **result}


@assessment_router.post("/{assessment_id}/draft/batch-level")
def batch_level(
    assessment_id: int,
    request: BatchLevelRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="assessment not found"
        )
    if not policies.can_member_edit(user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="insufficient permissions"
        )
    try:
        return batch_fill_l2(
            connection,
            assessment_id,
            int(user["id"]),
            request.l2_code,
            request.current_level,
            request.expected_revision,
        )
    except ValueError as exc:
        code = (
            status.HTTP_409_CONFLICT
            if str(exc) == "revision conflict"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=code, detail=str(exc)) from exc


@assessment_router.post(
    "/{assessment_id}/generate-plan-items",
    dependencies=[require_any_role("Member")],
)
def generate_plan_items(
    assessment_id: int,
    request: GeneratePlanItemsRequest,
    user: CurrentUser,
    connection: Connection,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, object]:
    """Issue #194: 显式生成所选学习任务（M02 第三个独立动作）。

    Only the selected l3_codes are generated.  Any unready item fails the
    whole batch with a per-L3 Chinese error (zero writes).  Idempotency:
    the (annual_growth_plan_id, l3_code) unique kernel returns already
    generated items as ``existing``, and the Idempotency-Key header (with a
    payload fingerprint) replays the stored first response or 409s on reuse
    with a different payload.
    """
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if user["id"] != assessment["member_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    try:
        result = generate_plan_items_for_selection(
            connection,
            assessment_id,
            int(user["id"]),
            request.l3_codes,
            expected_revision=request.expected_revision,
            idempotency_key=idempotency_key,
        )
    except AssessmentScopeError as exc:
        raise _scope_error(exc) from exc
    except DetailValidationError as exc:
        raise _detail_validation_error(exc) from exc
    except ValueError as exc:
        if str(exc) == "revision conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return {"ok": True, **result}


@assessment_router.post(
    "/{assessment_id}/submit",
    dependencies=[require_any_role("Member")],
)
def submit(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
    request: SubmitRequest,
) -> dict[str, object]:
    """Issue #194: 退役 — 生成学习任务已改为显式动作（M02 三个独立动作）。

    旧的一键 submit-and-generate 契约被替换；该端点保持存在但零写入，
    返回 422 legacy_assessment_submit_disabled 提示迁移到新动作。
    """
    del assessment_id, user, connection, request  # zero-write by design
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": "legacy_assessment_submit_disabled",
            "message": (
                "提交并自动生成学习任务已退役：请使用"
                "保存能力评级 → 加入/移出提升计划草稿 → "
                "生成所选学习任务（POST /generate-plan-items）三个独立动作"
            ),
        },
    )


@assessment_router.get("/{assessment_id}/history")
def get_history(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
) -> list[dict[str, object]]:
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if not policies.can_view_assessment(connection, user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return get_assessment_reviews(connection, assessment_id)


@assessment_router.get("/{assessment_id}/buddy-review")
def get_review_workspace(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
    """Buddy Review workspace DTO (frozen facts only).

    P1-3: Buddy-exclusive.  Only the current responsible Buddy (Buddy role +
    canonical is_current_responsible_buddy relationship) may read this
    endpoint; Member/Leader/Admin, old buddies, future or expired
    relationships and deactivated users all get 403.  Admin/Leader reads use
    the generic assessment endpoints (``/assessments/{id}``,
    ``/assessments/{id}/history``) which keep the broader policy.
    """
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if not policies.can_buddy_review(connection, user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    workspace = get_buddy_review_workspace(connection, assessment_id)
    if workspace is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    return workspace


@assessment_router.post("/{assessment_id}/reviews/{review_id}")
def submit_review(
    assessment_id: int,
    review_id: int,
    request: SubmitReviewRequest,
    user: CurrentUser,
    connection: Connection,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
) -> dict[str, object]:
    """Issue #194 P1-3: 退役 — Buddy 自评复核改为 Evidence Review。

    Assessment Review 写端点保持存在但零写入（稳定 410），自评复核流程
    已由 Evidence Review（证据评审）取代；GET 历史（/history）只读保持。
    """
    assessment = get_assessment(connection, assessment_id)
    if assessment is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="assessment not found",
        )
    if not policies.can_buddy_review(connection, user, assessment):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    del request, idempotency_key, review_id  # zero-write by design
    raise HTTPException(
        status_code=status.HTTP_410_GONE,
        detail={
            "code": "assessment_review_write_disabled",
            "message": (
                "自评复核提交已退役（410）：请改用证据评审 Evidence Review"
                "（/mentoring/evidence-review）评审证据并推进学习任务闭环"
            ),
        },
    )


# ponytail: archive remains a repository function only; not exposed via API.


class UpdateGapRequest(BaseModel):
    priority: str = Field(pattern=r"^(高|中|低|暂缓)$")
    plan_candidate: bool


gap_router = APIRouter(prefix="/api/gaps")


@gap_router.get("")
def list_gaps_endpoint(
    assessment_id: int | None = None,
    *,
    user: CurrentUser,
    connection: Connection,
) -> list[dict[str, object]]:
    roles: list[str] = user["roles"]

    if "Admin" in roles or "Leader" in roles:
        return list_gaps(connection, assessment_id=assessment_id)

    if "Buddy" in roles:
        from ..access.repository import get_assigned_members

        assigned = get_assigned_members(connection, int(user["id"]))
        member_ids = [int(member["id"]) for member in assigned]
        if "Member" in roles:
            member_ids.append(int(user["id"]))
        gaps: list[dict[str, object]] = []
        for member_id in member_ids:
            gaps.extend(
                list_gaps(
                    connection,
                    member_id=member_id,
                    assessment_id=assessment_id,
                )
            )
        return gaps

    # Member only
    return list_gaps(connection, member_id=int(user["id"]), assessment_id=assessment_id)


@gap_router.put("/{gap_id}")
def update_gap_endpoint(
    gap_id: int,
    request: UpdateGapRequest,
    *,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, bool]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )

    gap = get_gap(connection, gap_id)
    if gap is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="gap not found",
        )

    # Block gap writes for scope-v1 assessments: canonical source is
    # assessment_detail; the gap table is a one-way compat projection.
    if gap.get("assessment_scope_version") is not None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "legacy_gap_write_disabled",
                "message": (
                    "This assessment uses scope-v1.  Update member_priority "
                    "and include_in_plan on the assessment detail instead."
                ),
            },
        )

    if not policies.can_member_update_gap(connection, user, gap):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )

    try:
        update_gap(
            connection,
            gap_id,
            int(user["id"]),
            request.priority,
            request.plan_candidate,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True}
