import { useMemo } from 'react'
import { isBlackKey, midiToName } from '@/music/pitch'
import { cn } from '@/shared/lib/utils'

export interface VirtualKeyboardProps {
  /** First and last MIDI note (inclusive). Defaults to C3 … C5. */
  low?: number
  high?: number
  /** Notes to light up (e.g. the chord just played, or the student's pick). */
  highlighted?: readonly number[]
  /** Secondary highlight (e.g. the correct answer after grading). */
  marked?: readonly number[]
  onNote?: (midi: number) => void
  /** Show letter names on white keys. */
  labels?: boolean
  /** Only the labelled key `C` (default) or all white keys. */
  labelAll?: boolean
  /** Custom text on specific keys (midi → text), e.g. "① G4". Overrides the default name. */
  markLabels?: Readonly<Record<number, string>>
  /** The key being played right now (drawn with a ring). */
  activeMidi?: number
  className?: string
  disabled?: boolean
}

const WHITE_W = 36
const WHITE_H = 120
const BLACK_W = 22
const BLACK_H = 74

/**
 * Clickable SVG piano. Pure presentation: playback happens in the caller so
 * the same component serves ear training, lessons and the composer later.
 */
export function VirtualKeyboard({
  low = 48,
  high = 72,
  highlighted = [],
  marked = [],
  onNote,
  labels = true,
  labelAll = false,
  markLabels,
  activeMidi,
  className,
  disabled,
}: VirtualKeyboardProps) {
  const { whites, blacks, width } = useMemo(() => {
    const whites: Array<{ midi: number; x: number }> = []
    const blacks: Array<{ midi: number; x: number }> = []
    let x = 0
    for (let m = low; m <= high; m++) {
      if (isBlackKey(m)) {
        blacks.push({ midi: m, x: x - BLACK_W / 2 })
      } else {
        whites.push({ midi: m, x })
        x += WHITE_W
      }
    }
    return { whites, blacks, width: x }
  }, [low, high])

  const hl = new Set(highlighted)
  const mk = new Set(marked)

  return (
    <svg
      viewBox={`0 0 ${width} ${WHITE_H}`}
      className={cn('w-full select-none', disabled && 'opacity-60', className)}
      role="group"
      aria-label="虚拟键盘"
    >
      {whites.map((k) => {
        const name = midiToName(k.midi, { octave: true })
        const isC = name.startsWith('C')
        const custom = markLabels?.[k.midi]
        return (
          <g key={k.midi}>
            <rect
              x={k.x + 1}
              y={0}
              width={WHITE_W - 2}
              height={WHITE_H}
              rx={4}
              strokeWidth={k.midi === activeMidi ? 3 : undefined}
              className={cn(
                'fill-[hsl(var(--foreground)/0.92)] stroke-[hsl(var(--background))] transition-colors duration-150',
                !disabled && onNote && 'cursor-pointer hover:fill-[hsl(var(--foreground)/0.78)]',
                mk.has(k.midi) && 'fill-[hsl(var(--success))]',
                hl.has(k.midi) && 'fill-[hsl(var(--amber))]',
                k.midi === activeMidi && 'stroke-[hsl(var(--foreground))]',
              )}
              onPointerDown={() => !disabled && onNote?.(k.midi)}
              role={onNote ? 'button' : undefined}
              aria-label={name}
            />
            {custom ? (
              <text
                x={k.x + WHITE_W / 2}
                y={WHITE_H - 10}
                textAnchor="middle"
                className="pointer-events-none fill-[hsl(var(--primary-foreground))] font-mono text-[10px] font-semibold"
              >
                {custom}
              </text>
            ) : (
              labels &&
              (isC || labelAll) && (
                <text
                  x={k.x + WHITE_W / 2}
                  y={WHITE_H - 10}
                  textAnchor="middle"
                  className="pointer-events-none fill-[hsl(var(--background))] font-mono text-[10px] font-medium"
                >
                  {name}
                </text>
              )
            )}
          </g>
        )
      })}
      {blacks.map((k) => (
        <rect
          key={k.midi}
          x={k.x}
          y={0}
          width={BLACK_W}
          height={BLACK_H}
          rx={3}
          strokeWidth={k.midi === activeMidi ? 3 : undefined}
          className={cn(
            'fill-[hsl(var(--background))] stroke-[hsl(var(--foreground)/0.25)] transition-colors duration-150',
            !disabled && onNote && 'cursor-pointer hover:fill-[hsl(var(--muted))]',
            mk.has(k.midi) && 'fill-[hsl(var(--success))]',
            hl.has(k.midi) && 'fill-[hsl(var(--amber))]',
            k.midi === activeMidi && 'stroke-[hsl(var(--foreground))]',
          )}
          onPointerDown={() => !disabled && onNote?.(k.midi)}
          role={onNote ? 'button' : undefined}
          aria-label={midiToName(k.midi, { octave: true })}
        />
      ))}
      {blacks.map((k) =>
        markLabels?.[k.midi] ? (
          <text
            key={`bl${k.midi}`}
            x={k.x + BLACK_W / 2}
            y={BLACK_H - 8}
            textAnchor="middle"
            className="pointer-events-none fill-[hsl(var(--primary-foreground))] font-mono text-[9px] font-semibold"
          >
            {markLabels[k.midi]}
          </text>
        ) : null,
      )}
    </svg>
  )
}
