"""Loads the dataset: a bundled snapshot by default, or live from Elexon.

January 2026 is history, so the bundled snapshot is the source of truth for the
deployed app (fast cold starts, no dependency on Elexon uptime). Set
DATA_SOURCE=live to fetch from Elexon on startup instead; it falls back to the
snapshot if Elexon is unreachable. Regenerate the snapshot with
`python -m app.store`.
"""

import bisect
import gzip
import json
import logging
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import httpx

from . import config, elexon

log = logging.getLogger(__name__)
SNAPSHOT = Path(__file__).resolve().parent.parent / "data" / "snapshot.json.gz"


@dataclass
class Dataset:
    actuals: dict[datetime, int]  # half-hourly MW, keyed by period start (UTC)
    runs: dict[datetime, dict[datetime, int]]  # {publishTime: {startTime: MW}}
    source: str
    fetched_at: datetime
    run_times: list[datetime] = field(init=False)

    def __post_init__(self):
        self.run_times = sorted(self.runs)

    def latest_run(self, cutoff: datetime, target: datetime | None = None) -> datetime | None:
        """Most recent run published at or before `cutoff` (that covers `target`, if given)."""
        i = bisect.bisect_right(self.run_times, cutoff)
        while i > 0:
            i -= 1
            pub = self.run_times[i]
            if target is None or target in self.runs[pub]:
                return pub
        return None

    def next_run_after(self, cutoff: datetime) -> datetime | None:
        i = bisect.bisect_right(self.run_times, cutoff)
        return self.run_times[i] if i < len(self.run_times) else None


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_json(ds: Dataset) -> dict:
    return {
        "source": "elexon-bmrs",
        "fetched_at": _ts(ds.fetched_at),
        "actuals": [[_ts(t), v] for t, v in ds.actuals.items()],
        "runs": {_ts(p): [[_ts(t), v] for t, v in pts.items()] for p, pts in ds.runs.items()},
    }


def from_json(raw: dict, source: str) -> Dataset:
    p = elexon.parse_ts
    return Dataset(
        actuals={p(t): v for t, v in raw["actuals"]},
        runs={p(pub): {p(t): v for t, v in pts} for pub, pts in raw["runs"].items()},
        source=source,
        fetched_at=p(raw["fetched_at"]),
    )


def fetch_live() -> Dataset:
    with httpx.Client(timeout=60) as client:
        actuals = elexon.fetch_actuals(config.FETCH_FROM, config.FETCH_TO, client)
        runs = elexon.fetch_forecasts(config.FETCH_FROM, config.LAST_DELIVERY_DAY, client)
    return Dataset(actuals=actuals, runs=runs, source="live", fetched_at=datetime.now(timezone.utc))


def load_snapshot() -> Dataset:
    with gzip.open(SNAPSHOT, "rt") as f:
        return from_json(json.load(f), source="snapshot")


def load() -> Dataset:
    if os.getenv("DATA_SOURCE", "snapshot") == "live":
        try:
            return fetch_live()
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("Live fetch from Elexon failed (%s); using bundled snapshot", exc)
    return load_snapshot()


if __name__ == "__main__":
    ds = fetch_live()
    SNAPSHOT.parent.mkdir(parents=True, exist_ok=True)
    with gzip.open(SNAPSHOT, "wt") as f:
        json.dump(to_json(ds), f, separators=(",", ":"))
    print(f"Wrote {SNAPSHOT}: {len(ds.actuals)} actuals, {len(ds.runs)} forecast runs")
