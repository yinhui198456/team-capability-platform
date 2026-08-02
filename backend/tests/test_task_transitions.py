# ruff: noqa: F811  (pytest fixture arg shadows import)
# ruff: noqa: F811  (pytest fixture arg shadows import)
"""Issue #63: service-enforced Learning Task state machine and completion gate.

Every transition runs through the API so permission, structured 422/409 and
zero-partial-write behaviour are all covered.  Tasks come from the real #62
approval chain (assessment → plan → item → task).
"""

import asyncio
from typing import Any

import psycopg
import pytest

from tests.test_learning_task import (
    _request,
    _seed_plan_items,
    learning_task_schema,  # noqa: F401  (pytest fixture)
)


def _task(
    cookies: dict[str, str], tasks: list[dict[str, object]], index: int = 0
) -> int:
    return int(tasks[index]["id"])


def _get_tasks(cookies: dict[str, str]) -> list[dict[str, object]]:
    status, tasks, _ = _request("GET", "/api/planning/learning-tasks", cookies=cookies)
    assert status == 200
    return tasks


def _transition(
    cookies: dict[str, str],
    task_id: int,
    to_status: str,
    reason: str | None = None,
    expected_revision: int | None = None,
    idempotency_key: str | None = None,
) -> tuple[int, Any]:
    body: dict[str, object] = {"to_status": to_status}
    if reason is not None:
        body["reason"] = reason
    if expected_revision is not None:
        body["expected_revision"] = expected_revision
    if idempotency_key is not None:
        body["idempotency_key"] = idempotency_key
    status, payload, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/transitions",
        body,
        cookies=cookies,
    )
    return status, payload


def _add_log(
    cookies: dict[str, str],
    task_id: int,
    hours: int,
    record_date: str = "2026-05-10",
    idempotency_key: str | None = None,
) -> tuple[int, Any]:
    body: dict[str, object] = {"record_date": record_date, "actual_hours": hours}
    if idempotency_key is not None:
        body["idempotency_key"] = idempotency_key
    status, payload, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/progress-logs",
        body,
        cookies=cookies,
    )
    return status, payload


def _create_and_submit_evidence(
    cookies: dict[str, str], task_id: int
) -> int:
    status, evidence, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        {"content": "成果说明", "evidence_link": "http://example.com/output"},
        cookies=cookies,
    )
    assert status == 200
    evidence_id = int(evidence["id"])
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/submit",
        {},
        cookies=cookies,
    )
    assert status == 200
    return evidence_id


def _approve_evidence(
    buddy_cookies: dict[str, str], evidence_id: int
) -> None:
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{evidence_id}/review",
        {"conclusion": "通过", "feedback": "达标"},
        cookies=buddy_cookies,
    )
    assert status == 200


def _make_completable(
    connection: psycopg.Connection,
    member_cookies: dict[str, str],
    buddy_cookies: dict[str, str],
    task_id: int,
) -> None:
    """Drives a task to the point where every completion gate passes."""
    status, _ = _transition(member_cookies, task_id, "进行中")
    if status != 200:
        # Already running (e.g. resumed from 延期).
        current = _get_tasks(member_cookies)
        assert next(t for t in current if t["id"] == task_id)["status"] == "进行中"
    _add_log(member_cookies, task_id, 5)
    evidence_id = _create_and_submit_evidence(member_cookies, task_id)
    _approve_evidence(buddy_cookies, evidence_id)
    status, _, _ = _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {
            "completion_quality": "达到预期",
            "review_conclusion": "整体达标，符合预期",
            "next_action": "下一步深入 P5 场景",
        },
        cookies=member_cookies,
    )
    assert status == 200


@pytest.fixture
def seeded(learning_task_schema: psycopg.Connection) -> dict[str, object]:
    member_cookies, plan = _seed_plan_items(learning_task_schema)
    from tests.test_learning_task import _login

    buddy_cookies = _login(learning_task_schema, "buddy_task")
    task_id = _task(member_cookies, _get_tasks(member_cookies))
    return {
        "connection": learning_task_schema,
        "member_cookies": member_cookies,
        "buddy_cookies": buddy_cookies,
        "plan": plan,
        "task_id": task_id,
    }


