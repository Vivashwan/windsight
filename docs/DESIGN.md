# Windsight: design and implementation

This is for the technical lead reviewing the work. It covers what the system does, why it is built this way, and where its limits are.

## Architecture

```
Elexon BMRS ──(build time: python -m app.store)──► backend/data/snapshot.json.gz
                                                        │  (or DATA_SOURCE=live at startup)
                                                        ▼
                     FastAPI  ── store.Dataset (in memory) ── analysis.py (pure functions)
                        │  /api/meta  /api/day  /api/accuracy   (results lru_cached)
                        ▼
                   React (Vite + TS + Recharts): Day-ahead view │ Accuracy view
```

- **One container** for Docker and Heroku. A multi-stage Dockerfile builds the React app, then FastAPI serves it from `/` and the API from `/api`.
- **On Vercel**, the React build is static and the same FastAPI app runs as one Python function (`api/index.py`). Both targets use the same code.

## Why a bundled snapshot

January 2026 is historical and its data will not change, so the app ships a 114 KB gzipped snapshot (392 forecast runs, 2,400 half-hourly actuals). This gives:

- deterministic numbers for the pitch and tests
- fast serverless cold starts, with no ~15 paged calls to Elexon per instance
- no runtime dependency on Elexon's availability

`DATA_SOURCE=live` re-fetches on startup and falls back to the snapshot if that fails. That path is the seam for running this in production on rolling data.

## Data handling (`elexon.py`, `store.py`)

- **FUELHH**: filtered to `fuelType=WIND` and keyed by `startTime`. If a period was ever restated, the value with the latest `publishTime` wins (none were in this window).
- **WINDFOR**: stored as `{publishTime: {startTime: MW}}`, so each forecast run stays intact.
- Fetches use 7-day chunks, which keeps each stream request small.
- The publish-window upper bound is inclusive in the API. The client drops rows outside the chunk's own dates so midnight is not double-counted.
- **Observed data profile:**
  - WINDFOR is hourly and published 8×/day: 02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30, 22:30 UTC, plus one ad-hoc 12:25.
  - Horizons run up to about 66 h.
  - FUELHH had no gaps or duplicates over the window.

## Core logic (`analysis.py`)

All of it is pure functions over the `Dataset`, which keeps it easy to test.

| Concept | Rule |
|---|---|
| Delivery window | `[23:00 UK D-1, 23:00 UK D)`, converted with `zoneinfo` so BST is handled correctly |
| Gate | `D-1` at the chosen UK time |
| Forecast at gate | per target hour: `bisect` the sorted run times for the latest `publishTime ≤ gate` whose run contains the hour |
| Fixed-horizon forecast | latest run with `publishTime ≤ target − H` |
| Error | `forecast − actual` at hourly targets (positive = over-forecast = buyer is short) |
| Metrics | n, MAE, RMSE, bias, nMAE (MAE ÷ mean actual), signed P10/P50/P90, P95 of \|error\|, max |

Quantiles use linear interpolation, the same as NumPy's default. The analysis is pure Python, with no pandas or NumPy, so the serverless bundle stays small.

### Decision aids, with no look-ahead

The error band and adjusted estimate for delivery day D use the gate-time errors from delivery days **D-2 … D-15**. These are the 14 days whose delivery windows had fully finished before D's gate. D-1 is still being delivered at gate time, so it is excluded.

- **Range:** the error quantiles are flipped to give the range for wind:
  - `low = forecast − errP90`
  - `high = forecast − errP10`
  - `adjusted = forecast − errP50`
- **Back-test** (`band_evaluation`), January at 09:50:
  - 80.9% of outturns fell inside the nominal-80% band
  - the adjusted estimate cut MAE from 1,991 to 1,553 MW

`test_error_band_has_no_lookahead` builds a synthetic dataset whose errors jump after the cutoff, and asserts that none of the jump leaks into the band.

## API and caching

The responses depend only on the dataset and the query parameters, so `/api/day` and `/api/accuracy` are memoised with `lru_cache`. An uncached accuracy request takes about 0.1–0.3 s; it computes a 49-point horizon curve and 3 gate comparisons. Inputs are validated: the delivery day must fall in scope, the gate must be `HH:MM`, and the horizon must be 0–48. Invalid input returns 422 with a readable message.

## Frontend

- **Shared state:** the gate selector sits in the header and drives both tabs, since every number depends on it.
- **Day view:** one Recharts `ComposedChart` on a numeric time axis. Hourly forecast series use `connectNulls` across the half-hourly actual points. Earlier runs are an optional overlay, so a revision between runs is visible.
- **Hindsight is a toggle** ("Show what actually happened"). The desk can replay a day as it looked at decision time, then reveal the outcome.
- **Accessibility and theming:**
  - every chart has a custom tooltip
  - the day and daily charts have a table view
  - light and dark themes come from CSS custom properties
  - series colours come from a CVD-validated categorical palette
  - the layout reflows to phone width

## Testing

`backend/tests` has 11 pytest tests:

- delivery-window and BST handling
- gate selection, including the 09:20 vs 09:50 boundary and a run published exactly at the gate
- the minimum-lead-time rule
- metric sign conventions
- quantiles against NumPy
- band no-look-ahead and the flip
- API happy paths and validation against the real snapshot

The frontend was type-checked, linted and checked visually in headless Chrome (desktop, phone, light and dark).

## Known limitations and next steps

- **Bias cause unverified.** The systematic over-forecast is probably curtailment or a metering-scope difference. Confirming it needs BOALF/constraint data, which is outside the brief.
- **Hourly vs half-hourly.** Scoring takes only the first half-hour of each hour. Interpolating WINDFOR to 30-minute resolution is a small change if the desk trades half-hourly products.
- **Band shape.** The band is a constant offset per day. Error grows with the wind level (heteroscedastic), so a band that scales with the forecast level would be tighter at low wind. With only about 336 errors per window, that should be validated before shipping it.
- **Rolling operation.** For live use, swap the snapshot for a scheduled ingest into a small store (SQLite/Postgres) and invalidate the caches when new runs land.
- **Wind only.** Demand and other renewables (solar, embedded wind) are out of scope. Adding them would turn this into a residual-demand (net-position) tool, which is what the desk ultimately trades on.
