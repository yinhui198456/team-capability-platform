from datetime import date

from fastapi import APIRouter, HTTPException, Response, status

from ..access.policies import Connection, CurrentUser
from .gate import check_annual_plan_gate
from .repository import (
    EvidenceValidationError,
    LegacyPlanningWriteDisabled,
    PlanItemValidationError,
    PlanningDomainError,
    TaskValidationError,
    archive_team_annual_plan,
    create_evidence_draft,
    create_or_publish_team_annual_plan,
    create_progress_log,
    get_annual_plan_with_items,
    get_capability_profile,
    get_evidence,
    get_evidence_review_summary_for_buddy,
    get_learning_task,
    get_member_dashboard,
    get_monthly_hours,
    get_team_analytics,
    get_team_annual_plan_by_year,
    invalidate_progress_log,
    list_change_proposals,
    list_eligible_gaps,
    list_evidence_reviews_for_buddy_task,
    list_evidence_reviews_for_task,
    list_evidences,
    list_growth_goals,
    list_learning_tasks,
    list_pending_evidence_reviews_for_buddy,
    list_plan_items,
    list_progress_logs,
    list_selectable_members_for_profile,
    list_task_transition_history,
    submit_evidence,
    submit_evidence_review,
    transition_learning_task,
    update_evidence_draft,
    update_learning_task,
    update_plan_item,
    update_team_annual_plan,
    validate_team_analytics_domain_filter,
)

_CONFLICT_CODES = {
    "task_revision_conflict",
    "plan_revision_conflict",
    "evidence_revision_conflict",
    "transition_idempotency_conflict",
    "log_idempotency_conflict",
    "review_idempotency_conflict",
    "review_already_submitted",
}


def _domain_error(exc: PlanningDomainError) -> HTTPException:
    """Structured error envelope: code/entity_type/entity_id/field/reason."""
    return HTTPException(
        status_code=(
            status.HTTP_409_CONFLICT
            if exc.code in _CONFLICT_CODES
            else status.HTTP_422_UNPROCESSABLE_ENTITY
        ),
        detail={
            "code": exc.code,
            "entity_type": exc.entity_type,
            "entity_id": exc.entity_id,
            "field": exc.field,
            "reason": exc.code,
            "message": str(exc),
        },
    )


planning_router = APIRouter(prefix="/api/planning")


def _require_member(user: CurrentUser) -> None:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )


def _require_buddy(user: CurrentUser) -> None:
    if "Buddy" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )


def _require_leader(user: CurrentUser) -> None:
    if "Leader" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )


def _legacy_write_disabled() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail={
            "code": LegacyPlanningWriteDisabled.code,
            "message": (
                "manual planning writes are disabled; plans are generated "
                "atomically from an approved assessment"
            ),
        },
    )


@planning_router.get("/available-years")
def get_available_years(user: CurrentUser, connection: Connection) -> dict[str, object]:
    """Returns years with data for the current user, plus the active year."""
    _require_member(user)
    member_id = int(user["id"])
    # Collect distinct years from assessment and annual_growth_plan
    rows = connection.execute(
        """
        SELECT DISTINCT year FROM assessment WHERE member_id = %s
        UNION
        SELECT DISTINCT year FROM annual_growth_plan WHERE member_id = %s
        ORDER BY year
        """,
        (member_id, member_id),
    ).fetchall()
    available = (
        [r[0] for r in rows]
        if rows
        else [int(__import__("datetime").datetime.now().year)]
    )
    active = (
        max(available) if available else int(__import__("datetime").datetime.now().year)
    )
    return {"available_years": available, "active_year": active}


@planning_router.get("/member-dashboard")
def get_member_dashboard_view(
    user: CurrentUser, connection: Connection, year: int
) -> dict[str, object]:
    _require_member(user)
    return get_member_dashboard(connection, int(user["id"]), year)


