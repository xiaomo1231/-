import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Award, History, Play, RotateCcw, Timer, TrendingDown, TrendingUp, Zap } from 'lucide-react'
import * as engine from '@/audio/engine'
import type { DrillQuestion, DrillResponse, GradeResult, ModuleId } from '@/drills/types'
import { moduleInfo } from '@/drills/types'
import { levelTitles } from '@/drills/levels'
import type { ActiveRun, SessionKind } from '@/entities/types'
import { DrillService } from '@/services/drillService'
import { ModuleProgressService } from '@/services/moduleProgressService'
import { BadgeService } from '@/services/badgeService'
import { ProfileService } from '@/services/profileService'
import { rankFor } from '@/services/progressRules'
import { RunService } from '@/services/runService'
import { Button } from '@/shared/ui/Button'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { logger } from '@/infrastructure/logger/logger'
import { cn } from '@/shared/lib/utils'
import { QuestionView } from './QuestionView'

export interface DrillSummary {
  sessionId: string
  module: ModuleId
  questions: number
  correct: number
  creditSum: number
  xp: number
  bestCombo: number
  levelBefore: number
  levelAfter: number
  meanTimingMs: number | null
}

export interface DrillRunnerProps {
  module: ModuleId
  kind: SessionKind
  /** Number of questions; ignored when `timeLimitSec` is set. */
  count: number
  levelOverride?: number
  focusSkills?: string[]
  /** Challenge mode: answer as many as possible before the clock runs out. */
  timeLimitSec?: number
  onDone: (summary: DrillSummary) => void
  /** Rendered in the header, right side. */
  headerExtra?: ReactNode
  /**
   * A fixed list of questions (AI exercises). They are graded and update
   * mastery as usual but never move the module level up or down.
   */
  questions?: DrillQuestion[]
  /** Called after each fixed question has been answered and saved. */
  onAnswered?: (question: DrillQuestion, index: number) => void
  /**
   * Save progress after every answer under this id so the student can leave
   * and continue later. Not used in challenge mode (the clock cannot resume).
   */
  run?: DrillRunTarget
}

export interface DrillRunTarget {
  /** Where the drill lives, e.g. "module:E1", "plan:<item id>", "lesson:<id>:<block>". */
  id: string
  title: string
  /** Route that resumes it; defaults to the current page. */
  link?: string
  /** Daily-plan items do not carry over to the next day. */
  daily?: boolean
}

/** What a drill saves after each answer (plain data, stored in activeRuns). */
interface DrillSnapshot {
  index: number
  question: DrillQuestion
  result: GradeResult | null
  response: DrillResponse | null
  combo: number
  stats: { correct: number; creditSum: number; xp: number; bestCombo: number; levelBefore: number; levelAfter: number; timing: number[] }
  /** The fixed question list (AI exercises), so a resumed run asks the same questions. */
  questions?: DrillQuestion[]
}

/** Combo bonus XP in challenge mode: +1 per answer once the combo reaches 3, +3 from 10. */
function comboBonus(combo: number): number {
  if (combo >= 10) return 3
  if (combo >= 3) return 1
  return 0
}

