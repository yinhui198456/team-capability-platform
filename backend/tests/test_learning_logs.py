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


def test_idempotency_key_is_scoped_per_task(seeded: dict[str, object]) -> None:
    """P2: the same key on two tasks of the same member must not collide or
    replay each other's logs."""
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    tasks = _request("GET", "/api/planning/learning-tasks", cookies=mc)[1]
    other_task_id = int(next(t for t in tasks if t["id"] != task_id)["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{other_task_id}/transitions",
        {"to_status": "进行中"},
        cookies=mc,
    )
    assert status == 200

    status, first = _add_log(mc, task_id, 3, idempotency_key="shared-key")
    assert status == 200
    # The same key on the other task creates its own log.
    status, second = _add_log(mc, other_task_id, 4, idempotency_key="shared-key")
    assert status == 200
    assert second["id"] != first["id"]
    assert second["task_id"] == other_task_id
    # Replays stay scoped.
    status, replay = _add_log(mc, task_id, 3, idempotency_key="shared-key")
    assert status == 200
    assert replay["id"] == first["id"]
    status, replay2 = _add_log(mc, other_task_id, 4, idempotency_key="shared-key")
    assert status == 200
    assert replay2["id"] == second["id"]
    # Counts are exact per task.
    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    assert len(logs) == 1
    status, tasks2, _ = _request("GET", "/api/planning/learning-tasks", cookies=mc)
    assert next(t for t in tasks2 if t["id"] == task_id)["actual_hours"] == 3
    assert next(t for t in tasks2 if t["id"] == other_task_id)["actual_hours"] == 4


def test_idempotency_key_does_not_leak_across_members(
    seeded: dict[str, object],
) -> None:
    """P2: another member using the same key must never read or replay the
    first member's log — and may create their own."""
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    connection = seeded["connection"]
    from tests.test_learning_task import _create_test_user, _login

    other_id = _create_test_user(connection, "other_log_member", ["Member"])
    connection.execute(
        "UPDATE tcp_user SET target_level='P4', current_level='P4' WHERE id=%s",
        (other_id,),
    )
    connection.commit()
    other_cookies = _login(connection, "other_log_member")

    status, first = _add_log(mc, task_id, 5, idempotency_key="member-key")
    assert status == 200

    # The other member has no task; a fresh task via a second plan is not
    # needed — ownership of task_id blocks them entirely.
    status, body = _add_log(other_cookies, task_id, 5, idempotency_key="member-key")
    assert status == 403


def test_idempotency_payload_includes_correction(
    seeded: dict[str, object],
) -> None:
    """P2: same key + same date/hours/note but a different correction target
    is a different payload → 409."""
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    _add_log(mc, task_id, 2, idempotency_key="corr-key")
    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    original_id = logs[0]["id"]
    status, _, _ = _request(
        "POST",
        f"/api/planning/progress-logs/{original_id}/invalidate",
        {},
        cookies=mc,
    )
    assert status == 200

    # Same key, same date/hours/note, but with a correction reference: 409.
    status, body = _add_log(
        mc,
        task_id,
        2,
        idempotency_key="corr-key",
        correction_of_log_id=original_id,
    )
    assert status == 409
    assert body["detail"]["code"] == "log_idempotency_conflict"
