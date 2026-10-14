import { useCallback, useState } from 'react'
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Flame, RotateCcw, Trophy } from 'lucide-react'
import { MODULES, moduleInfo, type ModuleId } from '@/drills/types'
import { DailyPlanService } from '@/services/dailyPlanService'
import { BadgeService } from '@/services/badgeService'
import { ProfileService } from '@/services/profileService'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import type { DailyPlan } from '@/entities/types'
import { DrillRunner, LevelChange, type DrillSummary } from '@/widgets/drill/DrillRunner'
import { MODULE_ICON } from '@/widgets/drill/moduleIcons'
import { moduleDisplayName, moduleVisible } from '@/widgets/drill/moduleName'
import { RangeCalibration } from '@/widgets/pitch/RangeCalibration'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

const CHALLENGE_SECONDS = 90

export function DrillPage() {
  const { moduleId } = useParams()
  const [params] = useSearchParams()
  if (!MODULES.some((m) => m.id === moduleId)) return <Navigate to="/camp" replace />
  // Remount the whole run when the URL changes (e.g. "next plan item").
  return <DrillSession key={`${moduleId}?${params.toString()}`} moduleId={moduleId as ModuleId} params={params} />
}

function DrillSession({ moduleId, params }: { moduleId: ModuleId; params: URLSearchParams }) {
  const navigate = useNavigate()
  const refresh = useProfileStore((s) => s.refresh)
  const planItemId = params.get('plan')
  const challenge = params.get('mode') === 'challenge'
  const count = Math.max(3, Math.min(40, Number(params.get('count')) || 10))
  const level = Number(params.get('level')) || undefined
  const [summary, setSummary] = useState<DrillSummary | null>(null)
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const [planCompleted, setPlanCompleted] = useState(false)
  const info = moduleInfo(moduleId)
  const Icon = MODULE_ICON[moduleId]
  const profile = useProfileStore((s) => s.profile)!
  const setProfile = useProfileStore((s) => s.set)
  const name = moduleDisplayName(moduleId, profile)

  const onDone = useCallback(
    async (s: DrillSummary) => {
      setSummary(s)
      if (planItemId) {
        try {
          const res = await DailyPlanService.completeItem(planItemId)
          setPlan(res.plan)
          if (res.planCompleted) {
            setPlanCompleted(true)
            const first = await BadgeService.award('first-daily')
            if (first) toast({ title: `获得徽章「${first.name}」`, description: first.description, variant: 'success' })
            const p = await ProfileService.ensure()
            for (const b of await BadgeService.checkStreak(p.streak.current)) {
              toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
            }
          }
        } catch {
          // A plan from yesterday (page left open over midnight) is simply ignored.
        }
      }
      await refresh()
    },
    [planItemId, refresh],
  )

  if (summary) {
    const nextItem = plan?.items.find((i) => !i.completed)
    const accuracy = summary.questions ? summary.creditSum / summary.questions : 0
    return (
      <div className="mx-auto max-w-3xl animate-rise space-y-8 py-6">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Icon className="h-4 w-4 text-amber" /> {name} · {challenge ? '挑战模式' : planItemId ? '每日训练' : '自由练习'}
        </div>
        <h1 className="text-4xl font-semibold">{planCompleted ? '今天的训练全部完成 🎉' : challenge ? '时间到！' : '这一组完成了'}</h1>

        <div className="grid grid-cols-4 gap-4">
          <Stat label="正确率" value={`${Math.round(accuracy * 100)}%`} accent />
          <Stat label={challenge ? '答题数' : '答对'} value={challenge ? String(summary.questions) : `${summary.correct}/${summary.questions}`} />
          <Stat label="最长连对" value={String(summary.bestCombo)} />
          <Stat label="获得经验" value={`+${summary.xp + (planCompleted ? 60 : 0)}`} accent />
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-border/80 bg-card px-6 py-4 text-sm">
          <span>
            <LevelChange before={summary.levelBefore} after={summary.levelAfter} />
          </span>
          {summary.meanTimingMs !== null && (
            <span className="text-muted-foreground">
              平均节奏偏差 <b className="num text-foreground">{summary.meanTimingMs}ms</b>
            </span>
          )}
        </div>

        {planCompleted && (
          <div className="flex items-center gap-4 rounded-2xl border border-amber/40 bg-amber-soft/30 p-6">
            <Flame className="h-8 w-8 text-amber" />
            <div>
              <div className="font-display text-lg font-semibold">连续训练 +1 天</div>
              <div className="text-sm text-muted-foreground">每日训练奖励 +60 XP。明天见。</div>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {nextItem ? (
            <Button
              size="lg"
              onClick={() => navigate(nextItem.link ?? `/drill/${nextItem.module}?plan=${nextItem.id}&level=${nextItem.level}&count=${nextItem.questions}`)}
            >
              下一组：{nextItem.label ?? moduleInfo(nextItem.module).name} <ArrowRight />
            </Button>
          ) : (
            <Button size="lg" onClick={() => navigate('/camp')}>
              回到训练营 <ArrowRight />
            </Button>
          )}
          {!planItemId && (
            <Button variant="outline" size="lg" onClick={() => navigate(`/drill/${moduleId}?${new URLSearchParams({ ...Object.fromEntries(params), r: String(Date.now()) })}`)}>
              <RotateCcw /> 再来一组
            </Button>
          )}
          <Button variant="ghost" size="lg" onClick={() => navigate(`/camp/${moduleId}`)}>
            查看{name}详情
          </Button>
        </div>
      </div>
    )
  }

  if (info.kind === 'sing' && !profile.vocalRange) {
    return (
      <div className="mx-auto max-w-4xl space-y-6">
        <Link to={`/camp/${moduleId}`} className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 返回
        </Link>
        <div className="rounded-3xl border border-border/80 bg-card/80 p-8 shadow-lift">
          <h1 className="text-2xl font-semibold">先测一下你的舒适音域</h1>
          <p className="mt-2 mb-6 text-muted-foreground">只需要一次。之后所有唱歌练习都会放在你唱得舒服的范围里。请允许使用麦克风，建议戴耳机。</p>
          <RangeCalibration
            onSave={async (range) => {
              const next = await ProfileService.update({ vocalRange: range })
              const b = await BadgeService.award('range-set')
              if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
              setProfile(next)
            }}
          />
        </div>
      </div>
    )
  }

  if (!moduleVisible(moduleId, profile)) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <h1 className="text-2xl font-semibold">还没有设置乐器</h1>
        <p className="mt-3 text-muted-foreground">在设置里选择主乐器或第二乐器后，就能做乐器任务。</p>
        <Link to="/settings" className={buttonVariants({ className: 'mt-6' })}>
          去设置
        </Link>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <Link to={planItemId ? '/camp' : `/camp/${moduleId}`} className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> 退出
        </Link>
        <div className="flex items-center gap-2 text-sm">
          <Icon className="h-4 w-4 text-amber" />
          <span className="font-medium">{name}</span>
          {challenge && (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full border border-cyan/40 px-2 py-0.5 text-xs text-cyan">
              <Trophy className="h-3 w-3" /> 挑战
            </span>
          )}
        </div>
      </div>
      <div className={cn('rounded-3xl border border-border/80 bg-card/80 p-8 shadow-lift', challenge && 'border-cyan/30')}>
        <DrillRunner
          module={moduleId}
          kind={challenge ? 'challenge' : planItemId ? 'daily' : 'free'}
          count={count}
          {...(level ? { levelOverride: level } : {})}
          {...(challenge ? { timeLimitSec: CHALLENGE_SECONDS } : {})}
          {...(!challenge ? { run: planItemId ? { id: `plan:${planItemId}`, title: `今日训练 · ${name}`, daily: true } : { id: `module:${moduleId}`, title: name } } : {})}
          onDone={(s) => void onDone(s)}
        />
      </div>
      <p className="text-center text-xs text-muted-foreground">
        快捷键：数字键选答案 · R 重听 · Enter 下一题 · 节奏题用空格键
      </p>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/80 bg-card p-5">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={cn('num mt-2 text-3xl font-semibold', accent && 'text-amber')}>{value}</div>
    </div>
  )
}
