"""Issue #62: review idempotency and real dual-connection concurrency.

Scenarios:
- same key + same payload replays the original response;
- same key + different payload returns 409 idempotency_key_reused;
- no key duplicate returns 409 assessment_already_reviewed;
- idempotency scope is per (buddy_id, key);
- concurrent approvals: exactly one succeeds, zero duplicate writes;
- approve vs adjust concurrently: exactly one state transition;
- stale revision returns 409 with zero writes.
"""

import threading

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_user,
)
from app.assessment.repository import ReviewError
from tests.conftest import TEST_DATABASE_URL
from tests.review_support import (
    ReviewTestBase,
)

_L3 = "P01-L2A-L3A"


class TestIdempotencyConcurrency(ReviewTestBase):
    def _extra_connection(self) -> psycopg.Connection:
        return psycopg.connect(TEST_DATABASE_URL)

    def test_same_key_replays_original_response(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        first = self.approve(
            review_schema, assessment_id, buddy_id, idempotency_key="key-A"
        )
        assert first["idempotent_replayed"] is False
        second = self.approve(
            review_schema, assessment_id, buddy_id, idempotency_key="key-A"
        )
        assert second["idempotent_replayed"] is True
        assert second["plan"]["plan_id"] == first["plan"]["plan_id"]
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 1
        )
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM review_idempotency_key"
            ).fetchone()[0]
            == 1
        )

    def test_same_key_different_payload_rejected(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        self.approve(review_schema, assessment_id, buddy_id, idempotency_key="key-B")
        with pytest.raises(ReviewError) as excinfo:
            self.approve(
                review_schema,
                assessment_id,
                buddy_id,
                conclusion="建议调整",
                feedback="不同结论",
                idempotency_key="key-B",
            )
        assert excinfo.value.code == "idempotency_key_reused"

    def test_no_key_duplicate_returns_409(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        self.approve(review_schema, assessment_id, buddy_id)
        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, buddy_id)
        assert excinfo.value.code == "assessment_already_reviewed"

    def test_idempotency_scoped_per_buddy(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        other_buddy = create_user(review_schema, "other-buddy", "Other Buddy", "secret")
        assign_role(review_schema, other_buddy, "Buddy")
        review_schema.commit()
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        self.approve(
            review_schema, assessment_id, buddy_id, idempotency_key="shared-key"
        )
        # A different buddy with the same key is a different idempotency scope;
        # they see the review already closed (no replay of the other buddy).
        with pytest.raises(ReviewError) as excinfo:
            self.approve(
                review_schema,
                assessment_id,
                other_buddy,
                idempotency_key="shared-key",
            )
        assert excinfo.value.code == "assessment_already_reviewed"

    def test_stale_revision_returns_409_zero_writes(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        with pytest.raises(ReviewError) as excinfo:
            self.approve(
                review_schema,
                assessment_id,
                buddy_id,
                expected_revision=999,
            )
        assert excinfo.value.code == "revision_conflict"
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM assessment_review WHERE status='已闭环'"
            ).fetchone()[0]
            == 0
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 0
        )

    def test_concurrent_approvals_only_one_succeeds(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        conn_a = self._extra_connection()
        conn_b = self._extra_connection()
        barrier = threading.Barrier(2)
        results: dict[str, object] = {}

        def worker(conn: psycopg.Connection, key: str) -> None:
            try:
                barrier.wait(timeout=15)
                result = self.approve(
                    conn, assessment_id, buddy_id, idempotency_key=key
                )
                results[key] = ("ok", result["assessment_status"])
            except ReviewError as exc:
                results[key] = ("err", exc.code)
            except Exception as exc:  # noqa: BLE001 - surface unexpected errors
                results[key] = ("unexpected", type(exc).__name__)
            finally:
                conn.close()

        t1 = threading.Thread(target=worker, args=(conn_a, "conc-A"))
        t2 = threading.Thread(target=worker, args=(conn_b, "conc-B"))
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)

        outcomes = sorted(str(v[0]) for v in results.values())
        assert "ok" in outcomes, results
        # exactly one success; the other is a structured 409, never a crash
        assert outcomes.count("ok") == 1, results
        assert any(v[0] == "err" for v in results.values()), results
        # exactly one plan with one item and one task
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM learning_task").fetchone()[0]
            == 1
        )
        # only the winning call recorded its idempotency key; the loser got a
        # structured 409 without any write
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM review_idempotency_key"
            ).fetchone()[0]
            == 1
        )

    def test_concurrent_same_key_single_write(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema,
            member_id,
            2026,
            [
                {
                    "l3_code": _L3,
                    "current_level": 2,
                    "target_level": 4,
                    "member_priority": "高",
                    "include_in_plan": True,
                    "plan_quarter": "Q2",
                    "plan_month": 5,
                }
            ],
        )
        conn_a = self._extra_connection()
        conn_b = self._extra_connection()
        barrier = threading.Barrier(2)
        results: dict[str, bool] = {}

        def worker(conn: psycopg.Connection, label: str) -> None:
            try:
                barrier.wait(timeout=15)
                result = self.approve(
                    conn, assessment_id, buddy_id, idempotency_key="same-key"
                )
                results[label] = result["idempotent_replayed"]
            except Exception as exc:  # noqa: BLE001
                results[label] = f"err:{type(exc).__name__}"
            finally:
                conn.close()

        t1 = threading.Thread(target=worker, args=(conn_a, "a"))
        t2 = threading.Thread(target=worker, args=(conn_b, "b"))
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)
        # exactly one row written; the other call replays (or both ok, never
        # two writes)
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM review_idempotency_key"
            ).fetchone()[0]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        assert (
            review_schema.execute("SELECT COUNT(*) FROM plan_item").fetchone()[0] == 1
        )

    def test_approve_vs_adjust_concurrent(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        conn_a = self._extra_connection()
        conn_b = self._extra_connection()
        barrier = threading.Barrier(2)
        results: dict[str, object] = {}

        def approve_worker() -> None:
            try:
                barrier.wait(timeout=15)
                result = self.approve(
                    conn_a, assessment_id, buddy_id, idempotency_key="ap"
                )
                results["approve"] = ("ok", result["assessment_status"])
            except ReviewError as exc:
                results["approve"] = ("err", exc.code)
            finally:
                conn_a.close()

        def adjust_worker() -> None:
            try:
                barrier.wait(timeout=15)
                result = self.approve(
                    conn_b,
                    assessment_id,
                    buddy_id,
                    conclusion="建议调整",
                    feedback="再补充",
                    idempotency_key="ad",
                )
                results["adjust"] = ("ok", result["assessment_status"])
            except ReviewError as exc:
                results["adjust"] = ("err", exc.code)
            finally:
                conn_b.close()

        t1 = threading.Thread(target=approve_worker)
        t2 = threading.Thread(target=adjust_worker)
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)
        assert results.get("approve") is not None
        assert results.get("adjust") is not None
        ok_count = sum(1 for v in results.values() if v[0] == "ok")
        assert ok_count == 1, results
        # assessment ends in exactly one final state with one closed review
        assessment = self.get_assessment(review_schema, assessment_id)
        assert assessment["status"] in ("已归档", "建议调整")
        closed = review_schema.execute(
            "SELECT COUNT(*) FROM assessment_review WHERE status='已闭环'"
        ).fetchone()[0]
        assert closed == 1
