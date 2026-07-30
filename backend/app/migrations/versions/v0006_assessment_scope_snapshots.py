import psycopg


def _preflight_no_duplicate_open_assessments(connection: psycopg.Connection) -> None:
    """The open-assessment business key is (member_id, year, assessment_type).

    Any pre-existing duplicates must abort the entire migration: we never
    archive, delete, or pick a "latest" row on behalf of the data owner.
    The runner wraps every migration in one transaction, so raising here
    rolls back every DDL statement of this version as well.
    """
    rows = connection.execute(
        """
        SELECT member_id, year, assessment_type, array_agg(id ORDER BY id)
        FROM assessment
        WHERE status IN ('草稿', '建议调整')
        GROUP BY member_id, year, assessment_type
        HAVING COUNT(*) > 1
        ORDER BY member_id, year, assessment_type
        """
    ).fetchall()
    if rows:
        parts = [
            f"member={member_id} year={year} type={assessment_type} ids={list(ids)}"
            for member_id, year, assessment_type, ids in rows
        ]
        raise ValueError(
            "duplicate open assessments for "
            "(member_id, year, assessment_type): " + "; ".join(parts)
        )


def upgrade(connection: psycopg.Connection) -> None:
    _preflight_no_duplicate_open_assessments(connection)

    connection.execute(
        "ALTER TABLE assessment ADD COLUMN IF NOT EXISTS assessment_scope_version TEXT"
    )
    for definition in (
        "l3_node_id BIGINT",
        "scope_type TEXT",
        "standard_job_level_snapshot TEXT",
        "l1_code TEXT",
        "l1_name TEXT",
        "l2_code TEXT",
        "l2_name TEXT",
        "l3_name TEXT",
    ):
        connection.execute(
            f"ALTER TABLE assessment_detail ADD COLUMN IF NOT EXISTS {definition}"
        )
    connection.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_scope_type_check'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_scope_type_check
                CHECK (
                    scope_type IS NULL
                    OR scope_type IN ('current_required', 'target_progressive')
                );
            END IF;
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conrelid = 'assessment_detail'::regclass
                  AND conname = 'assessment_detail_standard_job_level_snapshot_check'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_standard_job_level_snapshot_check
                CHECK (
                    standard_job_level_snapshot IS NULL
                    OR standard_job_level_snapshot IN ('P4', 'P5', 'P6', 'P7', 'P8')
                );
            END IF;
        END
        $$
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS assessment_detail_node_identity
        ON assessment_detail (assessment_id, l3_node_id)
        WHERE l3_node_id IS NOT NULL
        """
    )
    connection.execute(
        """
        CREATE UNIQUE INDEX IF NOT EXISTS assessment_one_open_per_scope
        ON assessment (member_id, year, assessment_type)
        WHERE status IN ('草稿', '建议调整')
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS assessment_idempotency_key (
            member_id BIGINT NOT NULL REFERENCES tcp_user(id) ON DELETE CASCADE,
            idempotency_key TEXT NOT NULL,
            request_fingerprint TEXT NOT NULL,
            assessment_id BIGINT NOT NULL REFERENCES assessment(id) ON DELETE CASCADE,
            response JSONB NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (member_id, idempotency_key)
        )
        """
    )
