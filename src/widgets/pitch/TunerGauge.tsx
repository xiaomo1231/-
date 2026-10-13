import { cn } from '@/shared/lib/utils'

export interface TunerGaugeProps {
  /** Signed cents (null = no pitch). */
  cents: number | null
  /** Tolerance band drawn in green. */
  tolerance?: number
  /** Big label in the middle (note name). */
  label?: string
  sublabel?: string
  /** Input level 0–1 for the small level bar. */
  level?: number
  className?: string
}

const RANGE = 50

/**
 * Analogue VU-meter style tuner: a needle from −50 to +50 cents with a
 * green tolerance band. The needle eases with CSS so jitter reads as motion.
 */
export function TunerGauge({ cents, tolerance = 25, label, sublabel, level = 0, className }: TunerGaugeProps) {
  const clamped = cents === null ? 0 : Math.max(-RANGE, Math.min(RANGE, cents))
  const angle = (clamped / RANGE) * 60
  const inBand = cents !== null && Math.abs(cents) <= tolerance
  const arc = (from: number, to: number, r: number) => {
    const p = (deg: number) => {
      const rad = ((deg - 90) * Math.PI) / 180
      return [100 + r * Math.cos(rad), 110 + r * Math.sin(rad)]
    }
    const [x1, y1] = p(from)
    const [x2, y2] = p(to)
    return `M ${x1} ${y1} A ${r} ${r} 0 0 1 ${x2} ${y2}`
  }
  const tolDeg = (Math.min(tolerance, RANGE) / RANGE) * 60

  return (
    <div className={cn('relative rounded-3xl border border-border/80 bg-background/60 p-5', className)}>
      <svg viewBox="0 0 200 130" className="w-full" role="meter" aria-valuemin={-RANGE} aria-valuemax={RANGE} aria-valuenow={cents ?? 0} aria-label="音准表">
        <path d={arc(-60, 60, 86)} className="fill-none stroke-[hsl(var(--muted))]" strokeWidth={10} strokeLinecap="round" />
        <path d={arc(-tolDeg, tolDeg, 86)} className="fill-none stroke-[hsl(var(--success)/0.7)]" strokeWidth={10} strokeLinecap="round" />
        {[-50, -25, 0, 25, 50].map((c) => {
          const rad = (((c / RANGE) * 60 - 90) * Math.PI) / 180
          return (
            <g key={c}>
              <line x1={100 + 72 * Math.cos(rad)} y1={110 + 72 * Math.sin(rad)} x2={100 + 78 * Math.cos(rad)} y2={110 + 78 * Math.sin(rad)} className="stroke-[hsl(var(--muted-foreground))]" strokeWidth={1.5} />
              <text x={100 + 62 * Math.cos(rad)} y={110 + 62 * Math.sin(rad) + 3} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] font-mono text-[8px]">
                {c > 0 ? `+${c}` : c}
              </text>
            </g>
          )
        })}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: '100px 110px', transition: 'transform 120ms ease-out' }}>
          <line
            x1={100}
            y1={110}
            x2={100}
            y2={30}
            strokeWidth={2.5}
            strokeLinecap="round"
            className={cn(cents === null ? 'stroke-[hsl(var(--muted-foreground)/0.5)]' : inBand ? 'stroke-[hsl(var(--success))]' : 'stroke-[hsl(var(--amber))]')}
          />
        </g>
        <circle cx={100} cy={110} r={6} className="fill-[hsl(var(--foreground))]" />
      </svg>
      <div className="-mt-6 text-center">
        <div className={cn('font-display text-3xl font-semibold', inBand && 'text-success')}>{label ?? '—'}</div>
        <div className="num mt-1 text-xs text-muted-foreground">
          {cents === null ? sublabel ?? '等待声音…' : `${cents > 0 ? '+' : ''}${Math.round(cents)} 音分${sublabel ? ` · ${sublabel}` : ''}`}
        </div>
      </div>
      <div className="mt-3 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <div className="h-full bg-cyan transition-[width] duration-75" style={{ width: `${Math.min(100, level * 600)}%` }} />
      </div>
    </div>
  )
}
