import { useEffect, useRef, useState } from 'react'
import { Play, Square } from 'lucide-react'
import * as engine from '@/audio/engine'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { useChordTargets } from '@/features/guitar/useChordTargets'
import { StableNoteTracker, changeCounterNote, startChangeCounter, type ChangeCounterState } from '@/guitar/checks'
import { midiToName } from '@/music/pitch'
import { ChordDiagram } from '@/widgets/instrument/ChordDiagram'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface ChangeDrillProps {
  chords: [string, string]
  seconds: number
  target: number
  onDone: (result: { passed: boolean; score: number; summary: string; changes: number }) => void
}

/** One-minute changes: alternate two chords and pluck the root after each change; changes are counted by the root heard. */
export function ChangeDrill({ chords, seconds, target, onDone }: ChangeDrillProps) {
  const [a, b] = useChordTargets(chords)
  const mic = usePitchDetector('guitar', true)
  const [phase, setPhase] = useState<'idle' | 'count' | 'run' | 'done'>('idle')
  const [count, setCount] = useState(3)
  const [left, setLeft] = useState(seconds)
  const [state, setState] = useState<ChangeCounterState | null>(null)
  const tracker = useRef(new StableNoteTracker(3))
  const timers = useRef<Array<ReturnType<typeof setTimeout>>>([])

  useEffect(() => () => timers.current.forEach(clearTimeout), [])

  const running = useRef(false)
  running.current = phase === 'run'
  // Each pitch frame is processed exactly once.
  useEffect(() => {
    if (!running.current || !mic.frame) return
    const note = tracker.current.push(mic.frame)
    if (note !== null) setState((s) => (s ? changeCounterNote(s, note) : s))
  }, [mic.frame])

  const roots: [number, number] | null = a?.rootMidi != null && b?.rootMidi != null ? [a.rootMidi, b.rootMidi] : null

  const start = async () => {
    if (!roots) return
    await engine.ensureAudio()
    tracker.current.reset()
    setState(startChangeCounter(roots))
    setPhase('count')
    setCount(3)
    for (let i = 1; i <= 3; i++) {
      timers.current.push(setTimeout(() => {
        setCount(3 - i)
        engine.playNote(i === 3 ? 84 : 72, 0.08)
      }, i * 800))
    }
    timers.current.push(
      setTimeout(() => {
        setPhase('run')
        const t0 = Date.now()
        const tick = setInterval(() => {
          const l = Math.max(0, seconds - Math.floor((Date.now() - t0) / 1000))
          setLeft(l)
          if (l === 0) clearInterval(tick)
        }, 200)
        timers.current.push(tick as unknown as ReturnType<typeof setTimeout>)
        timers.current.push(setTimeout(() => setPhase('done'), seconds * 1000))
      }, 2400),
    )
  }

  const stop = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
    setPhase('idle')
    setLeft(seconds)
  }

  useEffect(() => {
    if (phase !== 'done' || !state) return
    engine.playNote(84, 0.15)
    const changes = state.changes
    onDone({ passed: changes >= target, score: Math.min(1, changes / target), changes, summary: `${seconds} 秒换了 ${changes} 次（目标 ${target}）` })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase])

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-8">
        {[a, b].map(
          (c, i) =>
            c?.shape && (
              <div key={c.symbol} className={cn('flex flex-col items-center rounded-2xl border p-3', state?.last === i ? 'border-amber/60 bg-amber-soft/20' : 'border-border/60')}>
                <div className="font-display text-2xl font-semibold">{c.symbol}</div>
                <ChordDiagram shape={c.shape} />
                <div className="text-xs text-muted-foreground">根音 {c.rootMidi != null ? midiToName(c.rootMidi, { octave: true }) : '—'}</div>
              </div>
            ),
        )}
        <div className="flex flex-1 flex-col items-center justify-center rounded-2xl border border-border/60 p-4" aria-live="polite">
          <div className="text-xs text-muted-foreground">{phase === 'count' ? '准备' : '已换'}</div>
          <div className="num text-6xl font-semibold">{phase === 'count' ? count : state?.changes ?? 0}</div>
          <div className="num text-sm text-muted-foreground">
            {phase === 'run' ? `剩 ${left} 秒` : `目标 ${target} 次 / ${seconds} 秒`}
          </div>
        </div>
      </div>
      {mic.error && (
        <p role="alert" className="text-sm text-destructive">
          {mic.error}
        </p>
      )}
      <div className="flex gap-2">
        {phase === 'idle' || phase === 'done' ? (
          <Button onClick={() => void start()} disabled={!roots || mic.state !== 'live'}>
            <Play /> {phase === 'done' ? '再来一分钟' : '开始'}
          </Button>
        ) : (
          <Button variant="outline" onClick={stop}>
            <Square /> 停止
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">每次换好和弦后，拨一下这个和弦的根音弦。程序听到根音从一个和弦变成另一个，就记一次。</p>
    </div>
  )
}
