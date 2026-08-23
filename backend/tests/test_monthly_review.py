"""Issue #64 phase 1 — Monthly Review red tests.

Contract under test (see docs/reference/metric-dictionary.md):

- ``GET /api/planning/monthly-reviews?year=&month=[&member_id=]`` returns a
  summary whose values are exactly recomputable from ``details`` (same
  transaction, one query family), plus Member-written fields, immutable
  history, and the shared meta block (as_of / year / scope).
- ``PUT /api/planning/monthly-reviews?year=&month=`` is Member-owner-only,
  structured-validation-422 / stale-revision-409 / forbidden-403, with zero
  partial writes on any failure (single request-scoped transaction).
- ``actual_hours`` aggregates ONLY non-invalidated learning progress logs;
  ``planned_count`` and state counts use the six plan-item states and
  ``plan_month``; delayed / paused / cancelled are reported separately.
- Read scope: Member self; Buddy only assigned members; Leader team scope;
  Admin never bypasses business isolation (self only).
"""

from typing import Any

import psycopg
import pytest

from tests.test_capability_profile import (
    _build_full_profile,
    _create_test_user,
    _ensure_l3_node,
    _login,
    _request,
)
from tests.test_capability_profile import (
    profile_schema as _initialize_profile_schema,
)

SESSION_COOKIE = "tcp_session"

# Columns copied when cloning a plan item.  planning_source_type and
# source_assessment_detail_id are intentionally NOT copied: the
# plan_item_approval_completeness CHECK and uniq_plan_item_source_detail
# unique index tie them to exactly one approved assessment detail.
_PLAN_ITEM_CLONE_COLUMNS = (
    "annual_growth_plan_id, current_level, target_level, priority, "
    "plan_start_date, plan_end_date, target_month, include_in_plan, "
    "l3_node_id, l1_code, l1_name, l2_code, l2_name, l3_name, scope_type, "
    "standard_target_level, adjusted_target_level, effective_target_level, "
    "standard_job_level_snapshot, member_current_level_snapshot, "
    "member_target_level_snapshot, gap_value, assessment_revision, "
    "source_assessment_id, planning_snapshot_id"
)


@pytest.fixture
def profile_schema(connection: psycopg.Connection) -> psycopg.Connection:
    return _initialize_profile_schema.__wrapped__(connection)


def _member_id(connection: psycopg.Connection, username: str) -> int:
    row = connection.execute(
        "SELECT id FROM tcp_user WHERE username = %s", (username,)
    ).fetchone()
    assert row is not None
    return int(row[0])


