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

    result = generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])

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
        generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])
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
            review_schema, assessment_id, [L3_A, L3_B, L3_C]
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

    result = generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])

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
        generate_plan_items_for_selection(review_schema, assessment_id, [L3_A, L3_B])
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

    first = generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])
    assert first["created_items"] == 1

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

    # Repeat the same selection: all skipped, nothing duplicated.
    repeat = generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])
    assert repeat["created_items"] == 0
    assert repeat["skipped_items"] == 1
    assert repeat["created_tasks"] == 0

    # Incremental addition of another L3 only adds that one.
    grow = generate_plan_items_for_selection(review_schema, assessment_id, [L3_A, L3_B])
    assert grow["created_items"] == 1
    assert grow["created_tasks"] == 1

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
        generate_plan_items_for_selection(review_schema, assessment_id, [L3_A])
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
