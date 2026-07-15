from collections.abc import Iterator
from typing import Annotated

import psycopg
from fastapi import Depends, HTTPException, Request, status

from ..settings import settings
from .repository import get_session_user

SESSION_COOKIE_NAME = "tcp_session"


def get_connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(settings.database_url) as connection:
        yield connection


Connection = Annotated[psycopg.Connection, Depends(get_connection)]


async def current_user(request: Request, connection: Connection) -> dict[str, object]:
    raw_token = request.cookies.get(SESSION_COOKIE_NAME)
    if not raw_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    user = get_session_user(connection, raw_token)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="not authenticated",
        )
    return user


CurrentUser = Annotated[dict[str, object], Depends(current_user)]


def require_authenticated() -> Depends:
    return Depends(current_user)


def require_any_role(*role_codes: str) -> Depends:
    async def checker(user: CurrentUser) -> None:
        if not set(role_codes).intersection(user["roles"]):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="insufficient permissions",
            )

    return Depends(checker)