def _plan_item_id(connection: psycopg.Connection, member_id: int) -> int:
    row = connection.execute(
        """
        SELECT pi.id
        FROM plan_item pi
        JOIN annual_growth_plan agp ON agp.id = pi.annual_growth_plan_id
        WHERE agp.member_id = %s
        ORDER BY pi.id
        LIMIT 1
        """,
        (member_id,),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _clone_plan_item(
    connection: psycopg.Connection,
    source_plan_item_id: int,
    l3_code: str,
    *,
    status: str,
    estimated_hours: str,
    plan_month: str,
    plan_quarter: str = "Q2",
) -> int:
    """INSERT a second plan item copying the seed row's provenance columns.

    The seed assessment-approved plan item satisfies every plan_item CHECK;
    cloning it keeps the same provenance while overriding month/status.
    """
    row = connection.execute(
        f"""
        INSERT INTO plan_item ({_PLAN_ITEM_CLONE_COLUMNS}, l3_code, status,
                               estimated_hours, plan_month, plan_quarter)
        SELECT {_PLAN_ITEM_CLONE_COLUMNS}, %s, %s, %s, %s, %s
        FROM plan_item
        WHERE id = %s
        RETURNING id
        """,
        (
            l3_code,
            status,
            estimated_hours,
            plan_month,
            plan_quarter,
            source_plan_item_id,
        ),
    ).fetchone()
    assert row is not None
    clone_id = int(row[0])
    # A plan item's status is mirrored by its single learning task.
    connection.execute(
        """
        INSERT INTO learning_task (plan_item_id, l3_code, status)
        VALUES (%s, %s, %s)
        """,
        (clone_id, l3_code, status),
    )
    return clone_id


def _set_plan_item_status(
    connection: psycopg.Connection, plan_item_id: int, status: str
) -> None:
    connection.execute(
        "UPDATE plan_item SET status = %s WHERE id = %s",
        (status, plan_item_id),
    )


def _insert_log(
    connection: psycopg.Connection,
    task_id: int,
    record_date: str,
    actual_hours: int,
    recorder_id: int,
) -> int:
    row = connection.execute(
        """
        INSERT INTO learning_progress_log
            (task_id, record_date, actual_hours, note, recorder_id)
        VALUES (%s, %s, %s, %s, %s)
        RETURNING id
        """,
        (task_id, record_date, actual_hours, "测试日志", recorder_id),
    ).fetchone()
    assert row is not None
    return int(row[0])


def _invalidate_log(connection: psycopg.Connection, log_id: int, by: int) -> None:
    connection.execute(
        """
        UPDATE learning_progress_log
        SET invalidated_at = NOW(), invalidated_by = %s
        WHERE id = %s
        """,
        (by, log_id),
    )


def _get_review(
    connection: psycopg.Connection,
    cookies: dict[str, str],
    year: int = 2026,
    month: int = 5,
    member_id: int | None = None,
) -> tuple[int, dict[str, Any] | None]:
    query = f"year={year}&month={month}"
    if member_id is not None:
        query += f"&member_id={member_id}"
    return _request("GET", f"/api/planning/monthly-reviews?{query}", cookies=cookies)


def _put_review(
    connection: psycopg.Connection,
    cookies: dict[str, str],
    body: dict[str, object],
    year: int = 2026,
    month: int = 5,
) -> tuple[int, dict[str, Any] | None]:
    return _request(
        "PUT",
        f"/api/planning/monthly-reviews?year={year}&month={month}",
        body,
        cookies=cookies,
    )


def test_monthly_review_requires_authentication(profile_schema) -> None:
    status, _, _ = _request("GET", "/api/planning/monthly-reviews?year=2026&month=5")
    assert status == 401


def test_monthly_review_empty_month_returns_zeroed_summary(
    profile_schema: psycopg.Connection,
) -> None:
    _build_full_profile(profile_schema)
    member_cookies = _login(profile_schema, "member_profile")

    status, body, _ = _get_review(profile_schema, member_cookies, month=2)
    assert status == 200
    assert body is not None
    assert body["summary"]["planned_count"] == 0
    assert body["summary"]["completed_count"] == 0
    assert body["summary"]["completion_rate"] == 0
    assert body["summary"]["actual_hours"] == 0
    assert body["written"] is None
    assert body["history"] == []
    assert body["meta"]["year"] == 2026
    assert body["meta"]["scope"] == "本人"


def test_monthly_review_summary_reconciles_with_details(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)
    base_item = _plan_item_id(profile_schema, member_id)

    # Month 5: one 已完成, one 进行中, one 延期, one 暂停, one 取消.
    _set_plan_item_status(profile_schema, base_item, "已完成")
    delayed = _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3B",
        status="延期",
        estimated_hours="12",
        plan_month="2026-05",
    )
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3C",
        status="暂停",
        estimated_hours="8",
        plan_month="2026-05",
    )
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3D",
        status="取消",
        estimated_hours="8",
        plan_month="2026-05",
    )
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3E",
        status="进行中",
        estimated_hours="8",
        plan_month="2026-05",
    )
    for l3_code in ("P01-L2A-L3B", "P01-L2A-L3C", "P01-L2A-L3D", "P01-L2A-L3E"):
        _ensure_l3_node(profile_schema, l3_code)
    # Actual hours: one valid log, one invalidated log (month 5).
    task_row = profile_schema.execute(
        """
        SELECT lt.id FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.id = %s
        """,
        (delayed,),
    ).fetchone()
    assert task_row is not None
    valid_log = _insert_log(
        profile_schema, int(task_row[0]), "2026-05-10", 2, member_id
    )
    _insert_log(profile_schema, int(task_row[0]), "2026-05-12", 3, member_id)
    _invalidate_log(profile_schema, valid_log, member_id)
    profile_schema.commit()

    status, body, _ = _get_review(profile_schema, member_cookies, month=5)
    assert status == 200
    assert body is not None
    summary = body["summary"]
    details = body["details"]

    # Summary values are exactly recomputable from the detail rows.
    assert summary["planned_count"] == len(details) == 5
    assert (
        summary["completed_count"] == sum(d["status"] == "已完成" for d in details) == 1
    )
    assert (
        summary["in_progress_count"]
        == sum(d["status"] == "进行中" for d in details)
        == 1
    )
    assert summary["delayed_count"] == sum(d["status"] == "延期" for d in details) == 1
    assert summary["paused_count"] == sum(d["status"] == "暂停" for d in details) == 1
    assert (
        summary["cancelled_count"] == sum(d["status"] == "取消" for d in details) == 1
    )
    assert summary["completion_rate"] == 1 / 5
    # Only the non-invalidated log counts; the invalidated 2h is excluded.
    assert summary["actual_hours"] == sum(d["actual_hours"] for d in details) == 3

    # Traceable detail identifiers: every detail carries plan_item_id/task_id.
    assert all("plan_item_id" in d and "task_id" in d for d in details)
    assert {d["plan_item_id"] for d in details} >= {base_item, delayed}


