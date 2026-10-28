"""HTTP API. Also serves the built React app when it's present (Docker / Heroku)."""

from datetime import date, datetime, time
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.encoders import jsonable_encoder
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from . import analysis, config, store

app = FastAPI(title="Windsight API", version="1.0.0")


@lru_cache(maxsize=1)
def dataset() -> store.Dataset:
    return store.load()


def parse_gate(value: str) -> time:
    try:
        return time.fromisoformat(value)
    except ValueError:
        raise HTTPException(422, "gate must be HH:MM (UK local time)")


def check_day(d: date) -> date:
    if not config.FIRST_DELIVERY_DAY <= d <= config.LAST_DELIVERY_DAY:
        raise HTTPException(
            422, f"delivery day must be between {config.FIRST_DELIVERY_DAY} and {config.LAST_DELIVERY_DAY}"
        )
    return d


# Responses are pure functions of (dataset, params), so cache them.
@lru_cache(maxsize=256)
def _day(day: date, gate: time):
    return jsonable_encoder(analysis.day_view(dataset(), day, gate))


@lru_cache(maxsize=64)
def _accuracy(start: date, end: date, mode: str, gate: time, horizon: float):
    return jsonable_encoder(analysis.accuracy(dataset(), start, end, mode, gate, horizon))


@app.get("/api/health")
def health():
    return {"ok": True}


@app.get("/api/meta")
def meta():
    ds = dataset()
    return {
        "first_delivery_day": config.FIRST_DELIVERY_DAY,
        "last_delivery_day": config.LAST_DELIVERY_DAY,
        "default_gate": config.DEFAULT_GATE.strftime("%H:%M"),
        "gate_presets": config.GATE_PRESETS,
        "max_horizon_h": config.MAX_HORIZON_H,
        "band_lookback_days": config.BAND_LOOKBACK_DAYS,
        "data": {
            "source": ds.source,
            "fetched_at": ds.fetched_at,
            "forecast_runs": len(ds.runs),
            "actual_periods": len(ds.actuals),
            "publish_schedule_utc": sorted({p.strftime("%H:%M") for p in ds.run_times}),
        },
    }


@app.get("/api/day")
def day(date_: date = Query(alias="date"), gate: str = config.DEFAULT_GATE.strftime("%H:%M")):
    return _day(check_day(date_), parse_gate(gate))


@app.get("/api/accuracy")
def accuracy(
    start: date = config.FIRST_DELIVERY_DAY,
    end: date = config.LAST_DELIVERY_DAY,
    mode: str = Query("decision", pattern="^(decision|horizon)$"),
    gate: str = config.DEFAULT_GATE.strftime("%H:%M"),
    horizon: float = Query(24, ge=0, le=config.MAX_HORIZON_H),
):
    check_day(start), check_day(end)
    if start > end:
        raise HTTPException(422, "start must be on or before end")
    return _accuracy(start, end, mode, parse_gate(gate), horizon)


# --- static frontend (built into ./static by the Dockerfile) -----------------
STATIC = Path(__file__).resolve().parent.parent / "static"
if STATIC.is_dir():
    app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        target = STATIC / path
        if path and target.is_file() and STATIC in target.resolve().parents:
            return FileResponse(target)
        return FileResponse(STATIC / "index.html")
