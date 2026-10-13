import { useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarRange, Loader2, Sparkles, Wand2 } from 'lucide-react'
import { AdviceService } from '@/services/adviceService'
import { ExerciseService } from '@/services/exerciseService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import { moduleInfo } from '@/drills/types'
import { useAsync } from '@/shared/lib/useAsync'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { AIError, AILabel } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'

/** This week's focus (built-in ranking, or the AI's advice when requested) and the AI practice entry. */
export function WeeklyAdvice() {
  const configured = useAIConfigured()
  const { data, reload } = useAsync(async () => {
    const [local, saved, counts] = await Promise.all([AdviceService.local(), AdviceService.current(), ExerciseService.counts()])
    return { local, saved, counts }
  }, [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async () => {
    setBusy(true)
    setError(null)
    try {
      await AdviceService.generate()
      reload()
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const focus = data?.saved?.focus ?? data?.local.focus ?? []
  const fromAI = Boolean(data?.saved)

  return (
    <section className="grid grid-cols-3 gap-4">
      <div className="col-span-2 rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-xl font-semibold">
            <CalendarRange className="h-5 w-5 text-amber" aria-hidden /> 本周重点
          </h2>
          {fromAI ? <AILabel /> : <span className="text-xs text-muted-foreground">按你的练习记录自动排出</span>}
        </div>
        <ul className="mt-4 space-y-2">
          {focus.map((f) => (
            <li key={f.module} className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/40 px-4 py-2.5">
              <div className="min-w-0">
                <div className="font-medium">
                  {moduleInfo(f.module).name} <span className="num text-xs text-muted-foreground">每天约 {f.minutes} 分钟</span>
                </div>
                {f.reason && <div className="truncate text-xs text-muted-foreground">{f.reason}</div>}
              </div>
              <Link to={`/drill/${f.module}`} className={buttonVariants({ size: 'sm', variant: 'outline' })} aria-label={`练习${moduleInfo(f.module).name}`}>
                练
              </Link>
            </li>
          ))}
        </ul>
        {data?.saved?.tip && <p className="mt-3 text-sm text-muted-foreground">{data.saved.tip}</p>}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {configured && (
            <Button size="sm" variant="ghost" onClick={() => void ask()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} {fromAI ? '让 AI 重新分析本周' : '请 AI 分析本周重点'}
            </Button>
          )}
          <AIError message={error} />
        </div>
      </div>
      <Link
        to="/camp/ai"
        className="focus-ring group flex flex-col justify-between rounded-3xl border border-cyan/30 bg-card p-6 transition-all hover:-translate-y-1 hover:border-cyan/60 hover:shadow-lift"
      >
        <div>
          <Wand2 className="h-6 w-6 text-cyan" aria-hidden />
          <div className="mt-3 text-xl font-semibold">AI 专项练习</div>
          <p className="mt-1 text-sm text-muted-foreground">按你的薄弱和弦与旋律出题，本地校验、本地判分。</p>
        </div>
        <div className="mt-4 text-xs text-muted-foreground">
          {configured === false ? '需要先配置 AI' : data ? `${data.counts.pending} 道待练` : '…'}
        </div>
      </Link>
    </section>
  )
}
