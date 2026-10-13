import { useEffect, useRef, useState } from 'react'
import * as engine from '@/audio/engine'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const BPM = 90
const COUNT_IN = 4
const TAPS = 8

/**
 * Measures the student's habitual offset (keyboard + reaction + audio path not
 * covered by `outputLatency`). Median of (tap − click) over 8 beats.
 */
export function LatencyCalibration({ current, onSave }: { current: number; onSave: (ms: number) => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [measured, setMeasured] = useState<number | null>(null)
  const [beat, setBeat] = useState(-1)
  const clicks = useRef<number[]>([])
  const taps = useRef<number[]>([])
  const cancel = useRef<Array<() => void>>([])

  useEffect(() => () => cancel.current.forEach((c) => c()), [])

  const start = async () => {
    await engine.ensureAudio()
    taps.current = []
    setMeasured(null)
    const sched = engine.scheduleClicks(BPM, COUNT_IN + TAPS, { accentEvery: 4, startOffset: 0.3 })
    clicks.current = sched.times.slice(COUNT_IN)
    setState('running')
    sched.times.forEach((t, i) => cancel.current.push(engine.onAudioTime(t, () => setBeat(i))))
    cancel.current.push(
      engine.onAudioTime(sched.endAt + 0.3, () => {
        const offsets: number[] = []
        for (const click of clicks.current) {
          const near = taps.current.reduce<number | null>(
            (best, t) => (best === null || Math.abs(t - click) < Math.abs(best - click) ? t : best),
            null,
          )
          if (near !== null && Math.abs(near - click) < 0.3) offsets.push((near - click) * 1000)
        }
        offsets.sort((a, b) => a - b)
        const median = offsets.length >= 4 ? offsets[Math.floor(offsets.length / 2)]! : null
        setMeasured(median === null ? null : Math.round(median))
        setState('done')
        setBeat(-1)
      }),
    )
  }

  useEffect(() => {
    if (state !== 'running') return
    const onKey = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || e.repeat) return
      e.preventDefault()
      taps.current.push(engine.rawTime() - engine.outputLatencySeconds())
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state])

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        听 4 拍预备后，跟着接下来的 8 下节拍按空格键。系统会测出你这台电脑上的固定延迟，以后所有节奏题都会扣掉它。
      </p>
      <div className="flex items-center gap-2" aria-hidden="true">
        {Array.from({ length: COUNT_IN + TAPS }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-3 flex-1 rounded-full transition-colors duration-75',
              i === beat ? (i < COUNT_IN ? 'bg-cyan' : 'bg-amber') : i < COUNT_IN ? 'bg-muted/60' : 'bg-muted',
            )}
          />
        ))}
      </div>
      <div className="flex items-center gap-4">
        <Button variant="outline" onClick={() => void start()} disabled={state === 'running'}>
          {state === 'running' ? '按空格键跟拍…' : state === 'done' ? '重新测量' : '开始测量'}
        </Button>
        <span className="text-sm text-muted-foreground">
          当前补偿 <b className="num text-foreground">{current}ms</b>
        </span>
      </div>
      {state === 'done' && (
        <div className="flex items-center justify-between rounded-xl border border-border/80 bg-background/60 px-4 py-3 text-sm">
          {measured === null ? (
            <span className="text-muted-foreground">有效按键太少，没能测出来。再试一次，每一拍都按。</span>
          ) : (
            <>
              <span>
                测得偏差 <b className="num">{measured > 0 ? '+' : ''}{measured}ms</b>
                <span className="ml-2 text-muted-foreground">（正数表示习惯性偏晚）</span>
              </span>
              <Button size="sm" onClick={() => void onSave(Math.max(0, measured))} disabled={measured < 0}>
                {measured < 0 ? '偏早无需补偿' : '保存为补偿值'}
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  )
}
