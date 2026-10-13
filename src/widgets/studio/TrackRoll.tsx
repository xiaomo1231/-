import { useMemo } from 'react'
import { isBlackKey, midiToName, pitchClass } from '@/music/pitch'
import { chordAt, slotPitchClasses, slotSymbol, type Score, type ScoreNote } from '@/music/score'
import { cn } from '@/shared/lib/utils'

const CELL_W = 22
const ROW_H = 14
const KEY_W = 54
const LANE_H = 24

/**
 * Polyphonic note grid for an accompaniment track (eighth-note cells). A
 * click toggles a note of the chosen length; chord tones of the chord above
 * each column are tinted so voicings are easy to find.
 */
export function TrackRoll({
  score,
  notes,
  low,
  high,
  cursorBeat,
  onToggle,
  onAudition,
}: {
  score: Score
  notes: readonly ScoreNote[]
  low: number
  high: number
  cursorBeat: number | null
  onToggle: (start: number, midi: number) => void
  onAudition: (midi: number) => void
}) {
  const cells = score.bars * score.beatsPerBar * 2
  const rows = useMemo(() => Array.from({ length: high - low + 1 }, (_, i) => high - i), [low, high])
  const tones = useMemo(
    () =>
      Array.from({ length: cells }, (_, c) => {
        const slot = chordAt(score, c / 2)
        return slot ? new Set(slotPitchClasses(score, slot)) : null
      }),
    [score, cells],
  )
  const width = KEY_W + cells * CELL_W
  const height = LANE_H + rows.length * ROW_H
  return (
    <div className="max-h-[360px] overflow-auto rounded-2xl border border-border/70 bg-background/60">
      <svg width={width} height={height} className="block select-none" role="grid" aria-label="轨道音符">
        {score.chords.map((c) => (
          <text key={c.start} x={KEY_W + c.start * 2 * CELL_W + 6} y={16} className="fill-[hsl(var(--cyan))] font-display text-[11px] font-semibold">
            {slotSymbol(score, c)}
          </text>
        ))}
        <g transform={`translate(0 ${LANE_H})`}>
          {rows.map((m, r) => (
            <g key={m}>
              <rect x={0} y={r * ROW_H} width={KEY_W} height={ROW_H} className={cn('cursor-pointer', isBlackKey(m) ? 'fill-[hsl(var(--muted))]' : 'fill-[hsl(var(--card))]')} onPointerDown={() => onAudition(m)} />
              <text x={KEY_W - 6} y={r * ROW_H + 10} textAnchor="end" className="pointer-events-none fill-[hsl(var(--muted-foreground))] font-mono text-[8px]">
                {midiToName(m, { octave: true })}
              </text>
              {Array.from({ length: cells }, (_, c) => (
                <rect
                  key={c}
                  x={KEY_W + c * CELL_W}
                  y={r * ROW_H}
                  width={CELL_W}
                  height={ROW_H}
                  className={cn('cursor-pointer hover:fill-[hsl(var(--cyan)/0.25)]', tones[c]?.has(pitchClass(m)) ? 'fill-[hsl(var(--cyan)/0.1)]' : 'fill-transparent')}
                  onPointerDown={() => onToggle(c / 2, m)}
                />
              ))}
            </g>
          ))}
          {Array.from({ length: cells + 1 }, (_, c) => (
            <line key={`v${c}`} x1={KEY_W + c * CELL_W} x2={KEY_W + c * CELL_W} y1={0} y2={rows.length * ROW_H} className={c % 8 === 0 ? 'stroke-[hsl(var(--foreground)/0.35)]' : c % 2 === 0 ? 'stroke-[hsl(var(--border))]' : 'stroke-[hsl(var(--border)/0.3)]'} />
          ))}
          {notes.map((n, i) => {
            const r = high - n.midi
            if (r < 0 || r >= rows.length) return null
            return (
              <rect
                key={i}
                x={KEY_W + n.start * 2 * CELL_W + 1}
                y={r * ROW_H + 1}
                width={Math.max(4, n.beats * 2 * CELL_W - 2)}
                height={ROW_H - 2}
                rx={3}
                className="cursor-pointer fill-[hsl(var(--amber))]"
                onPointerDown={() => onToggle(n.start, n.midi)}
              />
            )
          })}
        </g>
        {cursorBeat !== null && <line x1={KEY_W + cursorBeat * 2 * CELL_W} x2={KEY_W + cursorBeat * 2 * CELL_W} y1={0} y2={height} className="pointer-events-none stroke-[hsl(var(--cyan))]" strokeWidth={2} />}
      </svg>
    </div>
  )
}

const DRUM_ROWS: Array<{ midi: number; label: string }> = [
  { midi: 49, label: '吊镲' },
  { midi: 46, label: '开镲' },
  { midi: 42, label: '踩镲' },
  { midi: 38, label: '军鼓' },
  { midi: 36, label: '底鼓' },
]

/** Drum step grid: sixteenth notes per bar, one row per drum. */
export function DrumGrid({ score, notes, cursorBeat, onToggle }: { score: Score; notes: readonly ScoreNote[]; cursorBeat: number | null; onToggle: (start: number, midi: number) => void }) {
  const steps = score.bars * score.beatsPerBar * 4
  const on = useMemo(() => new Set(notes.map((n) => `${Math.round(n.start * 4)}:${n.midi}`)), [notes])
  const W = 14
  const H = 22
  const width = KEY_W + steps * W
  return (
    <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/60">
      <svg width={width} height={DRUM_ROWS.length * H + 4} className="block select-none" role="grid" aria-label="鼓谱">
        {DRUM_ROWS.map((row, r) => (
          <g key={row.midi}>
            <text x={KEY_W - 8} y={r * H + 15} textAnchor="end" className="fill-[hsl(var(--muted-foreground))] text-[11px]">
              {row.label}
            </text>
            {Array.from({ length: steps }, (_, st) => {
              const active = on.has(`${st}:${row.midi}`)
              return (
                <rect
                  key={st}
                  x={KEY_W + st * W + 1}
                  y={r * H + 3}
                  width={W - 2}
                  height={H - 4}
                  rx={3}
                  className={cn('cursor-pointer', active ? 'fill-[hsl(var(--amber))]' : st % 4 === 0 ? 'fill-[hsl(var(--foreground)/0.12)] hover:fill-[hsl(var(--cyan)/0.35)]' : 'fill-[hsl(var(--foreground)/0.05)] hover:fill-[hsl(var(--cyan)/0.35)]')}
                  onPointerDown={() => onToggle(st / 4, row.midi)}
                />
              )
            })}
          </g>
        ))}
        {Array.from({ length: score.bars + 1 }, (_, b) => (
          <line key={b} x1={KEY_W + b * 16 * W} x2={KEY_W + b * 16 * W} y1={0} y2={DRUM_ROWS.length * H + 4} className="stroke-[hsl(var(--foreground)/0.4)]" />
        ))}
        {cursorBeat !== null && <line x1={KEY_W + cursorBeat * 4 * W} x2={KEY_W + cursorBeat * 4 * W} y1={0} y2={DRUM_ROWS.length * H} className="pointer-events-none stroke-[hsl(var(--cyan))]" strokeWidth={2} />}
      </svg>
    </div>
  )
}
