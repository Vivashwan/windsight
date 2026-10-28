"""Domain constants for the GB day-ahead market and the January 2026 scope."""

from datetime import date, time
from zoneinfo import ZoneInfo

UK = ZoneInfo("Europe/London")

# Decisions are made in January 2026 (D-1), so delivery days run 2 Jan - 1 Feb.
FIRST_DELIVERY_DAY = date(2026, 1, 2)
LAST_DELIVERY_DAY = date(2026, 2, 1)

# GB day-ahead delivery day runs 23:00 UK on D-1 to 23:00 UK on D.
DELIVERY_DAY_START = time(23, 0)

# N2EX (Nord Pool) GB hourly day-ahead auction gate closure, UK time.
DEFAULT_GATE = time(9, 50)
GATE_PRESETS = [
    {"label": "EPEX GB hourly", "time": "09:20"},
    {"label": "N2EX GB hourly", "time": "09:50"},
    {"label": "GB half-hourly auction", "time": "15:30"},
]

# Error bands only use delivery days whose actuals were complete at gate time.
BAND_LOOKBACK_DAYS = 14
BAND_QUANTILES = (0.10, 0.90)

# Horizon analysis: latest forecast published at least H hours before target.
MAX_HORIZON_H = 48

# What we fetch: a warm-up period before January so early-January error bands
# and 48h-horizon forecasts have history, and actuals through 1 Feb delivery.
FETCH_FROM = date(2025, 12, 15)
FETCH_TO = date(2026, 2, 2)
