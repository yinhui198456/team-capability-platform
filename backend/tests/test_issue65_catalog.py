"""Issue #65 deterministic synthetic data-catalog contract tests.

These tests prove the catalog foundation itself: coverage, uniqueness,
determinism, cross-field invariants and single-team role semantics.
They do NOT execute or pass any Issue #65 business scenario.
"""

import psycopg
import pytest

from tests.issue65_support import (
    ROLE_CODES,
    VALID_LEVELS,
    build_catalog,
    iter_violations,
    materialize_identities,
)
from tests.review_support import reset_full_schema


@pytest.fixture
def catalog():
    return build_catalog()


def test_catalog_has_no_violations(catalog) -> None:
    assert iter_violations(catalog) == []


def test_all_18_dimensions_present_and_covered(catalog) -> None:
    assert [d.number for d in catalog.dimensions] == list(range(1, 19))
    covered = {case.dimension for case in catalog.cases}
    assert covered == set(range(1, 19))


def test_case_ids_unique(catalog) -> None:
    ids = [case.case_id for case in catalog.cases]
    assert len(ids) == len(set(ids))


def test_identity_keys_and_usernames_unique(catalog) -> None:
    keys = [identity.key for identity in catalog.identities]
    usernames = [identity.username for identity in catalog.identities]
    assert len(keys) == len(set(keys))
    assert len(usernames) == len(set(usernames))


def test_deterministic_repeated_construction() -> None:
    first = build_catalog()
    second = build_catalog()
    assert first == second
    assert [c.case_id for c in first.cases] == [c.case_id for c in second.cases]
    assert [i.key for i in first.identities] == [i.key for i in second.identities]


def test_synthetic_identities_only(catalog) -> None:
    for identity in catalog.identities:
        assert identity.username.startswith("i65-")
        assert identity.key.startswith("i65-")


def test_level_transition_cases(catalog) -> None:
    transitions = {
        tuple(dict(case.attributes)[key] for key in ("current_level", "target_level"))
        for case in catalog.cases
        if case.dimension in (1, 2, 3, 4)
    }
    assert transitions == {("P4", "P4"), ("P4", "P5"), ("P4", "P6"), ("P5", "P6")}
    for case in catalog.cases:
        attrs = dict(case.attributes)
        for field in ("current_level", "target_level"):
            value = attrs.get(field)
            if value is not None and attrs.get("level_semantics") != "invalid":
                assert value in VALID_LEVELS
    reversed_cases = [
        case
        for case in catalog.cases
        if case.dimension == 6
        and dict(case.attributes).get("level_semantics") == "reversed"
    ]
    assert reversed_cases, "dimension 6 must include a reversed-level case"
    for case in reversed_cases:
        attrs = dict(case.attributes)
        assert attrs["expected"] == "scope-rejection"


def test_quarter_month_coverage(catalog) -> None:
    quarter_cases = [case for case in catalog.cases if case.dimension == 12]
    assert {dict(case.attributes)["quarter"] for case in quarter_cases} == {
        "Q1",
        "Q2",
        "Q3",
        "Q4",
    }
    months: set[int] = set()
    for case in quarter_cases:
        attrs = dict(case.attributes)
        quarter = int(str(attrs["quarter"])[1])
        case_months = {int(m) for m in str(attrs["months"]).split(",")}
        assert case_months == {(quarter - 1) * 3 + i for i in (1, 2, 3)}
        months |= case_months
    assert months == set(range(1, 13))


def test_priority_labels_exact(catalog) -> None:
    labels = {
        dict(case.attributes)["priority"]
        for case in catalog.cases
        if case.dimension == 10
    }
    assert labels == {"高", "中", "低", "暂缓"}


def test_plan_inclusion_both_choices(catalog) -> None:
    choices = {
        dict(case.attributes)["include_in_plan"]
        for case in catalog.cases
        if case.dimension == 11
    }
    assert choices == {"true", "false"}


def test_single_team_role_semantics(catalog) -> None:
    by_key = {identity.key: identity for identity in catalog.identities}
    for identity in catalog.identities:
        assert identity.roles
        assert set(identity.roles) <= ROLE_CODES
    # Single-team MVP: exactly one Leader and one Admin; Admin read scope
    # declared identical to Leader scope via the dimension-17 case.
    leaders = [i for i in catalog.identities if "Leader" in i.roles]
    admins = [i for i in catalog.identities if "Admin" in i.roles]
    assert len(leaders) == 1
    assert len(admins) == 1
    admin_case = next(
        case
        for case in catalog.cases
        if case.dimension == 17 and "admin" in case.case_id.lower()
    )
    assert dict(admin_case.attributes)["read_scope"] == "same-as-leader"
    # buddy_relationship is a guidance/review assignment, not team membership.
    for assignment in catalog.buddy_assignments:
        member = by_key[assignment.member_key]
        buddy = by_key[assignment.buddy_key]
        assert "Member" in member.roles
        assert "Buddy" in buddy.roles
        assert assignment.member_key != assignment.buddy_key
    boundary_case = next(
        case
        for case in catalog.cases
        if case.dimension == 17 and "unassigned" in case.case_id.lower()
    )
    attrs = dict(boundary_case.attributes)
    assert attrs["expected"] == "denied"
    assert attrs["buddy_relationship_semantics"] == "assignment-not-membership"


def test_concurrency_cases_are_descriptors(catalog) -> None:
    identity_keys = {identity.key for identity in catalog.identities}
    concurrent = [case for case in catalog.cases if case.dimension == 18]
    assert len(concurrent) >= 5
    for case in concurrent:
        attrs = dict(case.attributes)
        # Actors may be the same identity (double-submit / retry replay) or
        # two distinct identities; both must be known catalog identities.
        assert attrs["actor_a"] in identity_keys
        assert attrs["actor_b"] in identity_keys
        assert attrs["descriptor_only"] == "true"


def test_materialize_identities_deterministic(connection: psycopg.Connection) -> None:
    reset_full_schema(connection)
    catalog = build_catalog()
    first = materialize_identities(connection, catalog)
    assert set(first) == {identity.key for identity in catalog.identities}
    rows = connection.execute(
        "SELECT username, current_level, target_level FROM tcp_user "
        "WHERE username LIKE 'i65-%' ORDER BY username"
    ).fetchall()
    assert [row[0] for row in rows] == sorted(
        identity.username for identity in catalog.identities
    )
    by_username = {identity.username: identity for identity in catalog.identities}
    for username, current_level, target_level in rows:
        identity = by_username[username]
        assert current_level == identity.current_level
        assert target_level == identity.target_level
    pair_count = connection.execute(
        """
        SELECT COUNT(*)
        FROM buddy_relationship br
        JOIN tcp_user m ON m.id = br.member_id
        JOIN tcp_user b ON b.id = br.buddy_id
        WHERE m.username LIKE 'i65-%' AND b.username LIKE 'i65-%'
        """
    ).fetchone()
    assert pair_count is not None
    assert pair_count[0] == len(catalog.buddy_assignments)
