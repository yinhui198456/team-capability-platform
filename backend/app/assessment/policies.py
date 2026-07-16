import psycopg

from ..access.repository import is_member_assigned_to_buddy


def can_member_view(user: dict[str, object], assessment: dict[str, object]) -> bool:
    return user["id"] == assessment["member_id"]


def can_member_edit(user: dict[str, object], assessment: dict[str, object]) -> bool:
    # ponytail: status validation (draft or needs-adjustment) lives in repository.
    return user["id"] == assessment["member_id"]


def can_buddy_view(
    connection: psycopg.Connection,
    user: dict[str, object],
    assessment: dict[str, object],
) -> bool:
    return is_member_assigned_to_buddy(
        connection, int(assessment["member_id"]), int(user["id"])
    )


def can_buddy_review(
    connection: psycopg.Connection,
    user: dict[str, object],
    assessment: dict[str, object],
) -> bool:
    if "Buddy" not in user["roles"]:
        return False
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


def can_member_update_gap(
    connection: psycopg.Connection,
    user: dict[str, object],
    gap: dict[str, object],
) -> bool:
    assessment = {
        "id": gap["assessment_id"],
        "member_id": gap["member_id"],
    }
    return can_member_edit(user, assessment)


def can_view_gap(
    connection: psycopg.Connection,
    user: dict[str, object],
    gap: dict[str, object],
) -> bool:
    assessment = {
        "id": gap["assessment_id"],
        "member_id": gap["member_id"],
    }
    return can_view_assessment(connection, user, assessment)
