import { useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ClipboardCheck, Info, Loader2, Sparkles } from 'lucide-react'
import type { CritiqueRecord, ReviewDimension } from '@/entities/types'
import type { Score } from '@/music/score'
import { CritiqueService, ruleFindings } from '@/services/critiqueService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import { useAsync } from '@/shared/lib/useAsync'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { toast } from '@/features/toast/toastStore'
import { AIError, AILabel, AISetupHint } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { formatDateTime } from '@/shared/lib/format'
import { cn } from '@/shared/lib/utils'

const DIM_LABEL: Record<ReviewDimension, string> = { structure: '结构', harmony: '和声', melody: '旋律', arrangement: '编曲' }

const SEVERITY = {
  warn: { icon: AlertTriangle, cls: 'text-amber', label: '需要注意' },
  info: { icon: Info, cls: 'text-cyan', label: '建议' },
  good: { icon: CheckCircle2, cls: 'text-success', label: '做得好' },
} as const

export interface CritiquePanelProps {
  compositionId: string | null
  score: Score
  /** The editor has unsaved changes: critiques always review the saved version. */
  dirty: boolean
  onSave: () => Promise<string | null>
  /** Called after a critique was stored. */
  onRecorded?: (record: CritiqueRecord) => void
}

/**
 * Rule-engine checks (always) and the optional AI review (four dimensions,
 * suggestions only). Every critique is stored with the work so the student
 * can compare before and after a revision.
 */
export function CritiquePanel({ compositionId, score, dirty, onSave, onRecorded }: CritiquePanelProps) {
  const configured = useAIConfigured()
  const live = useMemo(() => ruleFindings(score), [score])
  const { data: history, reload } = useAsync(() => (compositionId ? CritiqueService.list(compositionId) : Promise.resolve([])), [compositionId])
  const [busy, setBusy] = useState<'rules' | 'ai' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const run = async (ai: boolean) => {
    setBusy(ai ? 'ai' : 'rules')
    setError(null)
    try {
      const id = dirty || !compositionId ? await onSave() : compositionId
      if (!id) return
      const rec = await CritiqueService.record(id, { ai })
      setOpenId(rec.id)
      reload()
      onRecorded?.(rec)
      toast({ title: ai ? 'AI 点评已保存' : '规则点评已保存', ...(rec.dropped ? { description: `有 ${rec.dropped} 条建议直接写出了旋律或和弦，按“不代写”规则已去掉。` } : {}), variant: 'success' })
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setBusy(null)
    }
  }

  const counts = { warn: live.filter((f) => f.severity === 'warn').length, info: live.filter((f) => f.severity === 'info').length, good: live.filter((f) => f.severity === 'good').length }
  const current = history?.find((h) => h.id === openId) ?? history?.[0]

  return (
    <div className="grid grid-cols-5 gap-6">
      <div className="col-span-3 space-y-5">
        <section className="rounded-2xl border border-border/80 bg-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 font-semibold">
              <ClipboardCheck className="h-4 w-4 text-amber" aria-hidden /> 点评
            </h3>
            <div className="flex gap-3 text-xs">
              {(['warn', 'info', 'good'] as const).map((k) => (
                <span key={k} className={SEVERITY[k].cls}>
                  {SEVERITY[k].label} {counts[k]}
                </span>
              ))}
            </div>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            规则检查是本地、可复现的测量；AI 点评是审美层面的建议，只指出方向，不会替你写旋律或和弦。点评针对的是保存后的版本{dirty ? '，点击时会先自动保存' : ''}。
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => void run(false)} disabled={busy !== null}>
              {busy === 'rules' ? <Loader2 className="animate-spin" /> : <ClipboardCheck />} 记录一次规则点评
            </Button>
            {configured && (
              <Button onClick={() => void run(true)} disabled={busy !== null}>
                {busy === 'ai' ? <Loader2 className="animate-spin" /> : <Sparkles />} {busy === 'ai' ? 'AI 正在听…' : '请 AI 点评'}
              </Button>
            )}
          </div>
          <div className="mt-3">
            <AIError message={error} />
          </div>
          {configured === false && <AISetupHint className="mt-4" what="可以请 AI 从结构、和声、旋律、编曲四个方面点评，并给出下一步修改方向" />}
        </section>

        {current && <CritiqueView record={current} />}
      </div>

      <aside className="col-span-2 space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground">点评记录</h3>
        {!compositionId && <p className="text-sm text-muted-foreground">保存作品后，点评会记录在这里，方便对比修改前后。</p>}
        {history?.length === 0 && compositionId && <p className="text-sm text-muted-foreground">还没有点评。</p>}
        <ul className="space-y-2">
          {history?.map((h) => {
            const warns = h.rules.filter((r) => r.severity === 'warn').length
            return (
              <li key={h.id}>
                <button
                  type="button"
                  onClick={() => setOpenId(h.id)}
                  aria-pressed={current?.id === h.id}
                  className={cn('focus-ring w-full rounded-xl border px-3 py-2 text-left text-sm transition-colors', current?.id === h.id ? 'border-amber/60 bg-amber-soft/30' : 'border-border/70 hover:border-cyan/40')}
                >
                  <div className="flex items-center justify-between">
                    <span className="num">{formatDateTime(h.createdAt)}</span>
                    {h.ai ? <AILabel>AI</AILabel> : <span className="text-xs text-muted-foreground">规则</span>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {h.bars} 小节 · 需要注意 {warns} 条
                  </div>
                </button>
              </li>
            )
          })}
        </ul>
      </aside>
    </div>
  )
}

