from __future__ import annotations

import re

import psycopg
from psycopg.rows import dict_row

from .standard_targets import parse_earliest_level

DOMAIN_CODES = ("P01", "P02", "P03", "C01", "C02", "C03")
MATERIAL_CODE = re.compile(r"(?:P|C)\d{2}-M\d{3}")


def _fetchone(
    connection: psycopg.Connection, query: str, parameters: tuple[object, ...]
) -> dict[str, object] | None:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query, parameters)
        return cursor.fetchone()


def _fetchall(
    connection: psycopg.Connection, query: str, parameters: tuple[object, ...]
) -> list[dict[str, object]]:
    with connection.cursor(row_factory=dict_row) as cursor:
        cursor.execute(query, parameters)
        return list(cursor.fetchall())


def _unmatched_materials(materials_text: str, resource_codes: set[str]) -> list[str]:
    codes = MATERIAL_CODE.findall(materials_text)
    residual = MATERIAL_CODE.sub("", materials_text).strip("、,，;；/ \t\r\n")
    if residual or any(code not in resource_codes for code in codes):
        return [materials_text]
    return []


def catalog_is_empty(connection: psycopg.Connection) -> bool:
    return connection.execute(
        "SELECT NOT EXISTS (SELECT 1 FROM capability_model)"
    ).fetchone()[0]


def get_capability_model(
    connection: psycopg.Connection, domain_code: str | None
) -> dict[str, object] | None:
    model = _fetchone(
        connection,
        """
        SELECT code, name, version, source_workbook, source_sheet, source_row
        FROM capability_model
        ORDER BY id
        LIMIT 1
        """,
        (),
    )
    if model is None:
        return None

    l1_parameters: tuple[object, ...] = (list(DOMAIN_CODES),)
    l1_filter = "code = ANY(%s)"
    if domain_code is not None:
        l1_filter += " AND code = %s"
        l1_parameters = (*l1_parameters, domain_code)
    l1_rows = _fetchall(
        connection,
        f"""
        SELECT id, code, name, l1_category, overview, enabled
        FROM capability_node
        WHERE model_id = (SELECT id FROM capability_model ORDER BY id LIMIT 1)
          AND node_type = 'L1'
          AND {l1_filter}
        ORDER BY sort_order
        """,
        l1_parameters,
    )
    if not l1_rows:
        return None

    l1_ids = [row["id"] for row in l1_rows]
    l2_rows = _fetchall(
        connection,
        """
        SELECT id, parent_node_id, code, name,
               p4_description, p5_description, p6_description,
               p7_description, p8_description
        FROM capability_node
        WHERE node_type = 'L2' AND parent_node_id = ANY(%s)
        ORDER BY sort_order
        """,
        (l1_ids,),
    )
    l2_ids = [row["id"] for row in l2_rows]
    l3_rows = _fetchall(
        connection,
        """
        SELECT id, parent_node_id, code, name, recommended_start_level,
               materials_text, expected_output, estimated_hours, output_type, notes
        FROM capability_node
        WHERE node_type = 'L3' AND parent_node_id = ANY(%s)
        ORDER BY sort_order
        """,
        (l2_ids,),
    )
    resources_by_node: dict[object, list[dict[str, object]]] = {
        row["id"]: [] for row in l3_rows
    }
    overrides_by_node: dict[object, dict[str, int | None]] = {
        row["id"]: {} for row in l3_rows
    }
    if l3_rows:
        for override in _fetchall(
            connection,
            """
            SELECT node_id, job_level, target_level
            FROM capability_standard_target_override
            WHERE node_id = ANY(%s)
            ORDER BY job_level
            """,
            ([row["id"] for row in l3_rows],),
        ):
            overrides_by_node[override["node_id"]][override["job_level"]] = override[
                "target_level"
            ]
        for resource in _fetchall(
            connection,
            """
            SELECT link.node_id, resource.material_code, resource.name,
                   resource.material_type, resource.status
            FROM capability_node_resource AS link
            JOIN learning_resource AS resource ON resource.id = link.resource_id
            WHERE link.node_id = ANY(%s)
            ORDER BY resource.material_code
            """,
            ([row["id"] for row in l3_rows],),
        ):
            resources_by_node[resource.pop("node_id")].append(resource)

    l3_by_l2: dict[object, list[dict[str, object]]] = {row["id"]: [] for row in l2_rows}
    for row in l3_rows:
        resources = resources_by_node[row["id"]]
        l3_by_l2[row["parent_node_id"]].append(
            {
                "code": row["code"],
                "name": row["name"],
                "recommended_start_level": row["recommended_start_level"],
                "materials_text": row["materials_text"],
                "expected_output": row["expected_output"],
                "estimated_hours": row["estimated_hours"],
                "output_type": row["output_type"],
                "notes": row["notes"],
                "standard_target_overrides": overrides_by_node[row["id"]],
                "resources": resources,
                "unmatched_materials": _unmatched_materials(
                    row["materials_text"],
                    {resource["material_code"] for resource in resources},
                ),
            }
        )
    l2_by_l1: dict[object, list[dict[str, object]]] = {row["id"]: [] for row in l1_rows}
    for row in l2_rows:
        l2_by_l1[row["parent_node_id"]].append(
            {
                "code": row["code"],
                "name": row["name"],
                "p4_description": row["p4_description"],
                "p5_description": row["p5_description"],
                "p6_description": row["p6_description"],
                "p7_description": row["p7_description"],
                "p8_description": row["p8_description"],
                "children": l3_by_l2[row["id"]],
            }
        )
    model["domains"] = [
        {
            "code": row["code"],
            "name": row["name"],
            "category": row["l1_category"],
            "overview": row["overview"],
            "enabled": row["enabled"],
            "children": l2_by_l1[row["id"]],
        }
        for row in l1_rows
    ]
    return model


