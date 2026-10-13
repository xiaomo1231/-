import { INLAY_FRETS, type FretPosition, type Tuning } from '@/music/fretboard'
import { midiToName } from '@/music/pitch'
import { cn } from '@/shared/lib/utils'

export interface FretMarker extends FretPosition {
  label?: string
  /** 'root' draws amber, 'note' cyan, 'ghost' outline only. */
  tone?: 'root' | 'note' | 'ghost' | 'ok' | 'bad'
  /** Drawn larger with a ring (the note being played right now). */
  active?: boolean
  /** Small badge at the marker's upper right (e.g. the order ①). */
  badge?: string
}

export interface FretboardProps {
  tuning: Tuning
  markers: readonly FretMarker[]
  fromFret?: number
  toFret?: number
  onPosition?: (p: FretPosition) => void
  className?: string
}

const FRET_W = 54
const STRING_GAP = 22
const NUT_X = 36

/**
 * Horizontal fretboard, highest string on top (tab orientation). Markers
 * are drawn on the given positions; fret 0 sits left of the nut.
 */
export function Fretboard({ tuning, markers, fromFret = 0, toFret = 12, onPosition, className }: FretboardProps) {
  const strings = tuning.strings.length
  const frets = toFret - fromFret
  const width = NUT_X + frets * FRET_W + 16
  const height = (strings - 1) * STRING_GAP + 52
  const top = 18
  const yOf = (s: number) => top + (strings - 1 - s) * STRING_GAP
  const xOf = (f: number) => (f === 0 ? NUT_X - 16 : NUT_X + (f - fromFret - 0.5) * FRET_W)

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={cn('w-full select-none', className)} role="img" aria-label="指板">
      {/* Fret wires */}
      {Array.from({ length: frets + 1 }, (_, i) => {
        const x = NUT_X + i * FRET_W
        const isNut = fromFret + i === 0
        return (
          <line
            key={`f${i}`}
            x1={x}
            x2={x}
            y1={top}
            y2={yOf(0)}
            className={isNut ? 'stroke-[hsl(var(--foreground))]' : 'stroke-[hsl(var(--border))]'}
            strokeWidth={isNut ? 5 : 2}
          />
        )
      })}
      {/* Inlays */}
      {INLAY_FRETS.filter((f) => f > fromFret && f <= toFret).map((f) => {
        const x = NUT_X + (f - fromFret - 0.5) * FRET_W
        const mid = (top + yOf(0)) / 2
        return f === 12 ? (
          <g key={`i${f}`} className="fill-[hsl(var(--muted))]">
            <circle cx={x} cy={mid - STRING_GAP} r={5} />
            <circle cx={x} cy={mid + STRING_GAP} r={5} />
          </g>
        ) : (
          <circle key={`i${f}`} cx={x} cy={mid} r={5} className="fill-[hsl(var(--muted))]" />
        )
      })}
      {/* Strings */}
      {tuning.strings.map((open, s) => (
        <g key={`s${s}`}>
          <line
            x1={NUT_X - 26}
            x2={width - 6}
            y1={yOf(s)}
            y2={yOf(s)}
            className="stroke-[hsl(var(--muted-foreground)/0.6)]"
            strokeWidth={s < 3 ? 2.6 - s * 0.3 : 1.6}
          />
          <text x={4} y={yOf(s) + 4} className="fill-[hsl(var(--muted-foreground))] font-mono text-[10px]">
            {midiToName(open)}
          </text>
        </g>
      ))}
      {/* Fret numbers */}
      {Array.from({ length: frets }, (_, i) => fromFret + i + 1)
        .filter((f) => INLAY_FRETS.includes(f) || f === 1)
        .map((f) => (
          <text key={`n${f}`} x={NUT_X + (f - fromFret - 0.5) * FRET_W} y={height - 6} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] font-mono text-[10px]">
            {f}
          </text>
        ))}
      {/* Click targets */}
      {onPosition &&
        tuning.strings.map((open, s) =>
          Array.from({ length: frets + 1 }, (_, i) => {
            const f = i === 0 ? 0 : fromFret + i
            if (i === 0 && fromFret > 0) return null
            return (
              <rect
                key={`c${s}-${f}`}
                x={f === 0 ? NUT_X - 30 : NUT_X + (f - fromFret - 1) * FRET_W}
                y={yOf(s) - STRING_GAP / 2}
                width={f === 0 ? 26 : FRET_W}
                height={STRING_GAP}
                className="cursor-pointer fill-transparent hover:fill-[hsl(var(--cyan)/0.12)]"
                onPointerDown={() => onPosition({ string: s, fret: f, midi: open + f })}
              />
            )
          }),
        )}
      {/* Markers */}
      {markers
        .filter((m) => m.fret === 0 || (m.fret > fromFret && m.fret <= toFret))
        .map((m, i) => {
          const tone = m.tone ?? 'note'
          const active = m.active === true
          return (
            <g key={`m${i}`} className="pointer-events-none">
              <circle
                cx={xOf(m.fret)}
                cy={yOf(m.string)}
                r={active ? 12.5 : 9.5}
                className={cn(
                  'transition-[r] duration-150',
                  tone === 'root' && 'fill-[hsl(var(--amber))]',
                  tone === 'note' && 'fill-[hsl(var(--cyan))]',
                  tone === 'ok' && 'fill-[hsl(var(--success))]',
                  tone === 'bad' && 'fill-[hsl(var(--destructive))]',
                  tone === 'ghost' && 'fill-transparent stroke-[hsl(var(--cyan))]',
                  active && 'stroke-[hsl(var(--foreground))]',
                )}
                strokeWidth={active ? 3 : tone === 'ghost' ? 2 : 0}
              />
              {m.label && (
                <text
                  x={xOf(m.fret)}
                  y={yOf(m.string) + 3.5}
                  textAnchor="middle"
                  className={cn('font-mono text-[9px] font-semibold', tone === 'ghost' ? 'fill-[hsl(var(--cyan))]' : 'fill-[hsl(var(--primary-foreground))]')}
                >
                  {m.label}
                </text>
              )}
              {m.badge && (
                <g>
                  <circle cx={xOf(m.fret) + 12} cy={yOf(m.string) - 11} r={7.5} className="fill-[hsl(var(--card))] stroke-[hsl(var(--border))]" strokeWidth={1} />
                  <text x={xOf(m.fret) + 12} y={yOf(m.string) - 7.5} textAnchor="middle" className="fill-[hsl(var(--foreground))] text-[10px] font-semibold">
                    {m.badge}
                  </text>
                </g>
              )}
            </g>
          )
        })}
    </svg>
  )
}
