import { Link } from 'react-router-dom'
import { ArrowRight, Check, Clock, GraduationCap, Lock, Sparkles } from 'lucide-react'
import { CourseService, type StageStatus } from '@/services/courseService'
import { useProfileStore } from '@/features/profile/profileStore'
import { useAsync } from '@/shared/lib/useAsync'
import { VuBar } from '@/widgets/meter/VuBar'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

export function CoursePage() {
  const profile = useProfileStore((s) => s.profile)!
  const refresh = useProfileStore((s) => s.refresh)
  const { data } = useAsync(async () => {
    if ((await CourseService.evaluateUnlock()) !== null) await refresh()
    const [status, progress] = await Promise.all([CourseService.status(), CourseService.progressAll()])
    return { status, done: new Set(progress.filter((p) => p.completedAt).map((p) => p.lessonId)) }
  }, [profile.unlockedStage])

  const next = data?.status
    .filter((s) => s.unlocked)
    .flatMap((s) => s.info.lessons)
    .find((l) => !data.done.has(l.id))

  return (
    <div className="space-y-12">
      <header className="flex items-end justify-between gap-6">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Setlist</div>
          <h1 className="mt-2 text-4xl font-semibold">课程</h1>
          <p className="mt-3 max-w-2xl text-muted-foreground">
            每课先听、再练、最后写一段微创作。训练营里达到下面的标准，并学完当前阶段的课，就能进入下一阶段。
          </p>
        </div>
        {next && (
          <Link to={`/course/${next.id}`} className={buttonVariants({ size: 'lg' })}>
            继续：{next.stage}.{next.index} {next.title} <ArrowRight />
          </Link>
        )}
      </header>

      <div className="space-y-8">
        {data?.status.map((s) => <StageCard key={s.info.stage} status={s} done={data.done} current={s.info.stage === profile.unlockedStage} />)}
        {data && <GraduationCard stage5Done={data.status.find((s) => s.info.stage === 5)?.lessonsDone ?? 0} stage5Total={data.status.find((s) => s.info.stage === 5)?.info.lessons.length ?? 12} graduated={Boolean(profile.graduatedAt)} />}
      </div>
    </div>
  )
}

function StageCard({ status: s, done, current }: { status: StageStatus; done: Set<string>; current: boolean }) {
  const total = s.info.lessons.length
  const released = total > 0
  return (
    <section
      className={cn(
        'rounded-3xl border p-7',
        s.unlocked ? 'border-border/80 bg-card shadow-soft surface-gradient' : 'border-dashed border-border/80 bg-transparent',
        current && 'border-amber/50',
      )}
    >
      <div className="flex items-start justify-between gap-6">
        <div className="flex items-start gap-5">
          <span className={cn('num text-5xl font-semibold leading-none', s.unlocked ? 'text-amber' : 'text-muted-foreground/50')}>
            {String(s.info.stage).padStart(2, '0')}
          </span>
          <div>
            <h2 className="text-2xl font-semibold">{s.info.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{s.info.tagline}</p>
          </div>
        </div>
        <div className="text-right text-sm">
          {!released ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs text-muted-foreground">
              <Clock className="h-3.5 w-3.5" /> {s.info.releasedIn}开放
            </span>
          ) : s.unlocked ? (
            <div>
              <span className="num">
                {s.lessonsDone}/{total}
              </span>{' '}
              <span className="text-muted-foreground">课完成</span>
              <VuBar value={total ? s.lessonsDone / total : 0} segments={total || 1} className="mt-2 w-40" />
            </div>
          ) : (
            <span className="inline-flex items-center gap-1.5 text-muted-foreground">
              <Lock className="h-4 w-4" /> 未解锁
            </span>
          )}
        </div>
      </div>

      {s.requirements.length > 0 && !s.unlocked && (
        <div className="mt-6 rounded-2xl border border-border/70 bg-background/50 p-4">
          <div className="mb-2 text-xs text-muted-foreground">进入本阶段需要（并学完上一阶段全部课程）：</div>
          <ul className="grid grid-cols-3 gap-2">
            {s.requirements.map((r) => (
              <li key={r.label}>
                <Link
                  to={`/camp/${r.module}`}
                  className={cn('focus-ring flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition-colors', r.met ? 'border-success/40 text-success' : 'border-border/70 hover:border-cyan/50')}
                >
                  {r.met ? <Check className="h-4 w-4" /> : <span className="h-2 w-2 rounded-full bg-amber" />}
                  {r.label}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {released && s.unlocked && (
        <ol className="mt-6 grid grid-cols-2 gap-3">
          {s.info.lessons.map((l) => {
            const isDone = done.has(l.id)
            return (
              <li key={l.id}>
                <Link
                  to={`/course/${l.id}`}
                  className={cn(
                    'focus-ring group flex items-center gap-4 rounded-2xl border px-4 py-3.5 transition-all hover:-translate-y-0.5',
                    isDone ? 'border-success/30 bg-success/5' : 'border-border/70 bg-background/50 hover:border-cyan/50 hover:shadow-glow',
                  )}
                >
                  <span className="num w-10 text-sm text-muted-foreground">
                    {l.stage}.{l.index}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{l.title}</div>
                    <div className="truncate text-xs text-muted-foreground">{l.summary}</div>
                  </div>
                  {isDone ? <Check className="h-5 w-5 text-success" /> : <span className="text-xs text-muted-foreground">{l.minutes} 分钟</span>}
                </Link>
              </li>
            )
          })}
        </ol>
      )}

      {released && !s.unlocked && (
        <p className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> 也可以在设置里重做入门测试，直接跳到适合你的阶段。
        </p>
      )}
    </section>
  )
}

function GraduationCard({ stage5Done, stage5Total, graduated }: { stage5Done: number; stage5Total: number; graduated: boolean }) {
  const open = stage5Done >= stage5Total
  return (
    <section className={cn('flex items-center justify-between gap-6 rounded-3xl border p-7', open ? 'studio-noise border-amber/50 bg-card shadow-lift' : 'border-dashed border-border bg-card/60')}>
      <div className="flex items-center gap-5">
        <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber/40 via-card to-cyan/30">
          <GraduationCap className="h-8 w-8" aria-hidden />
        </div>
        <div>
          <div className="font-mono text-xs text-muted-foreground">FINAL</div>
          <h2 className="text-2xl font-semibold">毕业项目</h2>
          <p className="text-sm text-muted-foreground">
            {graduated ? '已经毕业。可以随时回去继续打磨毕业作品。' : open ? '一首 2–3 分钟、4–6 个声部的完整作品，从动机写到导出。' : `完成阶段 5 的全部课程后开放（${stage5Done}/${stage5Total}）。`}
          </p>
        </div>
      </div>
      {open ? (
        <Link to="/graduation" className={buttonVariants({ size: 'lg' })}>
          {graduated ? '打开毕业作品' : '开始毕业项目'} <ArrowRight />
        </Link>
      ) : (
        <Lock className="h-6 w-6 text-muted-foreground" aria-label="未解锁" />
      )}
    </section>
  )
}
