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
from app.assessment.repository import ReviewError
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

    def test_relationship_switch_takeover(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        new_buddy = self._buddy_user(review_schema, "new-buddy")
        review_schema.commit()
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        # switch: old relationship expires, new buddy takes over
        review_schema.execute(
            "UPDATE buddy_relationship SET expiry_date = CURRENT_DATE - 1, "
            "effective_to = CURRENT_DATE - 1 WHERE member_id=%s",
            (member_id,),
        )
        create_buddy_relationship(review_schema, member_id, new_buddy)
        review_schema.commit()

        # new buddy can approve; old buddy is rejected
        result = self.approve(review_schema, assessment_id, new_buddy)
        assert result["assessment_status"] == "已归档"
        with pytest.raises(ReviewError) as excinfo:
            # create a fresh review round for the old buddy attempt
            review_schema.execute("ROLLBACK")
            old_review = review_schema.execute(
                "SELECT id FROM assessment_review WHERE assessment_id=%s",
                (assessment_id,),
            ).fetchone()
            from app.assessment.repository import submit_assessment_review

            submit_assessment_review(
                review_schema,
                int(old_review[0]),
                buddy_id,
                "认可",
                "x",
                expected_revision=99,
                assessment_id_from_url=assessment_id,
            )
        assert excinfo.value.status_code in (403, 409)

    def test_reviewed_by_buddy_records_actual_closer(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        new_buddy = self._buddy_user(review_schema, "taker-buddy")
        review_schema.commit()
        self.ensure_nodes(review_schema, [_L3])
        assessment_id = self.submit(
            review_schema, member_id, 2026, [{"l3_code": _L3, "target_level": 3}]
        )
        review_schema.execute(
            "UPDATE buddy_relationship SET expiry_date = CURRENT_DATE - 1, "
            "effective_to = CURRENT_DATE - 1 WHERE member_id=%s",
            (member_id,),
        )
        create_buddy_relationship(review_schema, member_id, new_buddy)
        review_schema.commit()
        self.approve(review_schema, assessment_id, new_buddy)
        row = review_schema.execute(
            "SELECT buddy_id, reviewed_by_buddy_id FROM assessment_review "
            "WHERE assessment_id=%s",
            (assessment_id,),
        ).fetchone()
        # assignment-time snapshot stays the original buddy; actual closer is
        # the new buddy
        assert row[0] == buddy_id
        assert row[1] == new_buddy

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


# ── P1-3: the Buddy Review workspace endpoint is Buddy-exclusive ─────────────
# The workspace GET requires Buddy role + canonical current-responsible
# relationship; Member/Leader/Admin, old buddies, future/expired relationships,
# deactivated users and removed roles all get 403.  Generic reads stay on the
# generic endpoints.


def _login(connection: psycopg.Connection, username: str) -> dict[str, str]:
    from tests.test_assessment_review import _login as login

    return login(connection, username)


def _request(
    method: str,
    path: str,
    body: dict[str, object] | None = None,
    cookies: dict[str, str] | None = None,
) -> tuple[int, object]:
    from tests.test_assessment_review import _request as request

    status, parsed, _headers = request(method, path, body, cookies)
    return status, parsed


class TestBuddyWorkspacePermissions(ReviewTestBase):
    def _extra_users(self, connection: psycopg.Connection) -> dict[str, int]:
        users = {}
        for name, roles in (
            ("ws-member", ["Member"]),
            ("ws-leader", ["Leader"]),
            ("ws-admin", ["Admin"]),
            ("ws-buddy2", ["Buddy"]),
        ):
            user_id = create_user(connection, name, name, "secret")
            for role_code in roles:
                assign_role(connection, user_id, role_code)
            users[name] = user_id
        connection.execute(
            "UPDATE tcp_user SET current_level='P4', target_level='P5' "
            "WHERE username IN ('ws-member', 'rv-member')"
        )
        connection.commit()
        return users

    def _pending_assessment(
        self, connection: psycopg.Connection, member_name: str
    ) -> int:
        self.ensure_nodes(connection, [_L3])
        return self.submit(
            connection,
            connection.execute(
                "SELECT id FROM tcp_user WHERE username=%s", (member_name,)
            ).fetchone()[0],
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

    def test_workspace_200_for_current_buddy_403_for_others(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self._extra_users(review_schema)
        assessment_id = self._pending_assessment(review_schema, "rv-member")
        buddy_cookies = _login(review_schema, "rv-buddy")
        status, body = _request(
            "GET",
            f"/api/assessments/{assessment_id}/buddy-review",
            cookies=buddy_cookies,
        )
        assert status == 200, body
        assert body is not None and "summary" in body
        # Member / Leader / Admin / unrelated Buddy → 403.
        for username in ("ws-member", "ws-leader", "ws-admin", "ws-buddy2"):
            cookies = _login(review_schema, username)
            status, body = _request(
                "GET",
                f"/api/assessments/{assessment_id}/buddy-review",
                cookies=cookies,
            )
            assert status == 403, (username, status, body)

    def test_workspace_403_for_old_future_expired_deactivated_role_removed(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        self._extra_users(review_schema)
        assessment_id = self._pending_assessment(review_schema, "rv-member")
        buddy_cookies = _login(review_schema, "rv-buddy")
        assert (
            _request(
                "GET",
                f"/api/assessments/{assessment_id}/buddy-review",
                cookies=buddy_cookies,
            )[0]
            == 200
        )
        cases = {
            "expired": (
                "UPDATE buddy_relationship SET expiry_date=CURRENT_DATE-1, "
                "effective_to=CURRENT_DATE-1 WHERE member_id=%s",
                (member_id,),
            ),
            "future": (
                "UPDATE buddy_relationship SET effective_date=CURRENT_DATE+1, "
                "expiry_date=CURRENT_DATE+1, effective_from=CURRENT_DATE+1, "
                "effective_to=CURRENT_DATE+1 WHERE member_id=%s",
                (member_id,),
            ),
        }
        for label, (sql, params) in cases.items():
            review_schema.execute(sql, params)
            review_schema.commit()
            status, body = _request(
                "GET",
                f"/api/assessments/{assessment_id}/buddy-review",
                cookies=buddy_cookies,
            )
            assert status == 403, (label, status, body)
            review_schema.execute(
                "UPDATE buddy_relationship SET expiry_date=NULL, effective_to=NULL, "
                "effective_date=CURRENT_DATE, effective_from=CURRENT_DATE "
                "WHERE member_id=%s",
                (member_id,),
            )
            review_schema.commit()
        # deactivated user
        review_schema.execute(
            "UPDATE tcp_user SET is_active=FALSE WHERE id=%s", (buddy_id,)
        )
        review_schema.commit()
        status, _body = _request(
            "GET",
            f"/api/assessments/{assessment_id}/buddy-review",
            cookies=buddy_cookies,
        )
        # A deactivated user cannot authenticate its session at all (401);
        # either way the Buddy workspace is unreachable.
        assert status in (401, 403)
        review_schema.execute(
            "UPDATE tcp_user SET is_active=TRUE WHERE id=%s", (buddy_id,)
        )
        review_schema.commit()
        # removed Buddy role
        review_schema.execute(
            "DELETE FROM tcp_user_role ur USING tcp_role r "
            "WHERE ur.role_id=r.id AND r.code='Buddy' AND ur.user_id=%s",
            (buddy_id,),
        )
        review_schema.commit()
        status, _body = _request(
            "GET",
            f"/api/assessments/{assessment_id}/buddy-review",
            cookies=buddy_cookies,
        )
        assert status == 403

    def test_workspace_403_for_old_buddy_after_switch(
        self, review_schema: psycopg.Connection
    ) -> None:
        member_id, buddy_id = self.setup_users(review_schema)
        users = self._extra_users(review_schema)
        assessment_id = self._pending_assessment(review_schema, "rv-member")
        # Switch to the new buddy (end the old one first).
        review_schema.execute(
            "UPDATE buddy_relationship SET expiry_date=CURRENT_DATE-1, "
            "effective_to=CURRENT_DATE-1 WHERE member_id=%s",
            (member_id,),
        )
        create_buddy_relationship(review_schema, member_id, users["ws-buddy2"])
        review_schema.commit()
        old_cookies = _login(review_schema, "rv-buddy")
        status, _body = _request(
            "GET",
            f"/api/assessments/{assessment_id}/buddy-review",
            cookies=old_cookies,
        )
        assert status == 403
        new_cookies = _login(review_schema, "ws-buddy2")
        status, body = _request(
            "GET",
            f"/api/assessments/{assessment_id}/buddy-review",
            cookies=new_cookies,
        )
        assert status == 200, body

    def test_pending_list_requires_buddy_role_at_repository_level(
        self, review_schema: psycopg.Connection
    ) -> None:
        """The pending-list SQL itself uses the same canonical semantics
        including the Buddy role (P1-3)."""
        from app.assessment.repository import get_pending_reviews_for_buddy

        member_id, buddy_id = self.setup_users(review_schema)
        self._pending_assessment(review_schema, "rv-member")
        assert len(get_pending_reviews_for_buddy(review_schema, buddy_id)) == 1
        review_schema.execute(
            "DELETE FROM tcp_user_role ur USING tcp_role r "
            "WHERE ur.role_id=r.id AND r.code='Buddy' AND ur.user_id=%s",
            (buddy_id,),
        )
        review_schema.commit()
        assert get_pending_reviews_for_buddy(review_schema, buddy_id) == []
        # deactivated buddy also loses the pending list
        review_schema.execute(
            "INSERT INTO tcp_user_role (user_id, role_id) "
            "SELECT %s, r.id FROM tcp_role r WHERE r.code='Buddy'",
            (buddy_id,),
        )
        review_schema.execute(
            "UPDATE tcp_user SET is_active=FALSE WHERE id=%s", (buddy_id,)
        )
        review_schema.commit()
        assert get_pending_reviews_for_buddy(review_schema, buddy_id) == []

    def test_admin_generic_read_still_available(
        self, review_schema: psycopg.Connection
    ) -> None:
        """Admin/Leader keep the generic read endpoints; only the
        Buddy-exclusive workspace is restricted."""
        member_id, buddy_id = self.setup_users(review_schema)
        self._extra_users(review_schema)
        assessment_id = self._pending_assessment(review_schema, "rv-member")
        for username in ("ws-admin", "ws-leader"):
            cookies = _login(review_schema, username)
            status, body = _request(
                "GET", f"/api/assessments/{assessment_id}", cookies=cookies
            )
            assert status == 200, (username, status, body)
            status, _body = _request(
                "GET", f"/api/assessments/{assessment_id}/history", cookies=cookies
            )
            assert status == 200, (username, status)
