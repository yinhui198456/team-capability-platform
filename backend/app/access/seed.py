from datetime import date

import psycopg

from .repository import assign_role, create_buddy_relationship, create_user

# Local UAT default password. This is strictly seed data for local UAT and is
# not a production authentication design. The password is hashed before storage
# and is never logged or returned by any API.
_DEFAULT_DEMO_PASSWORD = "123456"

_DEMO_ACCOUNTS = [
    {
        "username": "admin",
        "full_name": "Admin User",
        "roles": ["Admin", "Leader", "Member"],
    },
    {
        "username": "leader",
        "full_name": "Leader User",
        "roles": ["Leader", "Member"],
    },
    {
        "username": "buddy",
        "full_name": "Buddy User",
        "roles": ["Buddy", "Member"],
    },
    {
        "username": "member",
        "full_name": "Member User",
        "roles": ["Member"],
    },
    {
        "username": "member2",
        "full_name": "Member Two",
        "roles": ["Member"],
    },
]

_BUDDY_LINKS = [
    ("member", "buddy"),
    ("member2", "buddy"),
]


def _user_table_empty(connection: psycopg.Connection) -> bool:
    row = connection.execute("SELECT 1 FROM tcp_user LIMIT 1").fetchone()
    return row is None


def seed_demo_accounts(connection: psycopg.Connection) -> None:
    """Seed UAT demo accounts if tcp_user is empty.

    This function is idempotent: if any user already exists, it performs no
    inserts or updates. It relies on create_access_schema having already seeded
    the four fixed roles.
    """
    if not _user_table_empty(connection):
        return

    user_ids: dict[str, int] = {}
    for account in _DEMO_ACCOUNTS:
        user_id = create_user(
            connection,
            account["username"],
            account["full_name"],
            _DEFAULT_DEMO_PASSWORD,
        )
        user_ids[account["username"]] = user_id
        for role_code in account["roles"]:
            assign_role(connection, user_id, role_code)

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
        save_assessment_draft,
        submit_assessment,
        submit_assessment_review,
        update_gap,
    )
    from ..planning.repository import (
        create_evidence_draft,
        create_growth_goal,
        create_learning_task,
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
        assessment_id = create_assessment_draft(connection, member_id, year)
        save_assessment_draft(
            connection,
            assessment_id,
            member_id,
            [
                {
                    "l3_code": l3[0],
                    "current_level": 2,
                    "target_level": 3,
                    "evidence_note": "本地演示自评",
                    "plan_candidate": True,
                }
            ],
        )
        submit_assessment(connection, assessment_id, member_id)
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
        update_gap(connection, gap_id, member_id, "高", True)
        create_growth_goal(connection, member_id, gap_id)
        plan_item = generate_plan_items(connection, member_id)[0]
        task = create_learning_task(connection, member_id, int(plan_item["id"]))
        task_id = int(task["id"])
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
            {"status": "进行中", "actual_hours": 4, "review_conclusion": None},
        )
        get_capability_profile(connection, member_id, ["Member"], member_id, year)
