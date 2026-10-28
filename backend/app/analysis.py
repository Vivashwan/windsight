"""Forecast selection and accuracy metrics.

Error convention everywhere: error = forecast - actual (MW).
Positive error = over-forecast = less wind arrived than planned for, i.e. a
shortfall the buyer has to cover later (intraday / imbalance).

Forecasts are hourly and actuals half-hourly; errors are evaluated at the
hourly target times, against the actual for the settlement period starting
at that time.
"""

import math
from datetime import date, datetime, time, timedelta, timezone

from . import config
from .store import Dataset

HOUR = timedelta(hours=1)


# ---------------------------------------------------------------- time helpers

def uk(d: date, t: time) -> datetime:
    return datetime.combine(d, t, tzinfo=config.UK).astimezone(timezone.utc)


def delivery_window(day: date) -> tuple[datetime, datetime]:
    """[23:00 UK on D-1, 23:00 UK on D) in UTC."""
    return uk(day - timedelta(days=1), config.DELIVERY_DAY_START), uk(day, config.DELIVERY_DAY_START)


def gate_time(day: date, gate: time) -> datetime:
    """Gate closure for delivery day D is on D-1."""
    return uk(day - timedelta(days=1), gate)


def hourly_targets(start: datetime, end: datetime) -> list[datetime]:
    out, t = [], start
    while t < end:
        out.append(t)
        t += HOUR
    return out


def delivery_days(start: date, end: date) -> list[date]:
    return [start + timedelta(days=i) for i in range((end - start).days + 1)]


# ---------------------------------------------------------------- selection

def decision_forecast(ds: Dataset, day: date, gate: time) -> list[dict]:
    """The forecast a buyer would actually have had at gate closure for delivery day D:
    for each hour, the latest run published at or before the gate that covers it."""
    cutoff = gate_time(day, gate)
    points = []
    for t in hourly_targets(*delivery_window(day)):
        pub = ds.latest_run(cutoff, t)
        if pub is not None:
            points.append({"time": t, "forecast": ds.runs[pub][t], "publish": pub})
    return points


def horizon_forecast(ds: Dataset, target: datetime, horizon_h: float) -> tuple[datetime, int] | None:
    """Latest forecast for `target` published at least `horizon_h` hours before it."""
    pub = ds.latest_run(target - timedelta(hours=horizon_h), target)
    return (pub, ds.runs[pub][target]) if pub is not None else None


def decision_pairs(ds: Dataset, day: date, gate: time) -> list[dict]:
    pairs = []
    for p in decision_forecast(ds, day, gate):
        actual = ds.actuals.get(p["time"])
        if actual is not None:
            pairs.append({**p, "actual": actual, "error": p["forecast"] - actual})
    return pairs


def horizon_pairs(ds: Dataset, start: date, end: date, horizon_h: float) -> list[dict]:
    pairs = []
    for day in delivery_days(start, end):
        for t in hourly_targets(*delivery_window(day)):
            hit, actual = horizon_forecast(ds, t, horizon_h), ds.actuals.get(t)
            if hit and actual is not None:
                pub, fc = hit
                pairs.append({"time": t, "forecast": fc, "publish": pub, "actual": actual,
                              "error": fc - actual, "day": day})
    return pairs


# ---------------------------------------------------------------- statistics

def quantile(sorted_vals: list[float], q: float) -> float:
    """Linear-interpolated quantile (same as numpy's default) of pre-sorted values."""
    if not sorted_vals:
        return math.nan
    pos = (len(sorted_vals) - 1) * q
    lo, hi = math.floor(pos), math.ceil(pos)
    return sorted_vals[lo] + (sorted_vals[hi] - sorted_vals[lo]) * (pos - lo)


def metrics(pairs: list[dict]) -> dict | None:
    if not pairs:
        return None
    errs = [p["error"] for p in pairs]
    abs_sorted = sorted(abs(e) for e in errs)
    signed_sorted = sorted(errs)
    n = len(errs)
    mean_actual = sum(p["actual"] for p in pairs) / n
    mae = sum(abs_sorted) / n
    return {
        "n": n,
        "mae": mae,
        "rmse": math.sqrt(sum(e * e for e in errs) / n),
        "bias": sum(errs) / n,
        "nmae": mae / mean_actual if mean_actual else None,
        "mean_actual": mean_actual,
        "p10": quantile(signed_sorted, 0.10),
        "p50": quantile(signed_sorted, 0.50),
        "p90": quantile(signed_sorted, 0.90),
        "p95_abs": quantile(abs_sorted, 0.95),
        "max_abs": abs_sorted[-1],
    }


