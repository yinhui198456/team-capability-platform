"""
Issue #178: Incremental learning-task generation from selected L3 rows.

Member selects one or more filled applicable L3s (current_level 0-5, 0
included) on the assessment/Gap page and generates or reuses the annual
plan learning tasks for exactly those rows.  Other unselected rows with
current_level=NULL must not block.  The batch is atomic and idempotent,
creates no Assessment Review, and never mutates historical reviews.

These tests are RED on the pre-#178 code: the entry point
``generate_plan_items_for_selection`` does not exist there.
"""

import psycopg

from app.assessment.repository import AssessmentValidationError

# l3 codes / node ids used in the raw-SQL drafts below.
L3_A = "P01-01-01"
L3_B = "P01-01-02"
L3_C = "P01-01-03"


def _create_draft(
    connection: psycopg.Connection,
    username: str,
    *,
    details: list[tuple[str, object | None, object | None, object | None]],
) -> tuple[int, int]:
    """Raw draft: member + assessment (草稿) + details.

    detail tuple: (l3_code, current_level, target_level, gap_value)
    current_level None = 未填写 (the blocking case in the old flow).
    """
    member = connection.execute(
        "INSERT INTO tcp_user (username, full_name, password_hash, "
        "current_level, target_level) VALUES (%s, %s, 'dummy_hash', 'P5', 'P6') "
        "RETURNING id",
        (username, username),
    ).fetchone()
    member_id = member[0]
    version_row = connection.execute(
        "SELECT id FROM capability_standard_version WHERE status='已发布' "
        "ORDER BY id LIMIT 1"
    ).fetchone()
    assert version_row is not None
    version_id = version_row[0]
    assessment = connection.execute(
        """
        INSERT INTO assessment (
            member_id, year, version, assessment_type, status, revision,
            member_current_level_snapshot, member_target_level_snapshot,
            capability_standard_version_id
        )
        VALUES (%s, 2026, 1, '年度', '草稿', 1, 'P5', 'P6', %s)
        RETURNING id
        """,
        (member_id, version_id),
    ).fetchone()
    assessment_id = assessment[0]
    for index, (code, current, target, gap) in enumerate(details, start=1):
        # High fake node ids: the real seeded catalog's L3 node (P01-L2A-L3A)
        # gets a low id captured into v0009's planning snapshots, so 1..N can
        # collide with the fixture's own snapshot inserts.
        l3_node_id = 9000 + index
        connection.execute(
            """
            INSERT INTO assessment_detail (
                assessment_id, l3_code, current_level, target_level, gap_value,
                l3_node_id, scope_type, standard_target_level,
                standard_target_applicable, include_in_plan,
                l1_code, l1_name, l2_code, l2_name, l3_name,
                standard_job_level_snapshot, plan_quarter, plan_month
            )
            VALUES (%s, %s, %s, %s, %s, %s, 'current_required', %s, TRUE, TRUE,
                    'P01', 'P01', 'P01-01', 'P01-01', %s,
                    'P5', 'Q1', 1)
            """,
            (assessment_id, code, current, target, gap, l3_node_id, target, code),
        )
        # Planning snapshot for this detail's node, mirroring v0009's captured
        # rows; the immutable guard is bypassed like test_review_plan_atomic.
        connection.execute("SET session_replication_role = replica")
        connection.execute(
            """
            INSERT INTO capability_standard_planning_snapshot (
                capability_standard_version_id, l3_node_id, l3_code, l3_name,
                source_type, source_hash
            )
            VALUES (%s, %s, %s, %s, 'legacy_catalog_capture_v0009', 'test-hash')
            """,
            (version_id, l3_node_id, code, code),
        )
        connection.execute("SET session_replication_role = origin")
    return member_id, assessment_id


def _plan_ids(connection: psycopg.Connection, member_id: int) -> list[int]:
    rows = connection.execute(
        "SELECT id FROM annual_growth_plan WHERE member_id=%s ORDER BY id",
        (member_id,),
    ).fetchall()
    return [int(row[0]) for row in rows]


def _item_task_counts(
    connection: psycopg.Connection, member_id: int
) -> tuple[int, int]:
    items = connection.execute(
        """
        SELECT COUNT(*) FROM plan_item pi
        JOIN annual_growth_plan p ON p.id = pi.annual_growth_plan_id
        WHERE p.member_id=%s
        """,
        (member_id,),
    ).fetchone()[0]
    tasks = connection.execute(
        """
        SELECT COUNT(*) FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan p ON p.id = pi.annual_growth_plan_id
        WHERE p.member_id=%s
        """,
        (member_id,),
    ).fetchone()[0]
    return int(items), int(tasks)


