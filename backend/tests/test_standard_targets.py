import pytest

from app.catalog.standard_targets import (
    ResolvedTarget,
    parse_earliest_level,
    resolve_standard_target,
)


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        ("P4", 4),
        ("P4-P5", 4),
        ("P4–P5", 4),
        ("P6—P8", 6),
        (" P7 ", 7),
    ],
)
def test_parse_earliest_level(value: str, expected: int) -> None:
    assert parse_earliest_level(value) == expected


@pytest.mark.parametrize("value", ["", "P3", "P9", "P6-P5", "P4/P5", "P4-x"])
def test_parse_earliest_level_rejects_invalid_ranges(value: str) -> None:
    with pytest.raises(ValueError, match="invalid recommended_start_level"):
        parse_earliest_level(value)


@pytest.mark.parametrize(
    ("member_level", "expected"),
    [
        ("P4", 2),
        ("P5", 3),
        ("P6", 4),
        ("P7", 5),
        ("P8", 5),
    ],
)
def test_resolve_standard_target_uses_default_mapping(
    member_level: str, expected: int
) -> None:
    assert resolve_standard_target(member_level, "P4") == ResolvedTarget(
        applicable=True,
        target_level=expected,
        source="default",
    )


def test_resolve_standard_target_uses_numeric_override() -> None:
    assert resolve_standard_target(
        "P6", "P4-P8", override_present=True, override_value=3
    ) == ResolvedTarget(True, 3, "leader_override")


def test_resolve_standard_target_honors_explicit_not_applicable_override() -> None:
    assert resolve_standard_target(
        "P6", "P4-P8", override_present=True, override_value=None
    ) == ResolvedTarget(False, None, "leader_override")


def test_applicability_precedes_leader_override() -> None:
    assert resolve_standard_target(
        "P5", "P6-P8", override_present=True, override_value=3
    ) == ResolvedTarget(False, None, "below_recommended_start")


@pytest.mark.parametrize("value", [0, 6])
def test_resolve_standard_target_rejects_invalid_override(value: int) -> None:
    with pytest.raises(ValueError, match="override target must be between 1 and 5"):
        resolve_standard_target(
            "P6", "P4-P8", override_present=True, override_value=value
        )


def test_resolve_standard_target_rejects_invalid_member_level() -> None:
    with pytest.raises(ValueError, match="invalid member target_level"):
        resolve_standard_target("P9", "P4")
