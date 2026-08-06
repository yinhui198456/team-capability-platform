import logging
from datetime import date

import psycopg

from .repository import assign_role, create_buddy_relationship, create_user

logger = logging.getLogger(__name__)

# Retired repository-known demo default. Seeding fails closed against it so a
# value that ever appeared in this repository can never be reused as a runtime
# credential. It is hashed-checked here, never logged or returned.
_KNOWN_INSECURE_DEMO_PASSWORDS = frozenset({"123456"})

_DEMO_ACCOUNTS = [
    {
        "username": "admin",
        "full_name": "Admin User",
        "roles": ["Admin", "Leader", "Member"],
        "current_level": "P7",
        "target_level": "P8",
    },
    {
        "username": "leader",
        "full_name": "Leader User",
        "roles": ["Leader", "Member"],
        "current_level": "P6",
        "target_level": "P7",
    },
    {
        "username": "buddy",
        "full_name": "Buddy User",
        "roles": ["Buddy", "Member"],
        "current_level": "P5",
        "target_level": "P6",
    },
    {
        "username": "member",
        "full_name": "Member User",
        "roles": ["Member"],
        "current_level": "P4",
        "target_level": "P5",
    },
    {
        "username": "member2",
        "full_name": "Member Two",
        "roles": ["Member"],
        "current_level": "P5",
        "target_level": "P6",
    },
]

_BUDDY_LINKS = [
    ("member", "buddy"),
    ("member2", "buddy"),
]


def _is_safe_demo_password(demo_password: str | None) -> bool:
    """Fail closed: only a non-blank, non-retired password may seed accounts."""
    if not demo_password or not demo_password.strip():
        return False
    if demo_password in _KNOWN_INSECURE_DEMO_PASSWORDS:
        return False
    return True


def _user_table_empty(connection: psycopg.Connection) -> bool:
    row = connection.execute("SELECT 1 FROM tcp_user LIMIT 1").fetchone()
    return row is None


def seed_demo_accounts(
    connection: psycopg.Connection, demo_password: str | None
) -> None:
    """Seed UAT demo accounts if tcp_user is empty and a password is supplied.

    The password must come from an explicitly supplied environment value
    (settings.demo_seed_password); there is no repository-known default and the
    value is never logged or returned. Missing, blank, or known-insecure values
    fail closed: no accounts are created and a controlled warning is logged.

    This function is idempotent: if any user already exists, it performs no
    inserts or updates. It relies on create_access_schema having already seeded
    the four fixed roles.
    """
    if not _is_safe_demo_password(demo_password):
        logger.warning(
            "demo seeding skipped: DEMO_SEED_PASSWORD is missing, blank, "
            "or a known-insecure value; no demo accounts were created"
        )
        return
    if not _user_table_empty(connection):
        return

    user_ids: dict[str, int] = {}
    for account in _DEMO_ACCOUNTS:
        user_id = create_user(
            connection,
            account["username"],
            account["full_name"],
            demo_password,
        )
        user_ids[account["username"]] = user_id
        for role_code in account["roles"]:
            assign_role(connection, user_id, role_code)
        connection.execute(
            """
            UPDATE tcp_user
            SET current_level = %s, target_level = %s
            WHERE id = %s
            """,
            (account["current_level"], account["target_level"], user_id),
        )

    for member_username, buddy_username in _BUDDY_LINKS:
        create_buddy_relationship(
            connection,
            user_ids[member_username],
            user_ids[buddy_username],
        )