def test_single_selected_filled_l3_generates_task_and_ignores_unfilled(review_schema):
    """A single applicable L3 with current_level=0 (filled) generates its
    plan item and task; the unselected NULL row does not block, and no
    Assessment Review / status transition happens."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-single",
        details=[
            (L3_A, 0, 2, 2),  # filled, current_level=0 is legal
            (L3_B, None, None, None),  # unselected, unassessed
        ],
    )

    result = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )

    assert result["created_items"] == 1
    assert result["created_tasks"] == 1
    assert result["skipped_items"] == 0

    plans = _plan_ids(review_schema, member_id)
    assert len(plans) == 1
    items, tasks = _item_task_counts(review_schema, member_id)
    assert (items, tasks) == (1, 1)

    item = review_schema.execute(
        "SELECT l3_code, current_level, target_level, status "
        "FROM plan_item WHERE annual_growth_plan_id=%s",
        (plans[0],),
    ).fetchone()
    assert item == (L3_A, 0, 2, "未开始")

    # Draft semantics preserved: status stays 草稿, no Assessment Review.
    status = review_schema.execute(
        "SELECT status FROM assessment WHERE id=%s", (assessment_id,)
    ).fetchone()[0]
    assert status == "草稿"
    reviews = review_schema.execute(
        "SELECT COUNT(*) FROM assessment_review WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    assert int(reviews) == 0

    # Unselected NULL row untouched.
    b_level = review_schema.execute(
        "SELECT current_level FROM assessment_detail "
        "WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, L3_B),
    ).fetchone()[0]
    assert b_level is None


def _set_plan_time(
    connection: psycopg.Connection,
    assessment_id: int,
    l3_code: str,
    quarter: object | None,
    month: object | None,
) -> None:
    connection.execute(
        "UPDATE assessment_detail SET plan_quarter=%s, plan_month=%s "
        "WHERE assessment_id=%s AND l3_code=%s",
        (quarter, month, assessment_id, l3_code),
    )


def test_selection_without_plan_time_rejected_atomically(review_schema):
    """A row filled with only the outcome levels (current_level/target — no
    plan quarter/month ever picked, the #178 partial-save scenario) can never
    generate: explicit generation rejects the batch with per-item plan-time
    issues and zero writes.  No default quarter/month may ever be invented
    (supersedes the pre-correction Q1/1 fallback contract)."""
    from app.planning.atomic_generation import (
        PlanTimeValidationError,
        generate_plan_items_for_selection,
    )

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-nulltime",
        details=[(L3_A, 0, 2, 2)],
    )
    _set_plan_time(review_schema, assessment_id, L3_A, None, None)

    plans_before = _plan_ids(review_schema, member_id)

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A], expected_revision=1
        )
    except PlanTimeValidationError as exc:
        reasons = sorted((issue.reason, issue.l3_code) for issue in exc.issues)
        assert reasons == [
            ("plan_month_required", L3_A),
            ("plan_quarter_required", L3_A),
        ]
        assert {issue.field for issue in exc.issues} == {
            "plan_month",
            "plan_quarter",
        }
    else:
        raise AssertionError("expected PlanTimeValidationError for NULL plan time")

    # Zero writes: no plan, no item, no task; draft untouched.
    assert _plan_ids(review_schema, member_id) == plans_before
    assert _item_task_counts(review_schema, member_id) == (0, 0)
    status = review_schema.execute(
        "SELECT status FROM assessment WHERE id=%s", (assessment_id,)
    ).fetchone()[0]
    assert status == "草稿"


def test_batch_missing_plan_time_lists_every_issue_zero_writes(review_schema):
    """Multi-select batch: any selected row missing plan quarter and/or month
    rejects the WHOLE batch — no partial writes even for complete rows — and
    every missing field across every selected row is listed at once."""
    from app.planning.atomic_generation import (
        PlanTimeValidationError,
        generate_plan_items_for_selection,
    )

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-batchtime",
        details=[
            (L3_A, 1, 3, 2),
            (L3_B, 1, 3, 2),
            (L3_C, 1, 3, 2),
        ],
    )
    _set_plan_time(review_schema, assessment_id, L3_A, "Q2", 5)  # complete
    _set_plan_time(review_schema, assessment_id, L3_B, "Q3", None)  # month missing
    _set_plan_time(review_schema, assessment_id, L3_C, None, 8)  # quarter missing

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A, L3_B, L3_C], expected_revision=1
        )
    except PlanTimeValidationError as exc:
        reasons = sorted((issue.reason, issue.l3_code) for issue in exc.issues)
        assert reasons == [
            ("plan_month_required", L3_B),
            ("plan_quarter_required", L3_C),
        ]
    else:
        raise AssertionError("expected PlanTimeValidationError for missing plan time")

    # Batch atomicity: even the complete row (L3_A) got no write.
    assert _plan_ids(review_schema, member_id) == []
    assert _item_task_counts(review_schema, member_id) == (0, 0)


def test_selection_with_explicit_plan_time_generates_exact_values(review_schema):
    """Explicit plan quarter/month are copied verbatim — never defaulted."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-explicittime",
        details=[(L3_A, 0, 2, 2)],
    )
    _set_plan_time(review_schema, assessment_id, L3_A, "Q2", 5)

    result = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )

    assert result["created_items"] == 1
    item = review_schema.execute(
        "SELECT plan_quarter, plan_month, priority FROM plan_item "
        "WHERE annual_growth_plan_id=%s",
        (_plan_ids(review_schema, member_id)[0],),
    ).fetchone()
    assert item == ("Q2", 5, "中")


