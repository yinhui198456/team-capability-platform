from collections.abc import Iterator

import psycopg
import pytest

from app.settings import settings

TEST_DATABASE = "tcp_test"
TEST_DATABASE_URL = "postgresql://tcp:tcp_dev_only@postgres:5432/tcp_test"
ADMIN_DATABASE_URL = "postgresql://tcp:tcp_dev_only@postgres:5432/postgres"


def _ensure_test_database() -> None:
    with psycopg.connect(ADMIN_DATABASE_URL, autocommit=True) as connection:
        exists = connection.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (TEST_DATABASE,)
        ).fetchone()
        if exists is None:
            connection.execute(f"CREATE DATABASE {TEST_DATABASE}")


def _clear_catalog(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS capability_node_resource")
        connection.execute("DROP TABLE IF EXISTS learning_resource")
        connection.execute("DROP TABLE IF EXISTS capability_node")
        connection.execute("DROP TABLE IF EXISTS capability_model")


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database() -> Iterator[None]:
    _ensure_test_database()
    development_database_url = settings.database_url
    settings.database_url = TEST_DATABASE_URL
    try:
        yield
    finally:
        settings.database_url = development_database_url


@pytest.fixture
def connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(TEST_DATABASE_URL) as test_connection:
        _clear_catalog(test_connection)
        yield test_connection
