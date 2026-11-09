import type { PitchMetrics } from '@/pitchcamp/plan'
import type { PitchLog } from '@/pitchcamp/types'
import { cn } from '@/shared/lib/utils'

type Key = keyof PitchMetrics

const ROWS: ReadonlyArray<{ key: Key; label: string; unit: string; better: 'lower' | 'higher'; pct?: boolean }> = [
  { key: 'discCents', label: '能分辨的最小音差', unit: '音分', better: 'lower' },
  { key: 'matchCents', label: '单音平均偏差', unit: '音分', better: 'lower' },
  { key: 'hitRate', label: '单音唱准（±50 音分内）', unit: '%', better: 'higher', pct: true },
  { key: 'driftCents', label: '长音晃动', unit: '音分', better: 'lower' },
  { key: 'intervalHit', label: '音程唱对', unit: '%', better: 'higher', pct: true },
  { key: 'melodyHit', label: '短旋律唱对的音', unit: '%', better: 'higher', pct: true },
]

const show = (v: number | null, pct?: boolean) => (v === null ? '—' : pct ? `${Math.round(v * 100)}` : String(v))

/** 进步：诊断和每次复测的指标对比表，加上每天小测的单音偏差曲线。 */
export function ProgressPanel({ logs }: { logs: readonly PitchLog[] }) {
  const tests = logs.filter((l) => l.kind !== 'session')
  const daily = logs.filter((l) => l.metrics.matchCents !== null)
  if (!tests.length) return null
  const first = tests[0]!.metrics
  const last = tests[tests.length - 1]!.metrics

  return (
    <section className="rounded-3xl border border-border/80 bg-card p-7">
      <h2 className="font-display text-2xl font-semibold">进步</h2>
      <p className="mt-1 text-sm text-muted-foreground">诊断和第 8、15、22、30 次的复测用同一套题；绿色表示比诊断时好。</p>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-2 pr-4 font-normal">指标</th>
              {tests.map((t) => (
                <th key={t.id} className="px-3 py-2 text-right font-normal">
                  {t.kind === 'diagnosis' ? '诊断' : `第 ${t.session} 次`}
                </th>
              ))}
              {tests.length > 1 && <th className="px-3 py-2 text-right font-normal">变化</th>}
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r) => {
              const a = first[r.key]
              const b = last[r.key]
              const delta = a !== null && b !== null ? b - a : null
              const better = delta !== null && delta !== 0 && (r.better === 'lower' ? delta < 0 : delta > 0)
              return (
                <tr key={r.key} className="border-t border-border/60">
                  <td className="py-2.5 pr-4">
                    {r.label}
                    <span className="ml-1 text-xs text-muted-foreground">（{r.unit}）</span>
                  </td>
                  {tests.map((t) => (
                    <td key={t.id} className="num px-3 py-2.5 text-right">
                      {show(t.metrics[r.key], r.pct)}
                    </td>
                  ))}
                  {tests.length > 1 && (
                    <td className={cn('num px-3 py-2.5 text-right', better ? 'text-success' : delta ? 'text-destructive' : 'text-muted-foreground')}>
                      {delta === null || delta === 0 ? '—' : `${delta > 0 ? '+' : ''}${r.pct ? Math.round(delta * 100) : Math.round(delta)}`}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {daily.length >= 2 && <Trend logs={daily} />}
    </section>
  )
}

/** 每天单音偏差的折线（越低越好）。 */
function Trend({ logs }: { logs: readonly PitchLog[] }) {
  const values = logs.map((l) => l.metrics.matchCents!)
  const max = Math.max(60, ...values)
  const w = 600
  const h = 120
  const x = (i: number) => (values.length === 1 ? w / 2 : (i / (values.length - 1)) * (w - 20) + 10)
  const y = (v: number) => h - 10 - (v / max) * (h - 20)
  const points = values.map((v, i) => `${x(i)},${y(v)}`).join(' ')
  return (
    <div className="mt-6">
      <div className="mb-2 text-sm text-muted-foreground">每次练习的单音平均偏差（越低越好；虚线是 ±25 音分）</div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full" role="img" aria-label={`单音偏差从 ${values[0]} 到 ${values[values.length - 1]} 音分`}>
        <line x1={0} x2={w} y1={y(25)} y2={y(25)} className="stroke-[hsl(var(--success))]" strokeDasharray="4 4" strokeWidth={1} />
        <polyline points={points} fill="none" className="stroke-[hsl(var(--amber))]" strokeWidth={2.5} strokeLinejoin="round" />
        {values.map((v, i) => (
          <circle key={i} cx={x(i)} cy={y(v)} r={3.5} className="fill-[hsl(var(--amber))]" />
        ))}
      </svg>
    </div>
  )
}
