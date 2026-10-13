import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Circle, GraduationCap, Lock, PartyPopper, Save } from 'lucide-react'
import type { Composition } from '@/entities/types'
import type { Score } from '@/music/score'
import { GraduationService } from '@/services/graduationService'
import { CompositionService } from '@/services/courseService'
import { graduationComplete, graduationSteps, seconds, type GradProgress, type GradStepId } from '@/course/graduation'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { useAsync } from '@/shared/lib/useAsync'
import { StudioWorkspace, type WorkspaceTab } from '@/widgets/studio/StudioWorkspace'
import { VersionHistoryButton } from '@/widgets/studio/VersionHistory'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

const STEP_TAB: Record<GradStepId, WorkspaceTab> = {
  motif: 'compose',
  harmony: 'compose',
  structure: 'arrange',
  arrangement: 'arrange',
  review: 'review',
  revise: 'compose',
  export: 'export',
}

export function GraduationPage() {
  const { data: gate } = useAsync(() => GraduationService.unlocked(), [])
  if (!gate) return <div className="py-20 text-center text-sm text-muted-foreground">正在载入…</div>
  if (!gate.ok) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-6 text-3xl font-semibold">毕业项目还没解锁</h1>
        <p className="mt-3 text-muted-foreground">
          完成阶段 5「编曲」的全部 {gate.total} 课后开放（已完成 {gate.done} 课）。毕业项目会把动机、和声、结构、编曲、点评、修改和导出串成一首完整的歌。
        </p>
        <Link to="/course" className={cn(buttonVariants({ variant: 'outline' }), 'mt-8')}>
          回到课程
        </Link>
      </div>
    )
  }
  return <GraduationWorkspace />
}

function GraduationWorkspace() {
  const profile = useProfileStore((s) => s.profile)!
  const refreshProfile = useProfileStore((s) => s.refresh)
  const [comp, setComp] = useState<Composition | null>(null)
  const [score, setScore] = useState<Score | null>(null)
  const [title, setTitle] = useState('毕业作品')
  const [dirty, setDirty] = useState(false)
  const [progress, setProgress] = useState<GradProgress>({})
  const [tab, setTab] = useState<WorkspaceTab>('compose')
  const [loadKey, setLoadKey] = useState(0)

  const load = useCallback(async (c: Composition) => {
    setComp(c)
    setScore(c.score!)
    setTitle(c.title)
    setDirty(false)
    setLoadKey((k) => k + 1)
    setProgress(await GraduationService.progress(c))
  }, [])

  useEffect(() => {
    void GraduationService.ensureProject().then(load)
  }, [load])

  const refresh = useCallback(async () => {
    const c = comp ? await CompositionService.get(comp.id) : undefined
    if (!c) return
    setComp(c)
    setProgress(await GraduationService.progress(c))
    const badge = await GraduationService.tryGraduate(c)
    if (badge) {
      toast({ title: `获得徽章「${badge.name}」`, description: '毕业项目完成了。这首歌从动机到导出都是你自己写的。', variant: 'success' })
      await refreshProfile()
    }
  }, [comp, refreshProfile])

  const steps = useMemo(() => (score ? graduationSteps(score, profile.instrument, progress) : []), [score, profile.instrument, progress])
  const current = steps.find((s) => !s.done)

  if (!comp || !score) return <div className="py-20 text-center text-sm text-muted-foreground">正在准备毕业项目…</div>

  const save = async (): Promise<string | null> => {
    const saved = await CompositionService.save({ ...comp, title: title.trim() || '毕业作品', score, bpm: score.bpm, steps: score.bars * score.beatsPerBar, project: 'graduation' })
    setComp(saved)
    setDirty(false)
    toast({ title: '毕业项目已保存', variant: 'success' })
    setProgress(await GraduationService.progress(saved))
    const badge = await GraduationService.tryGraduate(saved)
    if (badge) {
      toast({ title: `获得徽章「${badge.name}」`, description: '毕业项目完成了。', variant: 'success' })
      await refreshProfile()
    }
    return saved.id
  }

  const complete = graduationComplete(steps)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">Graduation</div>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
            <GraduationCap className="h-9 w-9 text-amber" aria-hidden /> 毕业项目
          </h1>
          <p className="mt-2 max-w-2xl text-muted-foreground">
            一首 2–3 分钟、4–6 个声部的完整作品：动机 → 和声 → 结构 → 编曲 → 点评 → 修改 → 导出。段落骨架已经搭好，可以随意改。现在约 {Math.floor(seconds(score) / 60)} 分 {Math.round(seconds(score) % 60)} 秒。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input value={title} onChange={(e) => { setTitle(e.target.value.slice(0, 40)); setDirty(true) }} className="w-48" aria-label="作品名" />
          <VersionHistoryButton composition={comp} onRestored={(c) => void load(c)} />
          <Button onClick={() => void save()}>
            <Save /> {dirty ? '保存修改' : '已保存'}
          </Button>
        </div>
      </header>

      {(complete || profile.graduatedAt) && (
        <div className="studio-noise flex items-center gap-4 rounded-3xl border border-amber/50 bg-amber-soft/30 p-5" role="status">
          <PartyPopper className="h-8 w-8 text-amber" aria-hidden />
          <div>
            <div className="text-lg font-semibold">毕业了！</div>
            <p className="text-sm text-muted-foreground">你已经能独立写一首歌、编一首歌。继续在作曲台写下一首吧，每一首都会进作品集。</p>
          </div>
        </div>
      )}

      <nav aria-label="毕业项目步骤">
        <ol className="grid grid-cols-7 gap-2">
          {steps.map((s, i) => (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => setTab(STEP_TAB[s.id])}
                aria-current={current?.id === s.id ? 'step' : undefined}
                className={cn(
                  'focus-ring flex w-full flex-col items-start rounded-2xl border p-3 text-left transition-colors',
                  s.done ? 'border-success/40 bg-success/10' : current?.id === s.id ? 'border-amber/60 bg-amber-soft/30' : 'border-border/70 bg-card hover:border-cyan/40',
                )}
              >
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  {s.done ? <Check className="h-3.5 w-3.5 text-success" aria-label="已完成" /> : <Circle className="h-3.5 w-3.5" aria-label="未完成" />}
                  第 {i + 1} 步
                </span>
                <span className="mt-1 font-semibold">{s.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      {current && (
        <section className="rounded-2xl border border-border/80 bg-card p-5" aria-live="polite">
          <div className="text-sm text-amber">下一步：{current.title}</div>
          <p className="mt-1">{current.hint}</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-sm">
            {current.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-2">
                {c.ok ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="已满足" /> : <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-label="未满足" />}
                <span>
                  {c.label}
                  {c.detail && <span className="text-muted-foreground">（{c.detail}）</span>}
                </span>
              </li>
            ))}
          </ul>
          {dirty && current.id !== 'motif' && <p className="mt-3 text-xs text-muted-foreground">点评、修改和导出按保存后的版本计算，记得保存。</p>}
        </section>
      )}

      <StudioWorkspace
        score={score}
        onChange={(s) => {
          setScore(s)
          setDirty(true)
        }}
        compositionId={comp.id}
        title={title}
        dirty={dirty}
        onSave={save}
        features={{ melody: true, chords: true, lyrics: true, keyEditable: true, barsEditable: true, advancedChords: true }}
        arrangeUnlocked
        instrument={profile.instrument}
        editorKey={`${comp.id}-${loadKey}`}
        tab={tab}
        onTabChange={setTab}
        onCritique={() => void refresh()}
        onExported={() => void CompositionService.markExported(comp.id).then(refresh)}
      />
    </div>
  )
}
