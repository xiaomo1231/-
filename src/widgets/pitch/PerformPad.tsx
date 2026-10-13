import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, Play, RotateCcw } from 'lucide-react'
import * as engine from '@/audio/engine'
import { centsFromTarget, measureBestStretch, measureWindow, nearestNote, smoothFrames, type NoteMeasure, type PitchFrame } from '@/audio/pitch/analysis'
import type { DetectorPreset } from '@/audio/pitch/detector'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { longestStableRun } from '@/audio/pitch/analysis'
import type { DrillResponse, PerformQuestion } from '@/drills/types'
import { noteHit } from '@/drills/gradingP2'
import { midiToName } from '@/music/pitch'
import { MelodyStaff } from '@/widgets/notation/MelodyStaff'
import { InstrumentView } from '@/widgets/instrument/InstrumentView'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { TunerGauge } from './TunerGauge'

export interface PerformPadProps {
  question: PerformQuestion
  disabled?: boolean
  /** Measurements of the submitted take (shown after grading). */
  measures?: NoteMeasure[] | null
  graded?: boolean
  onSubmit: (r: DrillResponse) => void
}

type Phase = 'idle' | 'reference' | 'countin' | 'take' | 'analysing' | 'done'

/** Extra delay between what was heard and what reaches the analyser (buffer centre). */
const ANALYSIS_DELAY = 0.03

