from fastapi import APIRouter, HTTPException, Response, status

from ..access.policies import Connection, CurrentUser
from .gate import check_annual_plan_gate
from .repository import (
    create_growth_goal,
    create_learning_task,
    create_progress_log,
    delete_growth_goal,
    delete_progress_log,
    generate_plan_items,
    get_annual_plan_with_items,
    get_learning_task,
    get_monthly_hours,
    list_eligible_gaps,
    list_growth_goals,
    list_learning_tasks,
    list_plan_items,
    list_progress_logs,
    update_learning_task,
    update_progress_log,
)

planning_router = APIRouter(prefix="/api/planning")


def _require_member(user: CurrentUser) -> None:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )


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
