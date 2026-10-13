import type { TabNote } from '@/guitar/scales'
import { cn } from '@/shared/lib/utils'

const BEAT_W = 46
const GAP = 16
const LEFT = 30

export interface LeadTabProps {
  notes: readonly TabNote[]
  strings?: number
  /** Note being played (cursor). */
  active?: number | null
  /** Per-note result after grading. */
  results?: Array<boolean | null>
  className?: string
}

const TECH_LABEL = { bend: '全音推弦', 'bend-half': '半音推弦', vibrato: '揉弦', hammer: '击弦', pull: '勾弦', slide: '滑音' } as const

/**
 * Six-line tab with rhythm spacing and technique marks: bends (curved
 * arrow, 全 / ½), vibrato (wavy line), hammer-on / pull-off (arc with h / p)
 * and slides (diagonal line). Highest string on top.
 */
export function LeadTab({ notes, strings = 6, active = null, results, className }: LeadTabProps) {
  const xs: number[] = []
  let x = LEFT
  for (const n of notes) {
    xs.push(x)
    x += Math.max(0.5, n.beats) * BEAT_W
  }
  const width = x + 10
  const top = 26
  const y = (s: number) => top + (strings - 1 - s) * GAP
  const height = top + (strings - 1) * GAP + 18
  const label = notes
    .map((n) => `${6 - n.string} 弦 ${n.fret} 品${n.tech ? `（${TECH_LABEL[n.tech]}）` : ''}`)
    .join('，')
  return (
    <div className={cn('overflow-x-auto rounded-2xl border border-border/70 bg-background/40 p-2', className)}>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ minWidth: Math.min(width, 900) }} className="w-full" role="img" aria-label={`六线谱：${label}`}>
        <text x={4} y={top + 2.5 * GAP} className="fill-muted-foreground" fontSize={11} fontFamily="JetBrains Mono, monospace">
          TAB
        </text>
        {Array.from({ length: strings }, (_, s) => (
          <line key={s} x1={LEFT - 6} x2={width - 4} y1={y(s)} y2={y(s)} className="stroke-border" strokeWidth={1} />
        ))}
        {notes.map((n, i) => {
          const cx = xs[i]! + 10
          const cy = y(n.string)
          const res = results?.[i]
          const next = notes[i + 1]
          return (
            <g key={i}>
              {n.tech === 'vibrato' && (
                <path d={`M ${cx + 8} ${cy - 10} q 3 -4 6 0 t 6 0 t 6 0 t 6 0`} fill="none" className="stroke-amber" strokeWidth={1.4} />
              )}
              {(n.tech === 'bend' || n.tech === 'bend-half') && (
                <>
                  <path d={`M ${cx + 8} ${cy} Q ${cx + 22} ${cy} ${cx + 22} ${cy - 18}`} fill="none" className="stroke-amber" strokeWidth={1.4} />
                  <path d={`M ${cx + 18} ${cy - 13} L ${cx + 22} ${cy - 19} L ${cx + 26} ${cy - 13}`} fill="none" className="stroke-amber" strokeWidth={1.4} />
                  <text x={cx + 22} y={cy - 22} textAnchor="middle" fontSize={10} className="fill-amber">
                    {n.tech === 'bend' ? '全' : '½'}
                  </text>
                </>
              )}
              {(n.tech === 'hammer' || n.tech === 'pull') && next && (
                <>
                  <path d={`M ${cx} ${cy - 9} Q ${(cx + xs[i + 1]! + 10) / 2} ${cy - 22} ${xs[i + 1]! + 10} ${y(next.string) - 9}`} fill="none" className="stroke-cyan" strokeWidth={1.2} />
                  <text x={(cx + xs[i + 1]! + 10) / 2} y={cy - 20} textAnchor="middle" fontSize={10} className="fill-cyan">
                    {n.tech === 'hammer' ? 'h' : 'p'}
                  </text>
                </>
              )}
              {n.tech === 'slide' && next && <line x1={cx + 8} y1={cy + 4} x2={xs[i + 1]! + 2} y2={y(next.string) - 4} className="stroke-cyan" strokeWidth={1.4} />}
              <rect
                x={cx - 9}
                y={cy - 8}
                width={18}
                height={16}
                rx={4}
                className={cn(active === i ? 'fill-amber' : res === true ? 'fill-success/30' : res === false ? 'fill-destructive/30' : 'fill-background')}
              />
              <text x={cx} y={cy + 4} textAnchor="middle" fontSize={12} fontFamily="JetBrains Mono, monospace" className={active === i ? 'fill-background' : 'fill-foreground'}>
                {n.fret}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
