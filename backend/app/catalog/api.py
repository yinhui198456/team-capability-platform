from collections.abc import Iterator
from typing import Annotated, Literal

import psycopg
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, ConfigDict, Field, StrictInt, field_validator

from ..access.policies import CurrentUser, require_any_role
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
from .standard_versions import (
    StandardVersionError,
    abandon_draft,
    catalog_drift,
    copy_previous_level,
    create_draft,
    list_versions,
    publish_preview,
    publish_version,
    read_matrix,
    reconcile_catalog,
    update_matrix,
    validate_version,
)

router = APIRouter(prefix="/api")


class CapabilityNodeUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = None
    enabled: bool | None = None
    overview: str | None = None
    p4_description: str | None = None
    p5_description: str | None = None
    p6_description: str | None = None
    p7_description: str | None = None
    p8_description: str | None = None
    recommended_start_level: str | None = None
    materials_text: str | None = None
    expected_output: str | None = None
    estimated_hours: str | None = None
    output_type: str | None = None
    notes: str | None = None
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


class StandardDraftCreate(BaseModel):
    model_id: StrictInt
    change_summary: str | None = None


class StandardMatrixItem(BaseModel):
    l3_node_id: StrictInt
    l3_code: str | None = None
    job_level: Literal["P4", "P5", "P6", "P7", "P8"]
    applicable: bool
    target_level: StrictInt | None = None


class StandardMatrixUpdate(BaseModel):
    expected_revision: StrictInt
    items: list[StandardMatrixItem]


class StandardRevisionRequest(BaseModel):
    expected_revision: StrictInt


class StandardCopyPreviousLevel(BaseModel):
    expected_revision: StrictInt
    from_level: Literal["P4", "P5", "P6", "P7", "P8"]
    to_level: Literal["P4", "P5", "P6", "P7", "P8"]
    l3_node_ids: list[StrictInt]


def _standard_error(exc: StandardVersionError) -> HTTPException:
    status_code = (
        409
        if exc.code
        in {
            "draft_already_exists",
            "standard_revision_conflict",
            "standard_version_not_draft",
        }
        else 404 if exc.code.endswith("not_found") else 422
    )
    return HTTPException(
        status_code=status_code,
        detail={"code": exc.code, "message": str(exc), "issues": exc.issues},
    )


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


@router.post(
    "/capability-standard-versions/drafts", status_code=status.HTTP_201_CREATED
)
def create_standard_draft(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    body: StandardDraftCreate,
) -> object:
    try:
        return create_draft(
            connection, body.model_id, int(user["id"]), body.change_summary
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions")
def standard_version_history(
    connection: Connection, user: CurrentUser, model_id: int
) -> object:
    try:
        return list_versions(
            connection, model_id, include_drafts="Leader" in user["roles"]
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions/published")
def published_standard_matrix(
    connection: Connection, _: CurrentUser, model_id: int
) -> object:
    try:
        versions = list_versions(connection, model_id, include_drafts=False)
        if not versions:
            raise StandardVersionError(
                "published_standard_not_found", "published standard not found"
            )
        return read_matrix(
            connection, int(versions[0]["id"]), include_draft_fields=False
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions/{version_id}")
def standard_matrix(
    connection: Connection, user: CurrentUser, version_id: int
) -> object:
    try:
        return read_matrix(
            connection, version_id, include_draft_fields="Leader" in user["roles"]
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions/{version_id}/validation")
def standard_validation(
    connection: Connection, _: LeaderRequired, version_id: int
) -> object:
    try:
        return validate_version(connection, version_id)
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions/{version_id}/catalog-drift")
def standard_catalog_drift(
    connection: Connection, _: LeaderRequired, version_id: int
) -> object:
    try:
        return catalog_drift(connection, version_id)
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.put("/capability-standard-versions/{version_id}/matrix")
def standard_matrix_update(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    version_id: int,
    body: StandardMatrixUpdate,
) -> object:
    try:
        return update_matrix(
            connection,
            version_id,
            int(user["id"]),
            body.expected_revision,
            [item.model_dump() for item in body.items],
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.post("/capability-standard-versions/{version_id}/copy-previous-level")
def standard_copy_previous_level(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    version_id: int,
    body: StandardCopyPreviousLevel,
) -> object:
    try:
        return copy_previous_level(
            connection,
            version_id,
            int(user["id"]),
            body.expected_revision,
            body.from_level,
            body.to_level,
            body.l3_node_ids,
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.post("/capability-standard-versions/{version_id}/reconcile-catalog")
def standard_reconcile(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    version_id: int,
    body: StandardRevisionRequest,
) -> object:
    try:
        return reconcile_catalog(
            connection, version_id, int(user["id"]), body.expected_revision
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.get("/capability-standard-versions/{version_id}/publish-preview")
def standard_publish_preview(
    connection: Connection, _: LeaderRequired, version_id: int
) -> object:
    try:
        return publish_preview(connection, version_id)
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.post("/capability-standard-versions/{version_id}/publish")
def standard_publish(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    version_id: int,
    body: StandardRevisionRequest,
) -> object:
    try:
        return publish_version(
            connection, version_id, int(user["id"]), body.expected_revision
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


@router.post("/capability-standard-versions/{version_id}/abandon")
def standard_abandon(
    connection: Connection,
    user: CurrentUser,
    _: LeaderRequired,
    version_id: int,
    body: StandardRevisionRequest,
) -> object:
    try:
        return abandon_draft(
            connection, version_id, int(user["id"]), body.expected_revision
        )
    except StandardVersionError as exc:
        raise _standard_error(exc) from exc


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
