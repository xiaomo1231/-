import { useMemo } from 'react'
import { isBlackKey, midiToName, pitchClass } from '@/music/pitch'
import { chordAt, slotPitchClasses, type ChordSlot, type Score } from '@/music/score'
import { scaleById } from '@/music/scales'
import { cn } from '@/shared/lib/utils'

export interface PianoRollProps {
  score: Score
  /** Lowest and highest MIDI rows. */
  low: number
  high: number
  cursorBeat: number | null
  warnNotes?: ReadonlySet<number>
  editable?: boolean
  onAdd: (start: number, midi: number) => void
  onRemove: (start: number) => void
  onAudition: (midi: number) => void
  /** Chord lane drawn above the grid so chords and notes scroll together. */
  chordLane?: {
    editable: boolean
    brushBeats: 2 | 4
    onPaint: (start: number, beats: number) => void
    describe: (slot: ChordSlot) => { symbol: string; roman: string; tone: string }
  }
}

const CELL_W = 22
const ROW_H = 16
const KEY_W = 54
const LANE_H = 40

/**
 * Melody piano roll on an eighth-note grid. Rows in the key are bright,
 * chord tones of the chord above each column are tinted, notes carry a
 * warning outline when the rule engine flagged them.
 */
export function PianoRoll({ score, low, high, cursorBeat, warnNotes, editable = true, onAdd, onRemove, onAudition, chordLane }: PianoRollProps) {
  const cells = score.bars * score.beatsPerBar * 2
  const rows = useMemo(() => Array.from({ length: high - low + 1 }, (_, i) => high - i), [low, high])
  const scalePcs = useMemo(() => {
    const steps = scaleById(score.mode === 'minor' ? 'natural_minor' : 'major').steps
    return new Set(steps.map((st) => pitchClass(score.keyTonic + st)))
  }, [score.keyTonic, score.mode])
  const chordTonesByCell = useMemo(() => {
    const out: Array<Set<number> | null> = []
    for (let c = 0; c < cells; c++) {
      const slot = chordAt(score, c / 2)
      out.push(slot ? new Set(slotPitchClasses(score, slot)) : null)
    }
    return out
  }, [score, cells])

  const width = KEY_W + cells * CELL_W
  const lane = chordLane ? LANE_H : 0
  const height = rows.length * ROW_H + lane

  return (
    <div className="max-h-[420px] overflow-auto rounded-2xl border border-border/70 bg-background/60">
      <svg width={width} height={height} className="block select-none" role="grid" aria-label="钢琴卷帘">
        {chordLane && (
          <g>
            <rect x={0} y={0} width={KEY_W} height={LANE_H} className="fill-[hsl(var(--card))]" />
            <text x={KEY_W - 6} y={24} textAnchor="end" className="fill-[hsl(var(--muted-foreground))] text-[10px]">和弦</text>
            {Array.from({ length: score.bars * 2 }, (_, i) => (
              <rect
                key={`slot${i}`}
                x={KEY_W + i * 4 * CELL_W + 1}
                y={2}
                width={4 * CELL_W - 2}
                height={LANE_H - 4}
                rx={6}
                className={cn('fill-[hsl(var(--foreground)/0.03)] stroke-[hsl(var(--border))]', chordLane.editable && 'cursor-pointer hover:fill-[hsl(var(--cyan)/0.15)]')}
                strokeDasharray="3 3"
                onPointerDown={() => chordLane.editable && chordLane.onPaint(chordLane.brushBeats === 4 ? Math.floor(i / 2) * 4 : i * 2, chordLane.brushBeats)}
              >
                <title>{`第 ${Math.floor(i / 2) + 1} 小节${i % 2 ? '后半' : '前半'}`}</title>
              </rect>
            ))}
            {score.chords.map((c) => {
              const d = chordLane.describe(c)
              return (
                <g key={`chord${c.start}`} className="pointer-events-none">
                  <rect x={KEY_W + c.start * 2 * CELL_W + 2} y={3} width={c.beats * 2 * CELL_W - 4} height={LANE_H - 6} rx={6} className={d.tone} />
                  <text x={KEY_W + c.start * 2 * CELL_W + 9} y={19} className="fill-[hsl(var(--foreground))] font-display text-[13px] font-semibold">{d.symbol}</text>
                  <text x={KEY_W + c.start * 2 * CELL_W + 9} y={32} className="fill-[hsl(var(--muted-foreground))] font-mono text-[9px]">{d.roman}</text>
                </g>
              )
            })}
          </g>
        )}
        <g transform={`translate(0 ${lane})`}>
        {rows.map((m, r) => {
          const inKey = scalePcs.has(pitchClass(m))
          const isTonic = pitchClass(m) === pitchClass(score.keyTonic)
          return (
            <g key={m}>
              <rect
                x={0}
                y={r * ROW_H}
                width={KEY_W}
                height={ROW_H}
                className={cn('cursor-pointer', isBlackKey(m) ? 'fill-[hsl(var(--muted))]' : 'fill-[hsl(var(--card))]')}
                onPointerDown={() => onAudition(m)}
              />
              <text x={KEY_W - 6} y={r * ROW_H + 12} textAnchor="end" className={cn('pointer-events-none font-mono text-[9px]', isTonic ? 'fill-[hsl(var(--amber))]' : inKey ? 'fill-[hsl(var(--foreground)/0.8)]' : 'fill-[hsl(var(--muted-foreground)/0.6)]')}>
                {midiToName(m, { octave: true })}
              </text>
              {Array.from({ length: cells }, (_, c) => {
                const chordTone = chordTonesByCell[c]?.has(pitchClass(m))
                return (
                  <rect
                    key={c}
                    x={KEY_W + c * CELL_W}
                    y={r * ROW_H}
                    width={CELL_W}
                    height={ROW_H}
                    className={cn(
                      editable && 'cursor-pointer hover:fill-[hsl(var(--cyan)/0.25)]',
                      chordTone ? 'fill-[hsl(var(--cyan)/0.10)]' : inKey ? 'fill-[hsl(var(--foreground)/0.035)]' : 'fill-transparent',
                    )}
                    onPointerDown={() => editable && onAdd(c / 2, m)}
                  />
                )
              })}
              <line x1={KEY_W} x2={width} y1={(r + 1) * ROW_H} y2={(r + 1) * ROW_H} className="stroke-[hsl(var(--border)/0.5)]" />
            </g>
          )
        })}
        </g>
        {/* Beat and bar lines */}
        {Array.from({ length: cells + 1 }, (_, c) => (
          <line
            key={`v${c}`}
            x1={KEY_W + c * CELL_W}
            x2={KEY_W + c * CELL_W}
            y1={lane}
            y2={height}
            className={c % 8 === 0 ? 'stroke-[hsl(var(--foreground)/0.35)]' : c % 2 === 0 ? 'stroke-[hsl(var(--border))]' : 'stroke-[hsl(var(--border)/0.35)]'}
            strokeWidth={c % 8 === 0 ? 1.5 : 1}
          />
        ))}
        {/* Notes */}
        {score.melody.map((n, i) => {
          const r = high - n.midi
          if (r < 0 || r >= rows.length) return null
          const warn = warnNotes?.has(i)
          return (
            <g key={`${n.start}-${n.midi}`} className={editable ? 'cursor-pointer' : ''} onPointerDown={() => editable && onRemove(n.start)}>
              <rect
                x={KEY_W + n.start * 2 * CELL_W + 1}
                y={lane + r * ROW_H + 1}
                width={n.beats * 2 * CELL_W - 2}
                height={ROW_H - 2}
                rx={4}
                className={cn('fill-[hsl(var(--amber))]', warn && 'stroke-[hsl(var(--destructive))]')}
                strokeWidth={warn ? 2 : 0}
              />
              {n.lyric && (
                <text x={KEY_W + n.start * 2 * CELL_W + 5} y={lane + r * ROW_H + 12} className="pointer-events-none fill-[hsl(var(--primary-foreground))] text-[10px]">
                  {n.lyric}
                </text>
              )}
            </g>
          )
        })}
        {cursorBeat !== null && (
          <line x1={KEY_W + cursorBeat * 2 * CELL_W} x2={KEY_W + cursorBeat * 2 * CELL_W} y1={0} y2={height} className="pointer-events-none stroke-[hsl(var(--cyan))]" strokeWidth={2} />
        )}
      </svg>
      {!editable && <div className="sr-only">旋律已给定，不能修改</div>}
    </div>
  )
}
