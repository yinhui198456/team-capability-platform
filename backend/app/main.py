from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .access.api import router as access_router
from .access.api import system_router
from .access.schema import create_access_schema
from .access.seed import seed_demo_accounts, seed_demo_business_data
from .assessment import assessment_router, create_assessment_schema, gap_router
from .catalog.api import router as catalog_router
from .catalog.importer import ensure_catalog_initialized
from .planning import create_planning_schema, planning_router
from .settings import settings


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    with psycopg.connect(settings.database_url) as connection:
        ensure_catalog_initialized(connection, Path("/app/capability-model"))
        create_access_schema(connection)
        create_assessment_schema(connection)
        create_planning_schema(connection)
        seed_demo_accounts(connection)
        seed_demo_business_data(connection)
    yield


app = FastAPI(
    title="TCP Backend",
    version="0.1.0",
    lifespan=lifespan,
    redirect_slashes=False,
)
app.include_router(catalog_router)
app.include_router(access_router)
app.include_router(system_router)
app.include_router(assessment_router)
app.include_router(gap_router)
app.include_router(planning_router)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "OPTIONS"],
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