def seed_demo_business_data(connection: psycopg.Connection) -> None:
    """Seed one approved local demo loop when no assessment data exists."""
    existing = connection.execute("SELECT 1 FROM assessment LIMIT 1").fetchone()
    if existing is not None:
        return

    users = {
        row[0]: row[1]
        for row in connection.execute(
            "SELECT username, id FROM tcp_user WHERE username IN ('member', 'buddy')"
        ).fetchall()
    }
    l3 = connection.execute(
        "SELECT code FROM capability_node WHERE node_type = 'L3' ORDER BY code LIMIT 1"
    ).fetchone()
    if l3 is None or set(users) != {"member", "buddy"}:
        return

    from ..assessment.repository import (
        create_assessment_draft,
        get_assessment,
        save_assessment_draft,
        submit_assessment,
        submit_assessment_review,
    )
    from ..assessment.scope import compute_assessment_scope
    from ..planning.repository import (
        create_evidence_draft,
        create_growth_goal,
        create_progress_log,
        generate_plan_items,
        get_capability_profile,
        submit_evidence,
        submit_evidence_review,
        update_learning_task,
    )

    member_id = users["member"]
    buddy_id = users["buddy"]
    year = date.today().year
    with connection.transaction():
        seed_scope = compute_assessment_scope(
            connection,
            member_id=member_id,
            year=year,
            assessment_type="年度",
        )
        created = create_assessment_draft(
            connection,
            member_id,
            year,
            scope_token=str(seed_scope["scope_token"]),
        )
        assessment_id = int(created["id"])
        assessment = get_assessment(connection, assessment_id)
        assert assessment is not None
        details = []
        for detail in assessment["details"]:
            applicable = detail["standard_target_applicable"] is True
            is_demo_gap = detail["l3_code"] == l3[0]
            target = detail["target_level"] if applicable else None
            demo_current = (
                max(1, int(target) - 1)
                if is_demo_gap and target is not None
                else target if applicable else None
            )
            details.append(
                {
                    "l3_code": detail["l3_code"],
                    "l3_node_id": detail.get("l3_node_id"),
                    "current_level": demo_current,
                    "evidence_note": (
                        "本地演示自评" if is_demo_gap else "本地演示已达标项"
                    ),
                    "member_priority": "高" if is_demo_gap else None,
                    "include_in_plan": True if is_demo_gap else None,
                    "plan_quarter": "Q1" if is_demo_gap else None,
                    "plan_month": 3 if is_demo_gap else None,
                }
            )
        save_assessment_draft(
            connection,
            assessment_id,
            member_id,
            details,
            expected_revision=1,
        )
        submit_assessment(connection, assessment_id, member_id, expected_revision=2)
        assessment_review_id = connection.execute(
            "SELECT id FROM assessment_review WHERE assessment_id = %s",
            (assessment_id,),
        ).fetchone()[0]
        submit_assessment_review(
            connection, assessment_review_id, buddy_id, "认可", "演示复核通过"
        )

        gap_id = connection.execute(
            "SELECT id FROM gap WHERE assessment_id = %s", (assessment_id,)
        ).fetchone()[0]
        create_growth_goal(connection, member_id, gap_id)
        plan_item = generate_plan_items(connection, member_id)[0]
        task_id = connection.execute(
            "SELECT id FROM learning_task WHERE plan_item_id = %s",
            (plan_item["id"],),
        ).fetchone()[0]
        # 补齐 UAT Mock 数据的计划预计时长，避免“有计划但时长 0h”的歧义。
        current_month = date.today().month
        connection.execute(
            """
            UPDATE plan_item
            SET estimated_hours = %s, target_month = %s
            WHERE id = %s
            """,
            ("10", current_month, plan_item["id"]),
        )
        connection.execute(
            """
            UPDATE annual_growth_plan
            SET status = '执行中'
            WHERE member_id = %s AND year = %s
            """,
            (member_id, year),
        )
        create_progress_log(
            connection,
            member_id,
            task_id,
            f"{year}-01-15",
            4,
            "本地演示学习记录",
        )
        evidence = create_evidence_draft(
            connection,
            member_id,
            task_id,
            "本地演示 Evidence",
            "https://example.invalid/tcp-demo-evidence",
        )
        submit_evidence(connection, member_id, int(evidence["id"]))
        evidence_review_id = connection.execute(
            "SELECT id FROM evidence_review WHERE evidence_id = %s", (evidence["id"],)
        ).fetchone()[0]
        submit_evidence_review(
            connection,
            evidence_review_id,
            buddy_id,
            "通过",
            "演示 Evidence 通过",
        )
        # 保持任务为进行中，使 UI-01 Member Dashboard 的“当前学习任务”表格有示例数据。
        update_learning_task(
            connection,
            member_id,
            task_id,
            {"status": "进行中"},
        )
        connection.execute(
            "UPDATE learning_task SET actual_hours = %s WHERE id = %s",
            (4, task_id),
        )
        get_capability_profile(connection, member_id, ["Member"], member_id, year)
