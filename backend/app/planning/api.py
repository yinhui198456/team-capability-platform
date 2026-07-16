from fastapi import APIRouter, HTTPException, Response, status

from ..access.policies import Connection, CurrentUser
from .gate import check_annual_plan_gate
from .repository import (
    create_growth_goal,
    delete_growth_goal,
    list_eligible_gaps,
    list_growth_goals,
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