export function PerformPad({ question: q, disabled, measures, graded, onSubmit }: PerformPadProps) {
  const preset: DetectorPreset = q.source === 'voice' ? 'voice' : q.source
  const mic = usePitchDetector(preset, true)
  const { start: micStart, record, peek, state: micState } = mic
  const [phase, setPhase] = useState<Phase>('idle')
  const [now, setNow] = useState(0)
  const timeline = useRef<{ takeStart: number; takeEnd: number; beat: number } | null>(null)
  const stopRecording = useRef<(() => PitchFrame[]) | null>(null)
  const timers = useRef<Array<() => void>>([])
  const finished = useRef(false)

  const clear = () => {
    timers.current.forEach((c) => c())
    timers.current = []
  }
  useEffect(() => clear, [])
  useEffect(() => {
    clear()
    finished.current = false
    setPhase('idle')
    timeline.current = null
  }, [q.id])

  // Clock for the cursor / current target.
  useEffect(() => {
    if (phase === 'idle' || phase === 'done') return
    let raf = 0
    const tick = () => {
      setNow(engine.rawTime())
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [phase])

  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    clear()
    setPhase('analysing')
    const frames = stopRecording.current?.() ?? []
    stopRecording.current = null
    const shift = engine.outputLatencySeconds() + ANALYSIS_DELAY
    const shifted = smoothFrames(frames.map((f) => ({ ...f, t: f.t - shift })))
    const tl = timeline.current!
    let notes: NoteMeasure[]
    if (q.freeTiming) {
      const inTake = shifted.filter((f) => f.t >= tl.takeStart && f.t <= tl.takeEnd)
      notes = q.targets.map((t) => measureBestStretch(inTake, t.midi, q.octaveEquivalence))
    } else {
      notes = q.targets.map((t) =>
        measureWindow(shifted, tl.takeStart + t.startBeat * tl.beat, tl.takeStart + (t.startBeat + t.beats) * tl.beat, t.midi, q.octaveEquivalence),
      )
    }
    setPhase('done')
    onSubmit({ kind: 'performance', notes })
  }, [q, onSubmit])

  const start = useCallback(async () => {
    if (disabled || phase !== 'idle') return
    if (micState !== 'live') {
      await micStart()
    }
    await engine.ensureAudio()
    finished.current = false
    stopRecording.current = record()
    const beat = 60 / q.bpm
    // 1) Reference.
    setPhase('reference')
    let refEnd = engine.now() + 0.1
    if (q.reference.type === 'notes') {
      let t = 0
      const events = q.reference.notes.map((n) => {
        const e = { midi: n.midi, duration: n.beats * beat * 0.9, at: t }
        t += n.beats * beat
        return e
      })
      refEnd = engine.playSequence(events).endAt
    } else if (q.reference.type === 'cadence') {
      const events: engine.NoteEvent[] = []
      q.reference.chords.forEach((chord, i) => chord.forEach((m) => events.push({ midi: m, duration: 0.75, at: i * 0.8, velocity: 0.6 })))
      const after = q.reference.chords.length * 0.8 + 0.2
      ;(q.reference.then ?? []).forEach((m, i) => events.push({ midi: m, duration: 0.9, at: after + i * 0.9 }))
      refEnd = engine.playSequence(events).endAt
    }
    const gap = 0.35
    if (q.freeTiming) {
      const takeStart = refEnd + gap
      const takeEnd = takeStart + q.takeSeconds
      timeline.current = { takeStart, takeEnd, beat }
      timers.current.push(engine.onAudioTime(takeStart, () => setPhase('take')))
      timers.current.push(engine.onAudioTime(takeEnd, finish))
    } else {
      // 2) Count-in, then clicks continue through the take.
      const totalBeats = Math.ceil(Math.max(...q.targets.map((t) => t.startBeat + t.beats)))
      const clickStartOffset = Math.max(0.1, refEnd + gap - engine.now())
      const sched = engine.scheduleClicks(q.bpm, q.countIn + totalBeats, { startOffset: clickStartOffset, accentEvery: 4 })
      const takeStart = sched.startAt + q.countIn * beat
      const takeEnd = takeStart + totalBeats * beat
      timeline.current = { takeStart, takeEnd, beat }
      timers.current.push(engine.onAudioTime(sched.startAt, () => setPhase('countin')))
      timers.current.push(engine.onAudioTime(takeStart, () => setPhase('take')))
      timers.current.push(engine.onAudioTime(takeEnd + 0.25, finish))
    }
  }, [disabled, phase, micState, micStart, record, q, finish])

  // Free timing: stop early once a long enough stable note is heard.
  useEffect(() => {
    if (phase !== 'take' || !q.freeTiming || !timeline.current) return
    const need = (q.sustainSeconds ?? 1.2) + 0.2
    const id = setInterval(() => {
      const frames = peek()
      const recent = frames.filter((f) => f.t >= timeline.current!.takeStart)
      const run = longestStableRun(smoothFrames(recent))
      if (run && recent[run.end]!.t - recent[run.start]!.t >= need) finish()
    }, 250)
    return () => clearInterval(id)
  }, [phase, q.freeTiming, q.sustainSeconds, peek, finish])

  // Space bar starts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'BUTTON'].includes(target.tagName)) return
      e.preventDefault()
      void start()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [start])

  // Which target is current.
  const tl = timeline.current
  const currentIndex = useMemo(() => {
    if (!tl || phase !== 'take') return q.freeTiming && phase === 'take' ? 0 : null
    if (q.freeTiming) return 0
    const beatPos = (now - tl.takeStart) / tl.beat
    const idx = q.targets.findIndex((t) => beatPos >= t.startBeat && beatPos < t.startBeat + t.beats)
    return idx >= 0 ? idx : null
  }, [tl, phase, now, q])

  const live = mic.frame
  const target = currentIndex !== null ? q.targets[currentIndex] : q.targets[0]
  const liveCents = live?.hz && target ? centsFromTarget(live.hz, target.midi, q.octaveEquivalence) : null
  const showCentsVsTarget = phase === 'take' || phase === 'countin'
  const gaugeLabel = showCentsVsTarget
    ? target?.label ?? midiToName(target!.midi)
    : live?.hz
      ? midiToName(nearestNote(live.hz).midi, { octave: true })
      : undefined
  const gaugeCents = showCentsVsTarget ? liveCents : live?.hz ? nearestNote(live.hz).cents : null

  const staffVisible = q.showStaff || (q.revealAfter && graded)
  const showPositions = q.source !== 'voice' && (graded || ['scale', 'arpeggio', 'interval'].includes(q.mode))
  const phaseText: Record<Phase, string> = {
    idle: q.source === 'voice' ? '准备好了就开始（空格）' : '把乐器放好，准备开始（空格）',
    reference: '仔细听…',
    countin: '预备…',
    take: q.source === 'voice' ? '现在唱！' : '现在弹！',
    analysing: '分析中…',
    done: '完成',
  }

  if (mic.state === 'error') {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
        <div className="flex items-center gap-2 font-medium">
          <MicOff className="h-5 w-5 text-destructive" /> 麦克风不可用
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{mic.error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void mic.start()}>
          <RotateCcw /> 重试
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {staffVisible && (
        <div className="rounded-2xl border border-border/70 bg-background/50 px-4 py-2">
          <MelodyStaff
            notes={q.targets.map((t) => ({ midi: t.midi, beats: q.freeTiming ? 4 : t.beats }))}
            clef={q.source === 'bass' ? 'bass' : 'treble'}
            keyTonic={q.keyTonic}
            showKeySignature={q.mode !== 'find_note'}
            timeSignature={q.freeTiming ? null : '4/4'}
            activeIndex={phase === 'take' ? currentIndex : null}
            marks={graded && measures ? q.targets.map((_, i) => (noteHit(q, measures[i]) ? 'ok' : 'bad')) : undefined}
          />
        </div>
      )}

      {showPositions && q.source !== 'voice' && (
        <div className="rounded-2xl border border-border/70 bg-background/50 p-3">
          <div className="mb-2 text-xs text-muted-foreground">{graded ? '在乐器上的位置' : '参考指法'}</div>
          <InstrumentView
            instrument={q.source}
            notes={q.targets.map((t) => t.midi)}
            labels={q.targets.map((t) => t.label ?? midiToName(t.midi))}
            rootPc={q.targets[0]!.midi % 12}
            {...(q.chordRootPc !== undefined ? { chord: { rootPc: q.chordRootPc, suffix: q.chordSuffix ?? '', rootName: (q.chordSymbol ?? '').replace(/m$/, '') } } : {})}
          />
        </div>
      )}

      <div className="grid grid-cols-5 gap-5">
        <TunerGauge
          className="col-span-2"
          cents={gaugeCents}
          tolerance={q.toleranceCents}
          label={gaugeLabel}
          sublabel={mic.state === 'live' ? undefined : mic.state === 'starting' ? '正在打开麦克风…' : '麦克风未开启'}
          level={live?.rms ?? 0}
        />
        <div className="col-span-3 flex flex-col">
          {!q.freeTiming && (
            <div className="mb-4 flex flex-wrap gap-1.5" aria-label="目标音">
              {q.targets.map((t, i) => {
                const m = measures?.[i]
                const hit = graded ? noteHit(q, m) : null
                return (
                  <div
                    key={i}
                    className={cn(
                      'flex min-w-[46px] flex-col items-center rounded-lg border px-2 py-1.5 text-xs transition-colors',
                      i === currentIndex ? 'border-amber bg-amber-soft/50' : 'border-border/70 bg-card',
                      hit === true && 'border-success/60 bg-success/15',
                      hit === false && 'border-destructive/60 bg-destructive/10',
                    )}
                  >
                    <span className="font-medium">{t.label ?? midiToName(t.midi)}</span>
                    {graded && (
                      <span className="num text-[10px] text-muted-foreground">
                        {m?.medianCents == null ? '—' : `${m.medianCents > 0 ? '+' : ''}${m.medianCents}`}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {q.freeTiming && graded && measures?.[0] && (
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <Metric label="偏差" value={measures[0].medianCents == null ? '—' : `${measures[0].medianCents > 0 ? '+' : ''}${measures[0].medianCents}`} unit="音分" />
              <Metric label="稳定时长" value={(measures[0].stableMs / 1000).toFixed(1)} unit="秒" />
              <Metric label="晃动" value={measures[0].driftCents == null ? '—' : String(measures[0].driftCents)} unit="音分" />
            </div>
          )}
          <button
            type="button"
            disabled={disabled || phase !== 'idle'}
            onClick={() => void start()}
            className={cn(
              'focus-ring relative flex flex-1 flex-col items-center justify-center rounded-3xl border p-6 transition-colors disabled:cursor-default',
              phase === 'take' ? 'border-amber/60 bg-amber-soft/40' : 'border-border/80 bg-card hover:border-cyan/50',
            )}
          >
            {phase === 'idle' ? (
              <>
                <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-cyan-soft/60">
                  {mic.state === 'live' ? <Mic className="h-6 w-6 text-cyan" /> : <Play className="h-6 w-6 text-cyan" />}
                </span>
                <span className="font-display text-lg">{phaseText.idle}</span>
              </>
            ) : (
              <span className={cn('font-display text-2xl font-semibold', phase === 'take' && 'text-amber glow-amber')}>{phaseText[phase]}</span>
            )}
            {phase === 'take' && q.freeTiming && <span className="mt-2 text-xs text-muted-foreground">稳住这个音，系统听到稳定的声音会自动结束</span>}
          </button>
        </div>
      </div>
    </div>
  )
}

function Metric({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-card px-2 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="num text-lg font-semibold">
        {value}
        <span className="ml-0.5 text-[10px] text-muted-foreground">{unit}</span>
      </div>
    </div>
  )
}
