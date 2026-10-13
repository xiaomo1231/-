/**
 * 整首重新开始: the banner while singing the whole song from the top, and the
 * whole-song report when it is done.
 */
import { Pause, Play, Repeat, Square, X } from 'lucide-react'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export interface RunPhraseResult {
  index: number
  lyric: string
  score: number
  notesSung: number
  notesTotal: number
  biasCents: number
}

export interface RunReport {
  phrases: RunPhraseResult[]
  /** Phrases that can be scored in the song. */
  scorable: number
  /** Mean of the latest draft's best scores, to compare with. */
  previous?: { name: string; avg: number }
  savedToFull: boolean
}

const pct = (x: number) => Math.round(x * 100)

function summarize(r: RunReport) {
  const n = r.phrases.length
  const avg = n ? r.phrases.reduce((t, p) => t + p.score, 0) / n : 0
  const sung = r.phrases.reduce((t, p) => t + p.notesSung, 0)
  const total = r.phrases.reduce((t, p) => t + p.notesTotal, 0)
  const bias = n ? Math.round(r.phrases.reduce((t, p) => t + p.biasCents, 0) / n) : 0
  const sorted = [...r.phrases].sort((a, b) => b.score - a.score)
  return {
    n,
    avg,
    hit: total ? sung / total : 0,
    bias,
    best: sorted.slice(0, 3),
    worst: sorted
      .slice(-3)
      .reverse()
      .filter((p) => !sorted.slice(0, 3).includes(p) || n <= 3),
  }
}

export function RunBanner({
  phase,
  countdown,
  sung,
  total,
  avg,
  onPause,
  onResume,
  onStop,
}: {
  phase: 'countdown' | 'running' | 'paused'
  countdown: number
  sung: number
  total: number
  avg: number | null
  onPause: () => void
  onResume: () => void
  onStop: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-amber/50 bg-amber-soft/20 px-4 py-2.5 text-sm">
      <span className="font-medium">整首模式</span>
      {phase === 'countdown' ? (
        <span className="num text-lg text-amber">{countdown}</span>
      ) : (
        <span className="num text-xs text-muted-foreground">
          已唱 {sung} / {total} 句{avg !== null ? ` · 平均 ${pct(avg)}` : ''}
          {phase === 'paused' ? ' · 已暂停' : ''}
        </span>
      )}
      <div className="h-1.5 min-w-24 flex-1 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-amber transition-[width]"
          style={{ width: `${total ? Math.round((sung / total) * 100) : 0}%` }}
        />
      </div>
      {phase === 'running' && (
        <Button size="sm" variant="outline" onClick={onPause}>
          <Pause /> 暂停
        </Button>
      )}
      {phase === 'paused' && (
        <Button size="sm" onClick={onResume}>
          <Play /> 继续
        </Button>
      )}
      <Button size="sm" variant="ghost" onClick={onStop}>
        <Square /> 结束
      </Button>
    </div>
  )
}

export function RunReportCard({
  report,
  onPractise,
  onClose,
}: {
  report: RunReport
  onPractise: (index: number) => void
  onClose: () => void
}) {
  const s = summarize(report)
  const diff = report.previous ? s.avg - report.previous.avg : null
  const row = (p: RunPhraseResult) => (
    <li key={p.index} className="flex items-center gap-2 text-sm">
      <span className="num w-10 text-muted-foreground">{pct(p.score)}</span>
      <span className="min-w-0 flex-1 truncate">
        第 {p.index + 1} 句{p.lyric ? ` · ${p.lyric}` : ''}
      </span>
      <Button size="sm" variant="ghost" onClick={() => onPractise(p.index)}>
        <Repeat /> 循环练这句
      </Button>
    </li>
  )
  return (
    <section
      className="space-y-4 rounded-3xl border border-amber/50 bg-card p-6"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">整首报告</h2>
          <p className="text-xs text-muted-foreground">
            唱了 {s.n} / {report.scorable} 句
            {report.savedToFull ? '；这次整首的录音已放进「完整版」，可以直接去做后期。' : '。'}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="focus-ring rounded p-1 text-muted-foreground hover:text-foreground"
          aria-label="关闭报告"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      {s.n === 0 ? (
        <p className="text-sm text-muted-foreground">
          这次没有唱到可以评分的句子（麦克风没开，或者还没唱到第一句就结束了）。
        </p>
      ) : (
        <div className="flex flex-wrap gap-6">
          <div>
            <div className="text-xs text-muted-foreground">整首平均</div>
            <div className="num text-3xl font-semibold">{pct(s.avg)}</div>
            {diff !== null && (
              <div className={cn('text-xs', diff >= 0 ? 'text-success' : 'text-muted-foreground')}>
                {diff >= 0
                  ? `比「${report.previous!.name}」高 ${pct(diff)} 分`
                  : `比「${report.previous!.name}」低 ${pct(-diff)} 分`}
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-muted-foreground">唱到的音</div>
            <div className="num text-3xl font-semibold">{pct(s.hit)}%</div>
          </div>
          <div>
            <div className="text-xs text-muted-foreground">整体倾向</div>
            <div className="num text-3xl font-semibold">
              {Math.abs(s.bias) < 15 ? '居中' : s.bias > 0 ? `偏高 ${s.bias}` : `偏低 ${-s.bias}`}
            </div>
          </div>
        </div>
      )}
      {s.n > 0 && (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-1 text-sm font-medium text-success">唱得最好的</h3>
            <ul className="space-y-1">{s.best.map(row)}</ul>
          </div>
          <div>
            <h3 className="mb-1 text-sm font-medium text-amber">最值得再练的</h3>
            <ul className="space-y-1">{s.worst.map(row)}</ul>
          </div>
        </div>
      )}
      <p className="text-xs text-muted-foreground/80">
        这些数字是根据这一次演唱估计的，不是对嗓音的评判。
      </p>
    </section>
  )
}
