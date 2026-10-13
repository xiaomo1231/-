import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Lightbulb, Loader2, Sparkles } from 'lucide-react'
import type { ConfusionPair } from '@/entities/types'
import { moduleInfo } from '@/drills/types'
import { confusionLabel } from '@/drills/confusionLabel'
import { confusionTip } from '@/drills/confusionTips'
import { ConfusionService } from '@/services/confusionService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import type { ConfusionExplanation } from '@/services/ai/validate'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { AIError, AILabel } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'

/** A confusion card that opens built-in tips, plus an optional AI explanation. */
export function ConfusionCard({ pair }: { pair: ConfusionPair }) {
  const [open, setOpen] = useState(false)
  const expected = confusionLabel(pair.module, pair.expected)
  const given = confusionLabel(pair.module, pair.given)
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="focus-ring rounded-2xl border border-border/80 bg-card p-5 text-left transition-colors hover:border-amber/50"
        aria-label={`${moduleInfo(pair.module).name}：${expected} 常被听成 ${given}，${pair.count} 次。查看辨别诀窍`}
      >
        <div className="text-xs text-muted-foreground">{moduleInfo(pair.module).name}</div>
        <div className="mt-2 font-medium">{expected}</div>
        <div className="text-sm text-muted-foreground">常被听成 {given}</div>
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="num text-amber">× {pair.count}</span>
          <span className="flex items-center gap-1 text-cyan">
            <Lightbulb className="h-3 w-3" aria-hidden /> 为什么？
          </span>
        </div>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">{open && <ConfusionBody pair={pair} expected={expected} given={given} />}</DialogContent>
      </Dialog>
    </>
  )
}

function ConfusionBody({ pair, expected, given }: { pair: ConfusionPair; expected: string; given: string }) {
  const tip = confusionTip(pair.module, pair.expected, pair.given)
  const configured = useAIConfigured()
  const [ai, setAi] = useState<ConfusionExplanation | null>(() => ConfusionService.cached(pair) ?? null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async () => {
    setBusy(true)
    setError(null)
    try {
      setAi(await ConfusionService.explain(pair))
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {expected} 和 {given}
        </DialogTitle>
        <DialogDescription>
          {moduleInfo(pair.module).name}里，{expected} 已经 {pair.count} 次被听成 {given}。
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4 text-sm leading-6">
        {tip ? (
          <div className="space-y-2">
            <p>{tip.why}</p>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {tip.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-muted-foreground">多听几遍两者，先唱出来再比较。</p>
        )}

        {ai && (
          <div className="space-y-2 rounded-2xl border border-cyan/30 bg-cyan-soft/20 p-4">
            <AILabel>AI 解释</AILabel>
            <p>{ai.why}</p>
            <ul className="list-disc space-y-1 pl-5">
              {ai.tips.map((t) => (
                <li key={t}>{t}</li>
              ))}
            </ul>
            {ai.practice && <p className="text-muted-foreground">接下来 5 分钟：{ai.practice}</p>}
          </div>
        )}
        <AIError message={error} />
        <div className="flex flex-wrap gap-2">
          <Link to={`/drill/${pair.module}?count=10`} className={buttonVariants({ size: 'sm' })}>
            针对练 10 题
          </Link>
          {configured && !ai && (
            <Button size="sm" variant="outline" onClick={() => void ask()} disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Sparkles />} 请 AI 解释
            </Button>
          )}
          {configured === false && (
            <Link to="/settings#ai" className={buttonVariants({ size: 'sm', variant: 'ghost' })}>
              配置 AI 后可以获得更详细的解释
            </Link>
          )}
        </div>
      </div>
    </>
  )
}
