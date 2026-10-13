import { useCallback, useEffect, useState } from 'react'
import { Link, Navigate, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Check, Lock, PenLine, Trophy } from 'lucide-react'
import { lessonById, stageInfo } from '@/course/stages'
import { isSongCreation, type Lesson } from '@/course/types'
import type { Score } from '@/music/score'
import { SongCreation } from '@/widgets/lesson/SongCreation'
import { LessonQA } from '@/widgets/lesson/LessonQA'
import type { Composition, LessonProgress } from '@/entities/types'
import { CompositionService, CourseService } from '@/services/courseService'
import { BadgeService } from '@/services/badgeService'
import { useProfileStore } from '@/features/profile/profileStore'
import { toast } from '@/features/toast/toastStore'
import { LessonBlockView } from '@/widgets/lesson/LessonBlocks'
import { HandsOnSection } from '@/widgets/lesson/HandsOnSection'
import { MiniComposer } from '@/widgets/compose/MiniComposer'
import { playSuccess } from '@/audio/engine'
import { buttonVariants } from '@/shared/ui/buttonVariants'
import { cn } from '@/shared/lib/utils'

export function LessonPage() {
  const { lessonId } = useParams()
  const lesson = lessonId ? lessonById(lessonId) : undefined
  if (!lesson) return <Navigate to="/course" replace />
  return <LessonView key={lesson.id} lesson={lesson} />
}

