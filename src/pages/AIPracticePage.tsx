import { useCallback, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Play, Sparkles, Trash2 } from 'lucide-react'
import { ExerciseService, questionFromExercise } from '@/services/exerciseService'
import { aiErrorMessage } from '@/services/ai/aiClient'
import type { GeneratedExercise } from '@/entities/types'
import { moduleInfo } from '@/drills/types'
import { skillLabel } from '@/drills/skills'
import { romanLabel, type RomanId } from '@/music/keys'
import { useAsync } from '@/shared/lib/useAsync'
import { useAIConfigured } from '@/features/ai/useAIConfigured'
import { toast } from '@/features/toast/toastStore'
import { DrillRunner, type DrillSummary } from '@/widgets/drill/DrillRunner'
import { AIError, AILabel, AISetupHint } from '@/widgets/ai/AIBits'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'

function specLabel(ex: GeneratedExercise): string {
  if (ex.spec.kind === 'progression') return `${ex.spec.mode === 'major' ? '大调' : '小调'}进行 · ${ex.spec.romans.length} 个和弦`
  if (ex.spec.kind === 'melody') return `旋律听写 · ${ex.spec.notes.length} 个音`
  return ex.spec.exercise.title
}

/**
 * AI-targeted practice: the AI proposes progressions and melodies aimed at
 * the student's weak skills; each one is checked locally, turned into a
 * normal question and graded locally.
 */
export function AIPracticePage() {
  const configured = useAIConfigured()
  const { data: pending, reload } = useAsync(() => ExerciseService.pending(), [])
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState<GeneratedExercise[] | null>(null)
  const [summary, setSummary] = useState<DrillSummary | null>(null)

  const questions = useMemo(() => running?.map((ex) => questionFromExercise(ex)) ?? [], [running])

  const generate = async () => {
    setGenerating(true)
    setError(null)
    try {
      const { saved, rejected } = await ExerciseService.generate()
      toast({
        title: `生成了 ${saved.length} 道针对性练习`,
        description: rejected ? `另有 ${rejected} 道没通过本地检查，已丢弃。` : '全部通过了本地检查。',
        variant: 'success',
      })
      reload()
    } catch (e) {
      setError(aiErrorMessage(e))
    } finally {
      setGenerating(false)
    }
  }

  // Question ids are "ai-<exercise id>", which also holds for a resumed run's saved questions.
  const onAnswered = useCallback((q: { id: string }) => {
    if (q.id.startsWith('ai-')) void ExerciseService.markUsed(q.id.slice(3))
  }, [])

  if (running && !summary) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-semibold">AI 专项练习</h1>
          <AILabel>AI 出题 · 本地判分</AILabel>
        </div>
        <DrillRunner module={questions[0]!.module} kind="ai" count={questions.length} questions={questions} onAnswered={onAnswered} onDone={setSummary} run={{ id: 'ai', title: 'AI 专项练习' }} />
      </div>
    )
  }

  if (summary) {
    return (
      <div className="mx-auto max-w-xl space-y-6 py-10 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-cyan" />
        <h1 className="text-3xl font-semibold">专项练习完成</h1>
        <p className="text-muted-foreground">
          答对 <b className="num text-foreground">{summary.correct}</b> / {summary.questions}，获得 <b className="num text-amber">+{summary.xp}</b> XP。
          这些题会更新对应技能的掌握度，但不影响模块的升降级。
        </p>
        <div className="flex justify-center gap-3">
          <Button
            onClick={() => {
              setRunning(null)
              setSummary(null)
              reload()
            }}
          >
            回到专项练习
          </Button>
          <Link to="/camp" className={buttonVariants({ variant: 'outline' })}>
            回训练营
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <Link to="/camp" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 训练营
      </Link>
      <header>
        <div className="flex items-center gap-3">
          <h1 className="text-4xl font-semibold">AI 专项练习</h1>
          <AILabel>可选</AILabel>
        </div>
        <p className="mt-3 text-muted-foreground">
          AI 读取你的薄弱技能和常见混淆，设计流行 / 摇滚风格的和声进行（E6）和旋律听写（E8）。每道题都先经过本地检查：和弦必须在你当前级别里，旋律必须在调内、音数和跳进符合要求。判分完全在本地完成。
        </p>
      </header>

      {configured === false && <AISetupHint what="AI 会按你的薄弱项出和声进行与旋律听写题" />}

      {configured && (
        <section className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button onClick={() => void generate()} disabled={generating}>
              {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} {generating ? 'AI 正在出题…' : '生成一组新练习'}
            </Button>
            {pending && pending.length > 0 && (
              <>
                <Button variant="outline" onClick={() => setRunning(pending)}>
                  <Play /> 开始练习（{pending.length} 题）
                </Button>
                <Button
                  variant="ghost"
                  onClick={async () => {
                    await ExerciseService.discardPending()
                    reload()
                  }}
                >
                  <Trash2 /> 清空未练的题
                </Button>
              </>
            )}
          </div>
          <AIError message={error} />
        </section>
      )}

      {pending && pending.length > 0 && (
        <ul className="space-y-3">
          {pending.map((ex) => (
            <li key={ex.id} className="rounded-2xl border border-border/80 bg-card p-4">
              <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {ex.module === 'guitar' ? '吉他' : moduleInfo(ex.module).name} · 第 {ex.level} 级 · {specLabel(ex)}
                </span>
                <span className="font-mono">{ex.promptVersion}</span>
              </div>
              <p className="mt-2">{ex.reason}</p>
              {ex.targetSkills.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ex.targetSkills.map((s) => (
                    <span key={s} className="rounded-full bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                      {skillLabel(s)}
                    </span>
                  ))}
                </div>
              )}
              {ex.spec.kind === 'progression' && (
                <details className="mt-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">偷看答案</summary>
                  {ex.spec.romans.map((r) => romanLabel(r as RomanId)).join(' – ')}
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
      {pending && pending.length === 0 && configured && <p className="text-sm text-muted-foreground">还没有未练的题。点“生成一组新练习”，大约需要 10–30 秒。</p>}
    </div>
  )
}