def test_submit_path_skips_rows_without_plan_time(review_schema):
    """Rating save / submit decoupled from generation: the Issue #82
    submit-time generation only creates items for rows with explicit plan
    time.  A row saved with include_in_plan=TRUE but no plan quarter/month
    generates nothing (no invented default)."""
    from app.planning.atomic_generation import generate_plan_and_tasks_from_assessment

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-submitnotime",
        details=[(L3_A, 1, 3, 2)],
    )
    _set_plan_time(review_schema, assessment_id, L3_A, None, None)

    result = generate_plan_and_tasks_from_assessment(review_schema, assessment_id)

    assert result["created_items"] == 0
    assert result["created_tasks"] == 0
    # The annual plan shell is part of the submit contract (issue-62-02);
    # the decoupling guarantee is: no items, no learning tasks.
    assert _item_task_counts(review_schema, member_id) == (0, 0)
    items = review_schema.execute(
        "SELECT COUNT(*) FROM plan_item WHERE annual_growth_plan_id=%s",
        (_plan_ids(review_schema, member_id)[0],),
    ).fetchone()[0]
    assert int(items) == 0


def test_batch_atomic_zero_writes_when_any_selected_invalid(review_schema):
    """Multi-select batch: one invalid (unassessed NULL) selected L3 makes
    the whole batch fail with zero writes — no plan, no items, no tasks, no
    gap rows, no review, no revision change."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-batch",
        details=[
            (L3_A, 1, 3, 2),  # valid
            (L3_B, None, None, None),  # invalid: unassessed
        ],
    )

    plans_before = _plan_ids(review_schema, member_id)
    revision_before = review_schema.execute(
        "SELECT revision FROM assessment WHERE id=%s", (assessment_id,)
    ).fetchone()[0]
    gaps_before = review_schema.execute(
        "SELECT COUNT(*) FROM gap WHERE assessment_id=%s", (assessment_id,)
    ).fetchone()[0]

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A, L3_B], expected_revision=1
        )
    except AssessmentValidationError as exc:
        assert exc.l3_code == L3_B
        assert exc.reason == "requires_current_level"
    else:
        raise AssertionError("expected AssessmentValidationError for NULL row")

    assert _plan_ids(review_schema, member_id) == plans_before
    assert _item_task_counts(review_schema, member_id) == (0, 0)
    revision_after = review_schema.execute(
        "SELECT revision FROM assessment WHERE id=%s", (assessment_id,)
    ).fetchone()[0]
    assert revision_after == revision_before
    gaps_after = review_schema.execute(
        "SELECT COUNT(*) FROM gap WHERE assessment_id=%s", (assessment_id,)
    ).fetchone()[0]
    assert gaps_after == gaps_before
    reviews = review_schema.execute(
        "SELECT COUNT(*) FROM assessment_review WHERE assessment_id=%s",
        (assessment_id,),
    ).fetchone()[0]
    assert int(reviews) == 0


def test_repeat_generation_idempotent_preserves_existing_data(review_schema):
    """Same member/year/L3 re-submitted: no duplicate item/task; existing
    learning task logs and evidence are not overwritten."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-idem",
        details=[
            (L3_A, 2, 4, 2),
            (L3_B, 1, 3, 2),
        ],
    )

    first = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )
    assert first["created_items"] == 1
    # A batch that creates items advances the authoritative revision once.
    assert first["revision"] == 2

    plans = _plan_ids(review_schema, member_id)
    task = review_schema.execute(
        """
        SELECT lt.id FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        WHERE pi.annual_growth_plan_id=%s AND lt.l3_code=%s
        """,
        (plans[0], L3_A),
    ).fetchone()
    task_id = int(task[0])

    # Existing log on the reused task must survive re-submission.
    review_schema.execute(
        """
        INSERT INTO learning_progress_log (
            task_id, record_date, actual_hours, note, recorder_id
        )
        VALUES (%s, '2026-03-05', 2, '已有日志', %s)
        """,
        (task_id, member_id),
    )

    # Repeat the same selection: all skipped, nothing duplicated; the
    # existing-only batch keeps the advanced revision.
    repeat = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=2
    )
    assert repeat["created_items"] == 0
    assert repeat["skipped_items"] == 1
    assert repeat["created_tasks"] == 0
    assert repeat["revision"] == 2

    # Incremental addition of another L3 only adds that one.
    grow = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A, L3_B], expected_revision=2
    )
    assert grow["created_items"] == 1
    assert grow["created_tasks"] == 1
    assert grow["revision"] == 3

    assert _item_task_counts(review_schema, member_id) == (2, 2)

    log = review_schema.execute(
        "SELECT record_date, actual_hours, note FROM learning_progress_log "
        "WHERE task_id=%s",
        (task_id,),
    ).fetchone()
    assert (str(log[0]), log[1], log[2]) == ("2026-03-05", 2, "已有日志")


