export interface Metrics {
  n: number
  mae: number
  rmse: number
  bias: number
  nmae: number | null
  mean_actual: number
  p10: number
  p50: number
  p90: number
  p95_abs: number
  max_abs: number
}

export interface Meta {
  first_delivery_day: string
  last_delivery_day: string
  default_gate: string
  gate_presets: { label: string; time: string }[]
  max_horizon_h: number
  band_lookback_days: number
  data: {
    source: string
    fetched_at: string
    forecast_runs: number
    actual_periods: number
    publish_schedule_utc: string[]
  }
}

export interface HourRow {
  time: string
  forecast: number
  actual: number | null
  low?: number
  adjusted?: number
  high?: number
}

export interface DayView {
  delivery_day: string
  window: { start: string; end: string }
  gate: string
  run_used: string | null
  runs_used: string[]
  minutes_before_gate: number | null
  next_run: string | null
  hourly: HourRow[]
  half_hourly: { time: string; actual: number }[]
  vintages: { publish: string; points: { time: string; forecast: number }[] }[]
  band: {
    days_used: number
    from: string | null
    to: string | null
    n: number
    mae: number | null
    bias: number | null
    err_p10: number | null
    err_p50: number | null
    err_p90: number | null
  }
  revision: { vs_publish: string; mean: number; max_abs: number } | null
  summary: {
    forecast_mwh: number
    adjusted_mwh: number | null
    actual_mwh: number | null
    forecast_min: number | null
    forecast_max: number | null
    realised: Metrics | null
  }
}

export interface Accuracy {
  mode: 'decision' | 'horizon'
  summary: Metrics | null
  lead_time_h: { min: number; median: number; max: number } | null
  by_hour: { hour: number; mae: number; bias: number; p10: number; p90: number }[]
  daily: { day: string; mae: number; bias: number; max_abs: number; forecast_mwh: number; actual_mwh: number }[]
  histogram: { from: number; to: number; count: number }[]
  scatter: { forecast: number; actual: number }[]
  horizon_curve: { horizon_h: number; mae: number; rmse: number; bias: number; p10: number; p90: number; n: number }[]
  gate_comparison: { label: string; time: string; mae: number; p95_abs: number; bias: number }[]
  band_evaluation: { coverage: number; nominal_coverage: number; adjusted: Metrics } | null
}

async function get<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]))
  const res = await fetch(`/api/${path}${qs.size ? `?${qs}` : ''}`)
  if (!res.ok) {
    const body = await res.json().catch(() => null)
    throw new Error(typeof body?.detail === 'string' ? body.detail : `Request failed (${res.status})`)
  }
  return res.json()
}

export const api = {
  meta: () => get<Meta>('meta'),
  day: (date: string, gate: string) => get<DayView>('day', { date, gate }),
  accuracy: (p: { start: string; end: string; mode: string; gate: string; horizon: number }) =>
    get<Accuracy>('accuracy', p),
}