def list_learning_resources(
    connection: psycopg.Connection,
    name: str | None,
    status: str | None,
    l3_code: str | None,
) -> list[dict[str, object]]:
    filters = ["1 = 1"]
    parameters: list[object] = []
    if name:
        filters.append("resource.name ILIKE %s")
        parameters.append(f"%{name}%")
    if status:
        filters.append("resource.status = %s")
        parameters.append(status)
    if l3_code:
        filters.append(
            """
            EXISTS (
                SELECT 1
                FROM capability_node_resource AS target_link
                JOIN capability_node AS target_l3 ON target_l3.id = target_link.node_id
                WHERE target_link.resource_id = resource.id
                  AND target_l3.node_type = 'L3'
                  AND target_l3.code = %s
            )
            """
        )
        parameters.append(l3_code)
    return _fetchall(
        connection,
        f"""
        SELECT resource.material_code, resource.name, resource.material_type,
               resource.source_text, resource.purpose, resource.status,
               count(DISTINCT link.node_id) AS l3_count
        FROM learning_resource AS resource
        LEFT JOIN capability_node_resource AS link ON link.resource_id = resource.id
        WHERE {" AND ".join(filters)}
        GROUP BY resource.id
        ORDER BY resource.material_code
        """,
        tuple(parameters),
    )


def get_learning_resource(
    connection: psycopg.Connection, material_code: str
) -> dict[str, object] | None:
    resource = _fetchone(
        connection,
        """
        SELECT material_code, name, material_type, source_text, purpose, status
        FROM learning_resource
        WHERE material_code = %s
        """,
        (material_code,),
    )
    if resource is None:
        return None
    resource["l3_nodes"] = _fetchall(
        connection,
        """
        SELECT l3.code, l3.name, l1.code AS l1_code, l1.name AS l1_name,
               l2.code AS l2_code, l2.name AS l2_name
        FROM capability_node_resource AS link
        JOIN capability_node AS l3 ON l3.id = link.node_id
        JOIN capability_node AS l2 ON l2.id = l3.parent_node_id
        JOIN capability_node AS l1 ON l1.id = l2.parent_node_id
        WHERE link.resource_id = (
            SELECT id FROM learning_resource WHERE material_code = %s
        )
          AND l3.node_type = 'L3'
          AND l1.code = ANY(%s)
        ORDER BY l1.sort_order, l2.sort_order, l3.sort_order
        """,
        (material_code, list(DOMAIN_CODES)),
    )
    return resource


_L3_ONLY_FIELDS = (
    "recommended_start_level",
    "materials_text",
    "expected_output",
    "estimated_hours",
    "output_type",
    "notes",
    "resource_codes",
    "standard_target_overrides",
)
_L1_FIELDS = {"name", "enabled", "overview"}
_L2_FIELDS = {
    "name",
    "enabled",
    "p4_description",
    "p5_description",
    "p6_description",
    "p7_description",
    "p8_description",
}
_L3_FIELDS = {"name", "enabled", *_L3_ONLY_FIELDS}


