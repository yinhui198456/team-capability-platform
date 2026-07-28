import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    connection.execute(
        """
        ALTER TABLE assessment
        ADD COLUMN IF NOT EXISTS revision BIGINT NOT NULL DEFAULT 1
        """
    )
    connection.execute(
        """
        ALTER TABLE assessment_detail
        ADD COLUMN IF NOT EXISTS inherited_from_assessment_id BIGINT
            REFERENCES assessment(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS inherited_current_level INT,
        ADD COLUMN IF NOT EXISTS inherited_evidence_note TEXT,
        ADD COLUMN IF NOT EXISTS current_level_explicitly_cleared BOOLEAN
            NOT NULL DEFAULT FALSE
        """
    )
    connection.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'assessment_detail_inherited_current_level_check'
            ) THEN
                ALTER TABLE assessment_detail
                ADD CONSTRAINT assessment_detail_inherited_current_level_check
                CHECK (
                    inherited_current_level IS NULL
                    OR inherited_current_level BETWEEN 1 AND 5
                );
            END IF;
        END
        $$
        """
    )
