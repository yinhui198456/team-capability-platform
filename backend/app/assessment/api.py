import psycopg
from fastapi import APIRouter, Header, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ..access.policies import Connection, CurrentUser, require_any_role
from . import policies
from .repository import (
    AssessmentValidationError,
    DraftTargetRepairError,
    batch_fill_l2,
    create_assessment_draft,
    get_assessment,
    get_assessment_review_summary_for_buddy,
    get_assessment_reviews,
    get_draft_target_repair_preview,
    get_gap,
    get_pending_reviews_for_buddy,
    list_gaps,
    list_member_assessments,
    patch_assessment_draft,
    repair_draft_target_snapshots,
    save_assessment_draft,
    submit_assessment,
    submit_assessment_review,
    update_gap,
)
from .scope import AssessmentScopeError, compute_assessment_scope


class CreateAssessmentRequest(BaseModel):
    year: int
    assessment_type: str = Field(default="年度")
    scope_token: str = Field(min_length=64, max_length=64)


class DetailItem(BaseModel):
    model_config = ConfigDict(extra="forbid")

    l3_code: str
    current_level: int | None = Field(default=None, ge=1, le=5)
    target_adjusted: bool = False
    adjusted_target_level: int | None = Field(default=None, ge=1, le=5)
    target_adjustment_reason: str | None = None
    evidence_note: str | None = None
    plan_candidate: bool = False


class SaveDraftRequest(BaseModel):
    details: list[DetailItem]
    expected_revision: int = Field(ge=1)


class BatchLevelRequest(BaseModel):
    l2_code: str
    current_level: int = Field(ge=1, le=2)
    expected_revision: int = Field(ge=1)


class SubmitRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class DraftTargetRepairRequest(BaseModel):
    expected_revision: int = Field(ge=1)


class SubmitReviewRequest(BaseModel):
    conclusion: str = Field(pattern=r"^(认可|建议调整)$")
    feedback: str | None = None


assessment_router = APIRouter(prefix="/api/assessments")


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
    details: list[dict[str, object]] = [
        {
            "l3_code": item.l3_code,
            "current_level": item.current_level,
            "target_adjusted": item.target_adjusted,
            "adjusted_target_level": item.adjusted_target_level,
            "target_adjustment_reason": item.target_adjustment_reason,
            "evidence_note": item.evidence_note,
            "plan_candidate": item.plan_candidate,
        }
        for item in request.details
    ]
    try:
        result = save_assessment_draft(
            connection,
            assessment_id,
            int(user["id"]),
            details,
            expected_revision=request.expected_revision,
        )
    except ValueError as exc:
        if str(exc) == "revision conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True, **result}


@assessment_router.patch("/{assessment_id}/draft")
def patch_draft(
    assessment_id: int,
    request: SaveDraftRequest,
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
    details = [
        {
            key: value
            for key, value in {
                "l3_code": item.l3_code,
                "current_level": item.current_level,
                "target_adjusted": item.target_adjusted,
                "adjusted_target_level": item.adjusted_target_level,
                "target_adjustment_reason": item.target_adjustment_reason,
                "evidence_note": item.evidence_note,
                "plan_candidate": item.plan_candidate,
            }.items()
            if key == "l3_code" or key in item.model_fields_set
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
    except ValueError as exc:
        code = (
            status.HTTP_409_CONFLICT
            if str(exc) == "revision conflict"
            else status.HTTP_400_BAD_REQUEST
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
    "/{assessment_id}/submit",
    dependencies=[require_any_role("Member")],
)
def submit(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
    request: SubmitRequest,
) -> dict[str, object]:
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
        result = submit_assessment(
            connection,
            assessment_id,
            int(user["id"]),
            expected_revision=request.expected_revision,
        )
    except AssessmentValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": exc.code,
                "l3_code": exc.l3_code,
                "reason": exc.reason,
                "message": str(exc),
            },
        ) from exc
    except ValueError as exc:
        if str(exc) == "revision conflict":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT, detail=str(exc)
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True, **result}


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


@assessment_router.post("/{assessment_id}/reviews/{review_id}")
def submit_review(
    assessment_id: int,
    review_id: int,
    request: SubmitReviewRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, object]:
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
    try:
        submit_assessment_review(
            connection,
            review_id,
            int(user["id"]),
            request.conclusion,
            request.feedback,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True}


# ponytail: archive remains a repository function only; not exposed via API.


class UpdateGapRequest(BaseModel):
    priority: str = Field(pattern=r"^(高|中|低)$")
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
