import psycopg

from app.settings import settings


def test_catalog_tests_use_the_isolated_database() -> None:
    assert settings.database_url.endswith("/tcp_test")

    with psycopg.connect(settings.database_url) as connection:
        database_name = connection.execute("SELECT current_database()").fetchone()[0]

    assert database_name == "tcp_test"
