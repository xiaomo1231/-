import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff, RotateCcw } from 'lucide-react'
import * as engine from '@/audio/engine'
import { startDrone, stopDrone } from '@/audio/drone'
import { centsFromTarget, smoothFrames } from '@/audio/pitch/analysis'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { trailingLock } from '@/pitchcamp/lock'
import { DEGREE_NAME, DRONE_PATTERNS, meanAbs, type FeedbackMode } from '@/pitchcamp/plan'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { TunerGauge } from '@/widgets/pitch/TunerGauge'
import { ResultLine, TaskFrame } from './TaskFrame'

type Phase = 'idle' | 'take' | 'done'

const LOCK_SECONDS = 0.5
const LOCK_TOL = 30
const NOTE_TIMEOUT = 7

/**
 * 持续音上唱级数：主音（加五度）一直响着，按顺序唱出屏幕上的级数，每个音唱稳了
 * 自动跳到下一个；7 秒没稳住算没唱对，也跳过去。
 */
export function DroneTask({
  rounds,
  level,
  range,
  feedback,
  why,
  onDone,
}: {
  rounds: number
  level: number
  range: { low: number; high: number }
  feedback: FeedbackMode
  why?: string
  onDone: (result: { hit: number; total: number; meanCents: number | null; seconds: number }) => void
}) {
  const mic = usePitchDetector('voice', true)
  const { record, peek, state: micState, start: micStart } = mic
  const patterns = DRONE_PATTERNS[Math.min(DRONE_PATTERNS.length, Math.max(1, level)) - 1]!
  const [round, setRound] = useState(0)
  const [phase, setPhase] = useState<Phase>('idle')
  const [setup, setSetup] = useState(() => makeRound(patterns, range))
  const [pos, setPos] = useState(0)
  const [marks, setMarks] = useState<Array<boolean | null>>([])
  const noteStart = useRef(0)
  const stopRec = useRef<(() => unknown) | null>(null)
  const hits = useRef(0)
  const total = useRef(0)
  const cents = useRef<Array<number | null>>([])
  const began = useRef(Date.now())

  useEffect(() => () => stopDrone(), [])

  const go = useCallback(async () => {
    if (phase !== 'idle') return
    if (micState !== 'live') await micStart()
    await engine.ensureAudio()
    // 先弹一下主音，再开始持续音。
    const { endAt } = engine.playSequence([{ midi: setup.tonic, duration: 1.0, at: 0 }])
    engine.onAudioTime(endAt, () => {
      void startDrone([setup.tonic - 12, setup.tonic - 5])
      stopRec.current = record()
      noteStart.current = engine.rawTime() + 0.6
      setPos(0)
      setMarks([])
      setPhase('take')
    })
  }, [phase, micState, micStart, setup, record])

  const advance = useCallback(
    (ok: boolean, c: number | null) => {
      total.current += 1
      if (ok) hits.current += 1
      cents.current.push(c)
      setMarks((m) => [...m, ok])
      const nextPos = pos + 1
      if (nextPos >= setup.pattern.length) {
        stopDrone()
        stopRec.current?.()
        setPhase('done')
        return
      }
      setPos(nextPos)
      noteStart.current = engine.rawTime()
      // 新的一个音：从现在开始重新判断。
      stopRec.current?.()
      stopRec.current = record()
    },
    [pos, setup.pattern.length, record],
  )

  useEffect(() => {
    if (phase !== 'take') return
    const target = setup.tonic + setup.pattern[pos]!
    const id = window.setInterval(() => {
      const frames = smoothFrames(peek()).filter((f) => f.t >= noteStart.current)
      const lock = trailingLock(frames, target, LOCK_TOL)
      if (lock.seconds >= LOCK_SECONDS) {
        engine.playSuccess()
        advance(true, lock.cents)
      } else if (engine.rawTime() - noteStart.current > NOTE_TIMEOUT) advance(false, null)
    }, 120)
    return () => window.clearInterval(id)
  }, [phase, pos, setup, peek, advance])

  const next = () => {
    if (round + 1 >= rounds) {
      onDone({ hit: hits.current, total: total.current, meanCents: meanAbs(cents.current), seconds: (Date.now() - began.current) / 1000 })
      return
    }
    setRound((r) => r + 1)
    setSetup(makeRound(patterns, range))
    setPhase('idle')
  }

  if (mic.state === 'error')
    return (
      <TaskFrame title="持续音上唱级数">
        <div className="flex items-center gap-2">
          <MicOff className="h-5 w-5 text-destructive" /> 麦克风不可用：{mic.error}
        </div>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void mic.start()}>
          <RotateCcw /> 重试
        </Button>
      </TaskFrame>
    )

  const target = setup.tonic + (setup.pattern[pos] ?? 0)
  const live = phase === 'take' && mic.frame?.hz ? centsFromTarget(mic.frame.hz, target, true) : null
  return (
    <TaskFrame title="持续音上唱级数" why={why} index={round} total={rounds}>
      <div className="mb-6 flex flex-wrap justify-center gap-2" aria-label="要唱的级数">
        {setup.pattern.map((d, i) => (
          <div
            key={i}
            className={cn(
              'num flex h-16 min-w-16 items-center justify-center rounded-2xl border px-3 text-2xl font-semibold transition-colors',
              phase === 'take' && i === pos ? 'border-amber bg-amber-soft/50' : 'border-border/70 bg-background/50',
              marks[i] === true && 'border-success/60 bg-success/15',
              marks[i] === false && 'border-destructive/60 bg-destructive/10',
            )}
          >
            {DEGREE_NAME[d] ?? d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-5">
        {feedback === 'live' ? (
          <TunerGauge className="col-span-2" cents={live} tolerance={LOCK_TOL} label={phase === 'take' ? `第 ${DEGREE_NAME[setup.pattern[pos]!] ?? ''} 级` : undefined} level={mic.frame?.rms ?? 0} />
        ) : (
          <div className="col-span-2 flex items-center justify-center rounded-3xl border border-dashed border-border/80 p-5 text-center text-sm text-muted-foreground">
            这周不看表，靠持续音听：和主音「合上了」的感觉就是准。
          </div>
        )}
        <div className="col-span-3 flex flex-col justify-center gap-4">
          {phase === 'idle' && (
            <Button size="lg" onClick={() => void go()}>
              <Mic /> 开始（先听主音）
            </Button>
          )}
          {phase === 'take' && (
            <div className="text-sm text-muted-foreground">按顺序唱，每个音稳住半秒就会跳到下一个。唱「啦」或「呜」都可以。</div>
          )}
          {phase === 'done' && (
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <ResultLine ok={marks.every(Boolean)}>
                  唱对 {marks.filter(Boolean).length} / {marks.length} 个音。
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

function makeRound(patterns: ReadonlyArray<ReadonlyArray<number>>, range: { low: number; high: number }) {
  const pattern = patterns[Math.floor(Math.random() * patterns.length)]!
  const top = Math.max(...pattern)
  const lo = range.low + 1
  const hi = Math.max(lo, range.high - top - 1)
  const tonic = lo + Math.floor(Math.random() * (hi - lo + 1))
  return { pattern, tonic }
}
