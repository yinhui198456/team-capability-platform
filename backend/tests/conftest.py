from collections.abc import Iterator

import psycopg
import pytest

from app.settings import settings

TEST_DATABASE = "tcp_test"
TEST_DATABASE_URL = "postgresql://tcp:tcp_dev_only@postgres:5432/tcp_test"
ADMIN_DATABASE_URL = "postgresql://tcp:tcp_dev_only@postgres:5432/postgres"
TEST_DATABASE_LOCK_KEY = 651042
# ponytail: global PostgreSQL advisory lock on tcp_test blocks cross-process conflicts.
# Serial test sessions are a known ceiling; isolate per worker only if throughput caps.


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


def _clear_assessment(connection: psycopg.Connection) -> None:
    with connection.transaction():
        connection.execute("DROP TABLE IF EXISTS growth_goal")
        connection.execute("DROP TABLE IF EXISTS annual_growth_plan")
        connection.execute("DROP TABLE IF EXISTS assessment_review")
        connection.execute("DROP TABLE IF EXISTS gap")
        connection.execute("DROP TABLE IF EXISTS assessment_detail")
        connection.execute("DROP TABLE IF EXISTS assessment")


@pytest.fixture(scope="session", autouse=True)
def isolated_test_database() -> Iterator[None]:
    lock_connection = psycopg.connect(ADMIN_DATABASE_URL, autocommit=True)
    lock_acquired = False
    try:
        lock_connection.execute(
            "SELECT pg_advisory_lock(%s)", (TEST_DATABASE_LOCK_KEY,)
        )
        lock_acquired = True
        development_database_url = settings.database_url
        _ensure_test_database()
        settings.database_url = TEST_DATABASE_URL
        try:
            yield
        finally:
            settings.database_url = development_database_url
    finally:
        if lock_acquired:
            lock_connection.execute(
                "SELECT pg_advisory_unlock(%s)", (TEST_DATABASE_LOCK_KEY,)
            )
        lock_connection.close()


@pytest.fixture
def connection() -> Iterator[psycopg.Connection]:
    with psycopg.connect(TEST_DATABASE_URL) as test_connection:
        _clear_catalog(test_connection)
        _clear_assessment(test_connection)
        yield test_connection
