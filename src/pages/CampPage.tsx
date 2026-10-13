import { Link, useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, Check, Flame, History, Play, Timer, Zap } from 'lucide-react'
import { KIND_LABEL, MODULES, moduleInfo } from '@/drills/types'
import { ReviewService } from '@/services/reviewService'
import { CourseService } from '@/services/courseService'
import { allLessons } from '@/course/stages'
import { moduleDisplayName, moduleVisible } from '@/widgets/drill/moduleName'
import { levelTitles } from '@/drills/levels'
import { DailyPlanService } from '@/services/dailyPlanService'
import { ModuleProgressService } from '@/services/moduleProgressService'
import { MasteryService } from '@/services/masteryService'
import { DrillService } from '@/services/drillService'
import { localDateKey, streakAlive } from '@/services/progressRules'
import { useProfileStore } from '@/features/profile/profileStore'
import { useAsync } from '@/shared/lib/useAsync'
import { MODULE_ICON } from '@/widgets/drill/moduleIcons'
import { VuBar } from '@/widgets/meter/VuBar'
import { ConfusionCard } from '@/widgets/drill/ConfusionExplain'
import { WeeklyAdvice } from '@/widgets/camp/WeeklyAdvice'
import { UnfinishedRuns } from '@/widgets/camp/UnfinishedRuns'
import { PendingHandsOn } from '@/widgets/camp/PendingHandsOn'
import { Button } from '@/shared/ui/Button'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

const KIND_HINT: Record<string, string> = {
  ear: '听辨 · 每题都会更新掌握度',
  rhythm: '空格键打拍 · 毫秒级判定',
  sing: '需要麦克风 · 先在“调音器与音域”标定音域',
  read: '五线谱必修 · 乐理规则',
  instrument: '麦克风检测你弹的音',
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 11) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

