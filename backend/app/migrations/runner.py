import psycopg

from .versions import MIGRATIONS


def run_migrations(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS schema_migration (
                version TEXT PRIMARY KEY,
                applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        applied = {
            row[0]
            for row in connection.execute(
                "SELECT version FROM schema_migration"
            ).fetchall()
        }
        for version, upgrade in MIGRATIONS:
            if version in applied:
                continue
            upgrade(connection)
            connection.execute(
                "INSERT INTO schema_migration (version) VALUES (%s)", (version,)
            )
