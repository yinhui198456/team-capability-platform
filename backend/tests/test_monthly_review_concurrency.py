"""Issue #64 phase 1 — monthly review first-create CAS concurrency.

P1-3: ``upsert_monthly_review`` locks only existing rows, so two concurrent
``expected_revision=0`` first creates can both observe the missing row; the
loser must get the structured ``monthly_review_revision_conflict`` 409, never
a UNIQUE-violation crash.  Both repository and API layers are covered:
- deterministic repository-level race: writer A holds its INSERT uncommitted
  while writer B runs the full upsert, then A commits;
- barrier API-level race: two PUTs race the first create;
- concurrent update regression guard: exactly one 200, one structured 409,
  history stays [1, 2] with zero orphan rows.
"""

import threading
import time
from typing import Any

import psycopg
import pytest

from app.planning.repository import PlanningDomainError, upsert_monthly_review
from tests.conftest import TEST_DATABASE_URL
from tests.test_capability_profile import (
    _build_full_profile,
    _request,
)
from tests.test_capability_profile import profile_schema as _initialize_profile_schema

SESSION_COOKIE = "tcp_session"


@pytest.fixture
def profile_schema(connection: psycopg.Connection) -> psycopg.Connection:
    return _initialize_profile_schema.__wrapped__(connection)


def _put_review(
    cookies: dict[str, str],
    body: dict[str, object],
) -> tuple[int, dict[str, Any] | None]:
    return _request(
        "PUT",
        "/api/planning/monthly-reviews?year=2026&month=5",
        body,
        cookies=cookies,
    )


def _rows(
    connection: psycopg.Connection, query: str, params: tuple[object, ...] = ()
) -> list[tuple[Any, ...]]:
    return connection.execute(query, params).fetchall()


def test_concurrent_first_create_repository_level_deterministic(
    profile_schema: psycopg.Connection,
) -> None:
    """Writer B runs its whole upsert while writer A's INSERT is uncommitted:
    B must finish with a structured conflict, not a UNIQUE violation."""
    member_id, _ = _build_full_profile(profile_schema)
    conn_a = psycopg.connect(TEST_DATABASE_URL)
    conn_b = psycopg.connect(TEST_DATABASE_URL)
    a_inserted = threading.Event()
    b_started = threading.Event()
    outcomes: dict[str, object] = {}

    def worker_a() -> None:
        try:
            result = upsert_monthly_review(
                conn_a,
                member_id,
                2026,
                5,
                {"main_output": "A wins"},
                expected_revision=0,
            )
            outcomes["a"] = ("ok", result["written"]["revision"])
            a_inserted.set()
            # Commit strictly after B has entered its own upsert: B's SELECT
            # (microseconds) must observe A's uncommitted row as absent, so
            # A's commit lands while B is blocked on the unique index.
            assert b_started.wait(timeout=30)
            time.sleep(0.5)
            conn_a.commit()
        except Exception as exc:  # noqa: BLE001 - surface unexpected errors
            conn_a.rollback()
            outcomes["a"] = ("unexpected", type(exc).__name__)
            a_inserted.set()
            b_started.wait(timeout=30)

    def worker_b() -> None:
        assert a_inserted.wait(timeout=30)
        b_started.set()
        try:
            result = upsert_monthly_review(
                conn_b,
                member_id,
                2026,
                5,
                {"main_output": "B loses"},
                expected_revision=0,
            )
            conn_b.commit()
            outcomes["b"] = ("ok", result["written"]["revision"])
        except PlanningDomainError as exc:
            conn_b.rollback()
            outcomes["b"] = ("conflict", exc.code)
        except Exception as exc:  # noqa: BLE001 - surface unexpected errors
            conn_b.rollback()
            outcomes["b"] = ("unexpected", type(exc).__name__)

    t1 = threading.Thread(target=worker_a)
    t2 = threading.Thread(target=worker_b)
    t1.start()
    t2.start()
    t1.join(timeout=60)
    t2.join(timeout=60)
    conn_a.close()
    conn_b.close()

    # Winner created revision 1; the loser got the structured 409 contract,
    # never a bare UNIQUE violation.
    assert outcomes.get("a") == ("ok", 1), outcomes
    assert outcomes.get("b") == (
        "conflict",
        "monthly_review_revision_conflict",
    ), outcomes

    # Exactly one review row at revision 1, exactly one immutable history row.
    assert _rows(
        profile_schema,
        "SELECT revision FROM monthly_review WHERE member_id = %s",
        (member_id,),
    ) == [(1,)]
    assert _rows(
        profile_schema,
        "SELECT mrh.revision FROM monthly_review_history mrh "
        "JOIN monthly_review mr ON mr.id = mrh.monthly_review_id "
        "WHERE mr.member_id = %s",
        (member_id,),
    ) == [(1,)]


