import { useEffect, useRef, useState } from 'react'
import { Check, Loader2, Timer } from 'lucide-react'
import * as engine from '@/audio/engine'
import { listenForOnsets, type OnsetSession } from '@/audio/onset/onsetListener'
import { CALIBRATION_MESSAGE, DEFAULT_CALIBRATION, calibrate, type CalibrationResult } from '@/audio/latency'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const BPM = 90
const CLICKS = 16

/**
 * Pluck the open low string along with 16 clicks. The first four are warm-up;
 * the typical offset between click and detected pluck is the latency to
 * subtract for this input→output pair.
 */
export function GuitarCalibration() {
  const judge = useGuitarAudio((s) => s.judge)
  const saveCalibration = useGuitarAudio((s) => s.saveCalibration)
  useProfileStore((s) => s.profile?.latencyByDevice)
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle')
  const [beat, setBeat] = useState(-1)
  const [result, setResult] = useState<CalibrationResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const session = useRef<OnsetSession | null>(null)
  const cancel = useRef<Array<() => void>>([])
  const onsets = useRef<number[]>([])

  useEffect(
    () => () => {
      cancel.current.forEach((c) => c())
      session.current?.stop()
    },
    [],
  )

  const start = async () => {
    setError(null)
    setResult(null)
    try {
      await engine.ensureAudio()
      onsets.current = []
      session.current = await listenForOnsets((o) => onsets.current.push(o.time))
      const sched = engine.scheduleClicks(BPM, CLICKS, { accentEvery: 4, startOffset: 0.8 })
      setState('running')
      sched.times.forEach((t, i) => cancel.current.push(engine.onAudioTime(t, () => setBeat(i))))
      cancel.current.push(
        engine.onAudioTime(sched.endAt + 0.5, () => {
          session.current?.stop()
          session.current = null
          setResult(calibrate(sched.times, onsets.current))
          setState('done')
          setBeat(-1)
        }),
      )
    } catch (e) {
      session.current?.stop()
      session.current = null
      setError(e instanceof Error ? e.message : String(e))
      setState('idle')
    }
  }

  const current = judge()

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        节拍器会响 {CLICKS} 下（{BPM} BPM）。每一下都拨一次空的低音弦，左手可以轻轻闷住琴弦。前 {DEFAULT_CALIBRATION.warmup} 下是热身，不计入。结果按“当前输入设备 + 输出设备”分别保存，换耳机或音箱后要重新校准。
      </p>
      <div className="flex flex-wrap items-center gap-4">
        <Button onClick={() => void start()} disabled={state === 'running'}>
          {state === 'running' ? <Loader2 className="animate-spin" /> : <Timer />} {state === 'running' ? '跟着节拍拨弦…' : current.calibrated ? '重新校准' : '开始校准'}
        </Button>
        <div className="flex gap-1.5" aria-hidden>
          {Array.from({ length: CLICKS }, (_, i) => (
            <span
              key={i}
              className={cn(
                'h-3 w-3 rounded-full transition-colors',
                i < DEFAULT_CALIBRATION.warmup ? 'bg-muted' : 'bg-border',
                beat === i && (i < DEFAULT_CALIBRATION.warmup ? 'bg-cyan' : 'bg-amber'),
                beat > i && i >= DEFAULT_CALIBRATION.warmup && 'bg-amber/50',
              )}
            />
          ))}
        </div>
        <span className="text-sm text-muted-foreground">
          当前使用：<b className="num text-foreground">{Math.round(current.seconds * 1000)} ms</b>
          {current.calibrated ? '（已校准）' : '（浏览器估计，建议校准）'}
        </span>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div role="status" className={cn('rounded-xl border p-4 text-sm', result.ok ? 'border-success/40 bg-success/10' : 'border-amber/40 bg-amber-soft/30')}>
          {result.ok ? (
            <>
              <div className="flex items-center gap-2 font-medium">
                <Check className="h-4 w-4 text-success" aria-hidden /> 测得 {result.offsetMs} ms，波动 ±{result.spreadMs} ms（用了 {result.used} 下）
              </div>
              <Button
                size="sm"
                className="mt-3"
                onClick={async () => {
                  await saveCalibration(result.offsetMs)
                  toast({ title: `已保存：${result.offsetMs} ms`, description: '这对输入、输出设备的节奏判定会使用这个值。', variant: 'success' })
                }}
              >
                保存这个结果
              </Button>
            </>
          ) : (
            <p>{CALIBRATION_MESSAGE[result.reason!]}</p>
          )}
        </div>
      )}
    </div>
  )
}
