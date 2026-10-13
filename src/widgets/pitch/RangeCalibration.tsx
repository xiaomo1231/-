import { useCallback, useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, MicOff, RotateCcw } from 'lucide-react'
import { longestStableRun, median, nearestNote, smoothFrames } from '@/audio/pitch/analysis'
import { usePitchDetector } from '@/features/audio/usePitchDetector'
import { frequencyToMidi, midiToName } from '@/music/pitch'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { TunerGauge } from './TunerGauge'

type Step = 'low' | 'high' | 'done'

/** Hold time needed to accept a note (s). */
const HOLD = 1.2

export interface RangeCalibrationProps {
  initial?: { low: number; high: number }
  onSave: (range: { low: number; high: number }) => Promise<void> | void
}

/**
 * Vocal range calibration: sing your lowest comfortable note, then your
 * highest, each held for about a second. The median of the stable part is
 * stored; drills then place every target inside this range.
 */
export function RangeCalibration({ initial, onSave }: RangeCalibrationProps) {
  const { state, error, frame, start, record, peek } = usePitchDetector('voice', true)
  const [step, setStep] = useState<Step>('low')
  const [low, setLow] = useState<number | null>(null)
  const [high, setHigh] = useState<number | null>(null)
  const [holding, setHolding] = useState(0)
  const stopRef = useRef<(() => unknown) | null>(null)

  // Record continuously while a step is active and accept the first stable hold.
  useEffect(() => {
    if (state !== 'live' || step === 'done') return
    stopRef.current = record()
    const id = setInterval(() => {
      const frames = smoothFrames(peek().slice(-120))
      const run = longestStableRun(frames, 50)
      if (!run) {
        setHolding(0)
        return
      }
      const last = frames[frames.length - 1]!
      // Only count a run that is still going on.
      if (run.end < frames.length - 3) {
        setHolding(0)
        return
      }
      const hz = median(frames.slice(run.start, run.end + 1).map((f) => f.hz!))
      const midi = Math.round(frequencyToMidi(hz))
      // The high note must clearly differ from the low one (ignores a held low note).
      if (step === 'high' && low !== null && midi - low < 3) {
        setHolding(0)
        return
      }
      const secs = last.t - frames[run.start]!.t
      setHolding(Math.min(1, secs / HOLD))
      if (secs >= HOLD) {
        if (step === 'low') {
          setLow(midi)
          setStep('high')
        } else {
          setHigh(midi)
          setStep('done')
        }
        setHolding(0)
        stopRef.current?.()
        stopRef.current = record()
      }
    }, 150)
    return () => {
      clearInterval(id)
      stopRef.current?.()
    }
  }, [state, step, record, peek, low])

  const restart = useCallback(() => {
    setLow(null)
    setHigh(null)
    setStep('low')
  }, [])

  const tooNarrow = low !== null && high !== null && high - low < 7
  const swapped = low !== null && high !== null && high < low

  if (state === 'error') {
    return (
      <div className="rounded-2xl border border-destructive/40 bg-destructive/10 p-6">
        <div className="flex items-center gap-2 font-medium">
          <MicOff className="h-5 w-5 text-destructive" /> 麦克风不可用
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{error}</p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void start()}>
          <RotateCcw /> 重试
        </Button>
      </div>
    )
  }

  const live = frame?.hz ? nearestNote(frame.hz) : null

  return (
    <div className="grid grid-cols-5 gap-6">
      <TunerGauge
        className="col-span-2"
        cents={live?.cents ?? null}
        tolerance={50}
        label={live ? midiToName(live.midi, { octave: true }) : undefined}
        sublabel={state === 'live' ? undefined : '正在打开麦克风…'}
        level={frame?.rms ?? 0}
      />
      <div className="col-span-3 space-y-5">
        {initial && step === 'low' && (
          <p className="text-sm text-muted-foreground">
            当前音域：{midiToName(initial.low, { octave: true })} – {midiToName(initial.high, { octave: true })}
          </p>
        )}
        <ol className="space-y-3">
          <StepRow
            active={step === 'low'}
            done={low !== null}
            title="唱出你最低、但仍然舒服的音"
            hint="用“啊”或“嗯”，从说话的音高往下滑，停在还不费力的地方，稳住约 1 秒。"
            value={low}
            progress={step === 'low' ? holding : 0}
          />
          <StepRow
            active={step === 'high'}
            done={high !== null}
            title="唱出你最高、但仍然舒服的音"
            hint="往上滑到还不用喊、不破音的地方，稳住约 1 秒。"
            value={high}
            progress={step === 'high' ? holding : 0}
          />
        </ol>
        {step === 'done' && low !== null && high !== null && (
          <div className="space-y-3 rounded-2xl border border-border/80 bg-card p-5">
            {swapped || tooNarrow ? (
              <p className="text-sm text-amber">
                {swapped ? '最高音比最低音还低，可能是检测到了别的声音。' : '测到的音域不到 5 度，可能没唱到边。'}请再测一次。
              </p>
            ) : (
              <p className="text-sm">
                你的舒适音域：
                <b className="num">
                  {midiToName(low, { octave: true })} – {midiToName(high, { octave: true })}
                </b>
                ，共 {high - low} 个半音。之后所有唱歌练习都会放在这个范围里。
              </p>
            )}
            <div className="flex gap-3">
              <Button onClick={() => void onSave({ low: Math.min(low, high), high: Math.max(low, high) })} disabled={swapped || tooNarrow}>
                保存音域 <ArrowRight />
              </Button>
              <Button variant="ghost" onClick={restart}>
                <RotateCcw /> 重测
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function StepRow({ active, done, title, hint, value, progress }: { active: boolean; done: boolean; title: string; hint: string; value: number | null; progress: number }) {
  return (
    <li className={cn('rounded-2xl border p-4 transition-colors', active ? 'border-cyan/60 bg-cyan-soft/20' : 'border-border/70 bg-card', !active && !done && 'opacity-60')}>
      <div className="flex items-center justify-between">
        <span className="font-medium">{title}</span>
        {done && value !== null ? (
          <span className="flex items-center gap-1.5 text-sm text-success">
            <Check className="h-4 w-4" /> <span className="num">{midiToName(value, { octave: true })}</span>
          </span>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      {active && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-muted">
          <div className="h-full bg-amber transition-[width] duration-150" style={{ width: `${progress * 100}%` }} />
        </div>
      )}
    </li>
  )
}