function LessonView({ lesson }: { lesson: Lesson }) {
  const profile = useProfileStore((s) => s.profile)!
  const refresh = useProfileStore((s) => s.refresh)
  const [progress, setProgress] = useState<LessonProgress | null>(null)
  const [composition, setComposition] = useState<Composition | null>(null)
  const locked = lesson.stage > profile.unlockedStage
  const stage = stageInfo(lesson.stage)!
  const nextLesson = stage.lessons.find((l) => l.index === lesson.index + 1) ?? stageInfo(lesson.stage + 1)?.lessons[0]

  useEffect(() => {
    void (async () => {
      const p = await CourseService.progress(lesson.id)
      setProgress(p)
      // Links from 待补的实操 jump straight to the section.
      if (window.location.hash === '#handson') requestAnimationFrame(() => document.getElementById('handson')?.scrollIntoView({ block: 'start' }))
      if (p.compositionId) setComposition((await CompositionService.get(p.compositionId)) ?? null)
    })()
  }, [lesson.id])

  const tryComplete = useCallback(async () => {
    const res = await CourseService.completeIfReady(lesson)
    if (res.completed) {
      playSuccess()
      toast({ title: `完成第 ${lesson.stage}.${lesson.index} 课`, description: `+${res.xp} XP`, variant: 'success' })
      if (res.unlockedStage !== null) {
        toast({ title: `解锁阶段 ${res.unlockedStage}：${stageInfo(res.unlockedStage)?.title ?? ''}`, variant: 'success' })
      }
      for (const b of res.badges) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
      await refresh()
    }
    setProgress(await CourseService.progress(lesson.id))
  }, [lesson, refresh])

  const onDrillPassed = async (id: string) => {
    setProgress(await CourseService.markExercise(lesson.id, id))
    await tryComplete()
  }

  const persist = async (input: Parameters<typeof CompositionService.save>[0]) => {
    const comp = await CompositionService.save({ ...(composition ? { id: composition.id } : {}), ...input })
    setComposition(comp)
    await CourseService.attachCreation(lesson.id, comp.id)
    const first = await BadgeService.award('first-composition')
    if (first) toast({ title: `获得徽章「${first.name}」`, description: first.description, variant: 'success' })
    toast({ title: composition ? '作品已更新' : '已保存到作品集', variant: 'success' })
    await tryComplete()
  }

  const onSaveCells = async (cells: Array<number | null>) => {
    const spec = lesson.creation
    if (isSongCreation(spec)) return
    await persist({
      title: spec.title,
      kind: spec.kind,
      lessonId: lesson.id,
      stage: lesson.stage,
      bpm: spec.bpm,
      steps: spec.steps,
      cells,
      ...(spec.tonic !== undefined ? { tonic: spec.tonic } : {}),
      ...(spec.scale ? { scale: spec.scale } : {}),
    })
  }

  const onSaveScore = async (score: Score) => {
    const spec = lesson.creation
    await persist({ title: spec.title, kind: 'song', lessonId: lesson.id, stage: lesson.stage, bpm: score.bpm, steps: score.bars * score.beatsPerBar, cells: [], score })
    if (isSongCreation(spec) && spec.kind === 'arrange') {
      const b = await BadgeService.award('first-arrangement')
      if (b) toast({ title: `获得徽章「${b.name}」`, description: b.description, variant: 'success' })
    }
  }

  if (locked) {
    return (
      <div className="mx-auto max-w-2xl py-20 text-center">
        <Lock className="mx-auto h-10 w-10 text-muted-foreground" />
        <h1 className="mt-6 text-3xl font-semibold">这一课还没解锁</h1>
        <p className="mt-3 text-muted-foreground">先完成阶段 {lesson.stage - 1} 的课程，并达到训练营里的进入标准。</p>
        <Link to="/course" className={cn(buttonVariants({ variant: 'outline' }), 'mt-8')}>
          <ArrowLeft /> 回到课程
        </Link>
      </div>
    )
  }

  const drills = lesson.blocks.filter((b) => b.type === 'drill')
  const drillsDone = drills.filter((b) => progress?.exercisesDone.includes((b as { id: string }).id)).length
  const completed = Boolean(progress?.completedAt)

  return (
    <div className="mx-auto max-w-3xl space-y-10">
      <Link to="/course" className="focus-ring inline-flex items-center gap-1.5 rounded text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> 课程 · 阶段 {lesson.stage} {stage.title}
      </Link>

      <header>
        <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
          Lesson {lesson.stage}.{lesson.index} · {lesson.minutes} min
        </div>
        <h1 className="mt-2 text-4xl font-semibold">{lesson.title}</h1>
        <p className="mt-3 text-lg text-muted-foreground">{lesson.summary}</p>
        <div className="mt-5 flex gap-3 text-sm">
          <span className={cn('rounded-full border px-3 py-1', drillsDone === drills.length ? 'border-success/40 text-success' : 'border-border text-muted-foreground')}>
            练习 {drillsDone}/{drills.length}
          </span>
          <span className={cn('rounded-full border px-3 py-1', composition ? 'border-success/40 text-success' : 'border-border text-muted-foreground')}>
            微创作 {composition ? '已保存' : '未完成'}
          </span>
          {completed && (
            <span className="flex items-center gap-1 rounded-full border border-success/40 px-3 py-1 text-success">
              <Check className="h-3.5 w-3.5" /> 已完成
            </span>
          )}
        </div>
      </header>

      <div className="space-y-6">
        {lesson.blocks.map((b, i) => (
          <LessonBlockView key={i} lessonId={lesson.id} block={b} done={b.type === 'drill' ? progress?.exercisesDone.includes(b.id) : undefined} onDrillPassed={(id) => void onDrillPassed(id)} />
        ))}
      </div>

      <HandsOnSection lesson={lesson} progress={progress} onProgress={setProgress} />

      <LessonQA lesson={lesson} />

      <section className="studio-noise rounded-3xl border border-amber/40 bg-card p-7 shadow-lift">
        <div className="flex items-center gap-2 text-sm text-amber">
          <PenLine className="h-4 w-4" /> 微创作
        </div>
        <h2 className="mt-2 text-2xl font-semibold">{lesson.creation.title}</h2>
        <p className="mt-2 text-muted-foreground">{lesson.creation.prompt}</p>
        <div className="mt-6">
          {progress && (
            isSongCreation(lesson.creation) ? (
              <SongCreation key={composition?.id ?? 'new'} spec={lesson.creation} {...(composition?.score ? { initial: composition.score } : {})} saved={Boolean(composition)} onSave={onSaveScore} />
            ) : (
              <MiniComposer key={composition?.id ?? 'new'} spec={lesson.creation} initial={composition?.cells} saved={Boolean(composition)} onSave={onSaveCells} />
            )
          )}
        </div>
      </section>

      {completed && (
        <div className="flex items-center justify-between rounded-3xl border border-success/40 bg-success/10 p-6">
          <div className="flex items-center gap-3">
            <Trophy className="h-6 w-6 text-success" />
            <div>
              <div className="font-display text-lg font-semibold">这一课完成了</div>
              <div className="text-sm text-muted-foreground">作品已收进作品集。</div>
            </div>
          </div>
          {nextLesson ? (
            <Link to={`/course/${nextLesson.id}`} className={buttonVariants()}>
              下一课：{nextLesson.title} <ArrowRight />
            </Link>
          ) : (
            <Link to="/course" className={buttonVariants({ variant: 'outline' })}>
              回到课程 <ArrowRight />
            </Link>
          )}
        </div>
      )}
    </div>
  )
}
