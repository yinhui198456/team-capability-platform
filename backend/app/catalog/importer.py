from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path

import psycopg
from openpyxl import load_workbook

from .repository import catalog_is_empty
from .schema import create_catalog_schema

MODEL_WORKBOOK = "技术架构与开发专业线能力胜任模型20260509_V1.0.xlsx"
PLAN_WORKBOOK = "团队成员年度学习计划模板_基于能力模型_V1.3.xlsx"
MODEL_SHEET = "1_能力模型"
SELF_ASSESSMENT_SHEET = "02_能力差距自评"
RESOURCE_SHEET = "06_学习材料索引"
MODEL_CODE = "technical-architecture-development-20260509-v1.0"
MODEL_VERSION = "20260509_V1.0"


def resolve_workbook_dir(anchor: Path | None = None) -> Path:
    """Resolve the capability-model directory starting from an anchor file.

    Walks up the directory tree until both required workbooks are found.
    This makes the resolver independent of the current working directory and
    works in host, CI, and Docker layouts as long as the workbooks live in a
    sibling ``capability-model`` directory somewhere above the anchor.
    """
    anchor_path = anchor or Path(__file__).resolve()
    current = anchor_path.parent
    for _ in range(10):
        candidate = current / "capability-model"
        if (candidate / MODEL_WORKBOOK).is_file() and (
            candidate / PLAN_WORKBOOK
        ).is_file():
            return candidate
        parent = current.parent
        if parent == current:
            break
        current = parent
    raise FileNotFoundError(
        f"Could not find capability-model directory containing "
        f"{MODEL_WORKBOOK} and {PLAN_WORKBOOK}; last searched: "
        f"{current / 'capability-model'}"
    )


DOMAINS = {
    "P01": "Data Infra 能力",
    "P02": "AI Infra / Agent 能力",
    "P03": "Coding 能力",
    "C01": "基本办公能力",
    "C02": "沟通协作",
    "C03": "学习创新",
}
MATERIAL_CODE = re.compile(r"(?:P|C)\d{2}-M\d{3}")


@dataclass(frozen=True)
class ImportReport:
    model_count: int
    l1_count: int
    l2_count: int
    l3_count: int
    resource_count: int
    resource_link_count: int
    unmatched_materials: tuple[str, ...]
    hard_errors: tuple[str, ...] = ()


@dataclass(frozen=True)
class _L1:
    code: str
    name: str
    category: str
    descriptions: tuple[object, object, object, object, object]
    source_row: int


@dataclass(frozen=True)
class _L2:
    code: str
    name: str
    parent_code: str
    source_row: int


@dataclass(frozen=True)
class _L3:
    code: str
    name: str
    parent_code: str
    start_level: str
    materials_text: str
    expected_output: str
    estimated_hours: str
    source_row: int


@dataclass(frozen=True)
class _Resource:
    code: str
    name: str
    material_type: str
    source_text: str
    purpose: str
    status: str
    source_row: int


def _required(value: object, label: str, row: int) -> str:
    if value is None or not str(value).strip():
        raise ValueError(f"missing {label} at row {row}")
    return str(value)


def _workbook(path: Path, sheet: str):
    if not path.is_file():
        raise FileNotFoundError(path)
    workbook = load_workbook(path, read_only=True, data_only=False)
    if sheet not in workbook.sheetnames:
        raise ValueError(f"missing worksheet {sheet} in {path.name}")
    return workbook


def _parse_l1(model_path: Path) -> list[_L1]:
    workbook = _workbook(model_path, MODEL_SHEET)
    try:
        found: dict[str, _L1] = {}
        for row_number, row in enumerate(
            workbook[MODEL_SHEET].iter_rows(min_row=4, values_only=True), 4
        ):
            name = row[2] if len(row) > 2 else None
            for code, expected_name in DOMAINS.items():
                if name == expected_name:
                    if code in found:
                        raise ValueError(f"duplicate L1 {code}")
                    found[code] = _L1(
                        code=code,
                        name=expected_name,
                        category=_required(row[0], "L1 category", row_number),
                        descriptions=(row[4], row[5], row[6], row[7], row[8]),
                        source_row=row_number,
                    )
        if set(found) != set(DOMAINS):
            raise ValueError("missing required L1 overview")
        return [found[code] for code in DOMAINS]
    finally:
        workbook.close()


