import psycopg

from ..access.repository import is_member_assigned_to_buddy


def can_member_view(user: dict[str, object], assessment: dict[str, object]) -> bool:
    return user["id"] == assessment["member_id"]


def can_member_edit(user: dict[str, object], assessment: dict[str, object]) -> bool:
    return user["id"] == assessment["member_id"] and assessment["status"] == "草稿"


def can_buddy_view(
    connection: psycopg.Connection,
    user: dict[str, object],
    assessment: dict[str, object],
) -> bool:
    return is_member_assigned_to_buddy(
        connection, int(assessment["member_id"]), int(user["id"])
    )


def can_leader_view(user: dict[str, object], assessment: dict[str, object]) -> bool:
    return "Leader" in user["roles"]


def can_admin_view(user: dict[str, object], assessment: dict[str, object]) -> bool:
    return "Admin" in user["roles"]


def can_view_assessment(
    connection: psycopg.Connection,
    user: dict[str, object],
    assessment: dict[str, object],
) -> bool:
    if can_admin_view(user, assessment):
        return True
    if can_leader_view(user, assessment):
        return True
    if can_buddy_view(connection, user, assessment):
        return True
    return can_member_view(user, assessment)
