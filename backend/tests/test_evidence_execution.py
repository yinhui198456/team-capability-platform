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


def _bounded_worker(target: Any, timeout: float, label: str) -> Any:
    """Run target in a DAEMON thread with a hard deadline.  Worker exceptions
    propagate verbatim to the caller; if the worker is still alive after the
    deadline the test fails immediately — and because the thread is daemon,
    a DB-locked worker can never block process exit."""
    import threading

    errors: list[BaseException] = []
    result: dict[str, Any] = {}

    def _runner() -> None:
        try:
            result["value"] = target()
        except BaseException as exc:  # noqa: BLE001 — propagate verbatim
            errors.append(exc)

    worker = threading.Thread(target=_runner, daemon=True, name=label)
    worker.start()
    worker.join(timeout)
    if worker.is_alive():
        raise AssertionError(f"{label} did not finish within {timeout}s")
    if errors:
        raise errors[0]
    return result.get("value")


def _run_switch_race(
    seeded: dict[str, object],
) -> tuple[tuple[int, Any], int, str, int, int | None]:
    """Shared race scaffolding with OBSERVABLE synchronisation bound to the
    EXACT target lock identity: the switch holds the production advisory
    lock, reads its own holder identity (classid/objid/objsubid) from
    pg_locks, and commits the relationship switch ONLY after pg_locks shows
    a waiter on that same identity with a different PID — no fixed sleep, no
    library-wide waiter count.  Returns
    (review outcome, evidence id, switch result, holder pid, waiter pid).
    The switch connection sets lock_timeout so a stuck worker ends itself
    (rollback + connection close) inside the deadline — the daemon thread is
    only the last resort, never the cleanup path."""
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
    switch_state: dict[str, Any] = {"result": None, "error": None}

    # The worker thread must use the authoritative test database URL (the
    # session fixture pointed settings.database_url at TEST_DATABASE_URL,
    # which honours POSTGRES_HOST/POSTGRES_PORT) — never a host-mapped port.
    from app.settings import settings

    def _switch_relationship() -> dict[str, Any]:
        with psycopg.connect(settings.database_url) as switch_conn:
            switch_conn.execute("SET lock_timeout = '20s'")
            switch_conn.execute("BEGIN")
            switch_conn.execute(
                "SELECT pg_advisory_xact_lock(hashtext(%s))",
                (f"tcp_buddy_relationship:{member_id}",),
            )
            switch_holder_ready.set()
            # Exact lock identity of THIS holder (single-key advisory form:
            # classid=4294967295, objid=hashtext key, objsubid=1).
            holder = switch_conn.execute(
                """
                SELECT pid, classid, objid, objsubid
                FROM pg_locks
                WHERE locktype = 'advisory' AND granted
                  AND pid = pg_backend_pid()
                LIMIT 1
                """
            ).fetchone()
            assert holder is not None
            holder_pid, classid, objid, objsubid = (int(v) for v in holder)
            # Wait for a waiter on the SAME identity with a DIFFERENT pid.
            deadline = time.monotonic() + 10.0
            waiter_pid: int | None = None
            while time.monotonic() < deadline:
                row = switch_conn.execute(
                    """
                    SELECT pid FROM pg_locks
                    WHERE locktype = 'advisory' AND NOT granted
                      AND classid = %s AND objid = %s AND objsubid = %s
                      AND pid <> pg_backend_pid()
                    LIMIT 1
                    """,
                    (classid, objid, objsubid),
                ).fetchone()
                if row is not None:
                    waiter_pid = int(row[0])
                    break
                time.sleep(0.02)
            if waiter_pid is None:
                switch_conn.execute("ROLLBACK")  # active cleanup, no commit
                return {
                    "result": "no-wait-evidence",
                    "holder_pid": holder_pid,
                    "waiter_pid": None,
                }
            assert waiter_pid != holder_pid
            switch_conn.execute(
                "UPDATE buddy_relationship "
                "SET expiry_date = CURRENT_DATE - 1, "
                "effective_to = CURRENT_DATE - 1 "
                "WHERE member_id = %s AND is_primary = TRUE "
                "AND effective_to IS NULL",
                (member_id,),
            )
            switch_conn.execute("COMMIT")
            return {
                "result": "waited",
                "holder_pid": holder_pid,
                "waiter_pid": waiter_pid,
            }

    def _switch_runner() -> None:
        try:
            switch_state["result"] = _switch_relationship()
        except BaseException as exc:  # noqa: BLE001
            switch_state["error"] = exc

    def _submit_review() -> tuple[int, Any]:
        return _request(
            "POST",
            f"/api/planning/evidences/{ev_id}/review",
            {"conclusion": "通过"},
            cookies=bc,
        )[:2]

    switcher = threading.Thread(
        target=_switch_runner, daemon=True, name="switch-worker"
    )
    switcher.start()
    deadline = time.monotonic() + 20.0
    while not switch_holder_ready.is_set():
        if switch_state["error"] is not None:
            raise switch_state["error"]
        if time.monotonic() > deadline:
            raise AssertionError("switch never held the relationship lock within 20s")
        time.sleep(0.02)
    review_outcome = _bounded_worker(_submit_review, 25, "review-worker")
    switcher.join(20)
    if switcher.is_alive():
        raise AssertionError("switch worker did not finish within 20s")
    if switch_state["error"] is not None:
        raise switch_state["error"]
    result = switch_state["result"]
    return (
        review_outcome,
        ev_id,
        str(result["result"]),
        int(result["holder_pid"]),
        int(result["waiter_pid"]) if result["waiter_pid"] is not None else None,
    )


