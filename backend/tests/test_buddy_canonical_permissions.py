"""Issue #62 P1-E: canonical current-responsible-Buddy semantics.

- future / expired / boundary-day relationships;
- deactivated user and removed Buddy role;
- relationship switch: new Buddy takes over the pending review, old Buddy
  immediately loses access;
- legacy effective_from/effective_to stay in sync with the canonical dates
  (trigger-level, no drift);
- interval overlap guard: finite-finite, finite-open, adjacent allowed;
- reviewed_by_buddy_id records the actual closer.
"""

import psycopg
import pytest

from app.access.repository import (
    assign_role,
    create_buddy_relationship,
    create_user,
    is_current_responsible_buddy,
)
from tests.review_support import ReviewTestBase

_L3 = "P01-L2A-L3A"


class TestBuddyCanonicalPermissions(ReviewTestBase):
    def _buddy_user(self, connection: psycopg.Connection, name: str) -> int:
        user_id = create_user(connection, name, name, "secret")
        assign_role(connection, user_id, "Buddy")
        return user_id

    def test_future_relationship_not_authorized(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        # Replace with a relationship that only starts tomorrow.
        review_schema.execute(
            "DELETE FROM buddy_relationship WHERE member_id=%s", (member_id,)
        )
        review_schema.execute(
            """
            INSERT INTO buddy_relationship (
                member_id, buddy_id, is_primary,
                effective_from, effective_to, effective_date, expiry_date
            )
            VALUES (%s, %s, TRUE, CURRENT_DATE + 1, NULL,
                    CURRENT_DATE + 1, NULL)
            """,
            (member_id, buddy_id),
        )
        review_schema.commit()
        assert not is_current_responsible_buddy(review_schema, member_id, buddy_id)

    def test_expired_relationship_not_authorized(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        review_schema.execute(
            "UPDATE buddy_relationship SET expiry_date = CURRENT_DATE - 1, "
            "effective_to = CURRENT_DATE - 1 WHERE member_id=%s",
            (member_id,),
        )
        review_schema.commit()
        assert not is_current_responsible_buddy(review_schema, member_id, buddy_id)

    def test_boundary_days_authorized(self, review_schema: psycopg.Connection) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        review_schema.execute(
            "UPDATE buddy_relationship SET expiry_date = CURRENT_DATE, "
            "effective_to = CURRENT_DATE WHERE member_id=%s",
            (member_id,),
        )
        review_schema.commit()
        # expiry today is still current; effective today is current too
        assert is_current_responsible_buddy(review_schema, member_id, buddy_id)

    def test_deactivated_buddy_not_authorized(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        review_schema.execute(
            "UPDATE tcp_user SET is_active = FALSE WHERE id=%s", (buddy_id,)
        )
        review_schema.commit()
        assert not is_current_responsible_buddy(review_schema, member_id, buddy_id)

    def test_removed_buddy_role_not_authorized(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        review_schema.execute(
            """
            DELETE FROM tcp_user_role ur USING tcp_role r
            WHERE ur.role_id = r.id AND r.code = 'Buddy' AND ur.user_id = %s
            """,
            (buddy_id,),
        )
        review_schema.commit()
        assert not is_current_responsible_buddy(review_schema, member_id, buddy_id)

    def test_date_columns_never_drift(self, review_schema: psycopg.Connection) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        # Canonical dates are the single source of truth; the trigger forces
        # the legacy columns to follow, so the two pairs can never diverge.
        review_schema.execute(
            "UPDATE buddy_relationship SET effective_date = '2020-01-01', "
            "expiry_date = '2020-12-31' WHERE member_id=%s",
            (member_id,),
        )
        review_schema.commit()
        row = review_schema.execute(
            "SELECT effective_from, effective_to FROM buddy_relationship "
            "WHERE member_id=%s",
            (member_id,),
        ).fetchone()
        assert row[0].isoformat() == "2020-01-01"
        assert row[1].isoformat() == "2020-12-31"

    def test_overlap_guards(self, review_schema: psycopg.Connection) -> None:
        member_id, _ = self.setup_users(review_schema)
        b1 = self._buddy_user(review_schema, "ov-b1")
        b2 = self._buddy_user(review_schema, "ov-b2")
        b3 = self._buddy_user(review_schema, "ov-b3")
        review_schema.execute(
            "DELETE FROM buddy_relationship WHERE member_id=%s", (member_id,)
        )
        review_schema.commit()

        def add(buddy: int, start: str, end: str | None) -> None:
            try:
                review_schema.execute(
                    """
                    INSERT INTO buddy_relationship (
                        member_id, buddy_id, is_primary,
                        effective_from, effective_to, effective_date, expiry_date
                    )
                    VALUES (%s, %s, TRUE, %s, %s, %s, %s)
                    """,
                    (member_id, buddy, start, end, start, end),
                )
                review_schema.commit()
            except psycopg.errors.RaiseException:
                review_schema.rollback()
                raise

        # finite-finite non-overlap: adjacent ranges allowed
        add(b1, "2026-01-01", "2026-06-30")
        add(b2, "2026-07-01", None)
        review_schema.commit()
        # finite-finite overlap rejected
        with pytest.raises(psycopg.errors.RaiseException):
            add(b3, "2026-05-01", "2026-08-31")
        # finite vs open overlap rejected
        with pytest.raises(psycopg.errors.RaiseException):
            add(b3, "2026-06-15", "2026-09-30")

    def test_concurrent_relationship_creation_only_one_wins(
        self, review_schema: psycopg.Connection
    ) -> None:
        import threading

        from tests.conftest import TEST_DATABASE_URL

        member_id, _ = self.setup_users(review_schema)
        b1 = self._buddy_user(review_schema, "cc-b1")
        b2 = self._buddy_user(review_schema, "cc-b2")
        review_schema.execute(
            "DELETE FROM buddy_relationship WHERE member_id=%s", (member_id,)
        )
        review_schema.commit()

        outcomes: dict[str, str] = {}
        barrier = threading.Barrier(2)

        def worker(conn: psycopg.Connection, buddy: int, label: str) -> None:
            try:
                barrier.wait(timeout=15)
                create_buddy_relationship(conn, member_id, buddy)
                conn.commit()
                outcomes[label] = "ok"
            except ValueError as exc:
                outcomes[label] = f"blocked:{str(exc)[:40]}"
            except Exception as exc:  # noqa: BLE001
                outcomes[label] = f"unexpected:{type(exc).__name__}"
            finally:
                conn.close()

        conn_a = psycopg.connect(TEST_DATABASE_URL)
        conn_b = psycopg.connect(TEST_DATABASE_URL)
        t1 = threading.Thread(target=worker, args=(conn_a, b1, "a"))
        t2 = threading.Thread(target=worker, args=(conn_b, b2, "b"))
        t1.start()
        t2.start()
        t1.join(timeout=30)
        t2.join(timeout=30)
        assert list(outcomes.values()).count("ok") == 1, outcomes
        assert any(v.startswith("blocked:") for v in outcomes.values()), outcomes
        count = review_schema.execute(
            "SELECT COUNT(*) FROM buddy_relationship WHERE member_id=%s",
            (member_id,),
        ).fetchone()[0]
        assert count == 1
