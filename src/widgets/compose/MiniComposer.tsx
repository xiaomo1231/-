import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Eraser, Play, Save, Square, X } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { CreationSpec } from '@/course/types'
import { checkCreation } from '@/course/rules'
import { midiToName, pitchClass } from '@/music/pitch'
import { scaleById, degreeFromSemitone, degreeLabel, type ScaleId } from '@/music/scales'
import { ScoreNotation } from '@/widgets/notation/ScoreNotation'
import { scoreFromCells } from '@/music/score'
import { RhythmStaff } from '@/widgets/notation/RhythmStaff'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface MiniComposerProps {
  spec: CreationSpec
  initial?: ReadonlyArray<number | null>
  saved?: boolean
  onSave: (cells: Array<number | null>) => Promise<void> | void
}

/** Pitch rows for the melody grid: scale tones from a fourth below the tonic to a ninth above. */
function melodyRows(tonic: number, scale: ScaleId): number[] {
  const pcs = new Set(scaleById(scale).steps.map((s) => (tonic + s) % 12))
  const rows: number[] = []
  for (let m = tonic + 14; m >= tonic - 5; m--) if (pcs.has(pitchClass(m))) rows.push(m)
  return rows
}

export function MiniComposer({ spec, initial, saved, onSave }: MiniComposerProps) {
  const [cells, setCells] = useState<Array<number | null>>(() => {
    const base = Array.from({ length: spec.steps }, (_, i) => initial?.[i] ?? null)
    return base
  })
  const [playing, setPlaying] = useState(false)
  const [cursor, setCursor] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const cancel = useRef<Array<() => void>>([])

  useEffect(() => () => cancel.current.forEach((c) => c()), [])

  const check = useMemo(() => checkCreation(spec, cells), [spec, cells])
  const isRhythm = spec.kind === 'rhythm'
  const tonic = spec.tonic ?? 60
  const rows = useMemo(() => (isRhythm ? [] : melodyRows(tonic, spec.scale ?? 'major')), [isRhythm, tonic, spec.scale])

  const stop = () => {
    cancel.current.forEach((c) => c())
    cancel.current = []
    engine.stopAll()
    setPlaying(false)
    setCursor(null)
  }

  const play = async () => {
    if (playing) {
      stop()
      return
    }
    await engine.ensureAudio()
    setPlaying(true)
    const beat = 60 / spec.bpm
    const cellLen = isRhythm ? beat / 2 : beat
    const startOffset = 0.15
    const start = engine.now() + startOffset
    if (isRhythm) {
      const beats = spec.steps / 2
      engine.scheduleClicks(spec.bpm, beats, { startOffset, accentEvery: 4 })
      engine.scheduleRhythmHits(cells.map((x, i) => (x ? start + i * cellLen : -1)).filter((t) => t >= 0))
    } else {
      // A soft tonic pad under the melody.
      engine.playSequence(
        cells.map((m, i) => (typeof m === 'number' && m >= 0 ? { midi: m, duration: cellLen * 0.92, at: i * cellLen } : null)).filter((e): e is engine.NoteEvent => e !== null),
        startOffset,
      )
    }
    cells.forEach((_, i) => cancel.current.push(engine.onAudioTime(start + i * cellLen, () => setCursor(i))))
    cancel.current.push(engine.onAudioTime(start + cells.length * cellLen, () => stop()))
  }

  const toggleRhythm = (i: number) => {
    setCells((c) => c.map((x, j) => (j === i ? (x ? null : 1) : x)))
    if (!cells[i]) void engine.ensureAudio().then(() => engine.scheduleRhythmHits([engine.now() + 0.02]))
  }
  const setMelody = (i: number, midi: number) => {
    setCells((c) => c.map((x, j) => (j === i ? (x === midi ? null : midi) : x)))
    if (cells[i] !== midi) void engine.ensureAudio().then(() => engine.playNote(midi, 0.4))
  }

  const save = async () => {
    setSaving(true)
    try {
      await onSave(cells)
    } finally {
      setSaving(false)
    }
  }

  const bars = isRhythm ? Math.ceil(spec.steps / 8) : Math.ceil(spec.steps / 4)

  return (
    <div className="space-y-5">
      {isRhythm ? (
        <div className="space-y-2">
          {Array.from({ length: bars }, (_, bar) => (
            <div key={bar} className="grid grid-cols-8 gap-1.5">
              {Array.from({ length: 8 }, (_, k) => {
                const i = bar * 8 + k
                const on = Boolean(cells[i])
                return (
                  <button
                    key={i}
                    type="button"
                    aria-label={`第 ${bar + 1} 小节第 ${Math.floor(k / 2) + 1} 拍${k % 2 ? '后半拍' : ''}`}
                    aria-pressed={on}
                    onClick={() => toggleRhythm(i)}
                    className={cn(
                      'focus-ring flex h-14 flex-col items-center justify-center rounded-xl border text-[10px] transition-all',
                      on ? 'border-amber bg-amber/80 text-primary-foreground shadow-[0_0_14px_-4px_hsl(var(--amber))]' : 'border-border/70 bg-card hover:border-cyan/50',
                      k % 2 === 0 && !on && 'bg-accent/50',
                      cursor === i && 'ring-2 ring-cyan',
                    )}
                  >
                    <span className="font-mono">{k % 2 === 0 ? Math.floor(k / 2) + 1 : '&'}</span>
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border/70 bg-background/50 p-2">
          <div className="grid gap-[3px]" style={{ gridTemplateColumns: `52px repeat(${spec.steps}, minmax(36px, 1fr))` }}>
            {rows.map((m) => (
              <div key={m} className="contents">
                <div className={cn('flex items-center justify-end pr-2 font-mono text-[10px]', pitchClass(m) === pitchClass(tonic) ? 'text-amber' : 'text-muted-foreground')}>
                  {midiToName(m, { octave: true })} <span className="ml-1 opacity-60">{degreeLabel(degreeFromSemitone(m - tonic))}</span>
                </div>
                {cells.map((x, i) => (
                  <button
                    key={i}
                    type="button"
                    aria-label={`第 ${i + 1} 拍 ${midiToName(m, { octave: true })}`}
                    aria-pressed={x === m}
                    onClick={() => setMelody(i, m)}
                    className={cn(
                      'focus-ring h-6 rounded-[5px] transition-colors',
                      x === m ? 'bg-amber shadow-[0_0_10px_-2px_hsl(var(--amber))]' : pitchClass(m) === pitchClass(tonic) ? 'bg-amber-soft/40 hover:bg-cyan/30' : 'bg-muted/60 hover:bg-cyan/30',
                      i % 4 === 0 && 'ml-1',
                      cursor === i && x !== m && 'bg-cyan/25',
                    )}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-2">
        {isRhythm ? (
          Array.from({ length: bars }, (_, bar) => (
            <RhythmStaff
              key={bar}
              onsets={cells.slice(bar * 8, bar * 8 + 8).map((x, k) => (x ? k * 0.5 : -1)).filter((t) => t >= 0)}
              beats={4}
            />
          ))
        ) : (
          <ScoreNotation
            score={scoreFromCells(cells, { tonic, mode: (['natural_minor', 'harmonic_minor', 'melodic_minor', 'pentatonic_minor', 'blues', 'dorian', 'phrygian'] as string[]).includes(spec.scale ?? '') ? 'minor' : 'major', bpm: spec.bpm })}
            activeNote={cursor !== null && typeof cells[cursor] === 'number' ? cells.slice(0, cursor).filter((x) => typeof x === 'number' && x >= 0).length : null}
            chordLabels="none"
          />
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => void play()}>
            {playing ? <Square /> : <Play />} {playing ? '停止' : '播放'}
          </Button>
          <Button variant="ghost" onClick={() => setCells(cells.map(() => null))}>
            <Eraser /> 清空
          </Button>
        </div>
        <Button onClick={() => void save()} disabled={!check.ok || saving}>
          {saved ? <Check /> : <Save />} {saved ? '更新作品' : '保存到作品集'}
        </Button>
      </div>

      <ul className="space-y-1 text-sm">
        {check.problems.length === 0 ? (
          <li className="flex items-center gap-2 text-success">
            <Check className="h-4 w-4" /> 符合所有要求，可以保存了。
          </li>
        ) : (
          check.problems.map((p) => (
            <li key={p} className="flex items-center gap-2 text-muted-foreground">
              <X className="h-4 w-4 text-amber" /> {p}
            </li>
          ))
        )}
      </ul>
    </div>
  )
}