def histogram(errors: list[float], width: int = 1000) -> list[dict]:
    if not errors:
        return []
    lo = math.floor(min(errors) / width) * width
    hi = math.floor(max(errors) / width) * width
    counts = {b: 0 for b in range(lo, hi + width, width)}
    for e in errors:
        counts[math.floor(e / width) * width] += 1
    return [{"from": b, "to": b + width, "count": c} for b, c in counts.items()]


# ---------------------------------------------------------------- products

def error_band(ds: Dataset, day: date, gate: time) -> dict:
    """Empirical P10/P90 forecast-error band for day D, using only information a
    buyer had at the gate: errors from delivery days that had fully finished
    (D-2 and earlier) over the trailing look-back window."""
    errs = []
    days_used = []
    for k in range(2, 2 + config.BAND_LOOKBACK_DAYS):
        past = day - timedelta(days=k)
        pairs = decision_pairs(ds, past, gate)
        if pairs:
            days_used.append(past)
            errs.extend(p["error"] for p in pairs)
    errs.sort()
    lo_q, hi_q = config.BAND_QUANTILES
    return {
        "days_used": len(days_used),
        "from": min(days_used).isoformat() if days_used else None,
        "to": max(days_used).isoformat() if days_used else None,
        "n": len(errs),
        "mae": sum(abs(e) for e in errs) / len(errs) if errs else None,
        "bias": sum(errs) / len(errs) if errs else None,
        "err_p10": quantile(errs, lo_q) if errs else None,
        "err_p50": quantile(errs, 0.5) if errs else None,
        "err_p90": quantile(errs, hi_q) if errs else None,
    }


def apply_band(forecast: float, band: dict) -> dict:
    """Turn error quantiles into a wind range. actual = forecast - error, so the
    quantiles flip: a high error quantile gives the low end of the wind range."""
    if band["err_p50"] is None:
        return {}
    return {
        "low": max(0.0, forecast - band["err_p90"]),
        "adjusted": max(0.0, forecast - band["err_p50"]),
        "high": forecast - band["err_p10"],
    }


def day_view(ds: Dataset, day: date, gate: time) -> dict:
    cutoff = gate_time(day, gate)
    start, end = delivery_window(day)
    fc = decision_forecast(ds, day, gate)
    band = error_band(ds, day, gate)
    runs_used = sorted({p["publish"] for p in fc})

    hourly = []
    for p in fc:
        hourly.append({"time": p["time"], "forecast": p["forecast"], "actual": ds.actuals.get(p["time"]),
                       **apply_band(p["forecast"], band)})

    half_hourly = [{"time": t, "actual": v} for t, v in ds.actuals.items() if start <= t < end]

    # Earlier runs the buyer could also have seen, to show how the forecast moved.
    vintages = []
    latest = runs_used[-1] if runs_used else None
    for pub in reversed(ds.run_times):
        if pub > cutoff or pub == latest:
            continue
        if len(vintages) == 4:
            break
        pts = [{"time": t, "forecast": v} for t, v in ds.runs[pub].items() if start <= t < end]
        if len(pts) >= len(fc) // 2:
            vintages.append({"publish": pub, "points": pts})

    pairs = decision_pairs(ds, day, gate)
    energy_fc = sum(p["forecast"] for p in fc)  # hourly MW * 1h = MWh
    energy_adj = sum(r["adjusted"] for r in hourly) if band["err_p50"] is not None else None
    energy_act = sum(r["actual"] for r in half_hourly) * 0.5 if half_hourly else None
    revision = None
    if vintages and latest:
        prev = {p["time"]: p["forecast"] for p in vintages[0]["points"]}
        diffs = [ds.runs[latest][t] - prev[t] for t in prev if t in ds.runs[latest]]
        if diffs:
            revision = {"vs_publish": vintages[0]["publish"], "mean": sum(diffs) / len(diffs),
                        "max_abs": max(abs(d) for d in diffs)}

    return {
        "delivery_day": day.isoformat(),
        "window": {"start": start, "end": end},
        "gate": cutoff,
        "run_used": latest,
        "runs_used": runs_used,
        "minutes_before_gate": (cutoff - latest).total_seconds() / 60 if latest else None,
        "next_run": ds.next_run_after(cutoff),
        "hourly": hourly,
        "half_hourly": half_hourly,
        "vintages": vintages,
        "band": band,
        "revision": revision,
        "summary": {
            "forecast_mwh": energy_fc,
            "adjusted_mwh": energy_adj,
            "actual_mwh": energy_act,
            "forecast_min": min((p["forecast"] for p in fc), default=None),
            "forecast_max": max((p["forecast"] for p in fc), default=None),
            "realised": metrics(pairs),
        },
    }