def test_gap_zero_or_non_applicable_selection_rejected(review_schema):
    """Filled rows with gap<=0 or 不适用 cannot be selected into the plan
    (consistent with plan candidate rules); the draft stays fully legal."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-nogap",
        details=[
            (L3_A, 4, 4, 0),  # filled but no positive gap
        ],
    )

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A], expected_revision=1
        )
    except AssessmentValidationError as exc:
        assert exc.reason == "plan_not_applicable"
    else:
        raise AssertionError("expected plan_not_applicable for gap<=0")

    assert _item_task_counts(review_schema, member_id) == (0, 0)

    # Draft stays legal (草稿, NULL rows untouched) — nothing was mutated.
    status = review_schema.execute(
        "SELECT status FROM assessment WHERE id=%s", (assessment_id,)
    ).fetchone()[0]
    assert status == "草稿"
    current = review_schema.execute(
        "SELECT current_level FROM assessment_detail "
        "WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, L3_A),
    ).fetchone()[0]
    assert current == 4


def test_historical_review_stays_readable_after_new_flow(
    review_schema: psycopg.Connection,
) -> None:
    """Legacy closed Assessment Reviews remain read-only compatible: the
    history endpoint keeps serving them after the new flow exists."""
    from app.assessment.repository import get_assessment_reviews
    from tests.review_support import ReviewTestBase

    base = ReviewTestBase()
    member_id, buddy_id = base.setup_users(review_schema)
    l3_code = "P01-L2A-L3A"
    base.ensure_nodes(review_schema, [l3_code])

    legacy = base.submit(
        review_schema,
        member_id,
        2026,
        [{"l3_code": l3_code, "current_level": 3, "target_level": 3}],
    )
    base.approve(review_schema, legacy, buddy_id)

    reviews = get_assessment_reviews(review_schema, legacy)
    assert len(reviews) == 1
    assert reviews[0]["status"] == "已闭环"
    assert reviews[0]["conclusion"] == "认可"


def _bump_revision(connection: psycopg.Connection, assessment_id: int) -> None:
    connection.execute(
        "UPDATE assessment SET revision = revision + 1 WHERE id = %s",
        (assessment_id,),
    )


def _delete_snapshot(
    connection: psycopg.Connection, assessment_id: int, l3_code: str
) -> None:
    node_id = connection.execute(
        "SELECT l3_node_id FROM assessment_detail "
        "WHERE assessment_id=%s AND l3_code=%s",
        (assessment_id, l3_code),
    ).fetchone()[0]
    # Bypass the v0009 immutable guard exactly like _create_draft's inserts.
    connection.execute("SET session_replication_role = replica")
    connection.execute(
        "DELETE FROM capability_standard_planning_snapshot WHERE l3_node_id=%s",
        (node_id,),
    )
    connection.execute("SET session_replication_role = origin")


def test_generate_stale_revision_conflict_zero_writes(review_schema):
    """Optimistic concurrency: a stale expected_revision must fail the whole
    request with a revision-conflict error and zero writes — never a silent
    overwrite and never a 500."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-stale",
        details=[(L3_A, 1, 3, 2)],
    )
    _bump_revision(review_schema, assessment_id)

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A], expected_revision=1
        )
    except ValueError as exc:
        assert str(exc) == "revision conflict"
    else:
        raise AssertionError("expected revision conflict for stale expected_revision")

    assert _plan_ids(review_schema, member_id) == []
    assert _item_task_counts(review_schema, member_id) == (0, 0)