export function DrillRunner({ module, kind, count: countProp, levelOverride, focusSkills, timeLimitSec, onDone, headerExtra, questions: questionsProp, onAnswered, run: runProp }: DrillRunnerProps) {
  const run = timeLimitSec ? undefined : runProp
  // A resumed run replaces the fixed list with the one it saved.
  const fixed = useRef<DrillQuestion[] | undefined>(questionsProp)
  const [fixedLen, setFixedLen] = useState(questionsProp?.length)
  const questions = fixed.current
  const count = fixedLen ?? countProp
  const [offer, setOffer] = useState<ActiveRun | null>(null)
  const saving = useRef<Promise<void>>(Promise.resolve())
  const profile = useProfileStore((s) => s.profile)!
  const refreshProfile = useProfileStore((s) => s.refresh)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [question, setQuestion] = useState<DrillQuestion | null>(null)
  const [result, setResult] = useState<GradeResult | null>(null)
  const [response, setResponse] = useState<DrillResponse | null>(null)
  const [busy, setBusy] = useState(false)
  const [index, setIndex] = useState(0)
  const [combo, setCombo] = useState(0)
  const [remaining, setRemaining] = useState(timeLimitSec ?? 0)
  const [lastXp, setLastXp] = useState<{ amount: number; key: number } | null>(null)
  const stats = useRef({ correct: 0, creditSum: 0, xp: 0, bestCombo: 0, levelBefore: 0, levelAfter: 0, timing: [] as number[] })
  const finished = useRef(false)

  const fetchQuestion = useCallback(
    async (avoid?: string, at = 0) => {
      const list = fixed.current
      if (list) {
        setQuestion(list[at] ?? null)
        setResult(null)
        setResponse(null)
        return
      }
      const q = await DrillService.nextQuestion(module, {
        ...(levelOverride ? { levelOverride } : {}),
        ...(focusSkills ? { focusSkills } : {}),
        ...(avoid ? { avoidAnswer: avoid } : {}),
      })
      setQuestion(q)
      setResult(null)
      setResponse(null)
    },
    [module, levelOverride, focusSkills],
  )

  const begin = async () => {
    const list = fixed.current
    const s = await DrillService.startSession(kind, list ? Array.from(new Set(list.map((q) => q.module))) : [module])
    setSessionId(s.id)
    stats.current.levelBefore = levelOverride ?? (await ModuleProgressService.ensure(module)).level
    stats.current.levelAfter = stats.current.levelBefore
    await fetchQuestion()
  }

  /** Continue a saved run exactly where it stopped (an answered question shows its result). */
  const resume = async (saved: ActiveRun) => {
    setOffer(null)
    const data = saved.data as DrillSnapshot
    const session = saved.sessionId ? await DrillService.session(saved.sessionId) : undefined
    if (!session || session.endedAt || !data?.question) {
      await RunService.clear(saved.id)
      await begin()
      return
    }
    if (data.questions) {
      fixed.current = data.questions
      setFixedLen(data.questions.length)
    }
    stats.current = { ...data.stats, timing: [...data.stats.timing] }
    setCombo(data.combo)
    setIndex(data.index)
    setResponse(data.response)
    setResult(data.result)
    setQuestion(data.question)
    setSessionId(session.id)
  }

  const restart = async (saved: ActiveRun) => {
    setOffer(null)
    await RunService.discard(saved.id)
    await begin()
  }

  // Start a session once (or offer to continue a saved one).
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const saved = run ? await RunService.get(run.id) : null
      if (cancelled) return
      if (saved && saved.kind === 'drill') {
        setOffer(saved)
        return
      }
      await begin()
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Save progress after every question shown and every answer.
  useEffect(() => {
    if (!run || !sessionId || !question || finished.current) return
    const snapshot: DrillSnapshot = { index, question, result, response, combo, stats: { ...stats.current, timing: [...stats.current.timing] }, ...(fixed.current ? { questions: fixed.current } : {}) }
    saving.current = saving.current
      .then(() =>
        finished.current
          ? undefined
          : RunService.save({
              id: run.id,
              kind: 'drill',
              title: run.title,
              link: run.link ?? window.location.pathname + window.location.search,
              ...(run.daily ? { daily: true } : {}),
              sessionId,
              done: index + (result ? 1 : 0),
              total: count,
              correct: stats.current.correct,
              data: snapshot,
            }),
      )
      .catch((err) => logger.warn('Saving drill progress failed', { error: err instanceof Error ? err.message : String(err) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question, result, sessionId])

  const finish = useCallback(async () => {
    if (finished.current || !sessionId) return
    finished.current = true
    await DrillService.endSession(sessionId)
    if (run) {
      await saving.current
      await RunService.clear(run.id)
    }
    const firstSession = await BadgeService.award('first-session')
    if (firstSession) toast({ title: `获得徽章「${firstSession.name}」`, description: firstSession.description, variant: 'success' })
    const s = stats.current
    onDone({
      sessionId,
      module,
      questions: index + (result ? 1 : 0),
      correct: s.correct,
      creditSum: s.creditSum,
      xp: s.xp,
      bestCombo: s.bestCombo,
      levelBefore: s.levelBefore,
      levelAfter: s.levelAfter,
      meanTimingMs: s.timing.length ? Math.round(s.timing.reduce((a, b) => a + b, 0) / s.timing.length) : null,
    })
  }, [index, module, onDone, result, sessionId, run])

  // Challenge clock.
  useEffect(() => {
    if (!timeLimitSec || !sessionId) return
    const id = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          clearInterval(id)
          void finish()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => clearInterval(id)
  }, [timeLimitSec, sessionId, finish])

  const onSubmit = useCallback(
    async (r: DrillResponse, ms: number) => {
      if (!question || !sessionId || busy || result) return
      setBusy(true)
      setResponse(r)
      try {
        const res = await DrillService.submit(sessionId, question, r, ms, questions ? { countsTowardLevel: false } : {})
        if (questions) onAnswered?.(question, index)
        setResult(res.grade)
        const s = stats.current
        if (res.grade.correct) s.correct++
        s.creditSum += res.grade.credit
        if (res.grade.timing) s.timing.push(res.grade.timing.meanAbsDeviationMs)
        const nextCombo = res.grade.correct ? combo + 1 : 0
        setCombo(nextCombo)
        s.bestCombo = Math.max(s.bestCombo, nextCombo)
        let xp = res.xp
        if (timeLimitSec && res.grade.correct) {
          const bonus = comboBonus(nextCombo)
          if (bonus) {
            await ProfileService.addXp(bonus)
            xp += bonus
          }
        }
        s.xp += xp
        setLastXp({ amount: xp, key: Date.now() })
        if (res.grade.correct) engine.playSuccess()

        if (res.level.after !== res.level.before) {
          s.levelAfter = res.level.after
          const titles = levelTitles(module)
          const title = titles[res.level.after - 1]?.title ?? ''
          if (res.level.after > res.level.before) {
            toast({ title: `升级！${moduleInfo(module).name} · 第 ${res.level.after} 级`, description: title, variant: 'success' })
            for (const b of await BadgeService.checkLevel(module, res.level.after)) {
              toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
            }
          } else {
            toast({ title: `回到第 ${res.level.after} 级巩固一下`, description: res.level.decision.reason, variant: 'info' })
          }
        }
        if (question.kind === 'perform' && question.module === 'S1' && res.grade.correct && question.toleranceCents <= 15) {
          const b = await BadgeService.award('pitch-15c')
          if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
        }
        if (nextCombo === 10) {
          const b = await BadgeService.award('combo-10')
          if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
        }
        if (res.grade.timing && res.grade.correct && res.grade.timing.meanAbsDeviationMs <= 25) {
          const b = await BadgeService.award('rhythm-tight')
          if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
        }
        if (res.rankedUp) {
          const p = await ProfileService.ensure()
          toast({ title: `段位提升：${rankFor(p.xp).name}`, description: rankFor(p.xp).flavor, variant: 'success' })
        }
        await refreshProfile()
      } catch (err) {
        logger.error('Drill submit failed', { error: err instanceof Error ? err.message : String(err) })
        toast({ title: '这道题没能保存', description: '作答结果已显示，但练习记录写入浏览器存储失败。可以刷新页面后继续。', variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [busy, combo, module, question, refreshProfile, result, sessionId, timeLimitSec, questions, onAnswered, index],
  )

  const onNext = useCallback(() => {
    if (!result) return
    const nextIndex = index + 1
    if (!timeLimitSec && nextIndex >= count) {
      void finish()
      return
    }
    setIndex(nextIndex)
    const avoid = question && 'answer' in question && !Array.isArray(question.answer) ? String(question.answer) : undefined
    void fetchQuestion(avoid, nextIndex)
  }, [count, fetchQuestion, finish, index, question, result, timeLimitSec])

  const total = timeLimitSec ? null : count
  const progressRatio = total ? (index + (result ? 1 : 0)) / total : timeLimitSec ? remaining / timeLimitSec : 0

  return (
    <div className="space-y-8">
      <header className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 font-mono text-xs text-muted-foreground">
            {total ? (
              <span>
                <b className="text-sm text-foreground">{Math.min(index + 1, total)}</b> / {total}
              </span>
            ) : (
              <span className={cn('flex items-center gap-1.5', remaining <= 10 && 'text-destructive')}>
                <Timer className="h-3.5 w-3.5" />
                <b className="text-sm">{remaining}s</b>
              </span>
            )}
            <span>第 {question?.level ?? '–'} 级</span>
            <span className={cn('flex items-center gap-1 transition-colors', combo >= 3 ? 'text-amber' : '')}>
              <Zap className="h-3.5 w-3.5" /> 连对 {combo}
            </span>
            <span className="relative flex items-center gap-1">
              <Award className="h-3.5 w-3.5" /> +{stats.current.xp} XP
              {lastXp && lastXp.amount > 0 && (
                <span key={lastXp.key} className="absolute -top-5 left-4 animate-rise text-amber">
                  +{lastXp.amount}
                </span>
              )}
            </span>
          </div>
          {headerExtra}
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-muted">
          <div
            className={cn('h-full rounded-full transition-[width] duration-500', timeLimitSec ? 'bg-cyan' : 'bg-amber')}
            style={{ width: `${Math.round(progressRatio * 100)}%` }}
          />
        </div>
      </header>

      {offer ? (
        <div className="mx-auto max-w-lg rounded-3xl border border-cyan/40 bg-card p-7 text-center shadow-lift">
          <History className="mx-auto h-8 w-8 text-cyan" aria-hidden />
          <h2 className="mt-3 text-xl font-semibold">上次还没做完</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            做到第 <b className="num text-foreground">{offer.done}</b> / {offer.total} 题，答对 <b className="num text-foreground">{offer.correct}</b> 题。已经答过的题都记进了练习记录。
          </p>
          <div className="mt-5 flex justify-center gap-3">
            <Button onClick={() => void resume(offer)} autoFocus>
              <Play /> 继续
            </Button>
            <Button variant="outline" onClick={() => void restart(offer)}>
              <RotateCcw /> 重新开始
            </Button>
          </div>
        </div>
      ) : question ? (
        <QuestionView
          key={question.id}
          question={question}
          result={result}
          response={response}
          onSubmit={(r, ms) => void onSubmit(r, ms)}
          onNext={onNext}
          deviceLatencyMs={profile.deviceLatencyMs}
          nextLabel={!timeLimitSec && index + 1 >= count ? '完成' : '下一题'}
          busy={busy}
        />
      ) : (
        <div className="py-20 text-center text-sm text-muted-foreground">正在准备题目…</div>
      )}
    </div>
  )
}

export function LevelChange({ before, after }: { before: number; after: number }) {
  if (after > before) {
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <TrendingUp className="h-4 w-4" /> 升到第 {after} 级
      </span>
    )
  }
  if (after < before) {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <TrendingDown className="h-4 w-4" /> 回到第 {after} 级
      </span>
    )
  }
  return <span className="text-muted-foreground">保持第 {after} 级</span>
}
