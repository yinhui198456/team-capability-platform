"""Issue #62 5th review: the proposal-source != plan-first-source invariant
must hold under real concurrency, not only in single-connection sequential
tests.  Two independent connections at the default READ COMMITTED isolation,
event/barrier-driven interleaving with bounded join/lock/statement timeouts
(no arbitrary sleeps), asserting blocking order, per-side outcomes, the exact
final plan/proposal state, and absence of deadlocks.
"""

import threading

import psycopg

from tests.conftest import TEST_DATABASE_URL
from tests.review_support import ReviewTestBase

_INSERT_PROPOSAL_SQL = """
INSERT INTO annual_plan_change_proposal (
    member_id, year, source_assessment_id,
    target_annual_growth_plan_id, status, created_by, summary
) VALUES (%s, 2026, %s, %s, '待处理', %s, '{}')
"""


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
        connection = psycopg.connect(TEST_DATABASE_URL)
        connection.execute("SET lock_timeout = '10s'")
        connection.execute("SET statement_timeout = '30s'")
        return connection

    @staticmethod
    def _run(
        connection: psycopg.Connection,
        sql: str,
        params: tuple,
        result: dict[str, str],
        key: str,
    ) -> None:
        try:
            connection.execute(sql, params)
            result[key] = "ok"
        except psycopg.errors.RaiseException as error:
            result[key] = f"raised:{error}"
        except psycopg.errors.LockNotAvailable as error:
            result[key] = f"lock-timeout:{error}"
        except psycopg.errors.DeadlockDetected as error:
            result[key] = f"deadlock:{error}"
        except Exception as error:  # noqa: BLE001
            result[key] = f"err:{error!r}"

    @staticmethod
    def _run_commit(
        connection: psycopg.Connection,
        sql: str,
        params: tuple,
        result: dict[str, str],
        key: str,
    ) -> None:
        """Self-contained transaction: BEGIN → statement → COMMIT.  Used by
        the legal-concurrency control where each side must land on its own
        (no external interleaving of commits), so one side can never wait on
        the other's externally-timed commit."""
        try:
            connection.execute("BEGIN")
            connection.execute(sql, params)
            connection.commit()
            result[key] = "ok"
        except psycopg.errors.RaiseException as error:
            result[key] = f"raised:{error}"
        except psycopg.errors.LockNotAvailable as error:
            result[key] = f"lock-timeout:{error}"
        except psycopg.errors.DeadlockDetected as error:
            result[key] = f"deadlock:{error}"
        except Exception as error:  # noqa: BLE001
            result[key] = f"err:{error!r}"

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
        """Tx-A inserts a proposal (source=A) while Tx-B concurrently
        backfills the plan's first source with the same A.  Exactly one side
        may win; the final pair may never be equal sources."""
        member_id, a_id, _b_id, plan_id = self._prepare(review_schema)
        tx_a = self._new_connection()
        tx_b = self._new_connection()
        try:
            tx_a.execute("BEGIN")
            tx_a.execute(_INSERT_PROPOSAL_SQL, (member_id, a_id, plan_id, member_id))
            # Tx-A holds its proposal uncommitted. Tx-B now tries the backfill.
            result_b: dict[str, str] = {}
            tx_b.execute("BEGIN")
            worker = threading.Thread(
                target=self._run,
                args=(
                    tx_b,
                    "UPDATE annual_growth_plan SET source_assessment_id=%s, "
                    "planning_source_type='assessment_approval' WHERE id=%s",
                    (a_id, plan_id),
                    result_b,
                    "update",
                ),
            )
            worker.start()
            # the backfill must block on Tx-A's uncommitted proposal (shared
            # plan-key serialisation); the unguarded baseline sails through
            worker.join(2.0)
            blocked = worker.is_alive()
            tx_a.commit()
            worker.join(15.0)
            assert not worker.is_alive(), "backfill did not finish"
            tx_b_did_backfill = result_b.get("update") == "ok"
            if tx_b_did_backfill:
                tx_b.rollback()
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert blocked, (
                "plan backfill must block while an uncommitted proposal with "
                f"the same source exists (result={result_b})"
            )
            assert not (tx_b_did_backfill and a_id in proposal_sources), (
                "both sides committed: plan.source == proposal.source "
                f"(backfill={result_b}, proposal_sources={proposal_sources})"
            )
            assert plan_source is None, f"plan source must stay NULL: {plan_source}"
            assert proposal_sources == [a_id]
        finally:
            for connection in (tx_a, tx_b):
                try:
                    connection.rollback()
                except Exception:  # noqa: BLE001
                    pass
                connection.close()

    def test_concurrent_plan_backfill_then_proposal_insert_cannot_form_equal_sources(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Reverse interleaving: Tx-B holds the plan-side source update while
        Tx-A inserts a proposal with the same source.  Only one legal result —
        the proposal side waits, then sees the committed source and is
        rejected with zero partial writes."""
        member_id, a_id, _b_id, plan_id = self._prepare(review_schema)
        tx_b = self._new_connection()
        tx_a = self._new_connection()
        try:
            tx_b.execute("BEGIN")
            tx_b.execute(
                "UPDATE annual_growth_plan SET source_assessment_id=%s, "
                "planning_source_type='assessment_approval' WHERE id=%s",
                (a_id, plan_id),
            )
            result_a: dict[str, str] = {}
            tx_a.execute("BEGIN")
            worker = threading.Thread(
                target=self._run,
                args=(
                    tx_a,
                    _INSERT_PROPOSAL_SQL,
                    (member_id, a_id, plan_id, member_id),
                    result_a,
                    "insert",
                ),
            )
            worker.start()
            # the proposal insert must wait for the plan-side backfill
            worker.join(2.0)
            blocked = worker.is_alive()
            tx_b.commit()
            worker.join(15.0)
            assert not worker.is_alive(), "proposal insert did not finish"
            tx_a_inserted = result_a.get("insert") == "ok"
            if tx_a_inserted:
                tx_a.rollback()
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert blocked, (
                "proposal insert must wait for the plan-side backfill "
                f"(result={result_a})"
            )
            assert not (
                tx_a_inserted and plan_source is not None and int(plan_source) == a_id
            ), (
                "both sides committed: proposal.source == plan.source "
                f"(insert={result_a}, plan_source={plan_source})"
            )
            assert int(plan_source) == a_id
            assert proposal_sources == [], (
                f"zero partial writes expected, got {proposal_sources} "
                f"(insert result={result_a})"
            )
        finally:
            for connection in (tx_a, tx_b):
                try:
                    connection.rollback()
                except Exception:  # noqa: BLE001
                    pass
                connection.close()

    def test_legal_concurrent_proposals_not_rejected(self, review_schema) -> None:
        """Legal concurrency control: with plan.source=A fixed, two
        subsequent-assessment proposals (B and C) inserted concurrently must
        both succeed, with no spurious rejection and no deadlock."""
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
        result_b: dict[str, str] = {}
        result_c: dict[str, str] = {}
        try:
            # each side is a self-contained BEGIN→INSERT→COMMIT transaction:
            # whichever wins the plan row first lands, the other waits on the
            # same row and then passes — both succeed, neither is rejected
            worker_b = threading.Thread(
                target=self._run_commit,
                args=(
                    tx_b,
                    _INSERT_PROPOSAL_SQL,
                    (member_id, b_id, plan_id, member_id),
                    result_b,
                    "insert",
                ),
            )
            worker_c = threading.Thread(
                target=self._run_commit,
                args=(
                    tx_c,
                    _INSERT_PROPOSAL_SQL,
                    (member_id, c_id, plan_id, member_id),
                    result_c,
                    "insert",
                ),
            )
            worker_b.start()
            worker_c.start()
            worker_b.join(15.0)
            worker_c.join(15.0)
            assert not worker_b.is_alive() and not worker_c.is_alive()
            assert result_b.get("insert") == "ok", result_b
            assert result_c.get("insert") == "ok", result_c
            plan_source, proposal_sources = self._final_state(review_schema, plan_id)
            assert int(plan_source) == a_id
            assert sorted(proposal_sources) == sorted([b_id, c_id])
        finally:
            for connection in (tx_b, tx_c):
                try:
                    connection.rollback()
                except Exception:  # noqa: BLE001
                    pass
                connection.close()
