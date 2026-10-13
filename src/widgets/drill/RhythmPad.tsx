import { useCallback, useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { DrillQuestion, DrillResponse } from '@/drills/types'
import { RhythmStaff } from '@/widgets/notation/RhythmStaff'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

type RhythmQ = Extract<DrillQuestion, { kind: 'rhythm_tap' | 'rhythm_echo' | 'rhythm_read' }>

export interface RhythmPadProps {
  question: RhythmQ
  /** Calibrated extra latency subtracted from every tap. */
  deviceLatencyMs: number
  disabled?: boolean
  onSubmit: (response: DrillResponse) => void
}

type Phase = 'idle' | 'countin' | 'listen' | 'answer' | 'done'

interface Plan {
  beatSeconds: number
  /** Absolute audio time the scored bar starts. */
  answerStart: number
  answerEnd: number
  clickTimes: number[]
  /** Phase boundaries as [time, phase]. */
  phases: Array<[number, Phase]>
  /** Onsets (beats) for the visual cursor in the scored bar. */
  answerOnsets: number[]
}

/**
 * Metronome-driven tapping. Space (or the pad) records a tap; times are taken
 * from the AudioContext clock and corrected for output latency plus the
 * student's calibrated device latency, so scoring compares like with like.
 */
export function RhythmPad({ question: q, deviceLatencyMs, disabled, onSubmit }: RhythmPadProps) {
  const [phase, setPhase] = useState<Phase>('idle')
  const [beatIndex, setBeatIndex] = useState(-1)
  const [taps, setTaps] = useState<number[]>([])
  const [flash, setFlash] = useState(0)
  const plan = useRef<Plan | null>(null)
  const tapsRef = useRef<number[]>([])
  const timers = useRef<Array<() => void>>([])

  const clearTimers = () => {
    timers.current.forEach((c) => c())
    timers.current = []
  }
  useEffect(() => clearTimers, [])

  // Reset when the question changes.
  useEffect(() => {
    clearTimers()
    plan.current = null
    tapsRef.current = []
    setTaps([])
    setPhase('idle')
    setBeatIndex(-1)
  }, [q.id])

  const start = useCallback(async () => {
    if (disabled) return
    await engine.ensureAudio()
    clearTimers()
    tapsRef.current = []
    setTaps([])
    const listenBars = q.kind === 'rhythm_echo' ? 1 : 0
    const answerBeats = q.beats
    const totalBeats = q.countIn + listenBars * q.beats + answerBeats
    const sched = engine.scheduleClicks(q.bpm, totalBeats, { accentEvery: q.kind === 'rhythm_tap' ? 4 : q.beats, startOffset: 0.25 })
    const bs = sched.beatSeconds
    const listenStart = sched.startAt + q.countIn * bs
    const answerStart = listenStart + listenBars * q.beats * bs
    const answerEnd = answerStart + answerBeats * bs
    const onsets = q.kind === 'rhythm_tap' ? Array.from({ length: q.beats }, (_, i) => i) : q.onsets
    if (q.kind === 'rhythm_echo') engine.scheduleRhythmHits(onsets.map((o) => listenStart + o * bs))
    plan.current = {
      beatSeconds: bs,
      answerStart,
      answerEnd,
      clickTimes: sched.times,
      phases: [
        [sched.startAt, 'countin'],
        ...(listenBars ? ([[listenStart, 'listen']] as Array<[number, Phase]>) : []),
        [answerStart, 'answer'],
      ],
      answerOnsets: onsets,
    }
    setPhase('countin')
    for (const [t, p] of plan.current.phases) timers.current.push(engine.onAudioTime(t, () => setPhase(p)))
    sched.times.forEach((t, i) => timers.current.push(engine.onAudioTime(t, () => setBeatIndex(i))))
    timers.current.push(
      engine.onAudioTime(answerEnd + bs * 0.5, () => {
        setPhase('done')
        setBeatIndex(-1)
        onSubmit({ kind: 'taps', taps: [...tapsRef.current] })
      }),
    )
  }, [q, disabled, onSubmit])

  const tap = useCallback(() => {
    const p = plan.current
    if (!p) return
    const heard = engine.rawTime() - engine.outputLatencySeconds() - deviceLatencyMs / 1000
    // Accept taps from half a beat before the scored bar to its end.
    if (heard < p.answerStart - p.beatSeconds * 0.5 || heard > p.answerEnd + p.beatSeconds * 0.25) return
    const beats = (heard - p.answerStart) / p.beatSeconds
    tapsRef.current.push(beats)
    setTaps([...tapsRef.current])
    setFlash((f) => f + 1)
  }, [deviceLatencyMs])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      const target = e.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      e.preventDefault()
      if (phase === 'idle') void start()
      else if (phase !== 'done') tap()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [phase, start, tap])

  const countInBeats = q.countIn
  const listenBeats = q.kind === 'rhythm_echo' ? q.beats : 0
  const phaseLabel: Record<Phase, string> = {
    idle: '按空格键或点击开始',
    countin: '预备…',
    listen: '仔细听',
    answer: '现在打！',
    done: '完成',
  }

  // Which beat of the current bar is lit.
  const localBeat =
    beatIndex < 0
      ? -1
      : beatIndex < countInBeats
        ? beatIndex
        : beatIndex < countInBeats + listenBeats
          ? beatIndex - countInBeats
          : beatIndex - countInBeats - listenBeats
  const barBeats = phase === 'countin' ? countInBeats : q.beats

  return (
    <div className="space-y-6">
      {(q.kind === 'rhythm_read' || q.kind === 'rhythm_echo') && (
        <div
          className={cn(
            'rounded-2xl border border-border/70 bg-background/50 px-4 py-2 transition-opacity',
            q.kind === 'rhythm_echo' && phase !== 'done' && 'opacity-0',
          )}
          aria-hidden={q.kind === 'rhythm_echo' && phase !== 'done'}
        >
          <RhythmStaff onsets={q.onsets} beats={q.beats} />
          {q.kind === 'rhythm_echo' && <div className="pb-2 text-center text-xs text-muted-foreground">刚才的节奏型</div>}
        </div>
      )}

      <div className="flex items-center justify-center gap-3" aria-hidden="true">
        {Array.from({ length: Math.max(1, Math.min(barBeats, 12)) }, (_, i) => (
          <span
            key={`${phase}-${i}`}
            className={cn(
              'h-3 w-3 rounded-full transition-all duration-100',
              i === localBeat && phase !== 'idle' && phase !== 'done'
                ? phase === 'answer'
                  ? 'scale-150 bg-amber shadow-[0_0_14px_hsl(var(--amber))]'
                  : 'scale-125 bg-cyan shadow-[0_0_12px_hsl(var(--cyan))]'
                : 'bg-muted',
            )}
          />
        ))}
      </div>

      <button
        type="button"
        disabled={disabled || phase === 'done'}
        onPointerDown={(e) => {
          e.preventDefault()
          if (phase === 'idle') void start()
          else tap()
        }}
        className={cn(
          'focus-ring relative mx-auto flex h-44 w-full max-w-xl select-none flex-col items-center justify-center overflow-hidden rounded-3xl border transition-colors',
          phase === 'answer' ? 'border-amber/60 bg-amber-soft/40' : 'border-border/80 bg-card',
          'disabled:cursor-default',
        )}
        aria-label={phase === 'idle' ? '开始' : '打拍'}
      >
        {flash > 0 && <span key={flash} className="pointer-events-none absolute inset-0 animate-flash bg-amber/25" />}
        {phase === 'idle' ? (
          <>
            <Play className="mb-3 h-8 w-8 text-cyan" />
            <span className="font-display text-lg">{phaseLabel.idle}</span>
          </>
        ) : (
          <>
            <span className={cn('font-display text-2xl font-semibold', phase === 'answer' && 'text-amber glow-amber')}>
              {phaseLabel[phase]}
            </span>
            <span className="mt-2 font-mono text-xs text-muted-foreground">
              SPACE · {q.bpm} BPM · 已打 {taps.length} 下
            </span>
          </>
        )}
      </button>

      {phase === 'idle' && (
        <div className="text-center">
          <Button variant="ghost" size="sm" onClick={() => void start()} disabled={disabled}>
            开始（空格）
          </Button>
        </div>
      )}
    </div>
  )
}
