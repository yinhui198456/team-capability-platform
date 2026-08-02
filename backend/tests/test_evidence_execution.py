# ruff: noqa: F811  (pytest fixture arg shadows import)
# ruff: noqa: F811  (pytest fixture arg shadows import)
"""Issue #63: evidence version chains, immutable review history, buddy
permission re-read and Assessment Review isolation."""

from typing import Any

import psycopg
import pytest

from app.access.repository import create_user
from tests.test_learning_task import (
    _login,
    _request,
    _seed_plan_items,
    learning_task_schema,  # noqa: F401  (pytest fixture)
)


@pytest.fixture
def seeded(learning_task_schema: psycopg.Connection) -> dict[str, object]:
    member_cookies, plan = _seed_plan_items(learning_task_schema)
    buddy_cookies = _login(learning_task_schema, "buddy_task")
    tasks = _request("GET", "/api/planning/learning-tasks", cookies=member_cookies)[1]
    task_id = int(tasks[0]["id"])
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
        "buddy_cookies": buddy_cookies,
        "task_id": task_id,
    }


def _create_evidence(
    mc: dict[str, str], task_id: int, **extra: Any
) -> tuple[int, Any]:
    body: dict[str, object] = {
        "content": "成果",
        "evidence_link": "http://example.com/out",
    }
    body.update(extra)
    status, payload, _ = _request(
        "POST",
        f"/api/planning/learning-tasks/{task_id}/evidences",
        body,
        cookies=mc,
    )
    return status, payload


def test_multi_evidence_and_supersede_chain(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, first = _create_evidence(mc, task_id, description="第一版")
    assert status == 200
    first_id = int(first["id"])
    status, _, _ = _request(
        "POST", f"/api/planning/evidences/{first_id}/submit", {}, cookies=mc
    )
    assert status == 200
    # Buddy asks for more.
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{first_id}/review",
        {"conclusion": "需补充", "feedback": "请补充验证截图"},
        cookies=seeded["buddy_cookies"],
    )
    assert status == 200
    # Member resubmits a new version superseding the old one.
    status, second = _create_evidence(
        mc, task_id, description="第二版", supersedes_evidence_id=first_id
    )
    assert status == 200
    assert second["version_number"] == 2
    assert second["supersedes_evidence_id"] == first_id
    # Old version + its review remain readable.
    status, evidences, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/evidences", cookies=mc
    )
    assert len(evidences) == 2
    status, reviews, _ = _request(
        "GET", f"/api/planning/learning-tasks/{task_id}/evidence-reviews", cookies=mc
    )
    assert len(reviews) == 1
    assert reviews[0]["conclusion"] == "需补充"
    assert reviews[0]["feedback"] == "请补充验证截图"


def test_approved_evidence_is_terminal(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过"},
        cookies=seeded["buddy_cookies"],
    )
    assert status == 200
    # Superseding an approved version is rejected.
    status, body = _create_evidence(
        mc, task_id, supersedes_evidence_id=ev_id
    )
    assert status == 422
    assert body["detail"]["field"] == "supersedes_evidence_id"


def test_submit_does_not_change_task_status(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    status, _, _ = _request(
        "POST", f"/api/planning/evidences/{int(ev['id'])}/submit", {}, cookies=mc
    )
    assert status == 200
    tasks = _request("GET", "/api/planning/learning-tasks", cookies=mc)[1]
    assert next(t for t in tasks if t["id"] == task_id)["status"] == "进行中"
    # Task status list no longer contains the removed 待 Evidence Review state.
    assert all(
        t["status"]
        in ("未开始", "进行中", "已完成", "延期", "暂停", "取消")
        for t in tasks
    )


def test_review_is_immutable_and_single(seeded: dict[str, object]) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)
    status, first, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过", "feedback": "达标", "idempotency_key": "rv-1"},
        cookies=bc,
    )
    assert status == 200
    # Same key replays.
    status, replay, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过", "feedback": "达标", "idempotency_key": "rv-1"},
        cookies=bc,
    )
    assert status == 200
    assert replay["id"] == first["id"]
    # A second review of the same evidence version conflicts.
    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "需补充", "feedback": "x"},
        cookies=bc,
    )
    assert status == 409
    assert body["detail"]["code"] == "review_already_submitted"


def test_need_more_requires_feedback(seeded: dict[str, object]) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)
    status, body, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "需补充", "feedback": "  "},
        cookies=bc,
    )
    assert status == 422
    assert body["detail"]["field"] == "feedback"
    assert body["detail"]["code"] == "invalid_review"


def test_non_assigned_buddy_cannot_review(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    connection = seeded["connection"]
    outsider_id = create_user(connection, "other_buddy", "Other Buddy", "secret")
    connection.execute(
        "INSERT INTO tcp_user_role (user_id, role_id) "
        "SELECT %s, id FROM tcp_role WHERE code='Buddy'",
        (outsider_id,),
    )
    connection.commit()
    outsider_cookies = _login(connection, "other_buddy")
    task_id = int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过"},
        cookies=outsider_cookies,
    )
    assert status == 403


def test_assessment_review_is_isolated_from_evidence_review(
    seeded: dict[str, object],
) -> None:
    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    task_id = int(seeded["task_id"])
    # The approval chain left a closed assessment_review row.
    connection = seeded["connection"]
    assessment_reviews = connection.execute(
        "SELECT conclusion, status FROM assessment_review"
    ).fetchall()
    assert assessment_reviews and assessment_reviews[0][1] == "已闭环"
    assert assessment_reviews[0][0] == "认可"

    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过"},
        cookies=bc,
    )
    assert status == 200
    # Assessment review rows untouched by evidence review and vice versa.
    after = connection.execute(
        "SELECT conclusion, status FROM assessment_review"
    ).fetchall()
    assert after == assessment_reviews
    evidence_reviews = connection.execute(
        "SELECT conclusion, status FROM evidence_review"
    ).fetchall()
    assert [(r[0], r[1]) for r in evidence_reviews] == [("通过", "已闭环")]


def test_evidence_submission_requires_running_task(seeded: dict[str, object]) -> None:
    mc = seeded["member_cookies"]
    tasks = _request("GET", "/api/planning/learning-tasks", cookies=mc)[1]
    second = next(t for t in tasks if t["id"] != int(seeded["task_id"]))
    status, ev = _create_evidence(mc, int(second["id"]))
    ev_id = int(ev["id"])
    status, body, _ = _request(
        "POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc
    )
    assert status == 422
    assert body["detail"]["code"] == "invalid_task_state_for_evidence"
