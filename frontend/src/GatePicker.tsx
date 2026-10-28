import type { Meta } from './api'

export function GatePicker({ gate, presets, onChange }: {
  gate: string
  presets: Meta['gate_presets']
  onChange: (g: string) => void
}) {
  return (
    <div className="gate">
      <label htmlFor="gate-input">Gate closure (D-1, UK)</label>
      <div className="gate-row">
        <select
          aria-label="Auction preset"
          value={presets.some((p) => p.time === gate) ? gate : ''}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        >
          {presets.map((p) => (
            <option key={p.time} value={p.time}>{p.label} · {p.time}</option>
          ))}
          <option value="">Custom</option>
        </select>
        <input
          id="gate-input"
          type="time"
          step={600}
          value={gate}
          onChange={(e) => e.target.value && onChange(e.target.value)}
        />
      </div>
    </div>
  )
}
