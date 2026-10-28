import type { ReactNode } from 'react'

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: 'warn' }) {
  return (
    <div className={`stat ${tone ?? ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </div>
  )
}

export function Card({ title, subtitle, children, actions }: {
  title: string
  subtitle?: ReactNode
  children: ReactNode
  actions?: ReactNode
}) {
  return (
    <section className="card">
      <header className="card-head">
        <div>
          <h2>{title}</h2>
          {subtitle && <p className="muted">{subtitle}</p>}
        </div>
        {actions}
      </header>
      {children}
    </section>
  )
}

export function Segmented<T extends string>({ value, options, onChange, label }: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Legend({ items }: { items: { label: string; className: string }[] }) {
  return (
    <ul className="legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`swatch ${i.className}`} />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** Tooltip shell used by every chart; rows are passed in already formatted. */
export function TipBox({ title, rows }: { title: string; rows: { label: string; value: string; className?: string }[] }) {
  return (
    <div className="tip">
      <div className="tip-title">{title}</div>
      {rows.map((r) => (
        <div key={r.label} className="tip-row">
          {r.className && <span className={`swatch ${r.className}`} />}
          <span className="tip-label">{r.label}</span>
          <span className="tip-value">{r.value}</span>
        </div>
      ))}
    </div>
  )
}

export function Status({ loading, error }: { loading: boolean; error: string | null }) {
  if (error) return <div className="banner error" role="alert">{error}</div>
  if (loading) return <div className="banner" aria-live="polite">Loading…</div>
  return null
}
