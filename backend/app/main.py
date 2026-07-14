from contextlib import asynccontextmanager
from collections.abc import AsyncIterator
from pathlib import Path

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .catalog.importer import ensure_catalog_initialized
from .settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    with psycopg.connect(settings.database_url) as connection:
        ensure_catalog_initialized(connection, Path("/app/capability-model"))
    yield


app = FastAPI(title="TCP Backend", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET"],
    allow_headers=["*"],
)


def check_database() -> None:
    with psycopg.connect(settings.database_url, connect_timeout=2) as connection:
        connection.execute("SELECT 1")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/ready")
def ready() -> dict[str, str]:
    try:
        check_database()
    except Exception as exc:
        raise HTTPException(status_code=503, detail="database unavailable") from exc
    return {"status": "ready", "database": "ok"}