@planning_router.get("/annual-plan-eligibility")
def get_annual_plan_eligibility(
    user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_member(user)
    return check_annual_plan_gate(connection, int(user["id"]))


@planning_router.post("/annual-plan-dry-run")
def annual_plan_dry_run(user: CurrentUser, connection: Connection) -> dict[str, bool]:
    _require_member(user)
    result = check_annual_plan_gate(connection, int(user["id"]))
    if not result["eligible"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=result["reason"],
        )
    return {"ok": True}


@planning_router.get("/eligible-gaps")
def get_eligible_gaps(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_member(user)
    return list_eligible_gaps(connection, int(user["id"]))


@planning_router.post("/growth-goals")
def post_growth_goal(
    user: CurrentUser, connection: Connection, body: dict[str, object]
) -> dict[str, object]:
    _require_member(user)
    raise _legacy_write_disabled()


@planning_router.get("/growth-goals")
def get_growth_goals(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_member(user)
    return list_growth_goals(connection, int(user["id"]))


@planning_router.delete("/growth-goals/{goal_id}")
def remove_growth_goal(
    user: CurrentUser, connection: Connection, goal_id: int
) -> Response:
    _require_member(user)
    raise _legacy_write_disabled()


@planning_router.get("/annual-plan")
def get_annual_plan(
    user: CurrentUser, connection: Connection, year: int
) -> dict[str, object] | None:
    _require_member(user)
    return get_annual_plan_with_items(connection, int(user["id"]), year)


@planning_router.get("/change-proposals")
def get_change_proposals(
    user: CurrentUser,
    connection: Connection,
    year: int,
    member_id: int | None = None,
) -> list[dict[str, object]]:
    """Read-only change proposals. Member sees their own; a current responsible
    Buddy, Leader or Admin may query a specific member."""
    roles: list[str] = user["roles"]
    if member_id is None:
        _require_member(user)
        target_member_id = int(user["id"])
    elif int(user["id"]) == member_id:
        target_member_id = int(user["id"])
    elif "Admin" in roles or "Leader" in roles:
        target_member_id = member_id
    elif "Buddy" in roles:
        from ..access.repository import is_current_responsible_buddy

        if not is_current_responsible_buddy(connection, member_id, int(user["id"])):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient permissions",
            )
        target_member_id = member_id
    else:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return list_change_proposals(connection, target_member_id, year)


@planning_router.post("/annual-plan/generate")
def post_generate_plan_items(
    user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_member(user)
    raise _legacy_write_disabled()


@planning_router.get("/plan-items")
def get_plan_items(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_member(user)
    return list_plan_items(connection, int(user["id"]))


@planning_router.put("/plan-items/{plan_item_id}")
def put_plan_item(
    user: CurrentUser,
    connection: Connection,
    plan_item_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        expected = body.get("expected_revision")
        if (
            expected is None
            or isinstance(expected, bool)
            or not isinstance(expected, int)
            or expected < 0
        ):
            raise PlanItemValidationError(
                "expected_revision is required and must be a non-negative integer",
                entity_type="plan_item",
                entity_id=plan_item_id,
                field="expected_revision",
            )
        # Business fields only; the revision token is CAS metadata, never a
        # writable field (the repository whitelist must not see it).
        fields = {k: v for k, v in body.items() if k != "expected_revision"}
        return update_plan_item(
            connection,
            int(user["id"]),
            plan_item_id,
            fields,
            expected_revision=expected,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.post("/plan-items/{plan_item_id}/learning-task")
def post_learning_task(
    user: CurrentUser, connection: Connection, plan_item_id: int
) -> dict[str, object]:
    _require_member(user)
    raise _legacy_write_disabled()


@planning_router.get("/learning-tasks")
def get_learning_tasks(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_member(user)
    return list_learning_tasks(connection, int(user["id"]))


@planning_router.get("/learning-tasks/{task_id}")
def get_learning_task_by_id(
    user: CurrentUser, connection: Connection, task_id: int
) -> dict[str, object]:
    _require_member(user)
    result = get_learning_task(connection, int(user["id"]), task_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="learning task not found",
        )
    return result


@planning_router.put("/learning-tasks/{task_id}")
def put_learning_task(
    user: CurrentUser,
    connection: Connection,
    task_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        expected = body.get("expected_revision")
        if (
            expected is None
            or isinstance(expected, bool)
            or not isinstance(expected, int)
            or expected < 0
        ):
            raise TaskValidationError(
                "expected_revision is required and must be a non-negative integer",
                entity_type="learning_task",
                entity_id=task_id,
                field="expected_revision",
            )
        # Business fields only; the revision token is CAS metadata, never a
        # writable field (the repository whitelist must not see it).
        fields = {k: v for k, v in body.items() if k != "expected_revision"}
        return update_learning_task(
            connection,
            int(user["id"]),
            task_id,
            fields,
            expected_revision=expected,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.post("/learning-tasks/{task_id}/transitions")
def post_task_transition(
    user: CurrentUser,
    connection: Connection,
    task_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        to_status = str(body["to_status"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_task_transition",
                "entity_type": "learning_task",
                "entity_id": task_id,
                "field": "to_status",
                "reason": "invalid_task_transition",
                "message": "to_status is required",
            },
        ) from exc
    expected = body.get("expected_revision")
    try:
        return transition_learning_task(
            connection,
            int(user["id"]),
            task_id,
            to_status,
            body.get("reason"),
            expected_revision=int(expected) if expected is not None else None,
            idempotency_key=body.get("idempotency_key"),
            revised_due_date=body.get("revised_due_date"),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.get("/learning-tasks/{task_id}/transition-history")
def get_task_transition_history(
    user: CurrentUser, connection: Connection, task_id: int
) -> list[dict[str, object]]:
    _require_member(user)
    try:
        return list_task_transition_history(connection, int(user["id"]), task_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@planning_router.post("/learning-tasks/{task_id}/progress-logs")
def post_progress_log(
    user: CurrentUser,
    connection: Connection,
    task_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        record_date = str(body["record_date"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="record_date is required",
        ) from exc
    try:
        return create_progress_log(
            connection,
            int(user["id"]),
            task_id,
            record_date,
            body.get("actual_hours"),
            body.get("note"),
            idempotency_key=body.get("idempotency_key"),
            correction_of_log_id=body.get("correction_of_log_id"),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.get("/learning-tasks/{task_id}/progress-logs")
def get_progress_logs(
    user: CurrentUser, connection: Connection, task_id: int
) -> list[dict[str, object]]:
    _require_member(user)
    try:
        return list_progress_logs(connection, int(user["id"]), task_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@planning_router.get("/progress-logs/monthly")
def get_monthly_hours_summary(
    user: CurrentUser, connection: Connection, year: int
) -> list[dict[str, object]]:
    _require_member(user)
    return get_monthly_hours(connection, int(user["id"]), year)


@planning_router.post("/progress-logs/{log_id}/invalidate")
def post_invalidate_progress_log(
    user: CurrentUser,
    connection: Connection,
    log_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    """Append-only correction: void the log (never delete) and re-aggregate."""
    _require_member(user)
    try:
        return invalidate_progress_log(
            connection,
            int(user["id"]),
            log_id,
            idempotency_key=body.get("idempotency_key"),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc


@planning_router.post("/learning-tasks/{task_id}/evidences")
def post_evidence(
    user: CurrentUser,
    connection: Connection,
    task_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        return create_evidence_draft(
            connection,
            int(user["id"]),
            task_id,
            body.get("content"),
            body.get("evidence_link"),
            description=body.get("description"),
            evidence_type=body.get("evidence_type"),
            url=body.get("url"),
            file_reference=body.get("file_reference"),
            file_name=body.get("file_name"),
            mime_type=body.get("mime_type"),
            file_size=body.get("file_size"),
            supersedes_evidence_id=body.get("supersedes_evidence_id"),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc


@planning_router.put("/evidences/{evidence_id}")
def put_evidence(
    user: CurrentUser,
    connection: Connection,
    evidence_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        expected = body.get("expected_revision")
        if (
            expected is None
            or isinstance(expected, bool)
            or not isinstance(expected, int)
            or expected < 0
        ):
            raise EvidenceValidationError(
                "expected_revision is required and must be a non-negative integer",
                entity_type="evidence",
                entity_id=evidence_id,
                field="expected_revision",
            )
        fields = {k: v for k, v in body.items() if k != "expected_revision"}
        return update_evidence_draft(
            connection,
            int(user["id"]),
            evidence_id,
            fields,
            expected_revision=expected,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.post("/evidences/{evidence_id}/submit")
def post_submit_evidence(
    user: CurrentUser, connection: Connection, evidence_id: int
) -> dict[str, object]:
    _require_member(user)
    try:
        return submit_evidence(connection, int(user["id"]), evidence_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.get("/learning-tasks/{task_id}/evidences")
def get_evidences(
    user: CurrentUser, connection: Connection, task_id: int
) -> list[dict[str, object]]:
    _require_member(user)
    try:
        return list_evidences(connection, int(user["id"]), task_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@planning_router.get("/evidences/{evidence_id}")
def get_evidence_by_id(
    user: CurrentUser, connection: Connection, evidence_id: int
) -> dict[str, object]:
    _require_member(user)
    result = get_evidence(connection, int(user["id"]), evidence_id)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="evidence not found",
        )
    return result


@planning_router.get("/evidence-reviews/pending")
def get_pending_evidence_reviews(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_buddy(user)
    return list_pending_evidence_reviews_for_buddy(connection, int(user["id"]))


@planning_router.get("/evidence-reviews/summary")
def get_evidence_review_summary(
    user: CurrentUser, connection: Connection, year: int
) -> dict[str, int]:
    _require_buddy(user)
    return get_evidence_review_summary_for_buddy(connection, int(user["id"]), year)


@planning_router.post("/evidences/{evidence_id}/review")
def post_evidence_review(
    user: CurrentUser,
    connection: Connection,
    evidence_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_buddy(user)
    try:
        conclusion = str(body["conclusion"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={
                "code": "invalid_review",
                "entity_type": "evidence_review",
                "entity_id": evidence_id,
                "field": "conclusion",
                "reason": "invalid_review",
                "message": "conclusion is required",
            },
        ) from exc
    feedback = body.get("feedback")
    try:
        return submit_evidence_review(
            connection,
            evidence_id,
            int(user["id"]),
            conclusion,
            feedback,
            idempotency_key=body.get("idempotency_key"),
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except PlanningDomainError as exc:
        raise _domain_error(exc) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.get("/learning-tasks/{task_id}/evidence-reviews")
def get_task_evidence_reviews(
    user: CurrentUser, connection: Connection, task_id: int
) -> list[dict[str, object]]:
    try:
        if "Member" in user["roles"]:
            return list_evidence_reviews_for_task(connection, int(user["id"]), task_id)
        if "Buddy" in user["roles"]:
            return list_evidence_reviews_for_buddy_task(
                connection, int(user["id"]), task_id
            )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc


@planning_router.get("/profiles")
def get_profiles(
    user: CurrentUser,
    connection: Connection,
    year: int,
    member_id: int | None = None,
) -> dict[str, object]:
    target_member_id = int(member_id) if member_id is not None else int(user["id"])
    try:
        result = get_capability_profile(
            connection,
            int(user["id"]),
            user["roles"],
            target_member_id,
            year,
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="member not found",
        )
    return result


@planning_router.get("/profiles/selectable-members")
def get_profile_selectable_members(
    user: CurrentUser,
    connection: Connection,
    year: int,
) -> dict[str, object]:
    members = list_selectable_members_for_profile(
        connection,
        int(user["id"]),
        user["roles"],
        year,
    )
    return {"members": members}


@planning_router.get("/team-analytics")
def get_team_analytics_view(
    user: CurrentUser,
    connection: Connection,
    year: int | None = None,
    member_id: int | None = None,
    domain_code: str | None = None,
) -> dict[str, object]:
    _require_leader(user)
    target_year = year if year is not None else date.today().year
    try:
        validate_team_analytics_domain_filter(connection, domain_code)
        return get_team_analytics(connection, target_year, member_id, domain_code)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.get("/team-annual-plan")
def get_team_annual_plan(
    user: CurrentUser, connection: Connection, year: int
) -> dict[str, object]:
    _require_leader(user)
    result = get_team_annual_plan_by_year(connection, year)
    if result is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="team annual plan not found",
        )
    return result


@planning_router.post("/team-annual-plan")
def post_team_annual_plan(
    user: CurrentUser,
    connection: Connection,
    body: dict[str, object],
) -> dict[str, object]:
    _require_leader(user)
    try:
        return create_or_publish_team_annual_plan(connection, int(user["id"]), body)
    except ValueError as exc:
        msg = str(exc)
        if "already exists" in msg:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=msg,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=msg,
        ) from exc


@planning_router.put("/team-annual-plan")
def put_team_annual_plan(
    user: CurrentUser,
    connection: Connection,
    body: dict[str, object],
) -> dict[str, object]:
    _require_leader(user)
    try:
        year = int(body["year"])  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="year is required",
        ) from exc
    try:
        return update_team_annual_plan(connection, year, body)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        if "invalid" in str(exc) or "duplicate" in str(exc):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=str(exc),
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc


@planning_router.post("/team-annual-plan/archive")
def post_archive_team_annual_plan(
    user: CurrentUser,
    connection: Connection,
    body: dict[str, object],
) -> dict[str, bool]:
    _require_leader(user)
    try:
        year = int(body["year"])  # type: ignore[arg-type]
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="year is required",
        ) from exc
    try:
        archive_team_annual_plan(connection, year)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    return {"ok": True}