def test_concurrent_first_create_api_level_barrier(
    profile_schema: psycopg.Connection,
) -> None:
    """Two PUTs race the first create: exactly one 200 and one structured
    409 with the conflict code — never a 500."""
    member_id, member_cookies = _build_full_profile(profile_schema)
    barrier = threading.Barrier(2)
    results: dict[str, tuple[int, dict[str, Any] | None] | str] = {}

    def worker(label: str) -> None:
        barrier.wait(timeout=15)
        try:
            results[label] = _put_review(
                member_cookies, {"expected_revision": 0, "main_output": label}
            )
        except Exception as exc:  # noqa: BLE001 - a crash is red-test evidence
            results[label] = f"crash:{type(exc).__name__}"

    t1 = threading.Thread(target=worker, args=("A",))
    t2 = threading.Thread(target=worker, args=("B",))
    t1.start()
    t2.start()
    t1.join(timeout=60)
    t2.join(timeout=60)

    statuses = sorted(r[0] for r in results.values() if isinstance(r, tuple))
    assert statuses == [200, 409], results
    loser = next(r for r in results.values() if r[0] == 409)
    assert loser[1] is not None
    assert loser[1]["detail"]["code"] == "monthly_review_revision_conflict", loser
    assert _rows(
        profile_schema,
        "SELECT revision FROM monthly_review WHERE member_id = %s",
        (member_id,),
    ) == [(1,)]
    assert _rows(
        profile_schema,
        "SELECT mrh.revision FROM monthly_review_history mrh "
        "JOIN monthly_review mr ON mr.id = mrh.monthly_review_id "
        "WHERE mr.member_id = %s",
        (member_id,),
    ) == [(1,)]


def test_concurrent_update_exactly_one_success_one_conflict(
    profile_schema: psycopg.Connection,
) -> None:
    """Concurrent updates on an existing review keep the same invariant:
    one 200 (revision 2), one structured 409, history exactly [1, 2]."""
    member_id, member_cookies = _build_full_profile(profile_schema)
    status, _, _ = _put_review(
        member_cookies, {"expected_revision": 0, "main_output": "v1"}
    )
    assert status == 200

    barrier = threading.Barrier(2)
    results: dict[str, tuple[int, dict[str, Any] | None]] = {}

    def worker(label: str) -> None:
        barrier.wait(timeout=15)
        results[label] = _put_review(
            member_cookies,
            {"expected_revision": 1, "main_output": f"v2-{label}"},
        )

    t1 = threading.Thread(target=worker, args=("A",))
    t2 = threading.Thread(target=worker, args=("B",))
    t1.start()
    t2.start()
    t1.join(timeout=60)
    t2.join(timeout=60)

    statuses = sorted(r[0] for r in results.values())
    assert statuses == [200, 409], results
    loser = next(r for r in results.values() if r[0] == 409)
    assert loser[1]["detail"]["code"] == "monthly_review_revision_conflict"
    winner = next(r for r in results.values() if r[0] == 200)
    assert winner[1]["written"]["revision"] == 2
    assert _rows(
        profile_schema,
        "SELECT revision FROM monthly_review WHERE member_id = %s",
        (member_id,),
    ) == [(2,)]
    assert _rows(
        profile_schema,
        "SELECT mrh.revision FROM monthly_review_history mrh "
        "JOIN monthly_review mr ON mr.id = mrh.monthly_review_id "
        "WHERE mr.member_id = %s ORDER BY mrh.revision",
        (member_id,),
    ) == [(1,), (2,)]


def test_concurrent_create_with_different_months_no_interference(
    profile_schema: psycopg.Connection,
) -> None:
    """Two members creating the same (year, month) race is member-scoped;
    a third concurrent create in a different month is never affected."""
    member_id, member_cookies = _build_full_profile(profile_schema)
    barrier = threading.Barrier(2)
    results: dict[str, tuple[int, dict[str, Any] | None]] = {}

    def worker(label: str) -> None:
        barrier.wait(timeout=15)
        results[label] = _request(
            "PUT",
            f"/api/planning/monthly-reviews?year=2026&month={5 if label == 'A' else 6}",
            {"expected_revision": 0, "main_output": label},
            cookies=member_cookies,
        )

    t1 = threading.Thread(target=worker, args=("A",))
    t2 = threading.Thread(target=worker, args=("B",))
    t1.start()
    t2.start()
    t1.join(timeout=60)
    t2.join(timeout=60)

    assert sorted(r[0] for r in results.values()) == [200, 200], results
    assert _rows(
        profile_schema,
        "SELECT month, revision FROM monthly_review WHERE member_id = %s "
        "ORDER BY month",
        (member_id,),
    ) == [(5, 1), (6, 1)]
