from __future__ import annotations

import re

import psycopg
from psycopg.rows import dict_row

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
        SELECT id, code, name, l1_category, enabled,
               p4_description, p5_description, p6_description,
               p7_description, p8_description
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
        SELECT id, parent_node_id, code, name
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
               materials_text, expected_output, estimated_hours
        FROM capability_node
        WHERE node_type = 'L3' AND parent_node_id = ANY(%s)
        ORDER BY sort_order
        """,
        (l2_ids,),
    )
    resources_by_node: dict[object, list[dict[str, object]]] = {
        row["id"]: [] for row in l3_rows
    }
    if l3_rows:
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
                "children": l3_by_l2[row["id"]],
            }
        )
    model["domains"] = [
        {
            "code": row["code"],
            "name": row["name"],
            "category": row["l1_category"],
            "enabled": row["enabled"],
            "p4_description": row["p4_description"],
            "p5_description": row["p5_description"],
            "p6_description": row["p6_description"],
            "p7_description": row["p7_description"],
            "p8_description": row["p8_description"],
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
        WHERE {' AND '.join(filters)}
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
