from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field

from ..access.policies import Connection, CurrentUser, require_any_role
from . import policies
from .repository import (
    create_assessment_draft,
    get_assessment,
    get_assessment_review_summary_for_buddy,
    get_assessment_reviews,
    get_gap,
    get_pending_reviews_for_buddy,
    list_gaps,
    list_member_assessments,
    save_assessment_draft,
    submit_assessment,
    submit_assessment_review,
    update_gap,
)


class CreateAssessmentRequest(BaseModel):
    year: int
    assessment_type: str = Field(default="年度")


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


class SubmitReviewRequest(BaseModel):
    conclusion: str = Field(pattern=r"^(认可|建议调整)$")
    feedback: str | None = None


assessment_router = APIRouter(prefix="/api/assessments")


@assessment_router.post("")
def create_assessment(
    request: CreateAssessmentRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, int]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    try:
        assessment_id = create_assessment_draft(
            connection,
            int(user["id"]),
            request.year,
            request.assessment_type,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    return {"id": assessment_id}


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
            SELECT id, member_id, year, version, assessment_type, status,
                   created_at, submitted_at, archived_at
            FROM assessment
            ORDER BY created_at DESC
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
            SELECT id, member_id, year, version, assessment_type, status,
                   created_at, submitted_at, archived_at
            FROM assessment
            WHERE member_id = ANY(%s)
            ORDER BY created_at DESC
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


@assessment_router.put("/{assessment_id}/draft")
def save_draft(
    assessment_id: int,
    request: SaveDraftRequest,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, bool]:
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
        save_assessment_draft(connection, assessment_id, int(user["id"]), details)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True}


@assessment_router.post(
    "/{assessment_id}/submit",
    dependencies=[require_any_role("Member")],
)
def submit(
    assessment_id: int,
    user: CurrentUser,
    connection: Connection,
) -> dict[str, bool]:
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
        submit_assessment(connection, assessment_id, int(user["id"]))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    return {"ok": True}


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
) -> dict[str, bool]:
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