def _parse_plan(plan_path: Path) -> tuple[list[_L2], list[_L3]]:
    workbook = _workbook(plan_path, SELF_ASSESSMENT_SHEET)
    try:
        l2_by_code: dict[str, _L2] = {}
        l3_by_code: dict[str, _L3] = {}
        for row_number, row in enumerate(
            workbook[SELF_ASSESSMENT_SHEET].iter_rows(min_row=2, values_only=True), 2
        ):
            _required(row[0], "capability category", row_number)
            l1_code = _required(row[1], "L1 code", row_number)
            l1_name = _required(row[2], "L1 name", row_number)
            l2_code = _required(row[3], "L2 code", row_number)
            l2_name = _required(row[4], "L2 name", row_number)
            l3_code = _required(row[5], "L3 code", row_number)
            l3_name = _required(row[6], "L3 name", row_number)
            start_level = _required(row[7], "recommended start level", row_number)
            materials_text = _required(row[8], "materials text", row_number)
            expected_output = _required(row[9], "expected output", row_number)
            estimated_hours = _required(row[10], "estimated hours", row_number)
            if l1_code not in DOMAINS:
                raise ValueError(f"unknown L1 code {l1_code} at row {row_number}")
            if l1_name != DOMAINS[l1_code]:
                raise ValueError(
                    f"inconsistent L1 name for {l1_code} at row {row_number}"
                )
            if not l2_code.startswith(f"{l1_code}.") or not l3_code.startswith(
                f"{l2_code}."
            ):
                raise ValueError(f"inconsistent parent code at row {row_number}")
            existing_l2 = l2_by_code.get(l2_code)
            candidate_l2 = _L2(l2_code, l2_name, l1_code, row_number)
            if existing_l2 and (
                existing_l2.name != candidate_l2.name
                or existing_l2.parent_code != candidate_l2.parent_code
            ):
                raise ValueError(f"inconsistent L2 {l2_code}")
            l2_by_code.setdefault(l2_code, candidate_l2)
            if l3_code in l3_by_code:
                raise ValueError(f"duplicate L3 {l3_code}")
            l3_by_code[l3_code] = _L3(
                l3_code,
                l3_name,
                l2_code,
                start_level,
                materials_text,
                expected_output,
                estimated_hours,
                row_number,
            )
        if len(l2_by_code) != 47 or len(l3_by_code) != 310:
            raise ValueError("unexpected fixed workbook catalog baseline")
        return list(l2_by_code.values()), list(l3_by_code.values())
    finally:
        workbook.close()


def _parse_resources(plan_path: Path) -> dict[str, _Resource]:
    workbook = _workbook(plan_path, RESOURCE_SHEET)
    try:
        resources: dict[str, _Resource] = {}
        for row_number, row in enumerate(
            workbook[RESOURCE_SHEET].iter_rows(min_row=2, values_only=True), 2
        ):
            resource = _Resource(
                code=_required(row[0], "material code", row_number),
                name=_required(row[1], "material name", row_number),
                material_type=_required(row[2], "material type", row_number),
                source_text=_required(row[3], "material source", row_number),
                purpose=_required(row[4], "material purpose", row_number),
                status=_required(row[5], "material status", row_number),
                source_row=row_number,
            )
            if resource.code in resources:
                raise ValueError(f"duplicate material code {resource.code}")
            resources[resource.code] = resource
        if len(resources) != 95:
            raise ValueError("unexpected fixed workbook resource baseline")
        return resources
    finally:
        workbook.close()


def _unmatched_materials(
    l3_nodes: list[_L3], resources: dict[str, _Resource]
) -> tuple[str, ...]:
    unmatched: list[str] = []
    for node in l3_nodes:
        codes = MATERIAL_CODE.findall(node.materials_text)
        residual = MATERIAL_CODE.sub("", node.materials_text).strip("、,，;；/ \t\r\n")
        if residual or any(code not in resources for code in codes):
            unmatched.append(node.materials_text)
    return tuple(unmatched)


