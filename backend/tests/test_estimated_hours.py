from app.planning.hours import parse_estimated_hours, summarize_estimated_hours


def test_parse_estimated_hours_supports_single_decimal_and_ranges() -> None:
    expected = {
        "4": (4.0, 4.0, True, False),
        "4.5": (4.5, 4.5, True, False),
        " 4-6 ": (4.0, 6.0, True, True),
        "4–6": (4.0, 6.0, True, True),
        "4—6": (4.0, 6.0, True, True),
        "4~6": (4.0, 6.0, True, True),
        "4～6": (4.0, 6.0, True, True),
    }

    for raw, (minimum, maximum, valid, is_range) in expected.items():
        parsed = parse_estimated_hours(raw)
        assert (
            parsed.min_hours,
            parsed.max_hours,
            parsed.is_valid,
            parsed.is_range,
        ) == (
            minimum,
            maximum,
            valid,
            is_range,
        )


def test_estimated_hours_summary_keeps_ranges_and_marks_unparsed_text() -> None:
    summary = summarize_estimated_hours(["4", "4–6", "约半天", None])

    assert summary == {
        "min_hours": 8.0,
        "max_hours": 10.0,
        "has_values": True,
        "has_unparsed": True,
    }
    assert parse_estimated_hours("4–6").max_hours != 46
    assert parse_estimated_hours("未知文本").is_valid is False
