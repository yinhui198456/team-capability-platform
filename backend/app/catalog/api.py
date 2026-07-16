from collections.abc import Iterator
from typing import Annotated

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, field_validator

from ..access.policies import require_any_role
from ..settings import settings
from .repository import (
    archive_learning_resource,
    create_learning_resource,
    get_capability_model,
    get_learning_resource,
    list_learning_resources,
    update_capability_node,
    update_learning_resource,
)

router = APIRouter(prefix="/api")


class CapabilityNodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    enabled: bool | None = None
    p4_description: str | None = None
    p5_description: str | None = None
    p6_description: str | None = None
    p7_description: str | None = None
    p8_description: str | None = None
    recommended_start_level: str | None = None
    materials_text: str | None = None
    expected_output: str | None = None
    estimated_hours: str | None = None
    resource_codes: list[str] | None = None


class LearningResourceBase(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    material_type: str
    source_text: str
    purpose: str
    status: str
    l3_codes: list[str]


class LearningResourceCreate(LearningResourceBase):
    material_code: str = Field(..., pattern=r"^(?:P|C)\d{2}-M\d{3}$")


class LearningResourceUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    material_code: str | None = Field(default=None, pattern=r"^(?:P|C)\d{2}-M\d{3}$")
    name: str | None = None
    material_type: str | None = None
    source_text: str | None = None
    purpose: str | None = None
    status: str | None = None
    l3_codes: list[str] | None = None

    @field_validator("material_code")
    @classmethod
    def _material_code_immutable(cls, value: str | None) -> str | None:
        # The URL code is the source of truth; reject any body value.
        if value is not None:
            raise ValueError("material_code is immutable")
        return value


def get_connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(settings.database_url) as connection:
        yield connection


Connection = Annotated[psycopg.Connection, Depends(get_connection)]
LeaderRequired = Annotated[None, require_any_role("Leader")]


@router.get("/capability-model")
def capability_model(connection: Connection, domain_code: str | None = None) -> object:
    model = get_capability_model(connection, domain_code)
    if model is None:
        raise HTTPException(status_code=404, detail="capability model not found")
    return model


@router.put("/capability-model/nodes/{node_code}")
def update_node(
    connection: Connection,
    _: LeaderRequired,
    node_code: str,
    update: CapabilityNodeUpdate,
) -> object:
    try:
        node = update_capability_node(
            connection, node_code, update.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if node is None:
        raise HTTPException(status_code=404, detail="capability node not found")
    return node


@router.get("/learning-resources")
def learning_resources(
    connection: Connection,
    name: str | None = None,
    status: str | None = None,
    l3_code: str | None = None,
) -> object:
    return list_learning_resources(connection, name, status, l3_code)


@router.post("/learning-resources", status_code=status.HTTP_201_CREATED)
def create_resource(
    connection: Connection,
    _: LeaderRequired,
    resource: LearningResourceCreate,
) -> object:
    try:
        return create_learning_resource(connection, resource.model_dump())
    except ValueError as exc:
        detail = str(exc)
        if "already exists" in detail:
            raise HTTPException(status_code=409, detail=detail) from exc
        raise HTTPException(status_code=422, detail=detail) from exc


@router.get("/learning-resources/{material_code}")
def learning_resource(connection: Connection, material_code: str) -> object:
    resource = get_learning_resource(connection, material_code)
    if resource is None:
        raise HTTPException(status_code=404, detail="learning resource not found")
    return resource


@router.put("/learning-resources/{material_code}")
def update_resource(
    connection: Connection,
    _: LeaderRequired,
    material_code: str,
    update: LearningResourceUpdate,
) -> object:
    try:
        resource = update_learning_resource(
            connection, material_code, update.model_dump(exclude_unset=True)
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    if resource is None:
        raise HTTPException(status_code=404, detail="learning resource not found")
    return resource


@router.post("/learning-resources/{material_code}/archive")
def archive_resource(
    connection: Connection,
    _: LeaderRequired,
    material_code: str,
) -> object:
    resource = archive_learning_resource(connection, material_code)
    if resource is None:
        raise HTTPException(status_code=404, detail="learning resource not found")
    return resource