def test_evidence_review_waits_for_buddy_relationship_switch(
    seeded: dict[str, object],
) -> None:
    """P3b: a review must wait on the shared buddy-relationship advisory lock
    and re-read the canonical relationship afterwards — an ex-buddy cannot
    submit once the relationship switched, without deadlock."""
    connection = seeded["connection"]
    task_id = int(seeded["task_id"])

    review_outcome, ev_id, switch_result, holder_pid, waiter_pid = _run_switch_race(
        seeded
    )
    assert switch_result == "waited"  # the review observably blocked on the lock
    assert holder_pid > 0
    assert waiter_pid is not None and waiter_pid != holder_pid
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
    """Mutation sensitivity under the SAME observable interleaving: with the
    shared advisory lock removed from the review path, the switch never
    observes a lock waiter (no-wait-evidence) and never commits the switch —
    the review completes while the relationship is still valid (200).  The
    guarded test's 403 assertion is therefore red under this mutation, and
    the red is deterministic (driven by the pg_locks observability, not by
    scheduling speed)."""
    from app.planning import repository as planning_repository

    monkeypatch.setattr(
        planning_repository,
        "_acquire_buddy_relationship_lock",
        lambda connection, member_id: None,
    )
    review_outcome, _, switch_result, holder_pid, waiter_pid = _run_switch_race(seeded)
    assert switch_result == "no-wait-evidence"
    assert waiter_pid is None  # no waiter on the target lock identity
    assert holder_pid > 0
    assert review_outcome[0] == 200  # review never blocked → succeeds


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


