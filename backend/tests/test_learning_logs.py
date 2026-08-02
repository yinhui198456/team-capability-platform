# ruff: noqa: F811  (pytest fixture arg shadows import)
# ruff: noqa: F811  (pytest fixture arg shadows import)
"""Issue #63: append-only learning logs, actual_hours aggregation, idempotency
and concurrent appends.  Tasks come from the real #62 approval chain."""

from concurrent.futures import ThreadPoolExecutor
from typing import Any

import psycopg
import pytest

from tests.test_learning_task import (
    _request,
    _seed_plan_items,
    learning_task_schema,  # noqa: F401  (pytest fixture)
)


@pytest.fixture
def seeded(learning_task_schema: psycopg.Connection) -> dict[str, object]:
    member_cookies, plan = _seed_plan_items(learning_task_schema)
    task_id = int(plan["items"][0]["id"])
    tasks = _request("GET", "/api/planning/learning-tasks", cookies=member_cookies)[1]
    task_id = int(next(t for t in tasks if t["plan_item_id"] == task_id)["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        {"to_status": "进行中"},
        cookies=member_cookies,
    )
    assert status == 200
    return {
        "connection": learning_task_schema,
        "member_cookies": member_cookies,
        "task_id": task_id,
    }


def _add_log(
    mc: dict[str, str], task_id: int, hours: int, **extra: Any
) -> tuple[int, Any]:
    body: dict[str, object] = {"record_date": "2026-05-10", "actual_hours": hours}
    body.update(extra)
    status, payload, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        body,
        cookies=mc,
    )
    return status, payload


def test_append_and_aggregate(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    _add_log(mc, task_id, 3)
    _add_log(mc, task_id, 5, record_date="2026-05-11")
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    task = next(t for t in tasks if t["id"] == task_id)
    assert task["actual_hours"] == 8


def test_hours_and_date_validation(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    for hours in (0, -1, 25, "abc"):
        status, body = _add_log(mc, task_id, hours)  # type: ignore[arg-type]
        assert status == 422
        assert body["detail"]["field"] == "actual_hours"
    status, body = _add_log(mc, task_id, 2, record_date="2099-01-01")
    assert status == 422
    assert body["detail"]["code"] == "invalid_hours"
    assert body["detail"]["field"] == "record_date"


def test_log_idempotency_replay_and_conflict(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, first = _add_log(mc, task_id, 4, idempotency_key="log-1")
    assert status == 200
    status, replay = _add_log(mc, task_id, 4, idempotency_key="log-1")
    assert status == 200
    assert replay["id"] == first["id"]
    status, body = _add_log(mc, task_id, 9, idempotency_key="log-1")
    assert status == 409
    assert body["detail"]["code"] == "log_idempotency_conflict"
    # Aggregation counted the log once.
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    assert next(t for t in tasks if t["id"] == task_id)["actual_hours"] == 4


def test_invalidate_and_correction_chain(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    _add_log(mc, task_id, 6)
    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    original_id = logs[0]["id"]

    status, invalidated, _ = _request(
        "POST",
        f"/api/planning/progress-logs/{original_id}/invalidate",
        {"idempotency_key": "void-1"},
        cookies=mc,
    )
    assert status == 200
    assert invalidated["invalidated_at"] is not None

    # Idempotent re-void returns the same row.
    status, replay, _ = _request(
        "POST",
        f"/api/planning/progress-logs/{original_id}/invalidate",
        {"idempotency_key": "void-1"},
        cookies=mc,
    )
    assert status == 200
    assert replay["id"] == original_id

    # Aggregation drops to zero after voiding.
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    assert next(t for t in tasks if t["id"] == task_id)["actual_hours"] == 0

    # Correction: new log referencing the voided one.  History stays readable.
    status, corrected, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        {
            "record_date": "2026-05-10",
            "actual_hours": 7,
            "note": "更正",
            "correction_of_log_id": original_id,
        },
        cookies=mc,
    )
    assert status == 200
    assert corrected["correction_of_log_id"] == original_id
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    assert next(t for t in tasks if t["id"] == task_id)["actual_hours"] == 7
    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    assert len(logs) == 2  # voided + corrected, nothing deleted


def test_logs_require_running_task(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    second = next(t for t in tasks if t["id"] != int(seeded["task_id"]))
    status, body = _add_log(mc, int(second["id"]), 2)
    assert status == 422
    assert body["detail"]["code"] == "invalid_task_state_for_log"


def test_concurrent_appends_do_not_lose_logs(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])

    def _fire(hours: int) -> tuple[int, Any]:
        return _request(
            "POST",
            f"/api/planning/learning-tasks/{task_id}/progress-logs",
            {"record_date": "2026-05-10", "actual_hours": hours},
            cookies=mc,
        )[:2]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(_fire, (2, 3)))
    assert [r[0] for r in results] == [200, 200]
    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    assert len(logs) == 2
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    assert next(t for t in tasks if t["id"] == task_id)["actual_hours"] == 5