def test_generate_idempotency_key_replay_returns_single_item(review_schema):
    """Same Idempotency-Key + same payload replayed: the stored response is
    returned, exactly one plan item/task exists, and nothing is duplicated."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-key",
        details=[(L3_A, 1, 3, 2)],
    )

    first = generate_plan_items_for_selection(
        review_schema,
        assessment_id,
        [L3_A],
        expected_revision=1,
        idempotency_key="gen-key-1",
    )
    assert first["idempotent_replayed"] is False
    assert first["items"] == [{"l3_code": L3_A, "status": "created"}]

    replay = generate_plan_items_for_selection(
        review_schema,
        assessment_id,
        [L3_A],
        expected_revision=1,
        idempotency_key="gen-key-1",
    )
    assert replay["idempotent_replayed"] is True
    assert replay["items"] == first["items"]

    assert len(_plan_ids(review_schema, member_id)) == 1
    assert _item_task_counts(review_schema, member_id) == (1, 1)


def test_generate_idempotency_key_reused_with_different_payload_rejected(
    review_schema,
):
    """A key already used for a different request is rejected outright; only
    the first request's L3s may have been written."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-keymismatch",
        details=[(L3_A, 1, 3, 2), (L3_B, 1, 3, 2)],
    )

    generate_plan_items_for_selection(
        review_schema,
        assessment_id,
        [L3_A],
        expected_revision=1,
        idempotency_key="gen-key-x",
    )

    try:
        generate_plan_items_for_selection(
            review_schema,
            assessment_id,
            [L3_B],
            expected_revision=1,
            idempotency_key="gen-key-x",
        )
    except ValueError as exc:
        assert str(exc) == "idempotency key reused"
    else:
        raise AssertionError("expected idempotency-key reuse rejection")

    assert _item_task_counts(review_schema, member_id) == (1, 1)


def test_generate_missing_planning_snapshot_rejected_zero_writes(review_schema):
    """A selected L3 with no planning snapshot is a structured, per-L3
    failure — never the false 'already exists' skip of the old contract."""
    from app.planning.atomic_generation import (
        SelectionValidationError,
        generate_plan_items_for_selection,
    )

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-nosnap",
        details=[(L3_A, 1, 3, 2)],
    )
    _delete_snapshot(review_schema, assessment_id, L3_A)

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A], expected_revision=1
        )
    except SelectionValidationError as exc:
        assert len(exc.issues) == 1
        issue = exc.issues[0]
        assert (issue.reason, issue.l3_code, issue.field) == (
            "planning_snapshot_missing",
            L3_A,
            "planning_snapshot",
        )
    else:
        raise AssertionError("expected planning_snapshot_missing failure")

    assert _plan_ids(review_schema, member_id) == []
    assert _item_task_counts(review_schema, member_id) == (0, 0)


def test_generate_mixed_batch_snapshot_missing_zero_writes(review_schema):
    """Multi-select batch with one snapshot-less L3: the WHOLE batch fails
    with zero writes, listing the missing snapshot for exactly that L3."""
    from app.planning.atomic_generation import (
        SelectionValidationError,
        generate_plan_items_for_selection,
    )

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-mixsnap",
        details=[(L3_A, 1, 3, 2), (L3_B, 1, 3, 2)],
    )
    _delete_snapshot(review_schema, assessment_id, L3_B)

    try:
        generate_plan_items_for_selection(
            review_schema, assessment_id, [L3_A, L3_B], expected_revision=1
        )
    except SelectionValidationError as exc:
        issues = [(issue.reason, issue.l3_code) for issue in exc.issues]
        assert issues == [("planning_snapshot_missing", L3_B)]
    else:
        raise AssertionError("expected planning_snapshot_missing failure")

    # Batch atomicity: even the valid L3_A got no write.
    assert _plan_ids(review_schema, member_id) == []
    assert _item_task_counts(review_schema, member_id) == (0, 0)


