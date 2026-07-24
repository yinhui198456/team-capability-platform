from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..settings import settings
from .policies import SESSION_COOKIE_NAME, Connection, CurrentUser
from .repository import (
    create_session,
    create_user_admin,
    delete_session,
    get_assigned_members,
    get_primary_buddy,
    get_user_by_username,
    list_system_configs,
    list_users,
    update_system_config,
    update_user_admin,
)
from .security import verify_password


class LoginRequest(BaseModel):
    username: str
    password: str


router = APIRouter(prefix="/api/auth")
system_router = APIRouter(prefix="/api/system")


@router.post("/login")
def login(
    response: Response,
    credentials: LoginRequest,
    connection: Connection,
) -> dict[str, object]:
    user = get_user_by_username(connection, credentials.username)
    if (
        user is None
        or not user["is_active"]
        or not verify_password(credentials.password, user["password_hash"])
    ):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="invalid credentials",
        )

    raw_token = create_session(connection, user["id"], settings.session_max_age_seconds)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value=raw_token,
        httponly=True,
        samesite="lax",
        path="/",
        max_age=settings.session_max_age_seconds,
        secure=settings.session_cookie_secure,
    )
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "roles": user["roles"],
    }


@router.post("/logout")
def logout(
    request: Request,
    user: CurrentUser,
    connection: Connection,
    response: Response,
) -> dict[str, bool]:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if raw_token:
        delete_session(connection, raw_token)
    response.set_cookie(
        key=SESSION_COOKIE_NAME,
        value="",
        httponly=True,
        samesite="lax",
        path="/",
        max_age=0,
        secure=settings.session_cookie_secure,
    )
    return {"ok": True}


@router.get("/me")
def me(user: CurrentUser, connection: Connection) -> dict[str, object]:
    primary_buddy: dict[str, object] | None = None
    assigned_members: list[dict[str, object]] = []
    roles: list[str] = user["roles"]

    if "Member" in roles:
        primary_buddy = get_primary_buddy(connection, user["id"])
    if "Buddy" in roles:
        assigned_members = get_assigned_members(connection, user["id"])

    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "roles": roles,
        "current_level": user.get("current_level"),
        "target_level": user.get("target_level"),
        "primary_buddy": primary_buddy,
        "assigned_members": assigned_members,
    }


class AdminUserUpdate(BaseModel):
    full_name: str
    is_active: bool
    roles: list[str]
    current_level: str | None = None
    target_level: str | None = None


class AdminUserCreate(AdminUserUpdate):
    username: str
    password: str


class SystemConfigUpdate(BaseModel):
    value: str
    enabled: bool


def _require_admin(user: CurrentUser) -> None:
    if "Admin" not in user["roles"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="insufficient permissions"
        )


def _system_user_response(user: dict[str, object]) -> dict[str, object]:
    return {
        "id": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "is_active": user["is_active"],
        "roles": user["roles"],
        "current_level": user.get("current_level"),
        "target_level": user.get("target_level"),
    }


@system_router.get("/users")
def get_system_users(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_admin(user)
    return [
        _system_user_response(system_user) for system_user in list_users(connection)
    ]


@system_router.post("/users", status_code=status.HTTP_201_CREATED)
def post_system_user(
    body: AdminUserCreate, user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_admin(user)
    try:
        created = create_user_admin(
            connection,
            body.username,
            body.full_name,
            body.password,
            body.is_active,
            body.roles,
            body.current_level,
            body.target_level,
        )
        return _system_user_response(created)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@system_router.put("/users/{user_id}")
def put_system_user(
    user_id: int, body: AdminUserUpdate, user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_admin(user)
    try:
        updated = update_user_admin(
            connection,
            user_id,
            body.full_name,
            body.is_active,
            body.roles,
            body.current_level,
            body.target_level,
        )
        return _system_user_response(updated)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc)
        ) from exc


@system_router.get("/roles")
def get_system_roles(user: CurrentUser) -> list[str]:
    _require_admin(user)
    return ["Member", "Buddy", "Leader", "Admin"]


@system_router.get("/settings")
def get_system_settings(
    user: CurrentUser, connection: Connection
) -> list[dict[str, object]]:
    _require_admin(user)
    return list_system_configs(connection)


@system_router.put("/settings/{code}")
def put_system_setting(
    code: str, body: SystemConfigUpdate, user: CurrentUser, connection: Connection
) -> dict[str, object]:
    _require_admin(user)
    try:
        return update_system_config(connection, code, body.value, body.enabled)
    except KeyError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc
