"""Issue #62 6th review: the concurrency red tests must prove the
proposal-source != plan-first-source invariant with trustworthy verdicts.

Two independent connections at the default READ COMMITTED isolation,
event/barrier-driven interleaving with bounded lock/statement timeouts (no
arbitrary sleeps, no retries).  Outcomes are structured (status, sqlstate,
message): the single expected failure mode of the illegal interleavings is a
raised P0001 guard rejection — lock timeouts, deadlocks and unexpected
errors FAIL the tests instead of being folded into a vague "not ok".  The
legal concurrency control synchronises both workers on a threading.Barrier
so the contention is real and provable, then asserts both sides succeeded
with exact final state.
"""

import threading
from dataclasses import dataclass

import psycopg

from tests.conftest import TEST_DATABASE_URL
from tests.review_support import ReviewTestBase

_INSERT_PROPOSAL_SQL = """
INSERT INTO annual_plan_change_proposal (
    member_id, year, source_assessment_id,
    target_annual_growth_plan_id, status, created_by, summary
) VALUES (%s, 2026, %s, %s, '待处理', %s, '{}')
"""

_UPDATE_PLAN_SOURCE_SQL = """
UPDATE annual_growth_plan SET source_assessment_id=%s,
planning_source_type='assessment_approval' WHERE id=%s
"""

_P0001 = "P0001"

_LOCK_TIMEOUT = "lock-timeout"
_DEADLOCK = "deadlock"


@dataclass(frozen=True)
class StatementOutcome:
    """Structured per-statement verdict.  The guard must reject an illegal
    write with ``raised``/P0001; anything else is a test failure."""

    status: str  # "ok" | "raised" | "lock-timeout" | "deadlock" | "error"
    sqlstate: str | None = None
    message: str = ""

    def is_ok(self) -> bool:
        return self.status == "ok"

    def is_guard_rejection(self) -> bool:
        """The expected DB-level rejection: a raised exception with the
        guard's P0001 SQLSTATE.  Lock timeouts, deadlocks and unexpected
        errors are never acceptable outcomes here."""
        return self.status == "raised" and self.sqlstate == _P0001

    def __str__(self) -> str:  # compact for assertion messages
        if self.status == "ok":
            return "ok"
        return f"{self.status} (sqlstate={self.sqlstate}): {self.message[:200]}"


def _execute_outcome(
    connection: psycopg.Connection,
    sql: str,
    params: tuple,
    commit: bool,
) -> StatementOutcome:
    """Run one statement in an explicit transaction; ``commit=True`` commits
    it (self-contained side), ``commit=False`` leaves the transaction open
    for the caller to interleave.  Structured verdict, no stringly folding."""
    try:
        if not commit:
            connection.execute("BEGIN")
        connection.execute(sql, params)
        if commit:
            connection.commit()
        return StatementOutcome("ok")
    except psycopg.errors.RaiseException as error:
        return StatementOutcome("raised", error.sqlstate, str(error))
    except psycopg.errors.LockNotAvailable as error:
        return StatementOutcome(_LOCK_TIMEOUT, error.sqlstate, str(error))
    except psycopg.errors.DeadlockDetected as error:
        return StatementOutcome(_DEADLOCK, error.sqlstate, str(error))
    except Exception as error:  # noqa: BLE001
        return StatementOutcome("error", None, repr(error))