def _run_put_snapshot_contract(
    seeded: dict[str, object],
    monkeypatch: pytest.MonkeyPatch,
    use_old_impl: bool,
) -> dict[str, object]:
    """The ONE shared contract harness for the PUT-response snapshot, at the
    repository layer with dedicated connections: each writer connection has
    NO implicit transaction, so ``with connection.transaction()`` commits on
    exit — the "A committed but A not yet responded" window is real.  B
    completes its expected_revision=1 write inside that window (commit
    barrier seam on the response construction).  With use_old_impl the OLD
    post-commit re-read implementation is injected; the caller asserts the
    SAME A contract, which must be red there."""
    import threading
    import time

    mc = seeded["member_cookies"]
    connection = seeded["connection"]
    task_id = int(seeded["task_id"])
    status, ev = _create_evidence(mc, task_id)
    ev_id = int(ev["id"])
    member_id = int(
        connection.execute(
            "SELECT id FROM tcp_user WHERE username = 'member_task'"
        ).fetchone()[0]
    )

    from app.planning import repository as planning_repository
    from app.settings import settings as app_settings

    if use_old_impl:

        def _old_update(
            conn: psycopg.Connection,
            member_id: int,
            evidence_id: int,
            fields: dict[str, object],
            expected_revision: int,
        ) -> dict[str, object]:
            # Old semantics: unconditional UPDATE (no row lock, no CAS),
            # then a post-commit re-read that can observe another writer.
            set_clause = ", ".join(f"{k} = %s" for k in fields)
            values = [fields[k] for k in fields] + [evidence_id]
            conn.execute(
                f"UPDATE evidence SET {set_clause}, revision = revision + 1 "
                f"WHERE id = %s",
                values,
            )
            conn.commit()  # the old implementation commits before re-reading
            # Defect window: wait until B committed revision 2, then
            # re-read — the response must be B's snapshot.
            deadline = time.monotonic() + 15.0
            while time.monotonic() < deadline:
                row = conn.execute(
                    "SELECT revision FROM evidence WHERE id = %s",
                    (evidence_id,),
                ).fetchone()
                if row is not None and int(row[0]) >= 2:
                    break
                time.sleep(0.02)
            else:
                raise AssertionError(
                    "B never committed revision 2 within 15s — old re-read "
                    "refuses to continue"
                )
            row = conn.execute(
                f"SELECT {planning_repository._EVIDENCE_COLUMNS} "
                f"FROM evidence WHERE id = %s",
                (evidence_id,),
            ).fetchone()
            assert row is not None
            return planning_repository._evidence_row(row)

        monkeypatch.setattr(planning_repository, "update_evidence_draft", _old_update)

    # Commit-barrier seam: A's response construction waits until B's
    # revision-2 write is committed.  B's own attach runs after its commit
    # (revision 2 visible) and passes immediately — no deadlock.
    original_attach = planning_repository._attach_l3_contexts

    def _attach_after_b_commit(conn: psycopg.Connection, rows: list[Any]) -> list[Any]:
        deadline = time.monotonic() + 15.0
        while time.monotonic() < deadline:
            row = conn.execute(
                "SELECT revision FROM evidence WHERE id = %s", (ev_id,)
            ).fetchone()
            if row is not None and int(row[0]) >= 2:
                break
            time.sleep(0.02)
        else:
            raise AssertionError(
                "B never committed revision 2 within 15s — contract window "
                "not reached; refusing to continue"
            )
        return original_attach(conn, rows)

    monkeypatch.setattr(
        planning_repository, "_attach_l3_contexts", _attach_after_b_commit
    )

    def _a_writes() -> dict[str, object]:
        with psycopg.connect(app_settings.database_url) as conn_a:
            return planning_repository.update_evidence_draft(
                conn_a,
                member_id,
                ev_id,
                {"description": "A-首次写入"},
                0,
            )

    def _b_writes_after_a_commits() -> None:
        # B starts when A's commit is visible (revision 1) — explicitly
        # asserting the observed state; a timeout must not continue.
        deadline = time.monotonic() + 15.0
        with psycopg.connect(app_settings.database_url) as observer:
            while time.monotonic() < deadline:
                row = observer.execute(
                    "SELECT revision FROM evidence WHERE id = %s", (ev_id,)
                ).fetchone()
                if row is not None and int(row[0]) >= 1:
                    break
                time.sleep(0.02)
            else:
                raise AssertionError(
                    "A never committed revision 1 within 15s — refusing to write B"
                )
        with psycopg.connect(app_settings.database_url) as conn_b:
            planning_repository.update_evidence_draft(
                conn_b,
                member_id,
                ev_id,
                {"description": "B-后续写入"},
                1,
            )

    b_errors: list[BaseException] = []

    def _b_runner() -> None:
        try:
            _b_writes_after_a_commits()
        except BaseException as exc:  # noqa: BLE001
            b_errors.append(exc)

    b_thread = threading.Thread(target=_b_runner, daemon=True, name="b-writer")
    b_thread.start()
    a_response = _bounded_worker(_a_writes, 25, "a-writer")
    b_thread.join(25)
    if b_thread.is_alive():
        raise AssertionError("B writer did not finish within 25s")
    if b_errors:
        raise b_errors[0]
    return a_response


def _assert_put_snapshot_contract(
    seeded: dict[str, object], a: dict[str, object]
) -> None:
    """The ONE contract: A's response is A's own committed snapshot and the
    final GET is exactly B's committed write."""
    mc = seeded["member_cookies"]
    assert a["revision"] == 1
    assert a["description"] == "A-首次写入"
    status, evidence, _ = _request(
        "GET", f"/api/planning/evidences/{int(a['id'])}", cookies=mc
    )
    assert status == 200
    assert evidence["revision"] == 2  # B committed inside the window
    assert evidence["description"] == "B-后续写入"


def test_evidence_put_response_is_own_returning_snapshot(
    seeded: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    """P2 contract: with the production UPDATE ... RETURNING implementation,
    A's response is A's own snapshot even though B commits inside the
    "A committed, A not yet responded" window (commit-barrier seam); the
    final GET is exactly B's write."""
    a_response = _run_put_snapshot_contract(seeded, monkeypatch, use_old_impl=False)
    _assert_put_snapshot_contract(seeded, a_response)


def test_put_response_old_impl_breaks_same_contract_mutation_red(
    seeded: dict[str, object], monkeypatch: pytest.MonkeyPatch
) -> None:
    """P2-2 mutation red: the SAME contract, run with the OLD post-commit
    re-read implementation injected, must fail — A's response carries B's
    committed snapshot (revision 2 / B description) instead of A's own."""
    a_response = _run_put_snapshot_contract(seeded, monkeypatch, use_old_impl=True)
    with pytest.raises(AssertionError):
        _assert_put_snapshot_contract(seeded, a_response)
    # And the old defect is exactly what the response shows.
    assert a_response["revision"] == 2
    assert a_response["description"] == "B-后续写入"
