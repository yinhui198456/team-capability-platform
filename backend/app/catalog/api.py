from collections.abc import Iterator
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, HTTPException

from ..settings import settings
from .repository import (
    get_capability_model,
    get_learning_resource,
    list_learning_resources,
)

router = APIRouter(prefix="/api")


def get_connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(settings.database_url) as connection:
        yield connection


Connection = Annotated[psycopg.Connection, Depends(get_connection)]


@router.get("/capability-model")
def capability_model(connection: Connection, domain_code: str | None = None) -> object:
    model = get_capability_model(connection, domain_code)
    if model is None:
        raise HTTPException(status_code=404, detail="capability model not found")
    return model


@router.get("/learning-resources")
def learning_resources(
    connection: Connection,
    name: str | None = None,
    status: str | None = None,
    l3_code: str | None = None,
) -> object:
    return list_learning_resources(connection, name, status, l3_code)


@router.get("/learning-resources/{material_code}")
def learning_resource(connection: Connection, material_code: str) -> object:
    resource = get_learning_resource(connection, material_code)
    if resource is None:
        raise HTTPException(status_code=404, detail="learning resource not found")
    return resource
