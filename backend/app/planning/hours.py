import re
from collections.abc import Iterable
from dataclasses import asdict, dataclass

_HOURS_PATTERN = re.compile(
    r"^\s*(?P<minimum>\d+(?:\.\d+)?)\s*(?:(?:-|–|—|~|～)\s*(?P<maximum>\d+(?:\.\d+)?))?\s*$"
)


@dataclass(frozen=True)
class EstimatedHours:
    raw: str | None
    min_hours: float | None
    max_hours: float | None
    is_valid: bool
    is_range: bool

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


def parse_estimated_hours(value: str | None) -> EstimatedHours:
    raw = value.strip() if isinstance(value, str) else None
    if not raw:
        return EstimatedHours(value, None, None, False, False)
    match = _HOURS_PATTERN.fullmatch(raw)
    if match is None:
        return EstimatedHours(value, None, None, False, False)
    minimum = float(match.group("minimum"))
    maximum = float(match.group("maximum") or minimum)
    if maximum < minimum:
        return EstimatedHours(value, None, None, False, False)
    return EstimatedHours(value, minimum, maximum, True, maximum != minimum)


def summarize_estimated_hours(values: Iterable[str | None]) -> dict[str, object]:
    parsed = [parse_estimated_hours(value) for value in values]
    valid = [value for value in parsed if value.is_valid]
    return {
        "min_hours": sum(value.min_hours or 0 for value in valid),
        "max_hours": sum(value.max_hours or 0 for value in valid),
        "has_values": bool(valid),
        "has_unparsed": any(
            isinstance(value.raw, str) and value.raw.strip() and not value.is_valid
            for value in parsed
        ),
    }