def band_evaluation(ds: Dataset, start: date, end: date, gate: time) -> dict | None:
    """Back-test the decision-time products: how often did the actual land inside
    the P10-P90 band, and does the bias-adjusted estimate beat the raw forecast?"""
    inside, adjusted = 0, []
    for d in delivery_days(start, end):
        band = error_band(ds, d, gate)
        for p in decision_pairs(ds, d, gate):
            b = apply_band(p["forecast"], band)
            if not b:
                continue
            inside += b["low"] <= p["actual"] <= b["high"]
            adjusted.append({**p, "error": b["adjusted"] - p["actual"]})
    if not adjusted:
        return None
    return {
        "coverage": inside / len(adjusted),
        "nominal_coverage": config.BAND_QUANTILES[1] - config.BAND_QUANTILES[0],
        "adjusted": metrics(adjusted),
    }


def horizon_curve(ds: Dataset, start: date, end: date, step: int = 1) -> list[dict]:
    curve = []
    for h in range(0, config.MAX_HORIZON_H + 1, step):
        m = metrics(horizon_pairs(ds, start, end, h))
        if m:
            curve.append({"horizon_h": h, **{k: m[k] for k in ("mae", "rmse", "bias", "p10", "p90", "n")}})
    return curve


def accuracy(ds: Dataset, start: date, end: date, mode: str, gate: time, horizon_h: float) -> dict:
    if mode == "decision":
        pairs = [{**p, "day": d} for d in delivery_days(start, end) for p in decision_pairs(ds, d, gate)]
    else:
        pairs = horizon_pairs(ds, start, end, horizon_h)

    by_hour = []
    for h in range(24):
        m = metrics([p for p in pairs if p["time"].astimezone(config.UK).hour == h])
        if m:
            by_hour.append({"hour": h, "mae": m["mae"], "bias": m["bias"], "p10": m["p10"], "p90": m["p90"]})

    daily = []
    for d in delivery_days(start, end):
        dp = [p for p in pairs if p["day"] == d]
        m = metrics(dp)
        if m:
            daily.append({"day": d.isoformat(), "mae": m["mae"], "bias": m["bias"], "max_abs": m["max_abs"],
                          "forecast_mwh": sum(p["forecast"] for p in dp),
                          "actual_mwh": sum(p["actual"] for p in dp)})

    lead_times = sorted((p["time"] - p["publish"]).total_seconds() / 3600 for p in pairs)
    gates = []
    for preset in config.GATE_PRESETS:
        g = time.fromisoformat(preset["time"])
        m = metrics([p for d in delivery_days(start, end) for p in decision_pairs(ds, d, g)])
        if m:
            gates.append({**preset, "mae": m["mae"], "p95_abs": m["p95_abs"], "bias": m["bias"]})

    return {
        "mode": mode,
        "summary": metrics(pairs),
        "lead_time_h": {"min": lead_times[0], "median": quantile(lead_times, 0.5), "max": lead_times[-1]} if lead_times else None,
        "by_hour": by_hour,
        "daily": daily,
        "histogram": histogram([p["error"] for p in pairs]),
        "scatter": [{"forecast": p["forecast"], "actual": p["actual"]} for p in pairs],
        "horizon_curve": horizon_curve(ds, start, end),
        "gate_comparison": gates,
        "band_evaluation": band_evaluation(ds, start, end, gate) if mode == "decision" else None,
    }
