import { useEffect, useMemo, useState } from 'react'
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, type DayView, type Meta } from './api'
import * as f from './format'
import { Card, Legend, Stat, Status, TipBox } from './ui'

interface Point {
  t: number
  forecast?: number
  adjusted?: number
  band?: [number, number]
  actual?: number
  [vintage: `v${number}`]: number | undefined
}

export function DecisionView({ meta, gate }: { meta: Meta; gate: string }) {
  const [date, setDate] = useState('2026-01-15')
  const [data, setData] = useState<DayView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [reveal, setReveal] = useState(true)
  const [showVintages, setShowVintages] = useState(false)
  const [showTable, setShowTable] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    api.day(date, gate)
      .then((d) => live && setData(d), (e) => live && setError(e.message))
      .finally(() => live && setLoading(false))
    return () => { live = false }
  }, [date, gate])

  const points = useMemo(() => (data ? toPoints(data, reveal) : []), [data, reveal])
  const first = meta.first_delivery_day
  const last = meta.last_delivery_day
  const realised = data?.summary.realised
  const hasBand = data?.band.err_p50 != null
  const yTicks = useMemo(() => f.niceTicks(0, Math.max(1000, ...points.flatMap((p) =>
    [p.forecast, p.actual, p.band?.[1], ...Object.entries(p).filter(([k]) => k.startsWith('v')).map(([, v]) => v as number)]
      .filter((v): v is number => v != null)))), [points])

  return (
    <div className="stack">
      <div className="controls">
        <div className="field">
          <label htmlFor="delivery-day">Delivery day</label>
          <div className="stepper">
            <button aria-label="Previous day" disabled={date <= first} onClick={() => setDate(f.addDays(date, -1))}>‹</button>
            <input id="delivery-day" type="date" min={first} max={last} value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)} />
            <button aria-label="Next day" disabled={date >= last} onClick={() => setDate(f.addDays(date, 1))}>›</button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          Show what actually happened
        </label>
        <label className="check">
          <input type="checkbox" checked={showVintages} onChange={(e) => setShowVintages(e.target.checked)} />
          Show earlier forecast runs
        </label>
      </div>

      <Status loading={loading && !data} error={error} />

      {data && (
        <>
          <DecisionContext data={data} />

          <div className="stats">
            <Stat
              label="Wind energy, delivery day"
              value={f.gwh(data.summary.forecast_mwh)}
              sub={<>Forecast · {f.gw(data.summary.forecast_min)}–{f.gw(data.summary.forecast_max)} hourly</>}
            />
            <Stat
              label="Bias-adjusted estimate"
              value={hasBand ? f.gwh(data.summary.adjusted_mwh) : '–'}
              sub={hasBand ? <>Forecast minus its median error, last {data.band.days_used} days</> : 'Not enough history'}
            />
            <Stat
              label="80% range, per hour"
              value={hasBand ? <>{f.signedGw(-data.band.err_p90!)} to {f.signedGw(-data.band.err_p10!)}</> : '–'}
              sub={hasBand ? <>Around the forecast · from {data.band.n} past hours</> : undefined}
            />
            <Stat
              label="Recent typical error"
              value={f.mw(data.band.mae)}
              sub={<>Bias {f.signedMw(data.band.bias)} {data.band.bias! > 0 ? '(over-forecast)' : ''}</>}
              tone={data.band.bias != null && Math.abs(data.band.bias) > 1000 ? 'warn' : undefined}
            />
            {reveal && realised && (
              <Stat
                label="Outturn (hindsight)"
                value={f.gwh(data.summary.actual_mwh)}
                sub={<>Day MAE {f.mw(realised.mae)} · bias {f.signedMw(realised.bias)}</>}
              />
            )}
          </div>

          <Card
            title="Wind generation for the delivery day"
            subtitle={<>GW. Hourly forecast available at gate closure{hasBand && ', with the empirical 80% range'}{reveal && ', against half-hourly metered outturn'}.</>}
            actions={<button className="link" onClick={() => setShowTable((s) => !s)}>{showTable ? 'Hide table' : 'Table view'}</button>}
          >
            <Legend items={[
              { label: 'Forecast at gate', className: 'sw-forecast' },
              ...(hasBand ? [{ label: 'Bias-adjusted', className: 'sw-adjusted' }, { label: '80% range', className: 'sw-band' }] : []),
              ...(reveal ? [{ label: 'Actual (outturn)', className: 'sw-actual' }] : []),
              ...(showVintages && data.vintages.length ? [{ label: 'Earlier runs', className: 'sw-vintage' }] : []),
            ]} />
            <div className="chart tall">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={points} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']}
                    tickFormatter={(t) => f.time(t)} stroke="var(--axis)" tick={{ fill: 'var(--text-2)', fontSize: 12 }}
                    ticks={points.filter((p) => new Date(p.t).getUTCMinutes() === 0 && new Date(p.t).getUTCHours() % 3 === 2).map((p) => p.t)} />
                  <YAxis tickFormatter={(v) => `${v / 1000}`} stroke="var(--axis)" width={44}
                    domain={[0, yTicks[yTicks.length - 1]]} ticks={yTicks}
                    tick={{ fill: 'var(--text-2)', fontSize: 12 }} />
                  <Tooltip content={<DayTip vintages={showVintages ? data.vintages : []} />} cursor={{ stroke: 'var(--axis)' }} />
                  {hasBand && <Area dataKey="band" stroke="none" fill="var(--band)" connectNulls isAnimationActive={false} activeDot={false} />}
                  {showVintages && data.vintages.map((v, i) => (
                    <Line key={v.publish} dataKey={`v${i}`} stroke="var(--vintage)" strokeWidth={1.5} dot={false}
                      connectNulls isAnimationActive={false} activeDot={false} />
                  ))}
                  {hasBand && <Line dataKey="adjusted" stroke="var(--s-adjusted)" strokeWidth={2} strokeDasharray="6 4"
                    dot={false} connectNulls isAnimationActive={false} />}
                  <Line dataKey="forecast" stroke="var(--s-forecast)" strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
                  {reveal && <Line dataKey="actual" stroke="var(--s-actual)" strokeWidth={2} dot={false} isAnimationActive={false} />}
                  <ReferenceLine x={new Date(data.window.start).getTime()} stroke="var(--grid)" />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {showTable && <HourTable data={data} reveal={reveal} />}
          </Card>
        </>
      )}
    </div>
  )
}

