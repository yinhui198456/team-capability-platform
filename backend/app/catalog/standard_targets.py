import re
from dataclasses import dataclass

LEVEL_RANGE = re.compile(r"\s*P([4-8])(?:\s*[-–—]\s*P([4-8]))?\s*")
MEMBER_LEVEL = re.compile(r"P([4-8])")
DEFAULT_TARGETS = {4: 2, 5: 3, 6: 4, 7: 5, 8: 5}


@dataclass(frozen=True)
class ResolvedTarget:
    applicable: bool
    target_level: int | None
    source: str


def parse_earliest_level(value: str) -> int:
    match = LEVEL_RANGE.fullmatch(value)
    if match is None:
        raise ValueError(f"invalid recommended_start_level: {value!r}")
    start = int(match.group(1))
    end = int(match.group(2) or start)
    if end < start:
        raise ValueError(f"invalid recommended_start_level: {value!r}")
    return start


def resolve_standard_target(
    member_level: str,
    recommended_start_level: str,
    *,
    override_present: bool = False,
    override_value: int | None = None,
) -> ResolvedTarget:
    member_match = MEMBER_LEVEL.fullmatch(member_level)
    if member_match is None:
        raise ValueError(f"invalid member target_level: {member_level!r}")
    if override_present and override_value is not None and not 1 <= override_value <= 5:
        raise ValueError("override target must be between 1 and 5")

    member = int(member_match.group(1))
    if member < parse_earliest_level(recommended_start_level):
        return ResolvedTarget(False, None, "below_recommended_start")
    if override_present:
        return ResolvedTarget(
            override_value is not None, override_value, "leader_override"
        )
    return ResolvedTarget(True, DEFAULT_TARGETS[member], "default")
