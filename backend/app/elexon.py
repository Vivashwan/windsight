"""Thin client for the two Elexon BMRS datasets we use (FUELHH and WINDFOR)."""

from datetime import date, datetime, timedelta, timezone

import httpx

BASE = "https://data.elexon.co.uk/bmrs/api/v1/datasets"
CHUNK_DAYS = 7


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def _chunks(start: date, end: date):
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=CHUNK_DAYS - 1), end)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def fetch_actuals(start: date, end: date, client: httpx.Client) -> dict[datetime, int]:
    """Half-hourly wind outturn (MW) keyed by settlement period start (UTC)."""
    out: dict[datetime, tuple[datetime, int]] = {}
    for a, b in _chunks(start, end):
        resp = client.get(
            f"{BASE}/FUELHH/stream",
            params={"settlementDateFrom": a.isoformat(), "settlementDateTo": b.isoformat(), "fuelType": "WIND"},
        )
        resp.raise_for_status()
        for row in resp.json():
            if row.get("fuelType") != "WIND" or row.get("generation") is None:
                continue
            start_t, pub = parse_ts(row["startTime"]), parse_ts(row["publishTime"])
            # Keep the most recently published value if a period is restated.
            if start_t not in out or pub > out[start_t][0]:
                out[start_t] = (pub, int(row["generation"]))
    return {k: v for k, (_, v) in sorted(out.items())}


def fetch_forecasts(start: date, end: date, client: httpx.Client) -> dict[datetime, dict[datetime, int]]:
    """Wind forecast runs: {publishTime: {startTime: MW}} (UTC), published within [start, end]."""
    runs: dict[datetime, dict[datetime, int]] = {}
    for a, b in _chunks(start, end):
        resp = client.get(
            f"{BASE}/WINDFOR/stream",
            params={
                "publishDateTimeFrom": f"{a.isoformat()}T00:00:00Z",
                "publishDateTimeTo": f"{(b + timedelta(days=1)).isoformat()}T00:00:00Z",
            },
        )
        resp.raise_for_status()
        for row in resp.json():
            if row.get("generation") is None:
                continue
            pub = parse_ts(row["publishTime"])
            if not (a <= pub.date() <= b):
                continue  # the upper bound is inclusive; avoid double-counting midnight
            runs.setdefault(pub, {})[parse_ts(row["startTime"])] = int(row["generation"])
    return {p: dict(sorted(pts.items())) for p, pts in sorted(runs.items())}
