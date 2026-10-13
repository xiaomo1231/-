import { Link, Navigate, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Lock, Play, Timer } from 'lucide-react'
import { MODULES, moduleInfo, type ModuleId } from '@/drills/types'
import { levelTitles } from '@/drills/levels'
import { skillLabel } from '@/drills/skills'
import { ModuleProgressService } from '@/services/moduleProgressService'
import { MasteryService } from '@/services/masteryService'
import { DrillService } from '@/services/drillService'
import { BAND_LABEL, LEVEL_UP_RATIO, LEVEL_WINDOW, masteryBand } from '@/services/masteryMath'
import { useAsync } from '@/shared/lib/useAsync'
import { MODULE_ICON } from '@/widgets/drill/moduleIcons'
import { moduleDisplayName } from '@/widgets/drill/moduleName'
import { useProfileStore } from '@/features/profile/profileStore'
import { VuBar } from '@/widgets/meter/VuBar'
import { confusionLabel } from '@/widgets/drill/confusionLabel'
import { Button } from '@/shared/ui/Button'
import { cn } from '@/shared/lib/utils'

export function ModulePage() {
  const { moduleId } = useParams()
  const valid = MODULES.some((m) => m.id === moduleId)
  if (!valid) return <Navigate to="/camp" replace />
  return <ModuleDetail moduleId={moduleId as ModuleId} />
}

