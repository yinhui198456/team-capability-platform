import psycopg
from conftest import ADMIN_DATABASE_URL, TEST_DATABASE_LOCK_KEY

from app.settings import settings


def test_catalog_tests_use_the_isolated_database() -> None:
    assert settings.database_url.endswith("/tcp_test")

    with psycopg.connect(settings.database_url) as connection:
        database_name = connection.execute("SELECT current_database()").fetchone()[0]

    assert database_name == "tcp_test"


def test_catalog_test_session_holds_the_database_lock() -> None:
    with psycopg.connect(ADMIN_DATABASE_URL, autocommit=True) as connection:
        locked = connection.execute(
            "SELECT pg_try_advisory_lock(%s)", (TEST_DATABASE_LOCK_KEY,)
        ).fetchone()[0]

    assert locked is False