def test_generate_success_reports_per_l3_status_revision_and_summary(review_schema):
    """A successful response distinguishes every selected L3 (created vs
    existing) and carries the latest revision plus a human summary."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-perl3",
        details=[(L3_A, 1, 3, 2), (L3_B, 2, 4, 2)],
    )

    first = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A, L3_B], expected_revision=1
    )
    assert first["revision"] == 2
    assert sorted(first["items"], key=lambda i: i["l3_code"]) == [
        {"l3_code": L3_A, "status": "created"},
        {"l3_code": L3_B, "status": "created"},
    ]
    assert first["created_items"] == 2
    assert first["skipped_items"] == 0
    assert first["created_tasks"] == 2
    assert first["summary"]

    # Repeat: every L3 truthfully reported as existing, counts intact; the
    # existing-only batch performs no effective write, so the revision that
    # the first generation advanced is preserved.
    repeat = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A, L3_B], expected_revision=2
    )
    assert repeat["revision"] == 2
    assert sorted(repeat["items"], key=lambda i: i["l3_code"]) == [
        {"l3_code": L3_A, "status": "existing"},
        {"l3_code": L3_B, "status": "existing"},
    ]
    assert repeat["created_items"] == 0
    assert repeat["skipped_items"] == 2
    assert _item_task_counts(review_schema, member_id) == (2, 2)


def test_generate_concurrent_same_key_creates_exactly_one_item(review_schema):
    """Two concurrent requests with the SAME idempotency key on fresh
    connections: exactly one plan item + task is created, one request
    replays the stored response — no duplicates, no errors."""
    import threading

    import psycopg as psycopg_mod

    from app.planning.atomic_generation import generate_plan_items_for_selection
    from tests.conftest import TEST_DATABASE_URL

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-conc",
        details=[(L3_A, 1, 3, 2)],
    )
    review_schema.commit()

    results: list[dict] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        try:
            conn = psycopg_mod.connect(TEST_DATABASE_URL)
            try:
                barrier.wait(timeout=10)
                results.append(
                    generate_plan_items_for_selection(
                        conn,
                        assessment_id,
                        [L3_A],
                        expected_revision=1,
                        idempotency_key="conc-key-1",
                    )
                )
            finally:
                conn.close()
        except BaseException as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == []
    assert all(not thread.is_alive() for thread in threads)
    assert len(results) == 2
    assert len([r for r in results if r["idempotent_replayed"]]) == 1
    assert len([r for r in results if not r["idempotent_replayed"]]) == 1

    assert len(_plan_ids(review_schema, member_id)) == 1
    assert _item_task_counts(review_schema, member_id) == (1, 1)


def test_generate_concurrent_distinct_requests_reuse_single_item(review_schema):
    """Two concurrent requests WITHOUT a key for the same L3: the row lock
    serializes them — the winner creates and advances the revision, the
    loser's stale expected_revision is rejected (409-style conflict, no 500);
    a retry with the latest revision reuses the single item (create-or-reuse
    stays concurrency-safe)."""
    import threading

    import psycopg as psycopg_mod

    from app.planning.atomic_generation import generate_plan_items_for_selection
    from tests.conftest import TEST_DATABASE_URL

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-conc2",
        details=[(L3_A, 1, 3, 2)],
    )
    review_schema.commit()

    results: list[dict] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        try:
            conn = psycopg_mod.connect(TEST_DATABASE_URL)
            try:
                barrier.wait(timeout=10)
                results.append(
                    generate_plan_items_for_selection(
                        conn, assessment_id, [L3_A], expected_revision=1
                    )
                )
            finally:
                conn.close()
        except BaseException as exc:  # pragma: no cover - failure path
            errors.append(exc)

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert all(not thread.is_alive() for thread in threads)
    # Exactly one request applied: it created the item and advanced revision.
    assert len(results) == 1
    assert results[0]["items"][0]["status"] == "created"
    assert results[0]["revision"] == 2
    assert len(errors) == 1
    assert str(errors[0]) == "revision conflict"
    assert _item_task_counts(review_schema, member_id) == (1, 1)

    # The loser retries with the latest revision: clean reuse, no extra write.
    retry = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=2
    )
    assert retry["items"] == [{"l3_code": L3_A, "status": "existing"}]
    assert retry["revision"] == 2
    assert _item_task_counts(review_schema, member_id) == (1, 1)


def _assessment_revision(connection: psycopg.Connection, assessment_id: int) -> int:
    row = connection.execute(
        "SELECT revision FROM assessment WHERE id = %s", (assessment_id,)
    ).fetchone()
    assert row is not None
    return int(row[0])


def test_generate_created_batch_advances_revision_once(review_schema):
    """A batch that creates plan items advances the authoritative assessment
    revision exactly once and the response carries the new revision."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-revadv",
        details=[(L3_A, 1, 3, 2), (L3_B, 1, 3, 2)],
    )
    assert _assessment_revision(review_schema, assessment_id) == 1

    first = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )
    assert first["revision"] == 2
    assert _assessment_revision(review_schema, assessment_id) == 2

    second = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_B], expected_revision=2
    )
    assert second["revision"] == 3
    assert _assessment_revision(review_schema, assessment_id) == 3


def test_generate_existing_only_batch_keeps_revision(review_schema):
    """Re-generating an already-existing selection performs no effective
    write, so the revision stays put (repair-noop convention: no effective
    change, no bump)."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-revkeep",
        details=[(L3_A, 1, 3, 2)],
    )

    first = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )
    assert first["created_items"] == 1
    assert first["revision"] == 2

    repeat = generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=2
    )
    assert repeat["created_items"] == 0
    assert repeat["skipped_items"] == 1
    assert repeat["revision"] == 2
    assert _assessment_revision(review_schema, assessment_id) == 2


def test_generate_same_key_replay_keeps_revision(review_schema):
    """Same-key replay returns the stored response with the revision captured
    at apply time and must not advance the revision again."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-revreplay",
        details=[(L3_A, 1, 3, 2)],
    )

    first = generate_plan_items_for_selection(
        review_schema,
        assessment_id,
        [L3_A],
        expected_revision=1,
        idempotency_key="gen-rev-1",
    )
    assert first["revision"] == 2
    assert _assessment_revision(review_schema, assessment_id) == 2

    replay = generate_plan_items_for_selection(
        review_schema,
        assessment_id,
        [L3_A],
        expected_revision=1,
        idempotency_key="gen-rev-1",
    )
    assert replay["idempotent_replayed"] is True
    assert replay["revision"] == 2
    assert _assessment_revision(review_schema, assessment_id) == 2


