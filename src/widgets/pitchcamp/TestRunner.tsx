import { useMemo, useRef, useState } from 'react'
import { EMPTY_METRICS, type PitchMetrics } from '@/pitchcamp/plan'
import { driftMetric, intervalMetric, matchMetrics, melodyMetric, singItems, type VoiceOpts } from '@/pitchcamp/questions'
import { cn } from '@/shared/lib/utils'
import { DiscriminationTask } from './DiscriminationTask'
import { PerformSeries, type SeriesResult } from './PerformSeries'

type Step = 'disc' | 'match' | 'sustain' | 'interval' | 'melody'

const STEPS: ReadonlyArray<{ id: Step; label: string }> = [
  { id: 'disc', label: '分辨音高' },
  { id: 'match', label: '单音' },
  { id: 'sustain', label: '长音' },
  { id: 'interval', label: '音程' },
  { id: 'melody', label: '短旋律' },
]

/**
 * 诊断 / 复测：每次都是同一套题型（分辨音高 16 次、单音 6 个、长音 2 个、音程 4 个、
 * 短旋律 2 句），唱的时候不看音准表，量的是真实水平。
 */
export function TestRunner({ voice, onDone }: { voice: VoiceOpts; onDone: (metrics: PitchMetrics, seconds: number) => void }) {
  const [step, setStep] = useState<Step>('disc')
  const metrics = useRef<PitchMetrics>({ ...EMPTY_METRICS })
  const seconds = useRef(0)
  const items = useMemo(
    () => ({
      match: singItems('S1', 1, 6, { ...voice, octaveEquivalence: true }),
      sustain: singItems('S2', 2, 2, { ...voice, octaveEquivalence: true }),
      interval: singItems('S3', 1, 4, voice),
      melody: singItems('S7', 1, 2, voice),
    }),
    [voice],
  )

  const after = (next: Step | null, add: Partial<PitchMetrics>, secs: number) => {
    metrics.current = { ...metrics.current, ...add }
    seconds.current += secs
    if (next) setStep(next)
    else onDone(metrics.current, seconds.current)
  }

  const series = (results: SeriesResult[], secs: number, next: Step | null, pick: (r: SeriesResult[]) => Partial<PitchMetrics>) =>
    after(next, pick(results), secs)

  return (
    <div className="space-y-5">
      <ol className="flex gap-2" aria-label="测试进度">
        {STEPS.map((s, i) => {
          const at = STEPS.findIndex((x) => x.id === step)
          return (
            <li
              key={s.id}
              className={cn(
                'flex-1 rounded-xl border px-3 py-2 text-center text-xs',
                i === at ? 'border-amber bg-amber-soft/40' : i < at ? 'border-success/50 bg-success/10' : 'border-border/70 text-muted-foreground',
              )}
            >
              {s.label}
            </li>
          )
        })}
      </ol>
      {step === 'disc' && (
        <DiscriminationTask
          trials={16}
          title="分辨音高"
          why="两个很近的音，判断第二个比第一个高还是低。答对音差会变小，答错会变大，最后得出你能分辨的最小音差。"
          onDone={(r) => after('match', { discCents: r.discCents }, r.seconds)}
        />
      )}
      {step === 'match' && (
        <PerformSeries
          title="单音"
          why="听一个音，唱出同一个音。测试时不看音准表。"
          items={items.match}
          feedback="score"
          onDone={(r, s) => series(r, s, 'sustain', matchMetrics)}
        />
      )}
      {step === 'sustain' && (
        <PerformSeries title="长音" why="把一个音稳稳地唱 3 秒。" items={items.sustain} feedback="score" onDone={(r, s) => series(r, s, 'interval', driftMetric)} />
      )}
      {step === 'interval' && (
        <PerformSeries title="音程" why="听一个音，唱出它上方的音程。" items={items.interval} feedback="score" onDone={(r, s) => series(r, s, 'melody', intervalMetric)} />
      )}
      {step === 'melody' && (
        <PerformSeries title="短旋律" why="听一句旋律，跟着节拍唱回来。" items={items.melody} feedback="score" onDone={(r, s) => series(r, s, null, melodyMetric)} />
      )}
    </div>
  )
}
