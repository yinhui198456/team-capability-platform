from app.main import health, ready


def test_health_shape() -> None:
    assert health() == {"status": "ok"}


def test_ready_shape_without_database(monkeypatch) -> None:
    monkeypatch.setattr("app.main.check_database", lambda: None)

    assert ready() == {"status": "ready", "database": "ok"}
