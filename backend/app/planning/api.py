from datetime import date

from fastapi import APIRouter, HTTPException, Response, status

from ..access.policies import Connection, CurrentUser
from .gate import check_annual_plan_gate
from .repository import (
    archive_team_annual_plan,
    create_evidence_draft,
    create_growth_goal,
    create_learning_task,
    create_or_publish_team_annual_plan,
    create_progress_log,
    delete_growth_goal,
    delete_progress_log,
    generate_plan_items,
    get_annual_plan_with_items,
    get_capability_profile,
    get_evidence,
    get_learning_task,
    get_member_dashboard,
    get_monthly_hours,
    get_team_analytics,
    get_team_annual_plan_by_year,
    list_eligible_gaps,
    list_evidence_reviews_for_buddy_task,
    list_evidence_reviews_for_task,
    list_evidences,
    list_growth_goals,
    list_learning_tasks,
    list_pending_evidence_reviews_for_buddy,
    list_plan_items,
    list_progress_logs,
    submit_evidence,
    submit_evidence_review,
    update_evidence_draft,
    update_learning_task,
    update_progress_log,
    update_team_annual_plan,
    validate_team_analytics_domain_filter,
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
    try:
        gap_id = int(body["gap_id"])
    except (KeyError, TypeError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="gap_id is required",
        ) from exc
    try:
        return create_growth_goal(connection, int(user["id"]), gap_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc


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
    try:
        delete_growth_goal(connection, int(user["id"]), goal_id)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        ) from exc
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@planning_router.get("/annual-plan")
def get_annual_plan(
    user: CurrentUser, connection: Connection, year: int
) -> dict[str, object] | None:
    _require_member(user)
    return get_annual_plan_with_items(connection, int(user["id"]), year)


@planning_router.post("/annual-plan/generate")
def post_generate_plan_items(
    user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_member(user)
    try:
        items = generate_plan_items(connection, int(user["id"]))
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc
    return {"created": len(items), "items": items}


@planning_router.get("/plan-items")
def get_plan_items(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_member(user)
    return list_plan_items(connection, int(user["id"]))


@planning_router.post("/plan-items/{plan_item_id}/learning-task")
def post_learning_task(
    user: CurrentUser, connection: Connection, plan_item_id: int
) -> dict[str, object]:
    _require_member(user)
    try:
        return create_learning_task(connection, int(user["id"]), plan_item_id)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        ) from exc


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
        return update_learning_task(connection, int(user["id"]), task_id, body)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
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
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
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


@planning_router.put("/progress-logs/{log_id}")
def put_progress_log(
    user: CurrentUser,
    connection: Connection,
    log_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    try:
        return update_progress_log(connection, int(user["id"]), log_id, body)
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
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc


@planning_router.delete("/progress-logs/{log_id}")
def remove_progress_log(
    user: CurrentUser, connection: Connection, log_id: int
) -> Response:
    _require_member(user)
    try:
        delete_progress_log(connection, int(user["id"]), log_id)
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
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@planning_router.post("/learning-tasks/{task_id}/evidences")
def post_evidence(
    user: CurrentUser,
    connection: Connection,
    task_id: int,
    body: dict[str, object],
) -> dict[str, object]:
    _require_member(user)
    content = body.get("content")
    evidence_link = body.get("evidence_link")
    try:
        return create_evidence_draft(
            connection, int(user["id"]), task_id, content, evidence_link
        )
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
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
        return update_evidence_draft(connection, int(user["id"]), evidence_id, body)
    except PermissionError as exc:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=str(exc),
        ) from exc
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


@planning_router.post("/evidence-reviews/{review_id}")
def post_evidence_review(
    user: CurrentUser,
    connection: Connection,
    review_id: int,
    body: dict[str, object],
) -> dict[str, bool]:
    _require_buddy(user)
    try:
        conclusion = str(body["conclusion"])
    except (KeyError, TypeError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="conclusion is required",
        ) from exc
    feedback = body.get("feedback")
    try:
        submit_evidence_review(
            connection, review_id, int(user["id"]), conclusion, feedback
        )
    except ValueError as exc:
        msg = str(exc)
        if msg == "review not found":
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=msg,
            ) from exc
        if msg in (
            "review is not assigned to this buddy",
            "buddy is not assigned to member",
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=msg,
            ) from exc
        if msg == "review is not pending":
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=msg,
            ) from exc
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=msg,
        ) from exc
    return {"ok": True}


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