def test_full_legal_path_records_times(seeded: dict[str, object]) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])

    status, task = _transition(mc, task_id, "进行中")
    assert status == 200
    first_started_at = task["actual_started_at"]
    assert first_started_at is not None
    assert task["status"] == "进行中"

    status, _ = _transition(mc, task_id, "暂停", reason="请假一周")
    assert status == 200
    status, task = _transition(mc, task_id, "进行中")  # resume
    assert status == 200
    assert task["actual_started_at"] == first_started_at  # never overwritten

    status, task = _transition(mc, task_id, "延期", reason="任务复杂度超出预期")
    assert status == 200
    assert task["delay_reason"] == "任务复杂度超出预期"
    assert task["status"] == "延期"

    status, _ = _transition(mc, task_id, "进行中")
    assert status == 200
    _make_completable(seeded["connection"], mc, bc, task_id)
    status, task = _transition(mc, task_id, "已完成")
    assert status == 200
    assert task["actual_completed_at"] is not None
    assert task["status"] == "已完成"

    # Terminal state: no further transitions.
    status, body = _transition(mc, task_id, "取消", reason="不再需要")
    assert status == 422
    assert body["detail"]["code"] == "invalid_task_transition"


def test_illegal_transition_is_zero_write(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["code"] == "invalid_task_transition"
    assert body["detail"]["field"] == "status"
    tasks = _get_tasks(mc)
    assert next(t for t in tasks if t["id"] == task_id)["status"] == "未开始"


def test_reason_required_for_delay_pause_cancel(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    status, _ = _transition(mc, task_id, "进行中")
    assert status == 200
    for to_status, reason_field in (
        ("暂停", "pause_reason"), ("取消", "cancel_reason")
    ):
        status, body = _transition(mc, task_id, to_status)
        assert status == 422
        assert body["detail"]["code"] == "invalid_status_reason"
        assert body["detail"]["field"] == reason_field
        assert next(
            t for t in _get_tasks(mc) if t["id"] == task_id
        )["status"] == "进行中"
    status, body = _transition(mc, task_id, "延期")
    assert status == 422
    assert body["detail"]["field"] == "delay_reason"


def test_cancel_preserves_execution_history(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    _transition(mc, task_id, "进行中")
    _add_log(mc, task_id, 3)
    evidence_id = _create_and_submit_evidence(mc, task_id)
    status, _ = _transition(mc, task_id, "取消", reason="目标调整，放弃此项")
    assert status == 200
    assert next(t for t in _get_tasks(mc) if t["id"] == task_id)["status"] == "取消"

    status, logs, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )
    assert status == 200
    assert len(logs) == 1
    status, evidences, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/evidences", cookies=mc
    )
    assert status == 200
    assert any(e["id"] == evidence_id for e in evidences)


def test_completion_gate_fields_are_located(seeded: dict[str, object]) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])
    _transition(mc, task_id, "进行中")

    # No evidence.
    _add_log(mc, task_id, 5)
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["code"] == "completion_gate_failed"
    assert body["detail"]["field"] == "evidence"
    assert next(t for t in _get_tasks(mc) if t["id"] == task_id)["status"] == "进行中"

    # Evidence approved but no retrospective.
    evidence_id = _create_and_submit_evidence(mc, task_id)
    _approve_evidence(bc, evidence_id)
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["field"] == "review_conclusion"

    # No quality.
    _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {"review_conclusion": "复盘", "next_action": "继续"},
        cookies=mc,
    )
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["field"] == "completion_quality"

    # Invalid quality value.
    _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {"completion_quality": "随便写"},
        cookies=mc,
    )
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["field"] == "completion_quality"

    # No next_action (explicitly cleared).
    _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {"completion_quality": "达到预期", "next_action": ""},
        cookies=mc,
    )
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["field"] == "next_action"


def test_completion_gate_requires_positive_aggregated_hours(
    seeded: dict[str, object],
) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])
    _transition(mc, task_id, "进行中")
    evidence_id = _create_and_submit_evidence(mc, task_id)
    _approve_evidence(bc, evidence_id)
    _request(
        "PUT",
        f"/api/planning/learning-tasks/{task_id}",
        {
            "completion_quality": "达到预期",
            "review_conclusion": "复盘",
            "next_action": "继续",
        },
        cookies=mc,
    )
    # Log added then voided — aggregated hours drop back to zero.
    _add_log(mc, task_id, 4)
    log_id = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/progress-logs", cookies=mc
    )[1][0]["id"]
    _request(
        "POST", f"/api/planning/progress-logs/{log_id}/invalidate", {}, cookies=mc
    )
    status, body = _transition(mc, task_id, "已完成")
    assert status == 422
    assert body["detail"]["field"] == "actual_hours"


