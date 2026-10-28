import { useEffect, useState } from 'react'
import { api, type Meta } from './api'
import { AccuracyView } from './AccuracyView'
import { DecisionView } from './DecisionView'
import { GatePicker } from './GatePicker'
import { dateTime } from './format'
import { Status } from './ui'

type Tab = 'decision' | 'accuracy'
const tabFromHash = (): Tab => (window.location.hash === '#accuracy' ? 'accuracy' : 'decision')

export default function App() {
  const [meta, setMeta] = useState<Meta | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>(tabFromHash)
  const [gate, setGate] = useState<string>('09:50')

  useEffect(() => {
    api.meta().then((m) => { setMeta(m); setGate(m.default_gate) }, (e) => setError(e.message))
    const onHash = () => setTab(tabFromHash())
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <svg className="logo" viewBox="0 0 32 32" aria-hidden><circle cx="16" cy="16" r="15" fill="currentColor" /><path d="M16 16l-1.2-11h2.4zM16 16l9.6 4.8-1.2 2zM16 16l-8.4 6.4-1.2-2z" fill="#fff" /><circle cx="16" cy="16" r="2" fill="#fff" /></svg>
          <div>
            <h1>Windsight</h1>
            <p className="muted">GB wind forecasts for day-ahead power buying</p>
          </div>
        </div>
        <nav className="tabs" aria-label="Views">
          <a href="#decision" className={tab === 'decision' ? 'on' : ''}>Day-ahead decision</a>
          <a href="#accuracy" className={tab === 'accuracy' ? 'on' : ''}>Forecast accuracy</a>
        </nav>
        {meta && <GatePicker gate={gate} presets={meta.gate_presets} onChange={setGate} />}
      </header>

      <main>
        <Status loading={!meta && !error} error={error} />
        {meta && (tab === 'decision' ? <DecisionView meta={meta} gate={gate} /> : <AccuracyView meta={meta} gate={gate} />)}
      </main>

      {meta && (
        <footer className="muted">
          Data: Elexon BMRS — actuals FUELHH (fuelType WIND, half-hourly) and forecasts WINDFOR (hourly, {meta.data.forecast_runs} runs).
          Source: {meta.data.source === 'live' ? 'live from Elexon' : 'bundled snapshot'} fetched {dateTime(meta.data.fetched_at)}.
          Times in UK local time. Delivery day = 23:00–23:00, gate closure on the day before.
        </footer>
      )}
    </div>
  )
}
