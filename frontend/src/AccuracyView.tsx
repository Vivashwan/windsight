import { useEffect, useState } from 'react'
import {
  Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter,
  ScatterChart, Tooltip, XAxis, YAxis,
} from 'recharts'
import { api, type Accuracy, type Meta } from './api'
import * as f from './format'
import { Card, Legend, Segmented, Stat, Status, TipBox } from './ui'

type Mode = 'decision' | 'horizon'
const tick = { fill: 'var(--text-2)', fontSize: 12 }

export function AccuracyView({ meta, gate }: { meta: Meta; gate: string }) {
  const [start, setStart] = useState(meta.first_delivery_day)
  const [end, setEnd] = useState(meta.last_delivery_day)
  const [mode, setMode] = useState<Mode>('decision')
  const [horizon, setHorizon] = useState(24)
  const [data, setData] = useState<Accuracy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [showDailyTable, setShowDailyTable] = useState(false)

  useEffect(() => {
    let live = true
    setLoading(true)
    setError(null)
    const timer = setTimeout(() => {
      api.accuracy({ start, end, mode, gate, horizon })
        .then((d) => live && setData(d), (e) => live && setError(e.message))
        .finally(() => live && setLoading(false))
    }, 150) // debounce the horizon slider
    return () => { live = false; clearTimeout(timer) }
  }, [start, end, mode, gate, horizon])

  const s = data?.summary
  const be = data?.band_evaluation

  return (
    <div className="stack">
      <div className="controls">
        <div className="field">
          <label>Delivery days</label>
          <div className="range">
            <input type="date" aria-label="From" min={meta.first_delivery_day} max={end} value={start}
              onChange={(e) => e.target.value && setStart(e.target.value)} />
            <span className="muted">to</span>
            <input type="date" aria-label="To" min={start} max={meta.last_delivery_day} value={end}
              onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label>Which forecast is scored</label>
          <Segmented label="Forecast selection" value={mode} onChange={setMode} options={[
            { value: 'decision', label: `At gate closure (${gate})` },
            { value: 'horizon', label: 'Fixed lead time' },
          ]} />
        </div>
        {mode === 'horizon' && (
          <div className="field grow">
            <label htmlFor="horizon">Published at least <strong>{horizon} h</strong> before target</label>
            <input id="horizon" type="range" min={0} max={meta.max_horizon_h} value={horizon}
              onChange={(e) => setHorizon(Number(e.target.value))} />
          </div>
        )}
        {loading && data && <span className="muted">Updating…</span>}
      </div>

      <Status loading={loading && !data} error={error} />

      {data && s && (
        <>
          <p className="explainer">
            {mode === 'decision'
              ? <>Scoring the forecast a buyer actually had at <strong>{gate} on D-1</strong> for every hour of each delivery day (lead times {Math.round(data.lead_time_h!.min)}–{Math.round(data.lead_time_h!.max)} h).</>
              : <>Scoring, for every hour, the latest forecast published at least <strong>{horizon} h</strong> earlier.</>}
            {' '}Error = forecast − actual, so <strong>positive means less wind arrived than forecast</strong> and the shortfall had to be bought later.
          </p>

          <div className="stats">
            <Stat label="Mean absolute error" value={f.mw(s.mae)} sub={<>{f.pct(s.nmae)} of mean output ({f.gw(s.mean_actual)})</>} />
            <Stat label="Bias (mean error)" value={f.signedMw(s.bias)}
              sub={s.bias > 0 ? 'Forecast runs high: plan for less wind' : 'Forecast runs low'}
              tone={Math.abs(s.bias) > 0.5 * s.mae ? 'warn' : undefined} />
            <Stat label="80% of errors within" value={<>{f.signedGw(s.p10)} to {f.signedGw(s.p90)}</>} sub="P10 to P90 of forecast − actual" />
            <Stat label="1-in-20 hour error" value={f.mw(s.p95_abs)} sub={<>95th pct absolute · worst {f.mw(s.max_abs)}</>} />
            <Stat label="RMSE" value={f.mw(s.rmse)} sub={<>{s.n.toLocaleString('en-GB')} hourly comparisons</>} />
          </div>

          {be && (
            <Card title="Using the error at decision time"
              subtitle="Back-test of the two decision aids on the Day-ahead view. Each day uses only errors from the 14 days that had fully finished before its gate.">
              <div className="stats inner">
                <Stat label="80% range: hit rate" value={f.pct(be.coverage)}
                  sub={<>Actuals inside the P10–P90 band (target {f.pct(be.nominal_coverage)})</>} />
                <Stat label="Bias-adjusted MAE" value={f.mw(be.adjusted.mae)}
                  sub={<>vs {f.mw(s.mae)} raw · {f.pct(1 - be.adjusted.mae / s.mae)} lower</>} />
                <Stat label="Bias-adjusted bias" value={f.signedMw(be.adjusted.bias)} sub={<>vs {f.signedMw(s.bias)} raw</>} />
              </div>
            </Card>
          )}

          <div className="grid2">
            <Card title="Error grows with lead time" subtitle="Mean absolute error and P10–P90 error range (GW), by minimum lead time">
              <Legend items={[{ label: 'MAE', className: 'sw-forecast' }, { label: 'P10–P90 error', className: 'sw-band' }]} />
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.horizon_curve.map((r) => ({ ...r, range: [r.p10, r.p90] }))}
                    margin={{ top: 22, right: 16, bottom: 16, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="horizon_h" type="number" domain={[0, meta.max_horizon_h]} ticks={[0, 12, 24, 36, 48]}
                      stroke="var(--axis)" tick={tick} label={{ value: 'hours ahead', position: 'insideBottom', offset: -10, fill: 'var(--text-2)', fontSize: 12 }} />
                    <YAxis tickFormatter={(v) => `${v / 1000}`} stroke="var(--axis)" tick={tick} width={44} />
                    <ReferenceLine y={0} stroke="var(--axis)" />
                    {mode === 'horizon'
                      ? <ReferenceLine x={horizon} stroke="var(--text-2)" strokeDasharray="3 3" />
                      : data.lead_time_h && <ReferenceLine x={data.lead_time_h.median} stroke="var(--text-2)" strokeDasharray="3 3"
                          label={{ value: 'median at gate', position: 'top', fill: 'var(--text-2)', fontSize: 11 }} />}
                    <Tooltip content={<HorizonTip />} cursor={{ stroke: 'var(--axis)' }} />
                    <Area dataKey="range" stroke="none" fill="var(--band)" isAnimationActive={false} activeDot={false} />
                    <Line dataKey="mae" stroke="var(--s-forecast)" strokeWidth={2} dot={false} isAnimationActive={false} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Forecast vs actual" subtitle="GW. Each dot is one hour; dots below the diagonal are over-forecasts">
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 16, bottom: 16, left: 8 }}>
                    <CartesianGrid stroke="var(--grid)" />
                    <XAxis dataKey="forecast" type="number" domain={[0, 25000]} ticks={[0, 5000, 10000, 15000, 20000, 25000]} tickFormatter={(v) => `${v / 1000}`}
                      stroke="var(--axis)" tick={tick} label={{ value: 'forecast, GW', position: 'insideBottom', offset: -10, fill: 'var(--text-2)', fontSize: 12 }} />
                    <YAxis dataKey="actual" type="number" domain={[0, 25000]} ticks={[0, 5000, 10000, 15000, 20000, 25000]} tickFormatter={(v) => `${v / 1000}`}
                      stroke="var(--axis)" tick={tick} width={44} />
                    <ReferenceLine segment={[{ x: 0, y: 0 }, { x: 25000, y: 25000 }]} stroke="var(--text-2)" strokeDasharray="4 4" ifOverflow="hidden" />
                    <Tooltip content={<ScatterTip />} />
                    <Scatter data={data.scatter} fill="var(--s-forecast)" fillOpacity={0.45} isAnimationActive={false} />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Error by delivery day"
            subtitle="Mean absolute error and bias per day (GW). Use this to find the days the forecast badly missed"
            actions={<button className="link" onClick={() => setShowDailyTable((v) => !v)}>{showDailyTable ? 'Hide table' : 'Table view'}</button>}>
            <Legend items={[{ label: 'MAE', className: 'sw-forecast' }, { label: 'Bias', className: 'sw-actual' }]} />
            <div className="chart">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.daily} margin={{ top: 8, right: 16, bottom: 0, left: 8 }} barGap={2}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="day" tickFormatter={(d) => d.slice(8)} stroke="var(--axis)" tick={tick} interval="preserveStartEnd" />
                  <YAxis tickFormatter={(v) => `${v / 1000}`} stroke="var(--axis)" tick={tick} width={44} />
                  <ReferenceLine y={0} stroke="var(--axis)" />
                  <Tooltip content={<DailyTip />} cursor={{ fill: 'var(--hover)' }} />
                  <Bar dataKey="mae" fill="var(--s-forecast)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  <Bar dataKey="bias" fill="var(--s-actual)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            {showDailyTable && <DailyTable rows={data.daily} />}
          </Card>

          <div className="grid2">
            <Card title="Error by hour of day" subtitle="Mean absolute error (GW) by delivery hour, UK time">
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.by_hour} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="hour" tickFormatter={(h) => `${String(h).padStart(2, '0')}`} stroke="var(--axis)" tick={tick} interval={2} />
                    <YAxis tickFormatter={(v) => `${v / 1000}`} stroke="var(--axis)" tick={tick} width={44} />
                    <Tooltip content={<HourTip />} cursor={{ fill: 'var(--hover)' }} />
                    <Bar dataKey="mae" fill="var(--s-forecast)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card title="Distribution of errors" subtitle="Hours by forecast − actual, 1 GW bins">
              <div className="chart">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.histogram} margin={{ top: 8, right: 16, bottom: 16, left: 8 }} barCategoryGap={2}>
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="from" tickFormatter={(v) => `${v / 1000}`} stroke="var(--axis)" tick={tick}
                      label={{ value: 'error, GW (bin start)', position: 'insideBottom', offset: -10, fill: 'var(--text-2)', fontSize: 12 }} />
                    <YAxis stroke="var(--axis)" tick={tick} width={44} allowDecimals={false} />
                    <Tooltip content={<HistTip />} cursor={{ fill: 'var(--hover)' }} />
                    <Bar dataKey="count" fill="var(--s-forecast)" radius={[4, 4, 0, 0]} isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Does the gate time matter?" subtitle="The same days scored with the forecast available at each auction's gate closure">
            <div className="table-wrap">
              <table>
                <thead><tr><th>Auction</th><th>Gate (D-1)</th><th>MAE</th><th>Bias</th><th>95th pct |error|</th></tr></thead>
                <tbody>
                  {data.gate_comparison.map((g) => (
                    <tr key={g.time} className={g.time === gate ? 'current' : ''}>
                      <td>{g.label}</td><td>{g.time}</td><td>{f.mw(g.mae)}</td><td>{f.signedMw(g.bias)}</td><td>{f.mw(g.p95_abs)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">Forecast runs are published around 02:30, 04:30, 07:30, 09:30, 11:30, 15:30, 18:30 and 22:30. A 09:20 gate misses the 09:30 run by ten minutes.</p>
          </Card>
        </>
      )}
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function HorizonTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TipBox title={`${r.horizon_h} h ahead`} rows={[
    { label: 'MAE', value: f.mw(r.mae), className: 'sw-forecast' },
    { label: 'P10–P90', value: `${f.signedGw(r.p10)} to ${f.signedGw(r.p90)}`, className: 'sw-band' },
    { label: 'Bias', value: f.signedMw(r.bias) },
    { label: 'Hours scored', value: String(r.n) },
  ]} />
}

function ScatterTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TipBox title="One hour" rows={[
    { label: 'Forecast', value: f.mw(r.forecast) },
    { label: 'Actual', value: f.mw(r.actual) },
    { label: 'Error', value: f.signedMw(r.forecast - r.actual) },
  ]} />
}

function DailyTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TipBox title={`Delivery ${f.day(r.day)}`} rows={[
    { label: 'MAE', value: f.mw(r.mae), className: 'sw-forecast' },
    { label: 'Bias', value: f.signedMw(r.bias), className: 'sw-actual' },
    { label: 'Worst hour', value: f.mw(r.max_abs) },
  ]} />
}

function HourTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TipBox title={`${String(r.hour).padStart(2, '0')}:00 UK`} rows={[
    { label: 'MAE', value: f.mw(r.mae) },
    { label: 'Bias', value: f.signedMw(r.bias) },
    { label: 'P10–P90', value: `${f.signedGw(r.p10)} to ${f.signedGw(r.p90)}` },
  ]} />
}

function HistTip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const r = payload[0].payload
  return <TipBox title={`${f.signedGw(r.from)} to ${f.signedGw(r.to)}`} rows={[{ label: 'Hours', value: String(r.count) }]} />
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function DailyTable({ rows }: { rows: Accuracy['daily'] }) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr><th>Delivery day</th><th>Forecast</th><th>Actual</th><th>MAE</th><th>Bias</th><th>Worst hour</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.day}>
              <td>{f.day(r.day)}</td><td>{f.gwh(r.forecast_mwh)}</td><td>{f.gwh(r.actual_mwh)}</td>
              <td>{f.mw(r.mae)}</td><td>{f.signedMw(r.bias)}</td><td>{f.mw(r.max_abs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