def test_revision_conflict_returns_409(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    status, body = _transition(
        mc, task_id, "进行中", expected_revision=99
    )
    assert status == 409
    assert body["detail"]["code"] == "task_revision_conflict"
    assert next(t for t in _get_tasks(mc) if t["id"] == task_id)["status"] == "未开始"


def test_transition_idempotency_replay_and_conflict(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    status, first = _transition(mc, task_id, "进行中", idempotency_key="tx-1")
    assert status == 200
    status, replay = _transition(mc, task_id, "进行中", idempotency_key="tx-1")
    assert status == 200
    assert replay["status"] == first["status"] == "进行中"
    status, body = _transition(
        mc, task_id, "取消", reason="不同payload", idempotency_key="tx-1"
    )
    assert status == 409
    assert body["detail"]["code"] == "transition_idempotency_conflict"


def test_transition_history_is_append_only(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    _transition(mc, task_id, "进行中")
    _transition(mc, task_id, "暂停", reason="原因一")
    _transition(mc, task_id, "进行中")
    _transition(mc, task_id, "延期", reason="原因二")
    status, history, _ = _request(
        "GET",
        f"/api/planning/learning-tasks/{task_id}/transition-history",
        cookies=mc,
    )
    assert status == 200
    transitions = [(h["from_status"], h["to_status"]) for h in history]
    assert transitions == [
        ("未开始", "进行中"),
        ("进行中", "暂停"),
        ("暂停", "进行中"),
        ("进行中", "延期"),
    ]
    assert history[1]["reason"] == "原因一"


def test_source_fields_and_machine_fields_are_locked(
    seeded: dict[str, object],
) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])
    # Task status / actual dates / actual_hours are machine-owned.
    for field, value in (
        ("status", "进行中"),
        ("actual_start_date", "2026-05-01"),
        ("actual_end_date", "2026-05-31"),
        ("actual_hours", 99),
    ):
        status, body, _ = _request(
            "PUT",
            f"/api/planning/learning-tasks/{task_id}",
            {field: value},
            cookies=mc,
        )
        assert status == 422, f"{field} should be locked"
        assert body["detail"]["code"] == "source_field_locked"
        assert body["detail"]["field"] == field
    # Plan item source snapshot columns are frozen.
    item_id = int(seeded["plan"]["items"][0]["id"])
    for field in ("target_month", "status", "plan_quarter", "l3_code"):
        status, body, _ = _request(
            "PUT",
            f"/api/planning/plan-items/{item_id}",
            {field: "5" if field == "target_month" else "取消"},
            cookies=mc,
        )
        assert status == 422
        assert body["detail"]["code"] == "source_field_locked"


def test_plan_date_rules_are_enforced(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    item_id = int(seeded["plan"]["items"][0]["id"])
    # Source plan month is May 2026 (Q2).  due must be inside May; start inside Q2.
    status, body, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {"plan_start_date": "2026-06-01", "plan_end_date": "2026-06-30"},
        cookies=mc,
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_date_range"
    assert body["detail"]["field"] == "plan_end_date"
    status, body, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {"plan_start_date": "2026-05-10", "plan_end_date": "2026-05-01"},
        cookies=mc,
    )
    assert status == 422
    assert body["detail"]["field"] == "plan_start_date"
    status, body, _ = _request(
        "PUT",
        f"/api/planning/plan-items/{item_id}",
        {"plan_start_date": "2026-05-10", "plan_end_date": "2026-05-31"},
        cookies=mc,
    )
    assert status == 200


def test_completion_does_not_update_member_mastery(
    seeded: dict[str, object],
) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    connection = seeded["connection"]
    task_id = int(seeded["task_id"])
    before = connection.execute(
        "SELECT current_level FROM tcp_user WHERE username='member_task'"
    ).fetchone()[0]
    _make_completable(connection, mc, bc, task_id)
    status, _ = _transition(mc, task_id, "已完成")
    assert status == 200
    after = connection.execute(
        "SELECT current_level FROM tcp_user WHERE username='member_task'"
    ).fetchone()[0]
    assert after == before


def test_concurrent_transitions_only_one_wins(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    task_id = int(seeded["task_id"])

    async def _fire() -> tuple[int, Any]:
        return await _request_async(
            "POST",
            f"/api/planning/learning-tasks/{task_id}/transitions",
            {"to_status": "进行中"},
            mc,
        )

    results = asyncio.run(_gather(_fire(), _fire()))
    ok = [r for r in results if r[0] == 200]
    assert len(ok) == 1  # second one either 409 revision or 409 idempotency-ish
    tasks = _get_tasks(mc)
    assert next(t for t in tasks if t["id"] == task_id)["status"] == "进行中"


async def _request_async(
    method: str, path: str, body: dict[str, object], cookies: dict[str, str]
) -> tuple[int, Any]:
    from tests.test_learning_task import _asgi_request

    return await _asgi_request(method, path, body, cookies)


async def _gather(*coros: Any) -> list[Any]:
    return await asyncio.gather(*coros)
