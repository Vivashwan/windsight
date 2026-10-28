// All times are shown in UK local time — that's how the trading desk thinks.
const TZ = 'Europe/London'

const fmt = (opts: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts })
const hm = fmt({ hour: '2-digit', minute: '2-digit', hour12: false })
const dayHm = fmt({ weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
const dayFmt = fmt({ weekday: 'short', day: 'numeric', month: 'short' })

export const time = (iso: string | number) => hm.format(new Date(iso))
export const dateTime = (iso: string | number) => dayHm.format(new Date(iso))
export const day = (iso: string) => dayFmt.format(new Date(`${iso}T12:00:00Z`))

export const mw = (v: number | null | undefined, digits = 0) =>
  v == null || Number.isNaN(v) ? '–' : `${v.toLocaleString('en-GB', { maximumFractionDigits: digits })} MW`
export const gw = (v: number | null | undefined) =>
  v == null ? '–' : `${(v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 })} GW`
export const gwh = (mwh: number | null | undefined) =>
  mwh == null ? '–' : `${(mwh / 1000).toLocaleString('en-GB', { maximumFractionDigits: 0 })} GWh`
export const pct = (v: number | null | undefined) => (v == null ? '–' : `${(v * 100).toFixed(1)}%`)
export const signedMw = (v: number | null | undefined) =>
  v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(Math.round(v)).toLocaleString('en-GB')} MW`

export const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
export const signedGw = (v: number | null | undefined) =>
  v == null ? '–' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${(Math.abs(v) / 1000).toFixed(1)} GW`

/** Round MW tick values (whole or half GW steps) covering [min, max]. */
export const niceTicks = (min: number, max: number) => {
  const lo = Math.min(0, min)
  const step = [1000, 2000, 2500, 5000, 10000].find((s) => (max - lo) / s <= 6) ?? 10000
  const ticks = []
  for (let v = Math.floor(lo / step) * step; v < max + step; v += step) ticks.push(v)
  return ticks
}
