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


def _create_evidence(mc: dict[str, str], task_id: int, **extra: Any) -> tuple[int, Any]:
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
    status, body = _create_evidence(mc, task_id, supersedes_evidence_id=ev_id)
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
        t["status"] in ("未开始", "进行中", "已完成", "延期", "暂停", "取消")
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


def test_evidence_put_cas_concurrent_updates_only_one_wins(
    seeded: dict[str, object],
) -> None:
    """P3a: two concurrent PUTs with the same expected_revision — exactly one
    succeeds, the other gets a structured 409 evidence_revision_conflict, and
    the final state is exact (no partial overwrite)."""
    from concurrent.futures import ThreadPoolExecutor

    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])

    def _fire(description: str) -> tuple[int, Any]:
        return _request(
            "PUT",
            f"/api/planning/evidences/{ev_id}",
            {"description": description, "expected_revision": 0},
            cookies=mc,
        )[:2]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(_fire, ("并发A", "并发B")))
    statuses = sorted(r[0] for r in results)
    assert statuses == [200, 409]
    conflict = next(r for r in results if r[0] == 409)
    assert conflict[1]["detail"]["code"] == "evidence_revision_conflict"
    assert conflict[1]["detail"]["field"] == "revision"

    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{ev_id}", cookies=mc
    )
    assert status == 200
    assert evidence["revision"] == 1
    assert evidence["description"] in ("并发A", "并发B")


def test_evidence_put_cas_rejects_stale_revision(seeded: dict[str, object]) -> None:
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    status, body, _ = _request(
        "PUT",
        f"/api/planning/evidences/{ev_id}",
        {"description": "第一版", "expected_revision": 0},
        cookies=mc,
    )
    assert status == 200
    status, body, _ = _request(
        "PUT",
        f"/api/planning/evidences/{ev_id}",
        {"description": "过期写入", "expected_revision": 0},
        cookies=mc,
    )
    assert status == 409
    assert body["detail"]["code"] == "evidence_revision_conflict"
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{ev_id}", cookies=mc
    )
    assert evidence["description"] == "第一版"


def _run_switch_race(
    seeded: dict[str, object],
    monkeypatch: pytest.MonkeyPatch | None,
) -> tuple[tuple[int, Any], int]:
    """Shared race scaffolding: the switch holds the production advisory
    lock; the review is submitted concurrently and must wait on it.  Returns
    (status, body) of the ex-buddy review.  All waits are bounded; worker
    exceptions propagate as their original cause."""
    import threading
    import time

    mc, bc = seeded["member_cookies"], seeded["buddy_cookies"]
    connection = seeded["connection"]
    task_id = int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    _request("POST", f"/api/planning/evidences/{ev_id}/submit", {}, cookies=mc)

    member_id = connection.execute(
        "SELECT member_id FROM annual_growth_plan WHERE member_id IN "
        "(SELECT agp.member_id FROM learning_task lt "
        "JOIN plan_item pi ON pi.id=lt.plan_item_id "
        "JOIN annual_growth_plan agp ON agp.id=pi.annual_growth_plan_id "
        "WHERE lt.id=%s)",
        (task_id,),
    ).fetchone()[0]

    switch_holder_ready = threading.Event()
    review_started = threading.Event()
    overall_deadline = time.monotonic() + 30.0

    # The worker thread must use the authoritative test database URL (the
    # session fixture pointed settings.database_url at TEST_DATABASE_URL,
    # which honours POSTGRES_HOST/POSTGRES_PORT) — never a host-mapped port.
    from app.settings import settings

    def _switch_relationship() -> None:
        with psycopg.connect(settings.database_url) as switch_conn:
            switch_conn.execute("BEGIN")
            switch_conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (f"tcp_buddy_relationship:{member_id}",),
            )
            switch_holder_ready.set()
            if not review_started.wait(timeout=10):
                raise AssertionError("review never started within 10s")
            time.sleep(0.3)  # give the review a chance to block on the lock
            switch_conn.execute(
                "UPDATE buddy_relationship SET expiry_date = CURRENT_DATE - 1, "
                "effective_to = CURRENT_DATE - 1 "
                "WHERE member_id = %s AND is_primary = TRUE AND effective_to IS NULL",
                (member_id,),
            )
            switch_conn.execute("COMMIT")

    def _submit_review() -> tuple[int, Any]:
        review_started.set()
        return _request(
            "POST",
            f"/api/planning/evidences/{ev_id}/review",
            {"conclusion": "通过"},
            cookies=bc,
        )[:2]

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as pool:
        switcher_future = pool.submit(_switch_relationship)
        # Bounded, failure-aware wait for the switch to hold the lock.
        while not switch_holder_ready.is_set():
            if switcher_future.done():
                switcher_future.result()  # raises the original exception
            if time.monotonic() > overall_deadline:
                raise AssertionError(
                    "switch never held the relationship lock within 30s"
                )
            time.sleep(0.05)
        reviewer_future = pool.submit(_submit_review)
        switcher_future.result(timeout=15)  # switch holds the lock, then commits
        review_outcome = reviewer_future.result(timeout=15)  # no deadlock
    return review_outcome, ev_id


