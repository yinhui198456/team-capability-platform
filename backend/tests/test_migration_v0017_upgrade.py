import psycopg

from app.migrations import run_migrations
from tests.review_support import reset_full_schema


def test_v0017_requirement_decision_upgrade_is_idempotent(
    connection: psycopg.Connection,
) -> None:
    reset_full_schema(connection)
    run_migrations(connection)
    run_migrations(connection)
    row = connection.execute(
        """SELECT column_name FROM information_schema.columns
           WHERE table_name = 'task_requirement_decision'
           ORDER BY column_name"""
    ).fetchall()
    assert {value[0] for value in row} >= {
        "learning_task_id",
        "proposal_detail_id",
        "selected_snapshot_id",
        "choice",
        "revision",
    }
