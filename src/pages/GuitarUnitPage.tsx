import { useCallback, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Circle, Lightbulb } from 'lucide-react'
import { guitarUnit, type GuitarExercise } from '@/guitar/units'
import { GuitarService } from '@/services/guitarService'
import { afterGuitarAttempt } from '@/services/guitarRewards'
import { useAsync } from '@/shared/lib/useAsync'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { LessonText } from '@/widgets/lesson/LessonText'
import { ExerciseRunner } from '@/widgets/guitar/ExerciseRunner'
import { useGuitarAudio } from '@/features/guitar/guitarAudioStore'
import { cn } from '@/shared/lib/utils'
import { useTimbreOverride } from '@/features/audio/useTimbreOverride'

const KIND_LABEL: Record<GuitarExercise['kind'], string> = {
  'chord-check': '和弦检查',
  change: '换和弦',
  strum: '扫弦',
  song: '整首',
  'note-name': '认音',
  'note-find': '找音',
  play: '跟拍演奏',
  bend: '推弦',
  vibrato: '揉弦',
  target: '瞄准和弦音',
  improv: '即兴',
}

export function GuitarUnitPage() {
  useTimbreOverride('guitar')
  const { unitId } = useParams()
  const unit = unitId ? guitarUnit(unitId) : undefined
  const refreshProfile = useProfileStore((s) => s.refresh)
  const { data: progress, reload } = useAsync(() => GuitarService.all(), [unitId])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [runKey, setRunKey] = useState(0)
  const applyPreset = useGuitarAudio((s) => s.applyPreset)

  const record = useCallback(
    async (ex: GuitarExercise, score: number, passed: boolean, last: string) => {
      if (!unit) return
      const r = await GuitarService.record(ex.id, unit.id, score, passed, last)
      const rewards = await afterGuitarAttempt(r.firstPass)
      for (const b of rewards.badges)
        toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
      if (rewards.planCompleted)
        toast({
          title: '今日训练全部完成',
          description: `额外 +${rewards.bonusXp} XP`,
          variant: 'success',
        })
      await refreshProfile()
      if (r.firstPass)
        toast({ title: `通过「${ex.title}」`, description: `+${r.xp} XP`, variant: 'success' })
      const status = (await GuitarService.unitStatus()).find((s) => s.unit.id === unit.id)
      if (r.firstPass && status?.complete)
        toast({
          title: `完成单元「${unit.title}」`,
          description: '可以进入下一个单元了。',
          variant: 'success',
        })
      reload()
    },
    [refreshProfile, reload, unit],
  )

  if (!unit || unit.comingIn) return <Navigate to="/guitar" replace />
  const active = unit.exercises.find((e) => e.id === activeId) ?? unit.exercises[0]!
  const rowOf = (id: string) => progress?.find((p) => p.exerciseId === id)

  return (
    <div className="space-y-8">
      <Link
        to="/guitar"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> 吉他工坊
      </Link>
      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          {unit.line === 'rhythm' ? '节奏吉他' : '主音吉他'} · 单元 {unit.index}
        </div>
        <h1 className="mt-2 text-4xl font-semibold">{unit.title}</h1>
        <p className="mt-2 text-muted-foreground">{unit.summary}</p>
      </header>

      <section className="surface-gradient rounded-3xl border border-border/80 bg-card p-6">
        <LessonText md={unit.intro} />
      </section>

      <div className="grid grid-cols-[260px,1fr] gap-6">
        <nav aria-label="练习" className="space-y-2">
          {unit.exercises.map((ex) => {
            const row = rowOf(ex.id)
            return (
              <button
                key={ex.id}
                type="button"
                onClick={() => {
                  setActiveId(ex.id)
                  setRunKey((k) => k + 1)
                  if ('preset' in ex && ex.preset) applyPreset(ex.preset)
                }}
                aria-current={active.id === ex.id ? 'true' : undefined}
                className={cn(
                  'focus-ring flex w-full items-start gap-3 rounded-2xl border p-3 text-left transition-colors',
                  active.id === ex.id
                    ? 'border-amber/60 bg-amber-soft/30'
                    : 'border-border/70 hover:border-cyan/40',
                )}
              >
                {row?.passedAt ? (
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-label="已通过" />
                ) : (
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-label="未通过"
                  />
                )}
                <span>
                  <span className="block text-xs text-muted-foreground">{KIND_LABEL[ex.kind]}</span>
                  <span className="block font-medium">{ex.title}</span>
                  {row && (
                    <span className="block text-xs text-muted-foreground">
                      最好 {Math.round(row.best * 100)} 分 · 练了 {row.attempts} 次
                    </span>
                  )}
                </span>
              </button>
            )
          })}
        </nav>

        <section
          className="rounded-3xl border border-amber/40 bg-card p-6"
          aria-label={active.title}
        >
          <h2 className="text-2xl font-semibold">{active.title}</h2>
          <p className="mt-1 flex items-start gap-2 text-sm text-muted-foreground">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-amber" aria-hidden /> {active.tip}
          </p>
          <div className="mt-5" key={`${active.id}-${runKey}`}>
            <ExerciseRunner
              exercise={active}
              onRecord={(score, passed, summary) => void record(active, score, passed, summary)}
            />
          </div>
        </section>
      </div>
    </div>
  )
}