function ModuleDetail({ moduleId }: { moduleId: ModuleId }) {
  const navigate = useNavigate()
  const info = moduleInfo(moduleId)
  const Icon = MODULE_ICON[moduleId]
  const profile = useProfileStore((s) => s.profile)!
  const { data, reload } = useAsync(async () => {
    const [progress, skills, confusions] = await Promise.all([
      ModuleProgressService.ensure(moduleId),
      MasteryService.byModule(moduleId),
      DrillService.confusions(moduleId, 6),
    ])
    return { progress, skills: skills.sort((a, b) => a.mastery - b.mastery), confusions }
  }, [moduleId])

  const titles = levelTitles(moduleId)
  const progress = data?.progress
  const recent = progress?.recentAtLevel.slice(-LEVEL_WINDOW) ?? []
  const acc = recent.length ? recent.reduce((s, r) => s + r.credit, 0) / recent.length : null
  const isEar = info.kind === 'ear'

  return (
    <div className="space-y-10">
      <Link to="/camp" className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 训练营
      </Link>

      <header className="grid grid-cols-12 gap-8">
        <div className="col-span-7">
          <div className="flex items-center gap-3">
            <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-border/80 bg-card">
              <Icon className="h-6 w-6 text-amber" />
            </span>
            <span className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">{moduleId} · {info.tagline}</span>
          </div>
          <h1 className="mt-5 text-4xl font-semibold">{moduleDisplayName(moduleId, profile)}</h1>
          <p className="mt-3 max-w-xl leading-relaxed text-muted-foreground">{info.description}</p>
          {info.kind === 'sing' && (
            <p className="mt-3 max-w-xl text-sm text-cyan">
              需要麦克风，建议戴耳机。{profile.vocalRange ? '会按你标定的音域出题。' : '第一次练习前会先标定你的音域。'}
            </p>
          )}
          {info.kind === 'instrument' && (
            <p className="mt-3 max-w-xl text-sm text-cyan">把乐器放在麦克风附近。吉他和贝斯请先用“调音器与音域”页调好音。</p>
          )}
          <div className="mt-8 flex items-center gap-3">
            <Button size="lg" onClick={() => navigate(`/drill/${moduleId}?count=10`)}>
              <Play /> 练 10 题
            </Button>
            <Button variant="outline" size="lg" onClick={() => navigate(`/drill/${moduleId}?count=20`)}>
              练 20 题
            </Button>
            {isEar && (
              <Button variant="ghost" size="lg" onClick={() => navigate(`/drill/${moduleId}?mode=challenge`)}>
                <Timer /> 90 秒挑战
              </Button>
            )}
          </div>
        </div>
        <div className="col-span-5 rounded-3xl border border-border/80 bg-card p-6 surface-gradient">
          <div className="text-sm text-muted-foreground">第 {progress?.level ?? 1} 级 · 升级进度</div>
          <div className="mt-2 font-display text-xl font-semibold">{titles[(progress?.level ?? 1) - 1]?.title}</div>
          <div className="mt-5 flex gap-1.5">
            {Array.from({ length: LEVEL_WINDOW }, (_, i) => {
              const r = recent[i]
              return (
                <span
                  key={i}
                  className={cn(
                    'h-8 flex-1 rounded-md border',
                    !r ? 'border-dashed border-border bg-transparent' : r.credit >= 0.999 ? 'border-transparent bg-amber' : r.credit > 0 ? 'border-transparent bg-amber/40' : 'border-transparent bg-muted',
                  )}
                />
              )
            })}
          </div>
          <div className="mt-3 text-xs text-muted-foreground">
            最近 {LEVEL_WINDOW} 题正确率达到 {Math.round(LEVEL_UP_RATIO * 100)}% 自动升级
            {acc !== null && <span className="num ml-2 text-foreground">当前 {Math.round(acc * 100)}%</span>}
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">累计作答</div>
              <div className="num text-lg">{progress?.totalAttempts ?? 0}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">累计正确</div>
              <div className="num text-lg">{progress?.totalCorrect ?? 0}</div>
            </div>
          </div>
        </div>
      </header>

      <section>
        <h2 className="mb-4 text-xl font-semibold">级别</h2>
        <div className="grid grid-cols-7 gap-3">
          {titles.map((t) => {
            const unlocked = (progress?.unlockedLevel ?? 1) >= t.level
            const current = progress?.level === t.level
            return (
              <button
                key={t.level}
                type="button"
                disabled={!unlocked || current}
                onClick={async () => {
                  await ModuleProgressService.setLevel(moduleId, t.level)
                  reload()
                }}
                className={cn(
                  'focus-ring flex min-h-[96px] flex-col justify-between rounded-2xl border p-3 text-left transition-colors',
                  current ? 'border-amber/70 bg-amber-soft/40' : unlocked ? 'border-border/80 bg-card hover:border-cyan/50' : 'border-dashed border-border/70 bg-transparent opacity-55',
                )}
                title={unlocked ? (current ? '当前级别' : '切换到这一级') : '达到上一级的升级标准后解锁'}
              >
                <div className="flex items-center justify-between">
                  <span className="num text-lg font-semibold">L{t.level}</span>
                  {!unlocked ? <Lock className="h-3.5 w-3.5" /> : current ? <span className="h-2 w-2 rounded-full bg-amber" /> : <Check className="h-3.5 w-3.5 text-success" />}
                </div>
                <span className="text-xs leading-snug text-muted-foreground">{t.title}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="grid grid-cols-12 gap-8">
        <div className="col-span-7">
          <h2 className="mb-4 text-xl font-semibold">细分掌握度</h2>
          {data && data.skills.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">还没有记录。练几题后，这里会按每个音程 / 和弦 / 级数显示掌握度。</p>
          ) : (
            <ul className="space-y-2">
              {data?.skills.map((s) => {
                const band = masteryBand(s.mastery, s.attempts)
                return (
                  <li key={s.skillId} className="flex items-center gap-4 rounded-xl border border-border/60 bg-card px-4 py-3">
                    <span className="w-32 shrink-0 text-sm">{skillLabel(s.skillId)}</span>
                    <VuBar value={s.mastery} segments={24} className="flex-1" />
                    <span className="num w-10 text-right text-xs">{Math.round(s.mastery * 100)}%</span>
                    <span
                      className={cn(
                        'w-14 text-right text-xs',
                        band === 'mastered' ? 'text-success' : band === 'learning' ? 'text-amber' : 'text-muted-foreground',
                      )}
                    >
                      {BAND_LABEL[band]}
                    </span>
                  </li>
                )
              })}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">掌握度是根据练习记录的估计值，越近的作答权重越高。</p>
        </div>
        <div className="col-span-5">
          <h2 className="mb-4 text-xl font-semibold">混淆记录</h2>
          {data && data.confusions.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">暂时没有反复混淆的组合。</p>
          ) : (
            <ul className="space-y-2">
              {data?.confusions.map((c) => (
                <li key={c.id} className="flex items-center justify-between rounded-xl border border-border/60 bg-card px-4 py-3 text-sm">
                  <span>
                    {confusionLabel(moduleId, c.expected)}
                    <span className="mx-2 text-muted-foreground">听成</span>
                    {confusionLabel(moduleId, c.given)}
                  </span>
                  <span className="num text-amber">× {c.count}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted-foreground">系统会在出题时多安排你容易混淆的内容。</p>
        </div>
      </section>
    </div>
  )
}