def get_capability_node(
    connection: psycopg.Connection, node_code: str
) -> dict[str, object] | None:
    node = _fetchone(
        connection,
        """
        SELECT id, node_type, code, name, l1_category, overview, enabled,
               p4_description, p5_description, p6_description,
               p7_description, p8_description,
               recommended_start_level, materials_text, expected_output,
               estimated_hours,
               output_type, notes
        FROM capability_node
        WHERE code = %s
        """,
        (node_code,),
    )
    if node is None:
        return None

    node_type = node["node_type"]
    if node_type == "L1":
        return {
            "code": node["code"],
            "name": node["name"],
            "category": node["l1_category"],
            "enabled": node["enabled"],
            "overview": node["overview"],
        }
    if node_type == "L2":
        return {
            "code": node["code"],
            "name": node["name"],
            "enabled": node["enabled"],
            "p4_description": node["p4_description"],
            "p5_description": node["p5_description"],
            "p6_description": node["p6_description"],
            "p7_description": node["p7_description"],
            "p8_description": node["p8_description"],
        }

    resources = _fetchall(
        connection,
        """
        SELECT resource.material_code, resource.name,
               resource.material_type, resource.status
        FROM capability_node_resource AS link
        JOIN learning_resource AS resource ON resource.id = link.resource_id
        WHERE link.node_id = %s
        ORDER BY resource.material_code
        """,
        (node["id"],),
    )
    standard_target_overrides = {
        row["job_level"]: row["target_level"]
        for row in _fetchall(
            connection,
            """
            SELECT job_level, target_level
            FROM capability_standard_target_override
            WHERE node_id = %s
            ORDER BY job_level
            """,
            (node["id"],),
        )
    }
    return {
        "code": node["code"],
        "name": node["name"],
        "enabled": node["enabled"],
        "recommended_start_level": node["recommended_start_level"],
        "materials_text": node["materials_text"],
        "expected_output": node["expected_output"],
        "estimated_hours": node["estimated_hours"],
        "output_type": node["output_type"],
        "notes": node["notes"],
        "standard_target_overrides": standard_target_overrides,
        "resources": resources,
        "unmatched_materials": _unmatched_materials(
            node["materials_text"],
            {resource["material_code"] for resource in resources},
        ),
    }


def _validate_l3_codes(connection: psycopg.Connection, l3_codes: list[str]) -> None:
    if not l3_codes:
        return
    rows = _fetchall(
        connection,
        """
        SELECT code FROM capability_node
        WHERE node_type = 'L3' AND code = ANY(%s)
        """,
        (list(set(l3_codes)),),
    )
    found = {row["code"] for row in rows}
    missing = set(l3_codes) - found
    if missing:
        raise ValueError(f"unknown l3 codes: {sorted(missing)}")


def _validate_resource_codes(
    connection: psycopg.Connection, resource_codes: list[str]
) -> None:
    if not resource_codes:
        return
    rows = _fetchall(
        connection,
        """
        SELECT material_code FROM learning_resource
        WHERE material_code = ANY(%s)
        """,
        (list(set(resource_codes)),),
    )
    found = {row["material_code"] for row in rows}
    missing = set(resource_codes) - found
    if missing:
        raise ValueError(f"unknown resource codes: {sorted(missing)}")


def update_capability_node(
    connection: psycopg.Connection,
    node_code: str,
    data: dict[str, object],
) -> dict[str, object] | None:
    node = _fetchone(
        connection,
        """
        SELECT id, node_type, recommended_start_level
        FROM capability_node WHERE code = %s
        """,
        (node_code,),
    )
    if node is None:
        return None

    node_type = node["node_type"]
    allowed_fields = {
        "L1": _L1_FIELDS,
        "L2": _L2_FIELDS,
        "L3": _L3_FIELDS,
    }[node_type]
    invalid_fields = set(data) - allowed_fields
    if invalid_fields:
        raise ValueError(
            f"invalid fields for {node_type}: {', '.join(sorted(invalid_fields))}"
        )

    standard_target_overrides: dict[str, int | None] | None = None
    if node_type == "L3" and (
        "standard_target_overrides" in data or "recommended_start_level" in data
    ):
        existing_overrides = {
            row["job_level"]: row["target_level"]
            for row in _fetchall(
                connection,
                """
                SELECT job_level, target_level
                FROM capability_standard_target_override
                WHERE node_id = %s
                """,
                (node["id"],),
            )
        }
        raw_overrides = data.get("standard_target_overrides", existing_overrides)
        if not isinstance(raw_overrides, dict):
            raise ValueError("standard_target_overrides must be an object")
        standard_target_overrides = {}
        for job_level, target_level in raw_overrides.items():
            if job_level not in {"P4", "P5", "P6", "P7", "P8"}:
                raise ValueError(f"invalid override job level: {job_level}")
            if target_level is not None and (
                isinstance(target_level, bool)
                or not isinstance(target_level, int)
                or not 1 <= target_level <= 5
            ):
                raise ValueError("override target must be between 1 and 5 or null")
            standard_target_overrides[job_level] = target_level

        recommended_start_level = data.get(
            "recommended_start_level", node["recommended_start_level"]
        )
        if not isinstance(recommended_start_level, str):
            raise ValueError("recommended_start_level is required for L3 nodes")
        earliest = parse_earliest_level(recommended_start_level)
        below_start = sorted(
            level for level in standard_target_overrides if int(level[1:]) < earliest
        )
        if below_start:
            raise ValueError(
                "standard target override below recommended_start_level: "
                + ", ".join(below_start)
            )

    scalar_fields = sorted(
        allowed_fields - {"resource_codes", "standard_target_overrides"}
    )

    updates = []
    parameters: list[object] = []
    for field in scalar_fields:
        if field in data:
            updates.append(f"{field} = %s")
            parameters.append(data[field])

    with connection.transaction():
        if updates:
            parameters.append(node_code)
            connection.execute(
                f"""
                UPDATE capability_node
                SET {", ".join(updates)}
                WHERE code = %s
                """,
                parameters,
            )

        if node_type == "L3" and "resource_codes" in data:
            _validate_resource_codes(connection, data["resource_codes"])
            connection.execute(
                "DELETE FROM capability_node_resource WHERE node_id = %s",
                (node["id"],),
            )
            codes = list(set(data["resource_codes"]))
            if codes:
                connection.execute(
                    """
                    INSERT INTO capability_node_resource (node_id, resource_id)
                    SELECT %s, id FROM learning_resource WHERE material_code = ANY(%s)
                    """,
                    (node["id"], codes),
                )

        if node_type == "L3" and "standard_target_overrides" in data:
            assert standard_target_overrides is not None
            connection.execute(
                "DELETE FROM capability_standard_target_override WHERE node_id = %s",
                (node["id"],),
            )
            for job_level, target_level in standard_target_overrides.items():
                connection.execute(
                    """
                    INSERT INTO capability_standard_target_override (
                        node_id, job_level, target_level
                    )
                    VALUES (%s, %s, %s)
                    """,
                    (node["id"], job_level, target_level),
                )

    return get_capability_node(connection, node_code)


