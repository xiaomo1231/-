import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, RotateCcw } from 'lucide-react'
import * as engine from '@/audio/engine'
import { centsFromTarget, smoothFrames } from '@/audio/pitch/analysis'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { firstVoiced, trailingLock } from '@/pitchcamp/lock'
import type { FeedbackMode } from '@/pitchcamp/plan'
import { midiToName } from '@/music/pitch'
import { Button } from '@/shared/ui/Button'
import { TunerGauge } from '@/widgets/pitch/TunerGauge'
import { ResultLine, TaskFrame } from './TaskFrame'

type Phase = 'idle' | 'reference' | 'take' | 'done'

const LOCK_SECONDS = 0.6
const LOCK_TOL = 25
const TIMEOUT = 10

/**
 * 滑音找音：听目标音，然后从低处慢慢往上滑，滑到目标音就停住、稳住。
 * 记从出声到稳住用了多久；10 秒内没稳住算没找到。
 */
export function SirenTask({
  rounds,
  range,
  feedback,
  why,
  onDone,
}: {
  rounds: number
  range: { low: number; high: number }
  feedback: FeedbackMode
  why?: string
  onDone: (result: { found: number; total: number; meanSeconds: number | null; seconds: number }) => void
}) {
  const mic = usePitchDetector('voice', true)
  const { record, peek, state: micState, start: micStart } = mic
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [target, setTarget] = useState(() => pick(range))
  const [took, setTook] = useState<number | null>(null)
  const times = useRef<number[]>([])
  const stopRec = useRef<(() => unknown) | null>(null)
  const takeStart = useRef(0)
  const began = useRef(Date.now())

  const go = useCallback(async () => {
    if (phase !== 'idle') return
    if (micState !== 'live') await micStart()
    await engine.ensureAudio()
    setPhase('reference')
    const { endAt } = engine.playSequence([{ midi: target, duration: 1.2, at: 0 }])
    engine.onAudioTime(endAt + 0.2, () => {
      takeStart.current = engine.rawTime()
      stopRec.current = record()
      setPhase('take')
    })
  }, [phase, micState, micStart, target, record])

  // 唱的时候不断检查有没有稳在目标音上。
  useEffect(() => {
    if (phase !== 'take') return
    const id = window.setInterval(() => {
      const frames = smoothFrames(peek())
      const lock = trailingLock(frames, target, LOCK_TOL)
      const elapsed = engine.rawTime() - takeStart.current
      if (lock.seconds >= LOCK_SECONDS) {
        const from = firstVoiced(frames, takeStart.current) ?? takeStart.current
        const t = Math.max(0, frames[frames.length - 1]!.t - LOCK_SECONDS - from)
        times.current.push(t)
        setTook(t)
        stopRec.current?.()
        engine.playSuccess()
        setPhase('done')
      } else if (elapsed > TIMEOUT) {
        setTook(null)
        stopRec.current?.()
        setPhase('done')
      }
    }, 120)
    return () => window.clearInterval(id)
  }, [phase, peek, target])

  const next = () => {
    if (round + 1 >= rounds) {
      const mean = times.current.length ? times.current.reduce((s, x) => s + x, 0) / times.current.length : null
      onDone({ found: times.current.length, total: rounds, meanSeconds: mean, seconds: (Date.now() - began.current) / 1000 })
      return
    }
    setRound((r) => r + 1)
    setTarget(pick(range))
    setTook(null)
    setPhase('idle')
  }

  if (mic.state === 'error')
    return (
      <TaskFrame title="滑音找音">
        <div className="flex items-center gap-2">
          <MicOff className="h-5 w-5 text-destructive" /> 麦克风不可用：{mic.error}
        </div>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void mic.start()}>
          <RotateCcw /> 重试
        </Button>
      </TaskFrame>
    )

  const live = mic.frame?.hz ? centsFromTarget(mic.frame.hz, target, true) : null
  return (
    <TaskFrame title="滑音找音" why={why} index={round} total={rounds}>
      <div className="grid grid-cols-5 gap-5">
        {feedback === 'live' ? (
          <TunerGauge className="col-span-2" cents={phase === 'take' ? live : null} tolerance={LOCK_TOL} label={midiToName(target, { octave: true })} level={mic.frame?.rms ?? 0} />
        ) : (
          <div className="col-span-2 flex items-center justify-center rounded-3xl border border-dashed border-border/80 p-5 text-center text-sm text-muted-foreground">
            这周不看表，听着参考音的感觉去找。
          </div>
        )}
        <div className="col-span-3 flex flex-col justify-center gap-4">
          {phase === 'idle' && (
            <Button size="lg" onClick={() => void go()}>
              <Mic /> 听目标音，然后开始滑
            </Button>
          )}
          {phase === 'reference' && <div className="font-display text-2xl">仔细听…</div>}
          {phase === 'take' && (
            <div>
              <div className="font-display text-2xl text-amber">从低处慢慢往上滑</div>
              <div className="mt-2 text-sm text-muted-foreground">用「呜——」滑上去，听到和刚才的音合上了就停住，稳住不动。</div>
            </div>
          )}
          {phase === 'done' && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <ResultLine ok={took !== null}>
                  {took !== null ? `找到了，用了 ${took.toFixed(1)} 秒。` : '10 秒内没稳住。下一题先慢一点滑，到了就停。'}
                </ResultLine>
              </div>
              <Button size="lg" onClick={next}>
                {round + 1 >= rounds ? '完成这一组' : '下一题'}
              </Button>
            </div>
          )}
        </div>
      </div>
    </TaskFrame>
  )
}

function pick(range: { low: number; high: number }): number {
  // 目标偏中上，留出从下面滑上来的空间。
  const lo = Math.min(range.high, range.low + 4)
  const hi = Math.max(lo, range.high - 2)
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}