class TestProposalSourceGuardConcurrency(ReviewTestBase):
    def _insert_assessment(
        self, connection: psycopg.Connection, member_id: int, version: int
    ) -> int:
        return connection.execute(
            "INSERT INTO assessment (member_id, year, version, assessment_type, "
            "status) VALUES (%s, 2026, %s, '年度', '已复核') RETURNING id",
            (member_id, version),
        ).fetchone()[0]

    def _prepare(self, review_schema: psycopg.Connection) -> tuple[int, int, int, int]:
        """member, first-source assessment A, second-source assessment B,
        plan (source still NULL, legacy shape)."""
        member_id, _buddy_id = self.setup_users(review_schema)
        a_id = self._insert_assessment(review_schema, member_id, 1)
        b_id = self._insert_assessment(review_schema, member_id, 2)
        plan_id = review_schema.execute(
            "INSERT INTO annual_growth_plan (member_id, year) "
            "VALUES (%s, 2026) RETURNING id",
            (member_id,),
        ).fetchone()[0]
        review_schema.commit()
        return member_id, a_id, b_id, plan_id

    @staticmethod
    def _new_connection() -> psycopg.Connection:
        """autocommit connection: the SETs never open an implicit
        transaction, so the explicit BEGIN in _execute_outcome is always the
        first transaction statement — no 'transaction already in progress'
        warnings, no hidden transaction state."""
        connection = psycopg.connect(TEST_DATABASE_URL, autocommit=True)
        connection.execute("SET lock_timeout = '10s'")
        connection.execute("SET statement_timeout = '30s'")
        return connection

    @staticmethod
    def _close(connection: psycopg.Connection) -> None:
        try:
            connection.rollback()
        except Exception:  # noqa: BLE001
            pass
        connection.close()

    def _final_state(
        self, connection: psycopg.Connection, plan_id: int
    ) -> tuple[int | None, list[int]]:
        plan_source = connection.execute(
            "SELECT source_assessment_id FROM annual_growth_plan WHERE id=%s",
            (plan_id,),
        ).fetchone()[0]
        sources = connection.execute(
            "SELECT source_assessment_id FROM annual_plan_change_proposal "
            "WHERE target_annual_growth_plan_id=%s",
            (plan_id,),
        ).fetchall()
        return plan_source, [int(row[0]) for row in sources]

    def test_concurrent_proposal_insert_then_plan_backfill_cannot_form_equal_sources(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Tx-A inserts a proposal (source=A) and holds it; Tx-B concurrently
        backfills the plan's first source with the same A.  Tx-B must block
        while Tx-A is uncommitted, then be rejected with the guard's P0001 —
        never a lock timeout, deadlock or unexpected error — and the final
        state must be exactly one proposal (Tx-A's) with the plan source
        still NULL."""
        member_id, a_id, _b_id, plan_id = self._prepare(review_schema)
        tx_a = self._new_connection()
        tx_b = self._new_connection()
        try:
            # Tx-A lands its proposal first and holds it uncommitted.
            outcome_a = _execute_outcome(
                tx_a,
                _INSERT_PROPOSAL_SQL,
                (member_id, a_id, plan_id, member_id),
                commit=False,
            )
            assert outcome_a.is_ok(), outcome_a
            # Tx-B now tries the backfill; it must block on Tx-A.
            outcomes: list[StatementOutcome | None] = [None]
            worker = threading.Thread(
                target=_run_threaded,
                args=(
                    tx_b,
                    _UPDATE_PLAN_SOURCE_SQL,
                    (a_id, plan_id),
                    False,
                    outcomes,
                    0,
                ),
            )
            worker.start()
            worker.join(2.0)
            blocked = worker.is_alive()
            tx_a.commit()
            worker.join(15.0)
            assert not worker.is_alive(), "backfill did not finish"
            outcome_b = outcomes[0]
            assert blocked, (
                "plan backfill must block while an uncommitted proposal with "
                f"the same source exists, got {outcome_b}"
            )
            assert outcome_b.is_guard_rejection(), (
                "plan backfill must be rejected by the guard with P0001 "
                f"(exactly one legal outcome: Tx-A wins), got {outcome_b}"
            )
            tx_b.rollback()
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert plan_source is None, f"plan source must stay NULL: {plan_source}"
            assert proposal_sources == [
                a_id
            ], f"exactly Tx-A's proposal expected, got {proposal_sources}"
        finally:
            self._close(tx_a)
            self._close(tx_b)

    def test_concurrent_plan_backfill_then_proposal_insert_cannot_form_equal_sources(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Reverse interleaving: Tx-B holds the plan-side source update while
        Tx-A inserts a proposal with the same source.  Tx-A must block until
        Tx-B commits, then be rejected with the guard's P0001 — never a lock
        timeout, deadlock or unexpected error — leaving zero proposal rows
        and the plan source committed."""
        member_id, a_id, _b_id, plan_id = self._prepare(review_schema)
        tx_b = self._new_connection()
        tx_a = self._new_connection()
        try:
            # Tx-B holds the plan-side backfill uncommitted.
            outcome_b = _execute_outcome(
                tx_b,
                _UPDATE_PLAN_SOURCE_SQL,
                (a_id, plan_id),
                commit=False,
            )
            assert outcome_b.is_ok(), outcome_b
            # Tx-A now tries a proposal with the same source; it must block.
            outcomes: list[StatementOutcome | None] = [None]
            worker = threading.Thread(
                target=_run_threaded,
                args=(
                    tx_a,
                    _INSERT_PROPOSAL_SQL,
                    (member_id, a_id, plan_id, member_id),
                    False,
                    outcomes,
                    0,
                ),
            )
            worker.start()
            worker.join(2.0)
            blocked = worker.is_alive()
            tx_b.commit()
            worker.join(15.0)
            assert not worker.is_alive(), "proposal insert did not finish"
            outcome_a = outcomes[0]
            assert blocked, (
                "proposal insert must block until the plan backfill commits, "
                f"got {outcome_a}"
            )
            assert outcome_a.is_guard_rejection(), (
                "proposal insert must be rejected by the guard with P0001 "
                f"(exactly one legal outcome: Tx-B wins), got {outcome_a}"
            )
            tx_a.rollback()
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert int(plan_source) == a_id
            assert proposal_sources == [], (
                f"zero partial writes expected, got {proposal_sources} "
                f"(insert outcome: {outcome_a})"
            )
        finally:
            self._close(tx_a)
            self._close(tx_b)

    def test_legal_concurrent_proposals_not_rejected(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Legal concurrency control with a provable starting point: with
        plan.source=A fixed, proposals B and C are inserted concurrently —
        both workers synchronise on a threading.Barrier before executing, so
        the contention is real.  Both must land (ok/ok — no spurious
        rejection, no lock timeout, no deadlock) and the final state must be
        exactly the two proposals."""
        member_id, a_id, b_id, plan_id = self._prepare(review_schema)
        review_schema.execute(
            "UPDATE annual_growth_plan SET source_assessment_id=%s, "
            "planning_source_type='assessment_approval' WHERE id=%s",
            (a_id, plan_id),
        )
        review_schema.commit()
        c_id = self._insert_assessment(review_schema, member_id, 3)
        review_schema.commit()
        tx_b = self._new_connection()
        tx_c = self._new_connection()
        barrier = threading.Barrier(2, timeout=10)
        outcomes: list[StatementOutcome | None] = [None, None]
        try:
            workers = [
                threading.Thread(
                    target=_run_barriered,
                    args=(
                        barrier,
                        tx_b,
                        _INSERT_PROPOSAL_SQL,
                        (member_id, b_id, plan_id, member_id),
                        outcomes,
                        0,
                    ),
                ),
                threading.Thread(
                    target=_run_barriered,
                    args=(
                        barrier,
                        tx_c,
                        _INSERT_PROPOSAL_SQL,
                        (member_id, c_id, plan_id, member_id),
                        outcomes,
                        1,
                    ),
                ),
            ]
            for worker in workers:
                worker.start()
            for worker in workers:
                worker.join(20.0)
            assert all(
                not worker.is_alive() for worker in workers
            ), "workers must finish within the bounded window"
            assert outcomes[0].is_ok(), f"proposal B must succeed, got {outcomes[0]}"
            assert outcomes[1].is_ok(), f"proposal C must succeed, got {outcomes[1]}"
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert int(plan_source) == a_id
            assert sorted(proposal_sources) == sorted(
                [b_id, c_id]
            ), f"exactly B and C expected, got {proposal_sources}"
        finally:
            self._close(tx_b)
            self._close(tx_c)


def _run_threaded(
    connection: psycopg.Connection,
    sql: str,
    params: tuple,
    commit: bool,
    outcomes: list[StatementOutcome | None],
    index: int,
) -> None:
    outcomes[index] = _execute_outcome(connection, sql, params, commit)


def _run_barriered(
    barrier: threading.Barrier,
    connection: psycopg.Connection,
    sql: str,
    params: tuple,
    outcomes: list[StatementOutcome | None],
    index: int,
) -> None:
    """Wait for both workers to arrive, then execute a self-contained
    transaction.  A broken barrier (timeout) is a test failure, never a
    pass."""
    try:
        barrier.wait(timeout=10)
    except threading.BrokenBarrierError as error:
        outcomes[index] = StatementOutcome("error", None, f"barrier broken: {error}")
        return
    outcomes[index] = _execute_outcome(connection, sql, params, commit=True)
