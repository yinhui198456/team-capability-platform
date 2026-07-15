from fastapi import APIRouter, HTTPException, Request, Response, status
from pydantic import BaseModel

from ..settings import settings
from .policies import SESSION_COOKIE_NAME, Connection, CurrentUser
from .repository import (
    create_session,
    delete_session,
    get_assigned_members,
    get_primary_buddy,
    get_user_by_username,
)
from .security import verify_password


class LoginRequest(BaseModel):
    username: str
    password: str


router = APIRouter(prefix="/api/auth")


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
        "primary_buddy": primary_buddy,
        "assigned_members": assigned_members,
    }
