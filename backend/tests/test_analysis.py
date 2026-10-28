from datetime import date, datetime, time, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app import analysis, store
from app.main import app


def utc(*args) -> datetime:
    return datetime(*args, tzinfo=timezone.utc)


def synthetic(runs: dict, actual_mw: int = 1000) -> store.Dataset:
    """Actuals flat at `actual_mw` over a wide range; `runs` = {publish: forecast_mw}
    with each run covering 0-72h ahead hourly."""
    start = utc(2025, 12, 10)
    actuals = {start + timedelta(minutes=30 * i): actual_mw for i in range(48 * 60)}
    return store.Dataset(
        actuals=actuals,
        runs={pub: {pub.replace(minute=0) + timedelta(hours=h): mw for h in range(1, 73)} for pub, mw in runs.items()},
        source="test",
        fetched_at=utc(2026, 3, 1),
    )


def test_delivery_window_is_23_to_23_uk():
    start, end = analysis.delivery_window(date(2026, 1, 15))
    assert (start, end) == (utc(2026, 1, 14, 23), utc(2026, 1, 15, 23))
    # Summer: BST shifts the window by an hour in UTC.
    start, _ = analysis.delivery_window(date(2026, 7, 15))
    assert start == utc(2026, 7, 14, 22)


def test_decision_uses_latest_run_published_at_or_before_gate():
    ds = synthetic({
        utc(2026, 1, 14, 7, 30): 2000,
        utc(2026, 1, 14, 9, 30): 3000,
        utc(2026, 1, 14, 11, 30): 9999,  # after the gate: must never be used
    })
    fc = analysis.decision_forecast(ds, date(2026, 1, 15), time(9, 50))
    assert len(fc) == 24
    assert {p["forecast"] for p in fc} == {3000}
    # With an EPEX-style 09:20 gate the 09:30 run is missed.
    fc = analysis.decision_forecast(ds, date(2026, 1, 15), time(9, 20))
    assert {p["forecast"] for p in fc} == {2000}


def test_run_published_exactly_at_gate_is_usable():
    ds = synthetic({utc(2026, 1, 14, 9, 50): 1234})
    assert analysis.decision_forecast(ds, date(2026, 1, 15), time(9, 50))[0]["forecast"] == 1234


def test_horizon_forecast_respects_minimum_lead_time():
    ds = synthetic({utc(2026, 1, 14, 2, 30): 100, utc(2026, 1, 14, 9, 30): 200})
    target = utc(2026, 1, 14, 20)
    assert analysis.horizon_forecast(ds, target, 4)[1] == 200  # 10.5h lead
    assert analysis.horizon_forecast(ds, target, 12)[1] == 100  # 17.5h lead
    assert analysis.horizon_forecast(ds, target, 24) is None


def test_metrics_sign_convention():
    m = analysis.metrics([{"error": 300, "actual": 1000}, {"error": -100, "actual": 1000}])
    assert m["bias"] == 100  # positive = over-forecast
    assert m["mae"] == 200
    assert m["rmse"] == pytest.approx((300**2 / 2 + 100**2 / 2) ** 0.5)


def test_quantile_matches_numpy_linear():
    vals = [1, 2, 3, 4, 5]
    assert analysis.quantile(vals, 0.1) == pytest.approx(1.4)
    assert analysis.quantile(vals, 0.5) == 3


def test_error_band_has_no_lookahead():
    """The band for day D may only use errors from days that finished before D's gate."""
    runs = {}
    for k in range(40):
        pub = utc(2025, 12, 20, 9, 30) + timedelta(days=k)
        # Forecast error is 500 MW for days before 15 Jan's gate, then huge.
        runs[pub] = 1500 if pub < utc(2026, 1, 13) else 50_000
    ds = synthetic(runs, actual_mw=1000)
    band = analysis.error_band(ds, date(2026, 1, 15), time(9, 50))
    assert band["days_used"] == 14
    assert band["to"] == "2026-01-13"  # D-2 is the most recent complete day
    # Delivery 13 Jan was forecast by the 12 Jan run (error 500), so nothing huge leaks in.
    assert band["err_p90"] == 500


def test_band_flips_error_quantiles_into_wind_range():
    b = analysis.apply_band(10_000, {"err_p10": -1000, "err_p50": 500, "err_p90": 3000})
    assert b == {"low": 7000, "adjusted": 9500, "high": 11000}


# --- API against the bundled January 2026 snapshot ---------------------------

client = TestClient(app)


def test_api_day_on_snapshot():
    r = client.get("/api/day", params={"date": "2026-01-15", "gate": "09:50"})
    assert r.status_code == 200
    body = r.json()
    assert len(body["hourly"]) == 24
    assert body["run_used"] == "2026-01-14T09:30:00+00:00"
    assert body["band"]["days_used"] == 14


def test_api_rejects_out_of_scope_days_and_bad_gates():
    assert client.get("/api/day", params={"date": "2026-03-01"}).status_code == 422
    assert client.get("/api/day", params={"date": "2026-01-15", "gate": "9.50"}).status_code == 422


def test_api_accuracy_on_snapshot():
    r = client.get("/api/accuracy", params={"mode": "decision"})
    assert r.status_code == 200
    body = r.json()
    assert body["summary"]["n"] == 31 * 24
    assert len(body["horizon_curve"]) == 49
    assert 0.6 < body["band_evaluation"]["coverage"] <= 1
