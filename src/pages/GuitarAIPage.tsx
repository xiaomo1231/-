import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Sparkles } from 'lucide-react'
import { GuitarAIService } from '@/services/guitarAIService'
import { GuitarService } from '@/services/guitarService'
import { afterGuitarAttempt } from '@/services/guitarRewards'
import { aiErrorMessage } from '@/services/ai/aiClient'
import { useAsync } from '@/shared/lib/useAsync'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { AIError, AILabel, AISetupHint } from '@/widgets/ai/AIBits'
import { ExerciseRunner } from '@/widgets/guitar/ExerciseRunner'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'

/**
 * AI guitar coaching: the AI proposes strumming, lick and bend exercises
 * aimed at the student's weak spots; each is checked locally and becomes a
 * normal workshop exercise with local judging.
 */
export function GuitarAIPage() {
  useTimbreOverride('guitar')
  const configured = useAIConfigured()
  const refreshProfile = useProfileStore((s) => s.refresh)
  const { data: pending, reload } = useAsync(() => GuitarAIService.pending(), [])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const active = pending?.find((p) => p.id === activeId) ?? pending?.[0]
  const exercise = active?.spec.kind === 'guitar' ? active.spec.exercise : null

  const generate = async () => {
    setBusy(true)
    setError(null)
    try {
      const { saved, rejected } = await GuitarAIService.generate()
      toast({
        title: `生成了 ${saved.length} 道吉他练习`,
        description: rejected
          ? `另有 ${rejected} 道没通过本地检查，已丢弃。`
          : '全部通过了本地检查。',
        variant: 'success',
      })
      reload()
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-8">
      <Link
        to="/guitar"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 吉他工坊
      </Link>
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-semibold">AI 吉他专项</h1>
          <AILabel>可选</AILabel>
        </div>
        <p className="mt-3 max-w-3xl text-muted-foreground">
          AI
          读取你在吉他工坊里分数较低的练习，出扫弦、句型和推弦的针对性练习。每道题都先经过本地检查：节奏型和和弦必须在可用范围内，句型的每个音都要在
          A 小调五声第一把位里。判分和其他练习一样在本地完成。
        </p>
      </header>
      {configured === false && (
        <AISetupHint what="AI 会根据你的吉他练习记录出针对性的扫弦、句型和推弦练习" />
      )}
      {configured && (
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void generate()} disabled={busy}>
            {busy ? <Loader2 className="animate-spin" /> : <Sparkles />}{' '}
            {busy ? 'AI 正在出题…' : '生成一组新练习'}
          </Button>
          <AIError message={error} />
        </div>
      )}
      {pending && pending.length > 0 && active && exercise && (
        <div className="grid grid-cols-[260px,1fr] gap-6">
          <nav aria-label="AI 练习" className="space-y-2">
            {pending.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setActiveId(p.id)}
                aria-current={active.id === p.id ? 'true' : undefined}
                className={cn(
                  'focus-ring w-full rounded-2xl border p-3 text-left text-sm',
                  active.id === p.id
                    ? 'border-amber/60 bg-amber-soft/30'
                    : 'border-border/70 hover:border-cyan/40',
                )}
              >
                <span className="block font-medium">
                  {p.spec.kind === 'guitar' ? p.spec.exercise.title : ''}
                </span>
                <span className="block text-xs text-muted-foreground">{p.reason}</span>
              </button>
            ))}
          </nav>
          <section
            className="rounded-3xl border border-cyan/40 bg-card p-6"
            aria-label={exercise.title}
          >
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-2xl font-semibold">{exercise.title}</h2>
              <span className="font-mono text-[10px] text-muted-foreground">
                {active.promptVersion}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{active.reason}</p>
            <div className="mt-5" key={active.id}>
              <ExerciseRunner
                exercise={exercise}
                onRecord={(score, passed, summary) =>
                  void (async () => {
                    const r = await GuitarService.record(exercise.id, 'AI', score, passed, summary)
                    const rewards = await afterGuitarAttempt(r.firstPass)
                    for (const b of rewards.badges)
                      toast({
                        title: `获得徽章「${b.name}」`,
                        description: b.description,
                        variant: 'success',
                      })
                    if (rewards.planCompleted)
                      toast({
                        title: '今日训练全部完成',
                        description: `额外 +${rewards.bonusXp} XP`,
                        variant: 'success',
                      })
                    await refreshProfile()
                    if (passed) {
                      await GuitarAIService.markUsed(active.id)
                      toast({ title: '这道 AI 练习过关了', variant: 'success' })
                      reload()
                    }
                  })()
                }
              />
            </div>
          </section>
        </div>
      )}
      {pending && pending.length === 0 && configured && (
        <p className="text-sm text-muted-foreground">
          还没有待练的 AI 练习。先在各单元里多练几次，AI 会更了解你的薄弱点。
        </p>
      )}
    </div>
  )
}
