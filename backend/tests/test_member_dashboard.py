import psycopg

from test_capability_profile import _build_full_profile, _request, profile_schema


def test_member_dashboard_aggregates_only_current_member_data(
    profile_schema: psycopg.Connection,
) -> None:
    _, member_cookies = _build_full_profile(profile_schema)

    status, body, _ = _request(
        "GET", "/api/planning/member-dashboard?year=2026", cookies=member_cookies
    )

    assert status == 200
    assert body is not None
    assert body["year"] == 2026
    assert body["summary"] == {
        "total_learning_hours": 5,
        "completed_task_count": 0,
        "pending_evidence_count": 0,
    }
    assert body["domain_radar"][0] == {"domain_code": "P01", "score": 2}
    assert len(body["gaps"]) == 1
    assert body["gaps"][0]["l3_code"] == "P01-L2A-L3A"
    assert len(body["current_tasks"]) == 1
    assert body["current_tasks"][0]["l3_code"] == "P01-L2A-L3A"


def test_member_dashboard_rejects_non_members(
    profile_schema: psycopg.Connection,
) -> None:
    _build_full_profile(profile_schema, "dashboard_member", "dashboard_buddy")
    from test_capability_profile import _login

    status, _, _ = _request(
        "GET",
        "/api/planning/member-dashboard?year=2026",
        cookies=_login(profile_schema, "dashboard_buddy"),
    )
    assert status == 403