function CritiqueView({ record }: { record: CritiqueRecord }) {
  return (
    <section className="space-y-4">
      {record.ai && (
        <div className="space-y-4 rounded-2xl border border-cyan/30 bg-cyan-soft/10 p-5">
          <div className="flex items-center justify-between">
            <AILabel>AI 点评</AILabel>
            <span className="font-mono text-[10px] text-muted-foreground">
              {record.promptVersion} · {record.model}
            </span>
          </div>
          <p className="font-medium">{record.ai.summary}</p>
          <div className="grid grid-cols-2 gap-3">
            {record.ai.dimensions.map((d) => (
              <div key={d.dimension} className="rounded-xl border border-border/60 bg-background/40 p-3 text-sm">
                <div className="mb-1 font-semibold">{DIM_LABEL[d.dimension]}</div>
                {d.strengths.map((s) => (
                  <p key={s} className="flex gap-1.5 text-success">
                    <CheckCircle2 className="mt-1 h-3 w-3 shrink-0" aria-hidden /> <span className="text-foreground">{s}</span>
                  </p>
                ))}
                {d.suggestions.map((s) => (
                  <p key={s.text} className="mt-1 flex gap-1.5">
                    <Info className="mt-1 h-3 w-3 shrink-0 text-cyan" aria-hidden />
                    <span>
                      {s.bar && <span className="num mr-1 text-xs text-amber">第 {s.bar} 小节</span>}
                      {s.text}
                    </span>
                  </p>
                ))}
              </div>
            ))}
          </div>
          <p className="text-sm">
            <span className="font-semibold">下一步：</span>
            {record.ai.nextStep}
          </p>
        </div>
      )}
      <div className="rounded-2xl border border-border/80 bg-card p-5">
        <h4 className="mb-2 text-sm font-semibold">规则检查（{formatDateTime(record.createdAt)}）</h4>
        <ul className="space-y-1.5 text-sm">
          {record.rules.length === 0 && <li className="text-muted-foreground">没有提示。</li>}
          {record.rules.map((r, i) => {
            const S = SEVERITY[r.severity]
            return (
              <li key={i} className="flex gap-2">
                <S.icon className={cn('mt-0.5 h-4 w-4 shrink-0', S.cls)} aria-label={S.label} />
                <span>
                  {r.bar && <span className="num mr-1 text-xs text-muted-foreground">第 {r.bar} 小节</span>}
                  {r.message}
                </span>
              </li>
            )
          })}
        </ul>
      </div>
    </section>
  )
}