def test_evidence_review_waits_for_buddy_relationship_switch(
    seeded: dict[str, object],
) -> None:
    """P3b: a review must wait on the shared buddy-relationship advisory lock
    and re-read the canonical relationship afterwards — an ex-buddy cannot
    submit once the relationship switched, without deadlock."""
    connection = seeded["connection"]
    task_id = int(seeded["task_id"])

    review_outcome, ev_id = _run_switch_race(seeded, None)
    assert review_outcome[0] == 403  # ex-buddy rejected after the switch

    # A legitimate current buddy can still review (no residual lock).
    member_id = connection.execute(
        "SELECT member_id FROM annual_growth_plan WHERE member_id IN "
        "(SELECT agp.member_id FROM learning_task lt "
        "JOIN plan_item pi ON pi.id=lt.plan_item_id "
        "JOIN annual_growth_plan agp ON agp.id=pi.annual_growth_plan_id "
        "WHERE lt.id=%s)",
        (task_id,),
    ).fetchone()[0]
    from tests.test_learning_task import _login

    new_buddy_id = create_user(connection, "new_current_buddy", "New Buddy", "secret")
    connection.execute(
        "INSERT INTO tcp_user_role (user_id, role_id) "
        "SELECT %s, id FROM tcp_role WHERE code='Buddy'",
        (new_buddy_id,),
    )
    from app.access.repository import create_buddy_relationship

    create_buddy_relationship(connection, int(member_id), new_buddy_id, is_primary=True)
    connection.commit()
    new_cookies = _login(connection, "new_current_buddy")
    # The ex-buddy review failed with 403, so the evidence is still pending.
    status, _, _ = _request(
        "POST",
        f"/api/planning/evidences/{ev_id}/review",
        {"conclusion": "通过"},
        cookies=new_cookies,
    )
    assert status == 200


def test_switch_race_red_without_review_lock(
    seeded: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Mutation sensitivity: remove the shared advisory lock from the review
    path and the same interleaving must NOT yield the 403 — the review
    completes while the relationship is still valid (200).  This proves the
    main test depends on the lock, not on timing."""
    from app.planning import repository as planning_repository

    monkeypatch.setattr(
        planning_repository,
        "_acquire_buddy_relationship_lock",
        lambda connection, member_id: None,
    )
    review_outcome, _ = _run_switch_race(seeded, monkeypatch)
    # Without the lock the review is not blocked: it succeeds (200) before
    # the switch commits — the guarded test's 403 assertion would be red.
    assert review_outcome[0] == 200


def test_evidence_put_requires_expected_revision_concurrent(
    seeded: dict[str, object],
) -> None:
    """P1 red: two concurrent PUTs WITHOUT expected_revision must both be
    rejected (structured 422, zero writes) — the current baseline lets both
    succeed with last-write-wins (revision=2)."""
    from concurrent.futures import ThreadPoolExecutor

    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])

    def _fire(description: str) -> tuple[int, Any]:
        return _request(
            "PUT",
            f"/api/planning/evidences/{ev_id}",
            {"description": description},
            cookies=mc,
        )[:2]

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(_fire, ("无CAS-A", "无CAS-B")))
    assert [r[0] for r in results] == [422, 422]
    for _, body in results:
        assert body["detail"]["code"] == "invalid_evidence"
        assert body["detail"]["field"] == "expected_revision"
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{ev_id}", cookies=mc
    )
    assert evidence["revision"] == 0  # zero writes
    assert evidence["description"] is None


def test_evidence_put_rejects_bad_expected_revision_types(
    seeded: dict[str, object],
) -> None:
    """P1: missing/bool/non-integer/negative expected_revision → 422,
    field=expected_revision, zero writes."""
    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])

    for bad in (None, True, "0", -1, 1.5):
        body: dict[str, object] = {"description": "bad-rev"}
        if bad is not None:
            body["expected_revision"] = bad
        status, payload, _ = _request(
            "PUT", f"/api/planning/evidences/{ev_id}", body, cookies=mc
        )
        assert status == 422, f"expected 422 for {bad!r}, got {status}"
        assert payload["detail"]["field"] == "expected_revision"
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{ev_id}", cookies=mc
    )
    assert evidence["revision"] == 0


def test_evidence_put_response_is_own_returning_snapshot(
    seeded: dict[str, object],
) -> None:
    """P2 red: A's PUT response must be exactly A's own committed snapshot,
    even when B writes right after — the final GET may show B's update."""
    import threading

    mc, task_id = seeded["member_cookies"], int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])

    b_wrote = threading.Event()
    a_response: dict[str, Any] = {}

    def _writer_b() -> None:
        # B updates the same evidence with the next revision after A commits.
        b_wrote.wait(timeout=10)
        status, payload, _ = _request(
            "PUT",
            f"/api/planning/evidences/{ev_id}",
            {"description": "B-后续写入", "expected_revision": 1},
            cookies=mc,
        )
        assert status == 200, f"B write failed: {status} {payload}"

    from concurrent.futures import ThreadPoolExecutor

    with ThreadPoolExecutor(max_workers=2) as pool:
        b_future = pool.submit(_writer_b)
        status, payload, _ = _request(
            "PUT",
            f"/api/planning/evidences/{ev_id}",
            {"description": "A-首次写入", "expected_revision": 0},
            cookies=mc,
        )
        a_response["status"] = status
        a_response["payload"] = payload
        b_wrote.set()
        b_future.result(timeout=15)

    assert a_response["status"] == 200
    a = a_response["payload"]
    # A's response is A's own snapshot: revision 1, A's description.
    assert a["revision"] == 1
    assert a["description"] == "A-首次写入"
    # The final GET may already show B's update.
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{ev_id}", cookies=mc
    )
    assert evidence["revision"] in (1, 2)
    if evidence["revision"] == 2:
        assert evidence["description"] == "B-后续写入"