def test_monthly_review_details_and_summary_carry_estimated_hours(
    profile_schema: psycopg.Connection,
) -> None:
    """P1-2: details expose the raw estimated hours plus a parseable
    interpretation; the summary estimated-hours block reconciles exactly
    from the detail rows (single value / range / unparsable / null)."""
    member_id, member_cookies = _build_full_profile(profile_schema)
    base_item = _plan_item_id(profile_schema, member_id)
    # Make every plan-item value explicit so the expected parse is exact.
    profile_schema.execute(
        "UPDATE plan_item SET estimated_hours = '10' WHERE id = %s", (base_item,)
    )
    _set_plan_item_status(profile_schema, base_item, "已完成")
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3B",
        status="进行中",
        estimated_hours="6-8",
        plan_month="2026-05",
    )
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3C",
        status="延期",
        estimated_hours="随时",
        plan_month="2026-05",
    )
    _clone_plan_item(
        profile_schema,
        base_item,
        "P01-L2A-L3D",
        status="暂停",
        estimated_hours=None,
        plan_month="2026-05",
    )
    for l3_code in ("P01-L2A-L3B", "P01-L2A-L3C", "P01-L2A-L3D"):
        _ensure_l3_node(profile_schema, l3_code)
    profile_schema.commit()

    status, body, _ = _get_review(profile_schema, member_cookies, month=5)
    assert status == 200
    assert body is not None
    details = body["details"]
    summary = body["summary"]

    # Every detail row carries the raw value and a parseable interpretation.
    for detail in details:
        assert "estimated_hours" in detail, detail
        assert "estimated_hours_parsed" in detail, detail
    by_code = {d["l3_code"]: d for d in details}
    assert by_code["P01-L2A-L3A"]["estimated_hours"] == "10"
    assert by_code["P01-L2A-L3A"]["estimated_hours_parsed"] == {
        "raw": "10",
        "min_hours": 10.0,
        "max_hours": 10.0,
        "is_valid": True,
        "is_range": False,
    }
    assert by_code["P01-L2A-L3B"]["estimated_hours"] == "6-8"
    assert by_code["P01-L2A-L3B"]["estimated_hours_parsed"] == {
        "raw": "6-8",
        "min_hours": 6.0,
        "max_hours": 8.0,
        "is_valid": True,
        "is_range": True,
    }
    assert by_code["P01-L2A-L3C"]["estimated_hours"] == "随时"
    assert by_code["P01-L2A-L3C"]["estimated_hours_parsed"] == {
        "raw": "随时",
        "min_hours": None,
        "max_hours": None,
        "is_valid": False,
        "is_range": False,
    }
    assert by_code["P01-L2A-L3D"]["estimated_hours"] is None
    assert by_code["P01-L2A-L3D"]["estimated_hours_parsed"] == {
        "raw": None,
        "min_hours": None,
        "max_hours": None,
        "is_valid": False,
        "is_range": False,
    }

    # Summary estimated hours are exactly the shared summarize semantics over
    # the detail raw values — no separate aggregation path to drift.
    from app.planning.hours import summarize_estimated_hours

    expected_summary = summarize_estimated_hours(
        [d["estimated_hours"] for d in details]
    )
    assert (
        summary["estimated_hours_summary"]
        == expected_summary
        == {
            "min_hours": 16.0,
            "max_hours": 18.0,
            "has_values": True,
            "has_unparsed": True,
        }
    )

    # An empty month reports the zeroed summary block, not a missing key.
    status, body, _ = _get_review(profile_schema, member_cookies, month=2)
    assert status == 200
    assert body is not None
    assert body["summary"]["estimated_hours_summary"] == {
        "min_hours": 0,
        "max_hours": 0,
        "has_values": False,
        "has_unparsed": False,
    }


