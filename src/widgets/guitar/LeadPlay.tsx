import { useEffect, useMemo, useRef, useState } from 'react'
import * as engine from '@/audio/engine'
import { listenForOnsets, type OnsetSession } from '@/audio/onset/onsetListener'
import { inputManager } from '@/audio/input/inputManager'
import { Fretboard } from '@/widgets/instrument/Fretboard'
import type { DrillResponse, GradeResult, PerformQuestion } from '@/drills/types'
import type { NoteMeasure } from '@/audio/pitch/analysis'
import { gradePerform } from '@/drills/gradingP2'
import { PLAY_PASS, playNotes, tabMidi, type PlaySource } from '@/guitar/scales'
import { useGuitarSetup } from '@/features/instrument/useGuitarSetup'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { midiToName } from '@/music/pitch'
import { PerformPad } from '@/widgets/pitch/PerformPad'
import { LeadTab } from './LeadTab'
import { MonitorToggle } from './MonitorToggle'
import { cn } from '@/shared/lib/utils'

/**
 * Play a box or a lick in time: the existing paced measurement checks each
 * note's pitch inside its beat window. Licks are played to the student first.
 */
export function LeadPlay({ source, bpm, preset, legato, onDone }: { source: PlaySource; bpm: number; preset?: string; legato?: boolean; onDone: (r: { passed: boolean; score: number; summary: string }) => void }) {
  const { played } = useGuitarSetup()
  const applyPreset = useGuitarAudio((s) => s.applyPreset)
  const [attempt, setAttempt] = useState(0)
  const [grade, setGrade] = useState<GradeResult | null>(null)
  const [measures, setMeasures] = useState<NoteMeasure[] | null>(null)
  const { notes, reference } = useMemo(() => playNotes(source, played.strings), [source, played.strings])
  const [legatoHint, setLegatoHint] = useState<string | null>(null)
  const onsets = useRef<number[]>([])
  const session = useRef<OnsetSession | null>(null)

  // Legato hint (cable only, never scored): count plucks during the take.
  useEffect(() => {
    if (!legato) return
    let alive = true
    void listenForOnsets((o) => onsets.current.push(o.time))
      .then((s) => {
        if (alive) session.current = s
        else s.stop()
      })
      .catch(() => undefined)
    return () => {
      alive = false
      session.current?.stop()
      session.current = null
    }
  }, [legato])
  const tonicPc = source.type === 'scale' ? source.tonicPc : 9
  const markers = useMemo(
    () => Array.from(new Map(notes.map((n) => [`${n.string}:${n.fret}`, n])).values()).map((n) => ({ string: n.string, fret: n.fret, midi: tabMidi(n, played.strings), tone: (tabMidi(n, played.strings) - tonicPc + 120) % 12 === 0 ? ('root' as const) : ('note' as const), label: midiToName(tabMidi(n, played.strings)) })),
    [notes, played.strings, tonicPc],
  )
  const frets = notes.map((n) => n.fret)
  const fromFret = Math.max(0, Math.min(...frets) - 1)
  const toFret = Math.max(fromFret + 5, Math.max(...frets) + 1)

  const question = useMemo<PerformQuestion>(() => {
    let beat = 0
    const targets = notes.map((n) => {
      const midi = tabMidi(n, played.strings)
      const t = { midi, startBeat: beat, beats: n.beats, label: midiToName(midi) }
      beat += n.beats
      return t
    })
    return {
      id: `lead-${source.type === 'box' ? source.position : source.type === 'lick' ? source.id : source.name}-${attempt}`,
      kind: 'perform',
      module: 'I1',
      level: 1,
      seed: attempt,
      skillIds: [],
      prompt: '跟着节拍器弹，每个音落在它自己的拍子上。',
      mode: 'sight',
      source: 'guitar',
      targets,
      bpm,
      countIn: 4,
      freeTiming: false,
      takeSeconds: 0,
      toleranceCents: 40,
      octaveEquivalence: false,
      reference: reference ? { type: 'notes', notes: targets.map((t) => ({ midi: t.midi, beats: t.beats })) } : { type: 'none' },
      showStaff: true,
      keyTonic: 60,
    }
  }, [notes, played.strings, bpm, source, reference, attempt])

  const onSubmit = (r: DrillResponse) => {
    const g = gradePerform(question, r)
    setGrade(g)
    if (legato && inputManager.current?.kind === 'cable') {
      const takeSeconds = question.targets.reduce((s, t) => s + t.beats, 0) * (60 / bpm)
      const now = engine.rawTime()
      const plucks = onsets.current.filter((t) => t >= now - takeSeconds - 0.8).length
      const picked = notes.filter((_, i) => i === 0 || !['hammer', 'pull', 'slide'].includes(notes[i - 1]!.tech ?? '')).length
      setLegatoHint(plucks > picked + 1 ? `这一遍听到约 ${plucks} 次拨弦，谱上只需要拨 ${picked} 次。击弦、勾弦、滑音的音可能是拨出来的（只作提示，不计分）。` : `拨弦次数和谱上一致（约 ${plucks} 次），连奏的音应该是左手弹出来的。`)
    }
    onsets.current = []
    setMeasures(r.kind === 'performance' ? r.notes : null)
    onDone({ passed: g.credit >= PLAY_PASS, score: g.credit, summary: `弹对 ${Math.round(g.credit * notes.length)}/${notes.length} 个音` })
  }

  const results = measures ? question.targets.map((_, i) => (measures[i]?.medianCents != null ? Math.abs(measures[i]!.medianCents!) <= question.toleranceCents && (measures[i]?.voicedRatio ?? 0) >= 0.4 : false)) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">
          {bpm} BPM · {notes.length} 个音{reference ? ' · 先听一遍示范' : ''}
        </span>
        <MonitorToggle compact />
      </div>
      <LeadTab notes={notes} {...(results ? { results } : {})} />
      <Fretboard tuning={played} markers={markers} fromFret={fromFret} toFret={toFret} className="max-w-3xl" />
      <PerformPad
        key={question.id}
        question={question}
        measures={measures}
        graded={grade !== null}
        onSubmit={onSubmit}
      />
      {grade && (
        <div role="status" className={cn('rounded-2xl border p-4 text-sm', grade.credit >= PLAY_PASS ? 'border-success/40 bg-success/10' : 'border-border bg-card')}>
          <b className="num">{Math.round(grade.credit * 100)}</b> 分 · {grade.feedback}
          {legatoHint && <span className="mt-1 block text-muted-foreground">{legatoHint}</span>}
          <button
            type="button"
            className="focus-ring ml-3 text-cyan hover:underline"
            onClick={() => {
              setGrade(null)
              setMeasures(null)
              setAttempt((a) => a + 1)
              if (preset) applyPreset(preset)
            }}
          >
            再来一遍
          </button>
        </div>
      )}
    </div>
  )
}
