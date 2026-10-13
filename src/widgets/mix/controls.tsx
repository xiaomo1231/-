import { ChevronDown } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'
import { Button, Slider } from '@/shared/ui'
import { MixLessonCard } from './MixLessonCard'
import type { ModuleId } from './mixUtils'

/** 开 / 关开关（旁通）。 */
export function OnSwitch({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cn(
        'focus-ring relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors',
        checked ? 'border-primary-strong bg-primary-strong' : 'border-border bg-muted',
      )}
    >
      <span
        className={cn(
          'block size-5 rounded-full bg-background shadow transition-transform',
          checked ? 'translate-x-5' : 'translate-x-0.5',
        )}
      />
    </button>
  )
}

export interface NumFieldProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  unit: string
  /** Slider runs on a log scale (min must be > 0). */
  log?: boolean
  /** Stored as 0–1, shown as 0–100 %. */
  percent?: boolean
  digits?: number
  disabled?: boolean
  onChange: (v: number) => void
}

/** Slider + number box for one parameter. The number box commits on blur or Enter. */
export function NumField({
  label,
  value,
  min,
  max,
  step,
  unit,
  log,
  percent,
  digits = 1,
  disabled,
  onChange,
}: NumFieldProps): JSX.Element {
  const k = percent ? 100 : 1
  const view = value * k
  const vmin = min * k
  const vmax = max * k
  const useLog = !!log && vmin > 0
  const [draft, setDraft] = useState<string | null>(null)

  const sliderValue = useLog
    ? (Math.log(Math.max(vmin, view) / vmin) / Math.log(vmax / vmin)) * 1000
    : view
  const shown = Number(view.toFixed(digits))

  const commit = () => {
    if (draft !== null && draft.trim() !== '') {
      const n = Number(draft)
      if (Number.isFinite(n)) onChange(Math.min(vmax, Math.max(vmin, n)) / k)
    }
    setDraft(null)
  }

  return (
    <div className={cn('space-y-1.5', disabled && 'opacity-50')}>
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="flex items-center gap-1">
          <input
            type="number"
            aria-label={label}
            disabled={disabled}
            min={vmin}
            max={vmax}
            step={step * k}
            value={draft ?? String(shown)}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
            className="focus-ring h-7 w-20 rounded-md border border-input bg-background px-2 text-right font-mono text-xs tabular-nums"
          />
          <span className="w-8 text-muted-foreground">{unit}</span>
        </span>
      </div>
      <Slider
        disabled={disabled}
        min={useLog ? 0 : vmin}
        max={useLog ? 1000 : vmax}
        step={useLog ? 1 : step * k}
        value={[sliderValue]}
        onValueChange={(v) => {
          const s = v[0]
          if (s === undefined) return
          const next = useLog ? vmin * Math.exp((s / 1000) * Math.log(vmax / vmin)) : s
          onChange(next / k)
        }}
      />
    </div>
  )
}

export interface ModulePanelProps {
  /** DOM id suffix, e.g. 'lowcut' or 'master'. */
  id: string
  title: string
  summary?: string
  /** Bypass switch state; null when the module has no switch. */
  on: boolean | null
  onToggle?: (v: boolean) => void
  open: boolean
  onToggleOpen: () => void
  /** Lesson card id; omit for sections without a lesson (母线). */
  lessonId?: ModuleId
  lessonOpen: boolean
  onToggleLesson: () => void
  /** Label of the pass being auditioned in this panel, if any. */
  listenLabel: string | null
  onListen: () => void
  listenDisabled?: boolean
  highlighted?: boolean
  panelRef?: (el: HTMLElement | null) => void
  children: ReactNode
}

/** One collapsible module card in the chain: header with bypass + 「这是什么」, body with the controls. */
export function ModulePanel(p: ModulePanelProps): JSX.Element {
  return (
    <section
      ref={p.panelRef}
      id={`mix-${p.id}`}
      className={cn(
        'scroll-mt-24 rounded-2xl border border-border/80 bg-card transition-shadow',
        p.highlighted && 'ring-2 ring-amber/70',
      )}
    >
      <header className="flex flex-wrap items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={p.onToggleOpen}
          aria-expanded={p.open}
          className="focus-ring flex min-w-0 flex-1 items-center gap-2 rounded-md text-left"
        >
          <ChevronDown
            className={cn(
              'size-4 shrink-0 text-muted-foreground transition-transform',
              !p.open && '-rotate-90',
            )}
          />
          <span className="font-medium text-foreground">{p.title}</span>
          {p.summary && <span className="truncate text-xs text-muted-foreground">{p.summary}</span>}
        </button>
        {p.on !== null && p.onToggle && (
          <OnSwitch checked={p.on} onChange={p.onToggle} label={`${p.title}开关`} />
        )}
        {p.lessonId && (
          <Button size="sm" variant="ghost" onClick={p.onToggleLesson} aria-expanded={p.lessonOpen}>
            这是什么
          </Button>
        )}
      </header>
      {p.open && (
        <div
          className={cn(
            'space-y-4 border-t border-border/60 px-4 py-4',
            p.on === false && 'opacity-70',
          )}
        >
          {p.children}
        </div>
      )}
      {p.lessonId && p.lessonOpen && (
        <div className="border-t border-border/60 px-4 py-4">
          <MixLessonCard
            lessonId={p.lessonId}
            onListen={p.onListen}
            playingLabel={p.listenLabel}
            disabled={p.listenDisabled}
          />
        </div>
      )}
    </section>
  )
}

export const selectClass =
  'focus-ring h-8 rounded-md border border-input bg-background px-2 text-sm'
