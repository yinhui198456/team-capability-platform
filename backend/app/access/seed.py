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
