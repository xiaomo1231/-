import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Play } from 'lucide-react'
import * as engine from '@/audio/engine'
import { newStaircase, staircaseThreshold, stepStaircase, type Staircase } from '@/pitchcamp/plan'
import { Button } from '@/shared/ui/Button'
import { ResultLine, TaskFrame } from './TaskFrame'

interface Trial {
  base: number
  /** 第二个音比第一个高（true）还是低。 */
  up: boolean
  cents: number
}

const newTrial = (cents: number): Trial => ({
  base: 55 + Math.floor(Math.random() * 18),
  up: Math.random() < 0.5,
  cents,
})

/**
 * 细分辨音：两个很近的音，判断第二个比第一个高还是低。两次答对音差缩小，
 * 答错就放大（阶梯法），结束时给出能稳定分辨的最小音差。
 */
export function DiscriminationTask({
  trials,
  start = 100,
  title = '细分辨音',
  why,
  onDone,
}: {
  trials: number
  start?: number
  title?: string
  why?: string
  onDone: (result: { discCents: number; seconds: number }) => void
}) {
  const [stair, setStair] = useState<Staircase>(() => newStaircase(start))
  const [trial, setTrial] = useState<Trial>(() => newTrial(start))
  const [last, setLast] = useState<{ ok: boolean; cents: number; up: boolean } | null>(null)
  const [busy, setBusy] = useState(false)
  const began = useRef(Date.now())
  const finished = useRef(false)

  const play = useCallback(async (t: Trial) => {
    await engine.ensureAudio()
    setBusy(true)
    const detune = t.up ? t.cents : -t.cents
    const { endAt } = engine.playSequence([
      { midi: t.base, duration: 0.7, at: 0, detuneCents: 0 },
      { midi: t.base, duration: 0.7, at: 0.9, detuneCents: detune },
    ])
    const off = engine.onAudioTime(endAt, () => setBusy(false))
    return off
  }, [])

  useEffect(() => {
    void play(trial)
  }, [trial, play])

  const answer = useCallback(
    (up: boolean) => {
      if (busy || finished.current) return
      const ok = up === trial.up
      const next = stepStaircase(stair, ok)
      setLast({ ok, cents: trial.cents, up: trial.up })
      setStair(next)
      if (next.trials >= trials) {
        finished.current = true
        onDone({ discCents: staircaseThreshold(next), seconds: (Date.now() - began.current) / 1000 })
        return
      }
      window.setTimeout(() => setTrial(newTrial(next.cents)), 600)
    },
    [busy, trial, stair, trials, onDone],
  )

  // ↑ / ↓ 键作答，R 重听。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp') answer(true)
      else if (e.key === 'ArrowDown') answer(false)
      else if (e.key === 'r' || e.key === 'R') void play(trial)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [answer, play, trial])

  return (
    <TaskFrame title={title} why={why} index={stair.trials} total={trials}>
      <div className="flex flex-col items-center gap-6">
        <div className="text-sm text-muted-foreground">
          第二个音比第一个高还是低？
          <span className="num ml-2 rounded-md bg-muted px-2 py-0.5 text-xs">这题差 {trial.cents} 音分</span>
        </div>
        <div className="flex gap-4">
          <Button size="lg" variant="outline" disabled={busy} onClick={() => answer(true)}>
            <ArrowUp /> 高（↑）
          </Button>
          <Button size="lg" variant="outline" disabled={busy} onClick={() => answer(false)}>
            <ArrowDown /> 低（↓）
          </Button>
          <Button size="lg" variant="ghost" disabled={busy} onClick={() => void play(trial)}>
            <Play /> 再听（R）
          </Button>
        </div>
        {last && (
          <ResultLine ok={last.ok}>
            {last.ok ? '对了。' : `不对，第二个音是${last.up ? '高' : '低'}的。`}
            <span className="ml-2 text-muted-foreground">
              {last.ok ? '连对两次音差会变小。' : '音差放大一点再来。'}
            </span>
          </ResultLine>
        )}
      </div>
    </TaskFrame>
  )
}