function DecisionContext({ data }: { data: DayView }) {
  const missedBy = data.next_run ? (new Date(data.next_run).getTime() - new Date(data.gate).getTime()) / 60000 : null
  return (
    <div className="context">
      <div>
        <span className="muted">Decision</span>
        <strong>{f.dateTime(data.gate)}</strong>
        <span className="muted">gate closure for delivery {f.dateTime(data.window.start)} → {f.dateTime(data.window.end)}</span>
      </div>
      <div>
        <span className="muted">Forecast used</span>
        <strong>{data.run_used ? `published ${f.time(data.run_used)}` : 'none available'}</strong>
        {data.minutes_before_gate != null && <span className="muted">{Math.round(data.minutes_before_gate)} min before gate</span>}
      </div>
      {data.next_run && (
        <div>
          <span className="muted">Next run</span>
          <strong>{f.time(data.next_run)}</strong>
          <span className="muted">{missedBy != null && missedBy <= 30 ? `lands ${Math.round(missedBy)} min after gate` : 'after gate, too late'}</span>
        </div>
      )}
      {data.revision && (
        <div>
          <span className="muted">Revision vs {f.time(data.revision.vs_publish)} run</span>
          <strong>{f.signedMw(data.revision.mean)}</strong>
          <span className="muted">max hourly change {f.mw(data.revision.max_abs)}</span>
        </div>
      )}
    </div>
  )
}

function toPoints(d: DayView, reveal: boolean): Point[] {
  const byT = new Map<number, Point>()
  const at = (iso: string) => {
    const t = new Date(iso).getTime()
    if (!byT.has(t)) byT.set(t, { t })
    return byT.get(t)!
  }
  for (const h of d.hourly) {
    const p = at(h.time)
    p.forecast = h.forecast
    if (h.adjusted != null) {
      p.adjusted = h.adjusted
      p.band = [h.low!, h.high!]
    }
  }
  if (reveal) for (const a of d.half_hourly) at(a.time).actual = a.actual
  d.vintages.forEach((v, i) => v.points.forEach((pt) => { at(pt.time)[`v${i}`] = pt.forecast }))
  return [...byT.values()].sort((a, b) => a.t - b.t)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function DayTip({ active, payload, label, vintages }: any) {
  if (!active || !payload?.length) return null
  const p: Point = payload[0].payload
  const rows = []
  if (p.forecast != null) rows.push({ label: 'Forecast', value: f.mw(p.forecast), className: 'sw-forecast' })
  if (p.adjusted != null) rows.push({ label: 'Bias-adjusted', value: f.mw(p.adjusted), className: 'sw-adjusted' })
  if (p.band) rows.push({ label: '80% range', value: `${f.gw(p.band[0])} – ${f.gw(p.band[1])}`, className: 'sw-band' })
  if (p.actual != null) rows.push({ label: 'Actual', value: f.mw(p.actual), className: 'sw-actual' })
  if (p.actual != null && p.forecast != null) rows.push({ label: 'Error (fc − actual)', value: f.signedMw(p.forecast - p.actual) })
  vintages.forEach((v: DayView['vintages'][number], i: number) => {
    const val = p[`v${i}`]
    if (val != null) rows.push({ label: `Run ${f.time(v.publish)}`, value: f.mw(val), className: 'sw-vintage' })
  })
  return <TipBox title={`${f.time(label)} UK`} rows={rows} />
}

function HourTable({ data, reveal }: { data: DayView; reveal: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Hour (UK)</th><th>Forecast</th><th>Bias-adj.</th><th>P10</th><th>P90</th>
            {reveal && <><th>Actual</th><th>Error</th></>}
          </tr>
        </thead>
        <tbody>
          {data.hourly.map((h) => (
            <tr key={h.time}>
              <td>{f.time(h.time)}</td>
              <td>{f.mw(h.forecast)}</td>
              <td>{f.mw(h.adjusted)}</td>
              <td>{f.mw(h.low)}</td>
              <td>{f.mw(h.high)}</td>
              {reveal && <><td>{f.mw(h.actual)}</td><td>{h.actual != null ? f.signedMw(h.forecast - h.actual) : '–'}</td></>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
