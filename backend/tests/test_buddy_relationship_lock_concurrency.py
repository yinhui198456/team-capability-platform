"""Issue #62 P1-2: the Review path and the Buddy-relationship path share one
member relationship lock with a fixed global order.

Scenarios (real dual-connection races, threading.Barrier):
- A: relationship switch wins the lock first -> the old Buddy's Review submit
      is rejected with 403 after the switch commits (no write at all);
- B: Review wins the lock first -> the relationship switch waits until the
      Review transaction commits, then succeeds (never an interleaved state);
- C: neither path deadlocks (fixed lock order) and both finish;
- D: after a switch, the new Buddy takes over the same pending Review and
      closes it (one review, one plan, reviewed_by_buddy_id = new Buddy);
- E: after a committed switch, the old Buddy can never close the Review
      (403 + zero partial writes).
"""

import threading

import psycopg
import pytest

from app.access.repository import assign_role, create_buddy_relationship, create_user
from app.assessment.repository import ReviewError, submit_assessment_review
from tests.conftest import TEST_DATABASE_URL
from tests.review_support import ReviewTestBase

_L3 = "P01-L2A-L3A"
_LOCK_NS = "tcp_buddy_relationship"


def _relationship_lock_key(member_id: int) -> str:
    return f"{_LOCK_NS}:{member_id}"


def _yesterday(connection: psycopg.Connection) -> str:
    row = connection.execute("SELECT CURRENT_DATE - 1").fetchone()
    return str(row[0])