def import_catalog(workbook_dir: Path, connection: psycopg.Connection) -> ImportReport:
    model_path = workbook_dir / MODEL_WORKBOOK
    plan_path = workbook_dir / PLAN_WORKBOOK
    l1_nodes = _parse_l1(model_path)
    l2_nodes, l3_nodes = _parse_plan(plan_path)
    resources = _parse_resources(plan_path)
    unmatched = _unmatched_materials(l3_nodes, resources)

    with connection.transaction():
        connection.execute("DELETE FROM capability_node_resource")
        connection.execute("DELETE FROM capability_node")
        connection.execute("DELETE FROM learning_resource")
        connection.execute("DELETE FROM capability_model")
        model_id = connection.execute(
            """
            INSERT INTO capability_model
                (code, name, version, source_workbook, source_sheet, source_row)
            VALUES (%s, %s, %s, %s, %s, %s)
            RETURNING id
            """,
            (
                MODEL_CODE,
                "技术架构与开发专业线能力胜任模型",
                MODEL_VERSION,
                MODEL_WORKBOOK,
                MODEL_SHEET,
                1,
            ),
        ).fetchone()[0]
        node_ids: dict[str, int] = {}
        for order, node in enumerate(l1_nodes, 1):
            node_ids[node.code] = connection.execute(
                """
                INSERT INTO capability_node (
                    model_id, parent_node_id, node_type, code, name, sort_order,
                    l1_category, p4_description, p5_description, p6_description,
                    p7_description, p8_description, source_workbook, source_sheet,
                    source_row
                ) VALUES (
                    %s, NULL, 'L1', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s
                )
                RETURNING id
                """,
                (
                    model_id,
                    node.code,
                    node.name,
                    order,
                    node.category,
                    *node.descriptions,
                    MODEL_WORKBOOK,
                    MODEL_SHEET,
                    node.source_row,
                ),
            ).fetchone()[0]
        for order, node in enumerate(l2_nodes, 1):
            node_ids[node.code] = connection.execute(
                """
                INSERT INTO capability_node (
                    model_id, parent_node_id, node_type, code, name, sort_order,
                    source_workbook, source_sheet, source_row
                ) VALUES (%s, %s, 'L2', %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    model_id,
                    node_ids[node.parent_code],
                    node.code,
                    node.name,
                    order,
                    PLAN_WORKBOOK,
                    SELF_ASSESSMENT_SHEET,
                    node.source_row,
                ),
            ).fetchone()[0]
        for order, node in enumerate(l3_nodes, 1):
            node_ids[node.code] = connection.execute(
                """
                INSERT INTO capability_node (
                    model_id, parent_node_id, node_type, code, name, sort_order,
                    recommended_start_level, materials_text, expected_output,
                    estimated_hours,
                    source_workbook, source_sheet, source_row
                ) VALUES (%s, %s, 'L3', %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    model_id,
                    node_ids[node.parent_code],
                    node.code,
                    node.name,
                    order,
                    node.start_level,
                    node.materials_text,
                    node.expected_output,
                    node.estimated_hours,
                    PLAN_WORKBOOK,
                    SELF_ASSESSMENT_SHEET,
                    node.source_row,
                ),
            ).fetchone()[0]
        resource_ids: dict[str, int] = {}
        for resource in resources.values():
            resource_ids[resource.code] = connection.execute(
                """
                INSERT INTO learning_resource (
                    material_code, name, material_type, source_text, purpose, status,
                    source_workbook, source_sheet, source_row
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
                """,
                (
                    resource.code,
                    resource.name,
                    resource.material_type,
                    resource.source_text,
                    resource.purpose,
                    resource.status,
                    PLAN_WORKBOOK,
                    RESOURCE_SHEET,
                    resource.source_row,
                ),
            ).fetchone()[0]
        links = {
            (node_ids[node.code], resource_ids[code])
            for node in l3_nodes
            for code in MATERIAL_CODE.findall(node.materials_text)
            if code in resource_ids
        }
        for node_id, resource_id in links:
            connection.execute(
                "INSERT INTO capability_node_resource (node_id, resource_id) "
                "VALUES (%s, %s)",
                (node_id, resource_id),
            )

    return ImportReport(
        1,
        len(l1_nodes),
        len(l2_nodes),
        len(l3_nodes),
        len(resources),
        len(links),
        unmatched,
    )


def ensure_catalog_initialized(
    connection: psycopg.Connection, workbook_dir: Path
) -> ImportReport | None:
    create_catalog_schema(connection)
    if catalog_is_empty(connection):
        return import_catalog(workbook_dir, connection)
    return None
