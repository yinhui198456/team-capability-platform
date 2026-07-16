from fastapi import APIRouter, HTTPException, status

from ..access.policies import Connection, CurrentUser
from .gate import check_annual_plan_gate

planning_router = APIRouter(prefix="/api/planning")


@planning_router.get("/annual-plan-eligibility")
def get_annual_plan_eligibility(
    user: CurrentUser, connection: Connection
) -> dict[str, object]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    return check_annual_plan_gate(connection, int(user["id"]))


@planning_router.post("/annual-plan-dry-run")
def annual_plan_dry_run(user: CurrentUser, connection: Connection) -> dict[str, bool]:
    if "Member" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="insufficient permissions",
        )
    result = check_annual_plan_gate(connection, int(user["id"]))
    if not result["eligible"]:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=result["reason"],
        )
    return {"ok": True}
