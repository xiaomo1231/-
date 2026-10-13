import type { HitGrade, StrumPattern } from '@/guitar/strum'
import { cn } from '@/shared/lib/utils'

const COUNT_8 = ['1', '&', '2', '&', '3', '&', '4', '&']
const COUNT_16 = ['1', 'e', '&', 'a', '2', 'e', '&', 'a', '3', 'e', '&', 'a', '4', 'e', '&', 'a']

const SYMBOL = { D: '↓', U: '↑', X: '✕', '-': '·' } as const
const SPOKEN = { D: '下扫', U: '上扫', X: '闷音', '-': '空' } as const

export interface StrumGridProps {
  pattern: StrumPattern
  /** Chord symbol shown above the bar. */
  chord?: string
  /** Index of the cell being played now (null when stopped). */
  activeCell?: number | null
  /** Grade per strummed cell, in cell order (cells with "-" are skipped). */
  grades?: Array<HitGrade | null>
  className?: string
}

/** One bar of strumming notation: counts, arrows, live position and grades. */
export function StrumGrid({ pattern, chord, activeCell = null, grades, className }: StrumGridProps) {
  const counts = pattern.grid === 16 ? COUNT_16 : COUNT_8
  let strumIndex = -1
  return (
    <div className={cn('rounded-2xl border border-border/70 bg-background/40 p-3', className)} role="img" aria-label={`节奏型 ${pattern.name}：${pattern.cells.map((c) => SPOKEN[c]).join('、')}`}>
      {chord && <div className="mb-1 font-display text-lg font-semibold text-cyan">{chord}</div>}
      <div className="grid gap-1" style={{ gridTemplateColumns: `repeat(${pattern.grid}, minmax(0, 1fr))` }}>
        {pattern.cells.map((c, i) => {
          if (c !== '-') strumIndex++
          const grade = c !== '-' ? grades?.[strumIndex] : undefined
          const beatStart = i % (pattern.grid / 4) === 0
          return (
            <div key={i} className={cn('flex flex-col items-center rounded-lg py-1 transition-colors', activeCell === i && 'bg-amber-soft/50', beatStart && 'border-l border-border/60')}>
              <span className={cn('num text-[10px]', beatStart ? 'text-foreground' : 'text-muted-foreground')}>{counts[i]}</span>
              <span
                className={cn(
                  'text-2xl leading-8',
                  c === '-' ? 'text-muted-foreground/50' : 'text-foreground',
                  grade === 'perfect' && 'text-success',
                  grade === 'good' && 'text-cyan',
                  grade === 'miss' && 'text-destructive',
                )}
              >
                {SYMBOL[c]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