def test_generate_stale_old_revision_conflicts_after_generation(review_schema):
    """After a generation advanced the revision, a request carrying the
    pre-generation revision (fresh key) is rejected with a conflict and zero
    writes — a stale operation cannot ride the old revision."""
    from app.planning.atomic_generation import generate_plan_items_for_selection

    member_id, assessment_id = _create_draft(
        review_schema,
        "tcp178-revstale",
        details=[(L3_A, 1, 3, 2)],
    )

    generate_plan_items_for_selection(
        review_schema, assessment_id, [L3_A], expected_revision=1
    )
    assert _assessment_revision(review_schema, assessment_id) == 2

    try:
        generate_plan_items_for_selection(
            review_schema,
            assessment_id,
            [L3_A],
            expected_revision=1,
            idempotency_key="gen-rev-stale",
        )
    except ValueError as exc:
        assert str(exc) == "revision conflict"
    else:
        raise AssertionError("expected revision conflict")

    assert _item_task_counts(review_schema, member_id) == (1, 1)
    assert _assessment_revision(review_schema, assessment_id) == 2


def _create_http_draft(
    review_schema: psycopg.Connection, username: str
) -> tuple[int, int, dict[str, str]]:
    """Create member/buddy + assessment + filled draft through the real API.
    Returns (member_id, assessment_id, cookies); draft revision is 2."""
    from app.access.repository import create_buddy_relationship
    from tests.standard_target_support import (
        ensure_capability_nodes,
        standard_target_payload,
    )
    from tests.test_annual_plan_gate import (
        _create_test_user,
        _login,
        _request,
    )

    member_id = _create_test_user(review_schema, username, ["Member"])
    buddy_id = _create_test_user(review_schema, f"{username}-buddy", ["Buddy"])
    create_buddy_relationship(review_schema, member_id, buddy_id)
    # ensure_capability_nodes also backfills fixture users' job-level
    # snapshots (P4/P8) that scope-preview requires.
    ensure_capability_nodes(review_schema, ["P01-L2A-L3A"])
    review_schema.commit()

    cookies = _login(review_schema, username)
    status, preview, _ = _request(
        "GET", "/api/assessments/scope-preview?year=2026", cookies=cookies
    )
    assert status == 200
    status, body, _ = _request(
        "POST",
        "/api/assessments",
        {"year": 2026, "scope_token": preview["scope_token"]},
        cookies=cookies,
    )
    assert status == 200
    assessment_id = body["id"]

    # current_level=0 (filled, legal per #178) keeps the standard-target gap
    # positive so the plan gate accepts include_in_plan on this fixture node.
    desired = [
        {
            "l3_code": "P01-L2A-L3A",
            "current_level": 0,
            "evidence_note": "测试中",
            "member_priority": "高",
            "include_in_plan": True,
            "plan_quarter": "Q2",
            "plan_month": 5,
        }
    ]
    status, body, _ = _request(
        "PUT",
        f"/api/assessments/{assessment_id}/draft",
        {
            "details": standard_target_payload(review_schema, assessment_id, desired),
            "expected_revision": 1,
        },
        cookies=cookies,
    )
    assert status == 200
    return member_id, assessment_id, cookies


def test_http_generate_stale_revision_returns_409_zero_writes(review_schema):
    """HTTP contract: a stale expected_revision yields 409 (never 500) and
    zero writes."""
    from tests.test_annual_plan_gate import _request

    member_id, assessment_id, cookies = _create_http_draft(
        review_schema, "tcp178-http409"
    )

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 1},
        cookies=cookies,
    )
    assert status == 409
    assert body == {"detail": "revision conflict"}

    plans = review_schema.execute(
        "SELECT COUNT(*) FROM annual_growth_plan WHERE member_id=%s",
        (member_id,),
    ).fetchone()[0]
    assert int(plans) == 0


def test_http_generate_missing_snapshot_returns_422_selection_validation(
    review_schema,
):
    """HTTP contract: a snapshot-less L3 yields 422 with a structured per-L3
    issue — never the old silent 'already exists' success."""
    from tests.test_annual_plan_gate import _request

    member_id, assessment_id, cookies = _create_http_draft(
        review_schema, "tcp178-httpnosnap"
    )
    _delete_snapshot(review_schema, assessment_id, "P01-L2A-L3A")
    review_schema.commit()

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
        cookies=cookies,
    )
    assert status == 422
    assert body["detail"]["code"] == "selection_validation_failed"
    issues = body["detail"]["issues"]
    assert any(issue["reason"] == "planning_snapshot_missing" for issue in issues)

    plans = review_schema.execute(
        "SELECT COUNT(*) FROM annual_growth_plan WHERE member_id=%s",
        (member_id,),
    ).fetchone()[0]
    assert int(plans) == 0