def create_learning_resource(
    connection: psycopg.Connection, data: dict[str, object]
) -> dict[str, object]:
    material_code = data["material_code"]
    existing = _fetchone(
        connection,
        "SELECT 1 FROM learning_resource WHERE material_code = %s",
        (material_code,),
    )
    if existing is not None:
        raise ValueError(f"material code already exists: {material_code}")

    l3_codes = list(set(data.get("l3_codes", [])))
    _validate_l3_codes(connection, l3_codes)

    with connection.transaction():
        resource = _fetchone(
            connection,
            """
            INSERT INTO learning_resource (
                material_code, name, material_type, source_text, purpose, status,
                source_workbook, source_sheet, source_row
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'manual', 'manual', 0)
            RETURNING id, material_code
            """,
            (
                material_code,
                data["name"],
                data["material_type"],
                data["source_text"],
                data["purpose"],
                data["status"],
            ),
        )
        if l3_codes:
            connection.execute(
                """
                INSERT INTO capability_node_resource (node_id, resource_id)
                SELECT id, %s FROM capability_node
                WHERE node_type = 'L3' AND code = ANY(%s)
                """,
                (resource["id"], l3_codes),
            )

    return get_learning_resource(connection, material_code)


def update_learning_resource(
    connection: psycopg.Connection,
    material_code: str,
    data: dict[str, object],
) -> dict[str, object] | None:
    resource = _fetchone(
        connection,
        "SELECT id FROM learning_resource WHERE material_code = %s",
        (material_code,),
    )
    if resource is None:
        return None

    if "material_code" in data and data["material_code"] != material_code:
        raise ValueError("material_code is immutable")

    scalar_fields = ["name", "material_type", "source_text", "purpose", "status"]
    updates = []
    parameters: list[object] = []
    for field in scalar_fields:
        if field in data:
            updates.append(f"{field} = %s")
            parameters.append(data[field])

    l3_codes: list[str] | None = None
    if "l3_codes" in data:
        l3_codes = list(set(data["l3_codes"]))
        _validate_l3_codes(connection, l3_codes)

    with connection.transaction():
        if updates:
            parameters.append(material_code)
            connection.execute(
                f"""
                UPDATE learning_resource
                SET {", ".join(updates)}
                WHERE material_code = %s
                """,
                parameters,
            )
        if l3_codes is not None:
            connection.execute(
                "DELETE FROM capability_node_resource WHERE resource_id = %s",
                (resource["id"],),
            )
            if l3_codes:
                connection.execute(
                    """
                    INSERT INTO capability_node_resource (node_id, resource_id)
                    SELECT id, %s FROM capability_node
                    WHERE node_type = 'L3' AND code = ANY(%s)
                    """,
                    (resource["id"], l3_codes),
                )

    return get_learning_resource(connection, material_code)


def archive_learning_resource(
    connection: psycopg.Connection, material_code: str
) -> dict[str, object] | None:
    resource = _fetchone(
        connection,
        "SELECT 1 FROM learning_resource WHERE material_code = %s",
        (material_code,),
    )
    if resource is None:
        return None

    with connection.transaction():
        connection.execute(
            "UPDATE learning_resource SET status = 'archived' WHERE material_code = %s",
            (material_code,),
        )
    return get_learning_resource(connection, material_code)