class TestBuddyRelationshipLockConcurrency(ReviewTestBase):
    def _extra_connection(self) -> psycopg.Connection:
        return psycopg.connect(TEST_DATABASE_URL)

    def _setup_pending_review(
        self, review_schema: psycopg.Connection
    ) -> tuple[int, int, int]:
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
                    "plan_month": "2026-05",
                }
            ],
        )
        return member_id, buddy_id, assessment_id

    def _new_buddy(self, connection: psycopg.Connection, tag: str = "") -> int:
        username = f"rv-buddy-2{tag}"
        new_buddy = create_user(connection, username, f"RV Buddy 2 {tag}", "secret")
        assign_role(connection, new_buddy, "Buddy")
        connection.commit()
        return new_buddy

    def _switch_relationship(
        self, connection: psycopg.Connection, member_id: int, new_buddy_id: int
    ) -> None:
        """End the current primary and assign the new Buddy from today in one
        transaction (the same shape the Admin takeover uses)."""
        with connection.transaction():
            connection.execute(
                "UPDATE buddy_relationship SET expiry_date = %s "
                "WHERE member_id = %s AND is_primary = TRUE AND expiry_date IS NULL",
                (_yesterday(connection), member_id),
            )
            create_buddy_relationship(connection, member_id, new_buddy_id)

    def test_a_switch_wins_then_old_buddy_gets_403(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-2 A: relationship switch holds the lock first; the old Buddy's
        concurrent Review submit is rejected 403 with zero writes."""
        member_id, old_buddy, assessment_id = self._setup_pending_review(review_schema)
        new_buddy = self._new_buddy(review_schema, "a")
        conn_switch = self._extra_connection()
        conn_review = self._extra_connection()
        barrier = threading.Barrier(2)
        results: dict[str, str] = {}

        def switch_worker() -> None:
            try:
                with conn_switch.transaction():
                    conn_switch.execute(
                        "SELECT pg_advisory_xact_lock(hashtext(%s))",
                        (_relationship_lock_key(member_id),),
                    )
                    # Hold the lock so the Review thread queues behind it.
                    barrier.wait(timeout=15)
                    conn_switch.execute(
                        "UPDATE buddy_relationship SET expiry_date = %s "
                        "WHERE member_id = %s AND is_primary = TRUE "
                        "AND expiry_date IS NULL",
                        (_yesterday(conn_switch), member_id),
                    )
                    create_buddy_relationship(conn_switch, member_id, new_buddy)
                results["switch"] = "ok"
            except Exception as exc:  # noqa: BLE001 - surface unexpected errors
                results["switch"] = f"unexpected:{type(exc).__name__}"
            finally:
                conn_switch.close()

        def review_worker() -> None:
            try:
                barrier.wait(timeout=15)
                review_id = conn_review.execute(
                    "SELECT id FROM assessment_review WHERE assessment_id=%s",
                    (assessment_id,),
                ).fetchone()[0]
                submit_assessment_review(
                    conn_review,
                    int(review_id),
                    old_buddy,
                    "认可",
                    "符合预期",
                    expected_revision=3,
                    assessment_id_from_url=assessment_id,
                )
                conn_review.commit()
                results["review"] = "ok"
            except ReviewError as exc:
                results["review"] = exc.code
            except Exception as exc:  # noqa: BLE001
                results["review"] = f"unexpected:{type(exc).__name__}"
            finally:
                conn_review.close()

        t1 = threading.Thread(target=switch_worker)
        t2 = threading.Thread(target=review_worker)
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)

        assert results.get("switch") == "ok", results
        # The old Buddy must NOT close the Review after the switch committed.
        assert results.get("review") == "insufficient_permissions", results
        # Zero partial writes: assessment still pending, no closed review;
        # the plan exists from submit-time generation (#82+#194) and the
        # blocked review writes nothing new.
        status = review_schema.execute(
            "SELECT status FROM assessment WHERE id=%s", (assessment_id,)
        ).fetchone()
        assert status[0] == "待复核"
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        closed = review_schema.execute(
            "SELECT COUNT(*) FROM assessment_review WHERE status='已闭环'"
        ).fetchone()[0]
        assert closed == 0
        # The new Buddy is the canonical responsible Buddy now.
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM buddy_relationship WHERE member_id=%s "
                "AND buddy_id=%s AND is_primary=TRUE AND expiry_date IS NULL",
                (member_id, new_buddy),
            ).fetchone()[0]
            == 1
        )

    def test_b_review_wins_then_switch_waits_for_commit(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-2 B: the Review transaction holds the relationship lock; the
        concurrent switch is serialised behind it and only succeeds after the
        Review commits."""
        member_id, old_buddy, assessment_id = self._setup_pending_review(review_schema)
        new_buddy = self._new_buddy(review_schema, "b")
        conn_review = self._extra_connection()
        conn_switch = self._extra_connection()
        barrier = threading.Barrier(2)
        results: dict[str, str] = {}

        def review_worker() -> None:
            try:
                with conn_review.transaction():
                    conn_review.execute(
                        "SELECT pg_advisory_xact_lock(hashtext(%s))",
                        (_relationship_lock_key(member_id),),
                    )
                    barrier.wait(timeout=15)
                    review_id = conn_review.execute(
                        "SELECT id FROM assessment_review WHERE assessment_id=%s",
                        (assessment_id,),
                    ).fetchone()[0]
                    submit_assessment_review(
                        conn_review,
                        int(review_id),
                        old_buddy,
                        "认可",
                        "符合预期",
                        expected_revision=3,
                        assessment_id_from_url=assessment_id,
                    )
                results["review"] = "ok"
            except Exception as exc:  # noqa: BLE001
                results["review"] = f"unexpected:{type(exc).__name__}"
            finally:
                conn_review.close()

        def switch_worker() -> None:
            try:
                barrier.wait(timeout=15)
                self._switch_relationship(conn_switch, member_id, new_buddy)
                results["switch"] = "ok"
            except Exception as exc:  # noqa: BLE001
                results["switch"] = f"unexpected:{type(exc).__name__}"
            finally:
                conn_switch.close()

        t1 = threading.Thread(target=review_worker)
        t2 = threading.Thread(target=switch_worker)
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)

        assert results.get("review") == "ok", results
        # The switch serialised behind the Review commit and then succeeded.
        assert results.get("switch") == "ok", results
        # The Review was closed by the old Buddy *before* the switch; exactly
        # one plan with one item/task; the switch left exactly one open primary.
        closed = review_schema.execute(
            "SELECT reviewed_by_buddy_id FROM assessment_review "
            "WHERE assessment_id=%s AND status='已闭环'",
            (assessment_id,),
        ).fetchone()
        assert closed is not None and int(closed[0]) == old_buddy
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
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM buddy_relationship WHERE member_id=%s "
                "AND is_primary=TRUE AND expiry_date IS NULL",
                (member_id,),
            ).fetchone()[0]
            == 1
        )

    def test_c_no_deadlock_between_orders(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-2 C: both lock orders complete without deadlock on independent
        members — switch-first on member A, review-first on member B — and
        every outcome is a structured result, never DeadlockDetected."""
        member_a, buddy_a, assessment_a = self._setup_pending_review(review_schema)
        new_buddy_a = self._new_buddy(review_schema, "a")
        # Member B must be a distinct member: build its own pending review
        # with a different username space.
        member_b, buddy_b, assessment_b = self._setup_member_b(review_schema)
        new_buddy_b = self._new_buddy(review_schema, "b")
        outcomes: list[str] = []

        # Round 1 (member A): the switch holds the lock first.
        conn_switch = self._extra_connection()
        conn_review = self._extra_connection()
        barrier = threading.Barrier(2)

        def switch_worker_a() -> None:
            try:
                with conn_switch.transaction():
                    conn_switch.execute(
                        "SELECT pg_advisory_xact_lock(hashtext(%s))",
                        (_relationship_lock_key(member_a),),
                    )
                    barrier.wait(timeout=15)
                    conn_switch.execute(
                        "UPDATE buddy_relationship SET expiry_date = %s "
                        "WHERE member_id = %s AND is_primary = TRUE "
                        "AND expiry_date IS NULL",
                        (_yesterday(conn_switch), member_a),
                    )
                    create_buddy_relationship(conn_switch, member_a, new_buddy_a)
                outcomes.append("r1-switch-ok")
            except psycopg.errors.DeadlockDetected:
                outcomes.append("r1-switch-deadlock")
            except Exception as exc:  # noqa: BLE001
                outcomes.append(f"r1-switch-unexpected:{type(exc).__name__}")
            finally:
                conn_switch.close()

        def review_worker_a() -> None:
            try:
                barrier.wait(timeout=15)
                review_id = conn_review.execute(
                    "SELECT id FROM assessment_review WHERE assessment_id=%s",
                    (assessment_a,),
                ).fetchone()[0]
                submit_assessment_review(
                    conn_review,
                    int(review_id),
                    buddy_a,
                    "认可",
                    "符合预期",
                    expected_revision=3,
                    assessment_id_from_url=assessment_a,
                )
                conn_review.commit()
                outcomes.append("r1-review-ok")
            except ReviewError as exc:
                outcomes.append(f"r1-review-{exc.code}")
            except Exception as exc:  # noqa: BLE001
                outcomes.append(f"r1-review-unexpected:{type(exc).__name__}")
            finally:
                conn_review.close()

        # Round 2 (member B): the Review holds the lock first.
        conn_review2 = self._extra_connection()
        conn_switch2 = self._extra_connection()
        barrier2 = threading.Barrier(2)

        def review_worker_b() -> None:
            try:
                with conn_review2.transaction():
                    conn_review2.execute(
                        "SELECT pg_advisory_xact_lock(hashtext(%s))",
                        (_relationship_lock_key(member_b),),
                    )
                    barrier2.wait(timeout=15)
                    review_id = conn_review2.execute(
                        "SELECT id FROM assessment_review WHERE assessment_id=%s",
                        (assessment_b,),
                    ).fetchone()[0]
                    submit_assessment_review(
                        conn_review2,
                        int(review_id),
                        buddy_b,
                        "认可",
                        "符合预期",
                        expected_revision=3,
                        assessment_id_from_url=assessment_b,
                    )
                outcomes.append("r2-review-ok")
            except Exception as exc:  # noqa: BLE001
                outcomes.append(f"r2-review-unexpected:{type(exc).__name__}")
            finally:
                conn_review2.close()

        def switch_worker_b() -> None:
            try:
                barrier2.wait(timeout=15)
                self._switch_relationship(conn_switch2, member_b, new_buddy_b)
                outcomes.append("r2-switch-ok")
            except psycopg.errors.DeadlockDetected:
                outcomes.append("r2-switch-deadlock")
            except Exception as exc:  # noqa: BLE001
                outcomes.append(f"r2-switch-unexpected:{type(exc).__name__}")
            finally:
                conn_switch2.close()

        threads = [
            threading.Thread(target=switch_worker_a),
            threading.Thread(target=review_worker_a),
            threading.Thread(target=review_worker_b),
            threading.Thread(target=switch_worker_b),
        ]
        for thread in threads:
            thread.start()
        for thread in threads:
            thread.join(timeout=30)
        assert all(not thread.is_alive() for thread in threads), "thread hung"
        assert "r1-switch-ok" in outcomes, outcomes
        assert "r1-review-insufficient_permissions" in outcomes, outcomes
        assert "r2-review-ok" in outcomes, outcomes
        assert "r2-switch-ok" in outcomes, outcomes
        assert "deadlock" not in " ".join(outcomes), outcomes
        # Consistent end state: one open primary per member, member B's review
        # produced exactly one plan.
        for member_id in (member_a, member_b):
            assert (
                review_schema.execute(
                    "SELECT COUNT(*) FROM buddy_relationship WHERE member_id=%s "
                    "AND is_primary=TRUE AND expiry_date IS NULL",
                    (member_id,),
                ).fetchone()[0]
                == 1
            )
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM annual_growth_plan WHERE member_id=%s",
                (member_b,),
            ).fetchone()[0]
            == 1
        )

    def _setup_member_b(
        self, review_schema: psycopg.Connection
    ) -> tuple[int, int, int]:
        member_id = create_user(review_schema, "rv-member-b", "RV Member B", "secret")
        assign_role(review_schema, member_id, "Member")
        buddy_id = create_user(review_schema, "rv-buddy-b", "RV Buddy B", "secret")
        assign_role(review_schema, buddy_id, "Buddy")
        review_schema.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' WHERE id=%s",
            (member_id,),
        )
        create_buddy_relationship(review_schema, member_id, buddy_id)
        review_schema.commit()
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
                    "plan_month": "2026-05",
                }
            ],
        )
        return member_id, buddy_id, assessment_id

    def test_d_new_buddy_takes_over_pending_review(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-2 D: after a committed switch, the new Buddy closes the same
        pending Review — no duplicates, one plan, reviewed_by_buddy_id set."""
        member_id, _old_buddy, assessment_id = self._setup_pending_review(review_schema)
        new_buddy = self._new_buddy(review_schema, "d")
        self._switch_relationship(review_schema, member_id, new_buddy)
        result = self.approve(
            review_schema, assessment_id, new_buddy, expected_revision=3
        )
        assert result["assessment_status"] == "已归档"
        assert result["plan"]["plan_id"] is not None
        closed = review_schema.execute(
            "SELECT reviewed_by_buddy_id FROM assessment_review "
            "WHERE assessment_id=%s AND status='已闭环'",
            (assessment_id,),
        ).fetchone()
        assert closed is not None and int(closed[0]) == new_buddy
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

    def test_e_old_buddy_cannot_close_after_committed_switch(
        self, review_schema: psycopg.Connection
    ) -> None:
        """P1-2 E: once the switch has committed, the old Buddy is rejected
        with 403 and zero writes — the invariant from test A holds even without
        concurrency."""
        member_id, old_buddy, assessment_id = self._setup_pending_review(review_schema)
        new_buddy = self._new_buddy(review_schema, "e")
        self._switch_relationship(review_schema, member_id, new_buddy)
        with pytest.raises(ReviewError) as excinfo:
            self.approve(review_schema, assessment_id, old_buddy)
        assert excinfo.value.code == "insufficient_permissions"
        # Issue #82+#194: the plan exists from submit-time generation; the
        # rejected review writes nothing new.
        assert (
            review_schema.execute("SELECT COUNT(*) FROM annual_growth_plan").fetchone()[
                0
            ]
            == 1
        )
        status = review_schema.execute(
            "SELECT status FROM assessment WHERE id=%s", (assessment_id,)
        ).fetchone()
        assert status[0] == "待复核"
        assert (
            review_schema.execute(
                "SELECT COUNT(*) FROM assessment_review WHERE status='已闭环'"
            ).fetchone()[0]
            == 0
        )
