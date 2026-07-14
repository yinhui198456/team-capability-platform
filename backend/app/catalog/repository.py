import psycopg


def catalog_is_empty(connection: psycopg.Connection) -> bool:
    return connection.execute(
        "SELECT NOT EXISTS (SELECT 1 FROM capability_model)"
    ).fetchone()[0]
