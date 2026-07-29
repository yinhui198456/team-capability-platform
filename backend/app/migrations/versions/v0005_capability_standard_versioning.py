# ruff: noqa: E501

import psycopg


def _constraint_exists(connection: psycopg.Connection, table: str, name: str) -> bool:
    return (
        connection.execute(
            """
            SELECT 1 FROM pg_constraint
            WHERE conrelid = %s::regclass AND conname = %s
            """,
            (table, name),
        ).fetchone()
        is not None
    )


def _add_constraint_if_missing(
    connection: psycopg.Connection, table: str, name: str, definition: str
) -> None:
    if not _constraint_exists(connection, table, name):
        connection.execute(f"ALTER TABLE {table} ADD CONSTRAINT {name} {definition}")


def _drop_source_check(connection: psycopg.Connection) -> None:
    rows = connection.execute(
        """
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'capability_standard_item'::regclass AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%source%'
        """
    ).fetchall()
    for (name,) in rows:
        # Constraint names originate in PostgreSQL metadata, not user input.
        connection.execute(
            f'ALTER TABLE capability_standard_item DROP CONSTRAINT "{name}"'
        )


def _backfill_l3_identity(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        UPDATE capability_standard_item i SET l3_node_id = n.id
        FROM capability_standard_version v, capability_node n
        WHERE i.version_id = v.id AND n.model_id = v.model_id
          AND n.node_type = 'L3' AND n.code = i.l3_code AND i.l3_node_id IS NULL
        """
    )
    missing = connection.execute(
        "SELECT l3_code FROM capability_standard_item WHERE l3_node_id IS NULL LIMIT 1"
    ).fetchone()
    if missing is not None:
        raise ValueError(f"cannot map Legacy Baseline item identity: {missing[0]}")
    mismatch = connection.execute(
        """
        SELECT i.l3_code FROM capability_standard_item i
        JOIN capability_standard_version v ON v.id = i.version_id
        JOIN capability_node n ON n.id = i.l3_node_id
        WHERE n.model_id <> v.model_id OR n.node_type <> 'L3' LIMIT 1
        """
    ).fetchone()
    if mismatch is not None:
        raise ValueError(f"cross-model Legacy Baseline identity: {mismatch[0]}")


def _assert_legacy_overrides_match_v1(connection: psycopg.Connection) -> None:
    """v0004 materialised the old override semantics into Legacy Baseline v1.

    An override below its L3 recommended starting level was never effective in the
    former resolver, so it is deliberately ignored here as well.  Any effective
    override that disagrees with its already published v1 cell means we cannot
    prove a lossless migration and must abort the entire migration.
    """
    mismatch = connection.execute(
        """
        SELECT n.code, o.job_level
        FROM capability_standard_target_override o
        JOIN capability_node n ON n.id = o.node_id AND n.node_type = 'L3'
        JOIN capability_standard_version v
          ON v.model_id = n.model_id AND v.version_no = 1
             AND v.label = 'Legacy Baseline v1'
        JOIN capability_standard_item i
          ON i.version_id = v.id AND i.l3_node_id = n.id
             AND i.job_level = o.job_level
        WHERE substring(o.job_level FROM 'P([4-8])')::INT
                >= substring(n.recommended_start_level FROM 'P([4-8])')::INT
          AND (
              i.applicable IS DISTINCT FROM (o.target_level IS NOT NULL)
              OR i.target_level IS DISTINCT FROM o.target_level
          )
        LIMIT 1
        """
    ).fetchone()
    if mismatch is not None:
        raise ValueError(
            "Legacy Baseline v1 does not match legacy override "
            f"for {mismatch[0]} {mismatch[1]}"
        )


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        "ALTER TABLE capability_standard_item ADD COLUMN IF NOT EXISTS l3_node_id BIGINT"
    )
    connection.execute(
        "ALTER TABLE capability_standard_item ADD COLUMN IF NOT EXISTS updated_by BIGINT"
    )
    connection.execute(
        "ALTER TABLE capability_standard_item ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
    )
    connection.execute(
        "ALTER TABLE capability_standard_version ADD COLUMN IF NOT EXISTS change_summary TEXT"
    )
    connection.execute(
        "ALTER TABLE capability_standard_version ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ"
    )
    connection.execute(
        "ALTER TABLE capability_standard_version ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ"
    )
    connection.execute(
        "ALTER TABLE capability_standard_version ADD COLUMN IF NOT EXISTS archived_by BIGINT"
    )

    _backfill_l3_identity(connection)
    _assert_legacy_overrides_match_v1(connection)

    _drop_source_check(connection)
    _add_constraint_if_missing(
        connection,
        "capability_standard_item",
        "capability_standard_item_source_check",
        "CHECK (source IN ('legacy_derived', 'copied', 'explicit'))",
    )
    connection.execute(
        "ALTER TABLE capability_standard_item ALTER COLUMN l3_node_id SET NOT NULL"
    )
    _add_constraint_if_missing(
        connection,
        "capability_standard_item",
        "capability_standard_item_l3_node_fkey",
        "FOREIGN KEY (l3_node_id) REFERENCES capability_node(id) ON DELETE RESTRICT",
    )
    _add_constraint_if_missing(
        connection,
        "capability_standard_item",
        "capability_standard_item_updated_by_fkey",
        "FOREIGN KEY (updated_by) REFERENCES tcp_user(id) ON DELETE SET NULL",
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS capability_standard_item_version_node_level_key
        ON capability_standard_item(version_id, l3_node_id, job_level)
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS unique_draft_capability_standard
        ON capability_standard_version(model_id) WHERE status = '草稿'
        """
    )
    _add_constraint_if_missing(
        connection,
        "capability_standard_version",
        "capability_standard_version_archived_by_fkey",
        "FOREIGN KEY (archived_by) REFERENCES tcp_user(id) ON DELETE SET NULL",
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS capability_standard_version_audit (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            version_id BIGINT NOT NULL REFERENCES capability_standard_version(id) ON DELETE RESTRICT,
            actor_user_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE RESTRICT,
            action TEXT NOT NULL CHECK (action IN ('created','edited','reconciled','published','archived','abandoned')),
            old_revision BIGINT,
            new_revision BIGINT,
            summary JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )
    connection.execute(
        """
        CREATE INDEX IF NOT EXISTS capability_standard_version_audit_version_idx
        ON capability_standard_version_audit(version_id, created_at DESC)
        """
    )
    connection.execute(
        "UPDATE capability_standard_version SET updated_at = COALESCE(updated_at, created_at)"
    )
