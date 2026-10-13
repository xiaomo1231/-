import type { ChordShape } from '@/music/fretboard'
import { cn } from '@/shared/lib/utils'

/** Vertical chord box (six strings, low E on the left). */
export function ChordDiagram({ shape, className }: { shape: ChordShape; className?: string }) {
  const played = shape.frets.filter((f): f is number => f !== null && f > 0)
  const minFret = played.length ? Math.min(...played) : 1
  const startFret = minFret > 3 ? minFret : 1
  const rows = 5
  const gap = 18
  const left = 22
  const top = 34
  const strings = shape.frets.length
  const xOf = (s: number) => left + s * gap
  const yOf = (row: number) => top + row * gap

  return (
    <figure className={cn('inline-flex flex-col items-center', className)}>
      <svg viewBox={`0 0 ${left * 2 + (strings - 1) * gap} ${top + rows * gap + 12}`} className="w-32" role="img" aria-label={`${shape.symbol} 和弦指法`}>
        <text x={left + ((strings - 1) * gap) / 2} y={14} textAnchor="middle" className="fill-[hsl(var(--foreground))] font-display text-[13px] font-semibold">
          {shape.symbol}
        </text>
        {/* Nut or starting fret label */}
        {startFret === 1 ? (
          <rect x={left - 1} y={top - 4} width={(strings - 1) * gap + 2} height={4} className="fill-[hsl(var(--foreground))]" />
        ) : (
          <text x={left - 8} y={top + gap / 2 + 4} textAnchor="end" className="fill-[hsl(var(--muted-foreground))] font-mono text-[10px]">
            {startFret}
          </text>
        )}
        {Array.from({ length: rows + 1 }, (_, r) => (
          <line key={`r${r}`} x1={left} x2={left + (strings - 1) * gap} y1={yOf(r)} y2={yOf(r)} className="stroke-[hsl(var(--border))]" strokeWidth={1.5} />
        ))}
        {Array.from({ length: strings }, (_, s) => (
          <line key={`s${s}`} x1={xOf(s)} x2={xOf(s)} y1={top} y2={yOf(rows)} className="stroke-[hsl(var(--muted-foreground)/0.7)]" strokeWidth={1.2} />
        ))}
        {shape.barre && (
          <rect
            x={xOf(shape.barre.from) - 7}
            y={yOf(shape.barre.fret - startFret + 0.5) - 7}
            width={xOf(shape.barre.to) - xOf(shape.barre.from) + 14}
            height={14}
            rx={7}
            className="fill-[hsl(var(--amber))]"
          />
        )}
        {shape.frets.map((f, s) => {
          if (f === null) {
            return (
              <text key={`x${s}`} x={xOf(s)} y={top - 9} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[11px]">
                ×
              </text>
            )
          }
          if (f === 0) return <circle key={`o${s}`} cx={xOf(s)} cy={top - 13} r={4} className="fill-none stroke-[hsl(var(--foreground))]" strokeWidth={1.4} />
          if (shape.barre && f === shape.barre.fret) return null
          return <circle key={`d${s}`} cx={xOf(s)} cy={yOf(f - startFret + 0.5)} r={7} className="fill-[hsl(var(--amber))]" />
        })}
      </svg>
    </figure>
  )
}