def test_monthly_review_details_are_month_scoped(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)
    base_item = _plan_item_id(profile_schema, member_id)
    # A March log exists from the seed (5h); a plan item planned for June must
    # not appear in May's review even though its task carries March logs.
    profile_schema.execute(
        "UPDATE plan_item SET plan_month = '2026-06', plan_quarter = 'Q2' "
        "WHERE id = %s",
        (base_item,),
    )
    profile_schema.commit()

    status, body, _ = _get_review(profile_schema, member_cookies, month=5)
    assert status == 200
    assert body is not None
    assert body["summary"]["planned_count"] == 0
    assert body["details"] == []

    status, body, _ = _get_review(profile_schema, member_cookies, month=6)
    assert status == 200
    assert body is not None
    assert body["summary"]["planned_count"] == 1
    assert body["summary"]["actual_hours"] == 0  # March log is not June hours


def test_monthly_review_write_requires_member_owner(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, _ = _build_full_profile(profile_schema)
    buddy_cookies = _login(profile_schema, "buddy_profile")
    _create_test_user(profile_schema, "review_leader", ["Leader"])
    profile_schema.commit()
    leader_cookies = _login(profile_schema, "review_leader")

    body = {"expected_revision": 0, "main_output": "产出", "notes": "备注"}
    status, _, _ = _put_review(profile_schema, buddy_cookies, body)
    assert status == 403
    status, _, _ = _put_review(profile_schema, leader_cookies, body)
    assert status == 403

    # Nothing was written by the failed attempts.
    row = profile_schema.execute(
        "SELECT COUNT(*) FROM monthly_review WHERE member_id = %s", (member_id,)
    ).fetchone()
    assert row is not None and int(row[0]) == 0


def test_monthly_review_create_and_cas_update_history(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _put_review(
        profile_schema,
        member_cookies,
        {
            "expected_revision": 0,
            "main_output": "完成 RAG POC",
            "problems": "环境搭建耗时",
            "next_month_focus": "接入问数",
            "notes": "备注 v1",
        },
    )
    assert status == 200
    assert body is not None
    assert body["written"]["revision"] == 1
    assert body["written"]["main_output"] == "完成 RAG POC"
    assert body["written"]["problems"] == "环境搭建耗时"
    assert body["written"]["next_month_focus"] == "接入问数"
    assert body["written"]["notes"] == "备注 v1"
    assert len(body["history"]) == 1
    assert body["history"][0]["revision"] == 1

    status, body, _ = _put_review(
        profile_schema,
        member_cookies,
        {
            "expected_revision": 1,
            "main_output": "完成 RAG POC",
            "problems": "环境搭建耗时",
            "next_month_focus": "接入问数与评测",
            "notes": "备注 v2",
        },
    )
    assert status == 200
    assert body is not None
    assert body["written"]["revision"] == 2
    assert body["written"]["next_month_focus"] == "接入问数与评测"
    assert len(body["history"]) == 2
    assert [h["revision"] for h in body["history"]] == [1, 2]
    # Version 1 payload is preserved immutably in history.
    assert body["history"][0]["notes"] == "备注 v1"
    assert body["history"][0]["main_output"] == "完成 RAG POC"

    # DB rows are consistent with the API response.
    history_rows = profile_schema.execute(
        """
        SELECT revision, notes FROM monthly_review_history
        WHERE monthly_review_id = (
            SELECT id FROM monthly_review
            WHERE member_id = %s AND year = 2026 AND month = 5
        )
        ORDER BY revision
        """,
        (member_id,),
    ).fetchall()
    assert [(r[0], r[1]) for r in history_rows] == [(1, "备注 v1"), (2, "备注 v2")]


def test_monthly_review_stale_revision_conflict_zero_write(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)
    _put_review(
        profile_schema,
        member_cookies,
        {"expected_revision": 0, "main_output": "v1", "notes": None},
    )
    _put_review(
        profile_schema,
        member_cookies,
        {"expected_revision": 1, "main_output": "v2", "notes": None},
    )

    status, body, _ = _put_review(
        profile_schema,
        member_cookies,
        {"expected_revision": 1, "main_output": "stale overwrite", "notes": None},
    )
    assert status == 409
    assert body is not None and body["detail"]["code"] == (
        "monthly_review_revision_conflict"
    )

    status, body, _ = _get_review(profile_schema, member_cookies)
    assert status == 200
    assert body is not None
    assert body["written"]["revision"] == 2
    assert body["written"]["main_output"] == "v2"
    assert len(body["history"]) == 2
    history_rows = profile_schema.execute(
        """
        SELECT revision, main_output FROM monthly_review_history
        WHERE monthly_review_id = (
            SELECT id FROM monthly_review
            WHERE member_id = %s AND year = 2026 AND month = 5
        )
        ORDER BY revision
        """,
        (member_id,),
    ).fetchall()
    assert [(r[0], r[1]) for r in history_rows] == [(1, "v1"), (2, "v2")]


def test_monthly_review_validation_422_zero_write(
    profile_schema: psycopg.Connection,
) -> None:
    member_id, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _put_review(
        profile_schema,
        member_cookies,
        {"expected_revision": 0, "main_output": "x" * 3001},
    )
    assert status == 422
    assert body is not None and body["detail"]["code"] == (
        "monthly_review_validation_error"
    )

    status, _, _ = _put_review(
        profile_schema,
        member_cookies,
        {"expected_revision": 0, "main_output": "ok"},
        month=13,
    )
    assert status == 422

    row = profile_schema.execute(
        "SELECT COUNT(*) FROM monthly_review WHERE member_id = %s", (member_id,)
    ).fetchone()
    assert row is not None and int(row[0]) == 0


def test_monthly_review_member_sees_self_only(
    profile_schema: psycopg.Connection,
) -> None:
    member_a_id, member_a_cookies = _build_full_profile(
        profile_schema, "member_a", "buddy_a"
    )
    member_b_id = _create_test_user(profile_schema, "member_b", ["Member"])
    profile_schema.commit()
    member_b_cookies = _login(profile_schema, "member_b")

    _put_review(
        profile_schema,
        member_a_cookies,
        {"expected_revision": 0, "main_output": "A"},
    )

    # B's own month is empty — no data leak from A.
    status, body, _ = _get_review(profile_schema, member_b_cookies)
    assert status == 200
    assert body is not None and body["written"] is None

    # B cannot read A's review through the member_id parameter.
    status, _, _ = _get_review(profile_schema, member_b_cookies, member_id=member_a_id)
    assert status == 403

    # A cannot read B's (empty) month either.
    status, _, _ = _get_review(profile_schema, member_a_cookies, member_id=member_b_id)
    assert status == 403


def test_monthly_review_buddy_scope_assigned_only(
    profile_schema: psycopg.Connection,
) -> None:
    member_a_id, _ = _build_full_profile(profile_schema, "member_a", "buddy_a")
    buddy_a_cookies = _login(profile_schema, "buddy_a")

    status, _, _ = _get_review(profile_schema, buddy_a_cookies, member_id=member_a_id)
    assert status == 200

    _create_test_user(profile_schema, "buddy_x", ["Buddy"])
    profile_schema.commit()
    outsider_cookies = _login(profile_schema, "buddy_x")
    status, _, _ = _get_review(profile_schema, outsider_cookies, member_id=member_a_id)
    assert status == 403


def test_monthly_review_admin_no_bypass(
    profile_schema: psycopg.Connection,
) -> None:
    member_a_id, _ = _build_full_profile(profile_schema, "member_a", "buddy_a")
    admin_id = _create_test_user(profile_schema, "review_admin", ["Admin"])
    profile_schema.commit()
    admin_cookies = _login(profile_schema, "review_admin")

    # Admin is NOT entitled to another member's monthly review.
    status, _, _ = _get_review(profile_schema, admin_cookies, member_id=member_a_id)
    assert status == 403

    # Admin may read their own month (self scope).
    status, _, _ = _get_review(profile_schema, admin_cookies, member_id=admin_id)
    assert status == 200


def test_monthly_review_leader_team_scope(
    profile_schema: psycopg.Connection,
) -> None:
    member_a_id, _ = _build_full_profile(profile_schema, "member_a", "buddy_a")
    _create_test_user(profile_schema, "review_leader2", ["Leader"])
    profile_schema.commit()
    leader_cookies = _login(profile_schema, "review_leader2")

    status, _, _ = _get_review(profile_schema, leader_cookies, member_id=member_a_id)
    assert status == 200


class _CountingCursor:
    def __init__(self, inner: Any, counter: Any) -> None:
        self._inner = inner
        self._count = counter

    def __enter__(self):
        self._inner.__enter__()
        return self

    def __exit__(self, *exc: Any) -> Any:
        return self._inner.__exit__(*exc)

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        self._count()
        return self._inner.execute(*args, **kwargs)

    def __getattr__(self, name: str) -> Any:
        return getattr(self._inner, name)


class _CountingConnection:
    """Read-only query counter: delegates execute()/transaction()/cursor() to
    a real psycopg connection while counting statements (query-count evidence
    for the shared aggregation layer, normal team-sized data)."""

    def __init__(self, inner: psycopg.Connection) -> None:
        self._inner = inner
        self.statement_count = 0

    def _count(self) -> None:
        self.statement_count += 1

    def execute(self, *args: Any, **kwargs: Any) -> Any:
        self._count()
        return self._inner.execute(*args, **kwargs)

    def cursor(self, *args: Any, **kwargs: Any) -> _CountingCursor:
        return _CountingCursor(self._inner.cursor(*args, **kwargs), self._count)

    def transaction(self, *args: Any, **kwargs: Any) -> Any:
        return self._inner.transaction(*args, **kwargs)

    def commit(self) -> None:
        self._inner.commit()


def test_monthly_review_query_count_bounded(
    profile_schema: psycopg.Connection,
) -> None:
    from app.planning.repository import get_monthly_review

    member_id, _ = _build_full_profile(profile_schema)
    profile_schema.commit()

    counted = _CountingConnection(profile_schema)
    result = get_monthly_review(counted, member_id, 2026, 5)
    assert result is not None
    assert counted.statement_count < 30, (
        f"monthly review read issued {counted.statement_count} statements; "
        "shared aggregation must stay bounded for team-sized data"
    )
