import psycopg


def upgrade(connection: psycopg.Connection) -> None:
    """Add the sparse-draft state needed to protect explicit clears from batch fill."""
    connection.execute(
        """
        ALTER TABLE assessment_detail
        ADD COLUMN IF NOT EXISTS current_level_explicitly_cleared BOOLEAN
            NOT NULL DEFAULT FALSE
        """
    )
