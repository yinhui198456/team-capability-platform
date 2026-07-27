import logging

import psycopg

from ...catalog.standard_targets import resolve_standard_target

logger = logging.getLogger(__name__)


def _add_snapshot_columns(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS capability_standard_target_override (
            node_id BIGINT NOT NULL
                REFERENCES capability_node(id) ON DELETE CASCADE,
            job_level TEXT NOT NULL
                CHECK (job_level IN ('P4', 'P5', 'P6', 'P7', 'P8')),
            target_level INT CHECK (
                target_level IS NULL OR target_level BETWEEN 1 AND 5
            ),
            PRIMARY KEY (node_id, job_level)
        )
        """
    )
    for definition in (
        "standard_target_applicable BOOLEAN",
        "standard_target_level INT",
        "target_adjusted BOOLEAN NOT NULL DEFAULT FALSE",
        "adjusted_target_level INT",
        "target_adjustment_reason TEXT",
        "target_snapshot_source TEXT",
        "target_compatibility_error TEXT",
    ):
        connection.execute(
            f"ALTER TABLE assessment_detail ADD COLUMN IF NOT EXISTS {definition}"
        )
    connection.execute(
        "ALTER TABLE assessment_detail ALTER COLUMN gap_value DROP NOT NULL"
    )


def _preserve_existing_targets(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        UPDATE assessment_detail
        SET target_snapshot_source = 'legacy_preserved'
        WHERE target_level IS NOT NULL
          AND target_snapshot_source IS NULL
        """
    )


def _migrate_empty_targets(connection: psycopg.Connection) -> None:
    rows = connection.execute(
        """
        SELECT ad.id, ad.current_level, a.status, u.target_level,
               c.code, c.recommended_start_level,
               override.target_level,
               override.node_id IS NOT NULL AS override_present
        FROM assessment_detail ad
        JOIN assessment a ON a.id = ad.assessment_id
        JOIN tcp_user u ON u.id = a.member_id
        LEFT JOIN capability_node c
          ON c.code = ad.l3_code AND c.node_type = 'L3'
        LEFT JOIN capability_standard_target_override override
          ON override.node_id = c.id AND override.job_level = u.target_level
        WHERE ad.target_level IS NULL
          AND ad.target_snapshot_source IS NULL
        ORDER BY ad.id
        """
    ).fetchall()
    for (
        detail_id,
        current_level,
        status,
        member_level,
        l3_code,
        recommended_start,
        override_value,
        override_present,
    ) in rows:
        if status not in ("草稿", "建议调整"):
            _mark_unresolved(connection, detail_id, "历史明细缺少目标快照")
            continue
        if member_level is None:
            _mark_unresolved(connection, detail_id, "成员缺少目标职级")
            continue
        if l3_code is None or recommended_start is None:
            _mark_unresolved(connection, detail_id, "能力项缺少建议起始职级")
            continue
        try:
            resolved = resolve_standard_target(
                member_level,
                recommended_start,
                override_present=override_present,
                override_value=override_value,
            )
        except ValueError as exc:
            logger.warning("cannot migrate target for L3 %s: %s", l3_code, exc)
            _mark_unresolved(connection, detail_id, str(exc))
            continue
        gap_value = (
            max(resolved.target_level - current_level, 0)
            if resolved.target_level is not None and current_level is not None
            else None
        )
        connection.execute(
            """
            UPDATE assessment_detail
            SET standard_target_applicable = %s,
                standard_target_level = %s,
                target_level = %s,
                gap_value = %s,
                plan_candidate = CASE WHEN %s THEN plan_candidate ELSE FALSE END,
                target_snapshot_source = 'legacy_draft_migrated',
                target_compatibility_error = NULL
            WHERE id = %s
            """,
            (
                resolved.applicable,
                resolved.target_level,
                resolved.target_level,
                gap_value,
                resolved.applicable,
                detail_id,
            ),
        )


def _mark_unresolved(
    connection: psycopg.Connection, detail_id: int, message: str
) -> None:
    connection.execute(
        """
        UPDATE assessment_detail
        SET gap_value = NULL,
            plan_candidate = FALSE,
            target_snapshot_source = 'legacy_preserved',
            target_compatibility_error = %s
        WHERE id = %s
        """,
        (message, detail_id),
    )


def _add_snapshot_constraints(connection: psycopg.Connection) -> None:
    constraints = {
        "assessment_detail_standard_target_level_check": """
            standard_target_level IS NULL OR standard_target_level BETWEEN 1 AND 5
        """,
        "assessment_detail_adjusted_target_level_check": """
            adjusted_target_level IS NULL OR adjusted_target_level BETWEEN 1 AND 5
        """,
        "assessment_detail_not_applicable_check": """
            standard_target_applicable IS DISTINCT FROM FALSE
            OR standard_target_level IS NULL
        """,
        "assessment_detail_target_adjustment_check": """
            (target_adjusted = FALSE
             AND adjusted_target_level IS NULL
             AND target_adjustment_reason IS NULL)
            OR
            (target_adjusted = TRUE
             AND standard_target_applicable = TRUE
             AND adjusted_target_level BETWEEN 1 AND 5
             AND BTRIM(target_adjustment_reason) <> '')
        """,
    }
    for name, expression in constraints.items():
        connection.execute(
            f"""
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = '{name}'
                ) THEN
                    ALTER TABLE assessment_detail
                    ADD CONSTRAINT {name} CHECK ({expression});
                END IF;
            END
            $$
            """
        )


def upgrade(connection: psycopg.Connection) -> None:
    _add_snapshot_columns(connection)
    _preserve_existing_targets(connection)
    _migrate_empty_targets(connection)
    _add_snapshot_constraints(connection)
