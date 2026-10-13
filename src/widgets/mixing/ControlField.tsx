import { CONTROLS, getPath, setPath } from '@/mixing/controls'
import type { MixSettings } from '@/songs/singTypes'
import { NumField, OnSwitch } from '@/widgets/mix/controls'

/** One setting from the CONTROLS registry, as a number field, switch or select. */
export function ControlField({ path, mix, onChange }: { path: string; mix: MixSettings; onChange: (m: MixSettings) => void }) {
  const spec = CONTROLS[path]
  if (!spec) return null
  const value = getPath(mix, path)
  if (spec.kind === 'switch')
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2 text-sm">
        <span>{spec.label}</span>
        <OnSwitch checked={Boolean(value)} onChange={(v) => onChange(setPath(mix, path, v))} label={spec.label} />
      </div>
    )
  if (spec.kind === 'select')
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-muted-foreground">{spec.label}</span>
        <select value={String(value)} onChange={(e) => onChange(setPath(mix, path, e.target.value))} className="focus-ring h-9 rounded-lg border border-border bg-background px-2">
          {spec.options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    )
  return (
    <NumField
      label={spec.label}
      value={typeof value === 'number' ? value : spec.min}
      min={spec.min}
      max={spec.max}
      step={spec.step}
      unit={spec.unit}
      {...(spec.log ? { log: true } : {})}
      {...(spec.percent ? { percent: true } : {})}
      {...(spec.digits !== undefined ? { digits: spec.digits } : {})}
      onChange={(v) => onChange(setPath(mix, path, v))}
    />
  )
}