def test_http_generate_same_key_replay_returns_stored_response(review_schema):
    """HTTP contract: the Idempotency-Key header is honored — a sequential
    replay returns the stored response with idempotent_replayed=true and
    exactly one item/task."""
    from tests.test_annual_plan_gate import _request

    member_id, assessment_id, cookies = _create_http_draft(
        review_schema, "tcp178-httpkey"
    )

    status, first_body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
        cookies=cookies,
        extra_headers={"idempotency-key": "http-gen-key-1"},
    )
    assert status == 200
    first_gen = first_body["plan_generation"]
    assert first_gen["idempotent_replayed"] is False

    status, replay_body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
        cookies=cookies,
        extra_headers={"idempotency-key": "http-gen-key-1"},
    )
    assert status == 200
    replay_gen = replay_body["plan_generation"]
    assert replay_gen["idempotent_replayed"] is True
    assert replay_gen["items"] == first_gen["items"]

    items = review_schema.execute(
        """
        SELECT COUNT(*) FROM plan_item pi
        JOIN annual_growth_plan p ON p.id = pi.annual_growth_plan_id
        WHERE p.member_id=%s
        """,
        (member_id,),
    ).fetchone()[0]
    assert int(items) == 1


def test_http_generate_concurrent_same_key_no_500_single_item(review_schema):
    """HTTP contract: concurrent same-key requests both return 200 (one
    replay), a single item/task exists, and nothing 500s."""
    import threading

    from tests.test_annual_plan_gate import _request

    member_id, assessment_id, cookies = _create_http_draft(
        review_schema, "tcp178-httpconc"
    )

    statuses: list[int] = []
    replayed: list[bool] = []
    errors: list[BaseException] = []
    barrier = threading.Barrier(2)

    def run() -> None:
        try:
            barrier.wait(timeout=10)
            status, body, _ = _request(
                "POST",
                f"/api/assessments/{assessment_id}/generate-plan-items",
                {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
                cookies=cookies,
                extra_headers={"idempotency-key": "http-gen-conc-1"},
            )
        except BaseException as exc:  # pragma: no cover - failure path
            errors.append(exc)
        else:
            statuses.append(status)
            replayed.append(body["plan_generation"]["idempotent_replayed"])

    threads = [threading.Thread(target=run) for _ in range(2)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(timeout=30)

    assert errors == []
    assert all(not thread.is_alive() for thread in threads)
    assert statuses == [200, 200]
    assert sorted(replayed) == [False, True]

    items = review_schema.execute(
        """
        SELECT COUNT(*) FROM plan_item pi
        JOIN annual_growth_plan p ON p.id = pi.annual_growth_plan_id
        WHERE p.member_id=%s
        """,
        (member_id,),
    ).fetchone()[0]
    tasks = review_schema.execute(
        """
        SELECT COUNT(*) FROM learning_task lt
        JOIN plan_item pi ON pi.id = lt.plan_item_id
        JOIN annual_growth_plan p ON p.id = pi.annual_growth_plan_id
        WHERE p.member_id=%s
        """,
        (member_id,),
    ).fetchone()[0]
    assert (int(items), int(tasks)) == (1, 1)


def test_http_generate_advances_revision_and_latest_state(review_schema):
    """HTTP contract: a generation that creates items advances the assessment
    revision (visible via GET, so the frontend state uses the latest) and a
    same-key replay returns that same revision without advancing again."""
    from tests.test_annual_plan_gate import _request

    member_id, assessment_id, cookies = _create_http_draft(
        review_schema, "tcp178-httprev"
    )
    assert _assessment_revision(review_schema, assessment_id) == 2

    status, body, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
        cookies=cookies,
        extra_headers={"idempotency-key": "http-gen-rev-1"},
    )
    assert status == 200
    assert body["plan_generation"]["revision"] == 3
    assert body["plan_generation"]["idempotent_replayed"] is False
    assert _assessment_revision(review_schema, assessment_id) == 3

    # Frontend refresh reads the latest revision after generation.
    status, draft, _ = _request(
        "GET", f"/api/assessments/{assessment_id}", cookies=cookies
    )
    assert status == 200
    assert draft["revision"] == 3

    # Same-key replay returns the stored revision, no further advance.
    status, replay, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 2},
        cookies=cookies,
        extra_headers={"idempotency-key": "http-gen-rev-1"},
    )
    assert status == 200
    assert replay["plan_generation"]["idempotent_replayed"] is True
    assert replay["plan_generation"]["revision"] == 3
    assert _assessment_revision(review_schema, assessment_id) == 3

    # A stale pre-generation revision is now a real 409 after generation.
    status, stale, _ = _request(
        "POST",
        f"/api/assessments/{assessment_id}/generate-plan-items",
        {"l3_codes": ["P01-L2A-L3A"], "expected_revision": 1},
        cookies=cookies,
    )
    assert status == 409
    assert stale == {"detail": "revision conflict"}
    assert _item_task_counts(review_schema, member_id) == (1, 1)
    assert _assessment_revision(review_schema, assessment_id) == 3