export function CampPage() {
  const navigate = useNavigate()
  const profile = useProfileStore((s) => s.profile)!
  const { data } = useAsync(async () => {
    const [plan, progress, confusions] = await Promise.all([
      DailyPlanService.today(),
      ModuleProgressService.all(),
      DrillService.confusions(null, 4),
    ])
    const averages = await Promise.all(MODULES.map((m) => MasteryService.moduleAverage(m.id)))
    const [dueCount, lessons] = await Promise.all([ReviewService.dueCount(), CourseService.progressAll()])
    const doneLessons = new Set(lessons.filter((l) => l.completedAt).map((l) => l.lessonId))
    const nextLesson = allLessons().find((l) => l.stage <= profile.unlockedStage && !doneLessons.has(l.id))
    return { plan, progress, confusions, averages, dueCount, nextLesson }
  }, [])

  const alive = streakAlive(profile.streak, localDateKey())
  const streak = alive ? profile.streak.current : 0
  const plan = data?.plan
  const done = plan?.items.filter((i) => i.completed).length ?? 0
  const total = plan?.items.length ?? 0
  const nextItem = plan?.items.find((i) => !i.completed)
  const planMinutes = plan ? Math.round(plan.items.reduce((s, i) => s + (i.link ? 300 : i.questions * moduleInfo(i.module).secondsPerQuestion), 0) / 60) : 0

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Training Camp · {localDateKey()}</div>
          <h1 className="mt-2 text-4xl font-semibold">
            {greeting()}
            {profile.displayName ? `，${profile.displayName}` : ''}。
          </h1>
        </div>
        {!profile.placementDone && (
          <Link to="/placement" className={buttonVariants({ variant: 'outline' })}>
            还没做入门测试 <ArrowRight />
          </Link>
        )}
      </header>

      <UnfinishedRuns />
      <PendingHandsOn />

      {/* Today's plan */}
      <section className="grid grid-cols-12 gap-5">
        <div className="studio-noise col-span-8 rounded-3xl border border-border/80 bg-card p-8 shadow-lift surface-gradient">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-sm text-muted-foreground">今日训练</div>
              <div className="mt-1 font-display text-3xl font-semibold">
                {!plan ? '正在排今天的训练…' : plan.completedAt ? '今天的训练已完成' : `约 ${planMinutes} 分钟 · ${total} 组`}
              </div>
            </div>
            <div className="text-right">
              <div className="num text-3xl font-semibold text-amber">
                {done}
                <span className="text-lg text-muted-foreground">/{total}</span>
              </div>
            </div>
          </div>
          <ol className="mt-8 space-y-2">
            {plan?.items.map((item, i) => {
              const Icon = MODULE_ICON[item.module]
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    disabled={item.completed}
                    onClick={() => navigate(item.link ?? `/drill/${item.module}?plan=${item.id}&level=${item.level}&count=${item.questions}`)}
                    className={cn(
                      'focus-ring group flex w-full items-center gap-4 rounded-2xl border px-4 py-3.5 text-left transition-all',
                      item.completed
                        ? 'border-transparent bg-background/40 opacity-60'
                        : item.id === nextItem?.id
                          ? 'border-cyan/50 bg-cyan-soft/20 hover:shadow-glow'
                          : 'border-border/70 bg-background/50 hover:border-border',
                    )}
                  >
                    <span className="num w-6 text-xs text-muted-foreground">{String(i + 1).padStart(2, '0')}</span>
                    <Icon className={cn('h-5 w-5', item.completed ? 'text-success' : 'text-amber')} />
                    <div className="min-w-0 flex-1">
                      <div className="font-medium">
                        {item.label ?? moduleDisplayName(item.module, profile)}
                        {!item.link && (
                          <span className="ml-2 font-mono text-xs text-muted-foreground">
                            L{item.level} · {item.questions} 题
                          </span>
                        )}
                      </div>
                      <div className="truncate text-xs text-muted-foreground">{item.reason}</div>
                    </div>
                    {item.completed ? (
                      <Check className="h-5 w-5 text-success" />
                    ) : (
                      <Play className="h-4 w-4 text-muted-foreground transition-colors group-hover:text-cyan" />
                    )}
                  </button>
                </li>
              )
            })}
          </ol>
          {nextItem && (
            <Button
              size="lg"
              className="mt-6"
              onClick={() => navigate(nextItem.link ?? `/drill/${nextItem.module}?plan=${nextItem.id}&level=${nextItem.level}&count=${nextItem.questions}`)}
            >
              {done === 0 ? '开始今天的训练' : '继续下一组'} <ArrowRight />
            </Button>
          )}
        </div>

        <div className="col-span-4 flex flex-col gap-5">
          <div className="rounded-3xl border border-border/80 bg-card p-6">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">连续训练</span>
              <Flame className={cn('h-5 w-5', streak > 0 ? 'text-amber' : 'text-muted-foreground')} />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={cn('num text-5xl font-semibold', streak > 0 && 'text-amber glow-amber')}>{streak}</span>
              <span className="text-muted-foreground">天</span>
            </div>
            <div className="mt-3 flex gap-1.5">
              {Array.from({ length: 7 }, (_, i) => (
                <span key={i} className={cn('h-1.5 flex-1 rounded-full', i < Math.min(streak, 7) ? 'bg-amber' : 'bg-muted')} />
              ))}
            </div>
            <div className="mt-3 text-xs text-muted-foreground">最长 {profile.streak.best} 天 · 断了也没关系，今天接着练</div>
          </div>

          <button
            type="button"
            onClick={() => navigate('/drill/E2?mode=challenge')}
            className="focus-ring group relative overflow-hidden rounded-3xl border border-cyan/40 bg-cyan-soft/25 p-6 text-left transition-all hover:shadow-glow"
          >
            <div className="flex items-center gap-2 text-sm text-cyan">
              <Timer className="h-4 w-4" /> 挑战模式
            </div>
            <div className="mt-2 font-display text-xl font-semibold">90 秒音程连击</div>
            <div className="mt-1 text-sm text-muted-foreground">连对越多加成越高，冲一次个人最佳。</div>
            <Zap className="absolute -bottom-3 -right-3 h-24 w-24 text-cyan/10 transition-transform duration-500 group-hover:rotate-12" />
          </button>
        </div>
      </section>

      {/* Course + review */}
      <section className="grid grid-cols-2 gap-5">
        {!data ? (
          <div className="h-[104px] rounded-3xl border border-border/60 bg-card/50" />
        ) : data.nextLesson ? (
          <Link
            to={`/course/${data.nextLesson.id}`}
            className="focus-ring group flex items-center gap-5 rounded-3xl border border-border/80 bg-card p-6 transition-all hover:-translate-y-0.5 hover:border-amber/50 hover:shadow-lift"
          >
            <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-amber-soft/50">
              <BookOpen className="h-6 w-6 text-amber" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-xs text-muted-foreground">继续课程 · 第 {data.nextLesson.stage}.{data.nextLesson.index} 课</div>
              <div className="truncate font-display text-lg font-semibold">{data.nextLesson.title}</div>
              <div className="truncate text-sm text-muted-foreground">{data.nextLesson.summary}</div>
            </div>
            <ArrowRight className="h-5 w-5 text-muted-foreground transition-transform group-hover:translate-x-1" />
          </Link>
        ) : (
          <Link to="/course" className="focus-ring flex items-center gap-5 rounded-3xl border border-border/80 bg-card p-6 hover:border-amber/50">
            <BookOpen className="h-6 w-6 text-amber" />
            <div>
              <div className="font-display text-lg font-semibold">当前阶段的课已经学完</div>
              <div className="text-sm text-muted-foreground">去课程页看看下一阶段还差哪些训练标准。</div>
            </div>
          </Link>
        )}
        <div className="flex items-center gap-5 rounded-3xl border border-border/80 bg-card p-6">
          <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-cyan-soft/50">
            <History className="h-6 w-6 text-cyan" />
          </span>
          <div>
            <div className="text-xs text-muted-foreground">间隔复习</div>
            <div className="font-display text-lg font-semibold">
              {data?.dueCount ? (
                <>
                  <span className="num text-cyan">{data.dueCount}</span> 项技能到期
                </>
              ) : (
                '没有到期的复习'
              )}
            </div>
            <div className="text-sm text-muted-foreground">到期的技能会自动排进每日训练，也会在练习中优先出现。</div>
          </div>
        </div>
      </section>

      {/* Modules, grouped */}
      <WeeklyAdvice />

      {(['ear', 'rhythm', 'sing', 'read', 'instrument'] as const).map((kind) => {
        const mods = MODULES.filter((m) => m.kind === kind && moduleVisible(m.id, profile))
        if (mods.length === 0) return null
        return (
          <section key={kind}>
            <div className="mb-5 flex items-end justify-between">
              <h2 className="text-2xl font-semibold">{KIND_LABEL[kind]}</h2>
              <span className="text-sm text-muted-foreground">{KIND_HINT[kind]}</span>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {mods.map((m) => {
                const i = MODULES.indexOf(m)
                const p = data?.progress.find((x) => x.moduleId === m.id)
                const avg = data?.averages[i]
                const Icon = MODULE_ICON[m.id]
                const title = levelTitles(m.id)[(p?.level ?? 1) - 1]?.title
                return (
                  <Link
                    key={m.id}
                    to={`/camp/${m.id}`}
                    className="focus-ring group flex flex-col rounded-2xl border border-border/80 bg-card p-5 transition-all duration-300 hover:-translate-y-1 hover:border-cyan/40 hover:shadow-lift"
                  >
                    <div className="flex items-center justify-between">
                      <Icon className="h-5 w-5 text-amber" />
                      <span className="font-mono text-[10px] text-muted-foreground">{m.id}</span>
                    </div>
                    <div className="mt-4 font-display text-lg font-semibold">{moduleDisplayName(m.id, profile)}</div>
                    <div className="text-xs text-muted-foreground">{m.tagline}</div>
                    <div className="mt-5 flex items-center justify-between text-xs">
                      <span className="num">
                        L{p?.level ?? 1}
                        <span className="text-muted-foreground">/{m.maxLevel}</span>
                      </span>
                      <span className="truncate pl-2 text-muted-foreground">{title}</span>
                    </div>
                    <VuBar value={avg?.mastery ?? 0} segments={16} className="mt-2" />
                  </Link>
                )
              })}
            </div>
          </section>
        )
      })}

      {data && data.confusions.length > 0 && (
        <section>
          <h2 className="mb-5 text-2xl font-semibold">最容易混淆的</h2>
          <div className="grid grid-cols-4 gap-4">
            {data.confusions.map((c) => (
              <ConfusionCard key={c.id} pair={c} />
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
