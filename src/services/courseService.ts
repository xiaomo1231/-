import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import { STAGES, lessonById } from '@/course/stages'
import { requirementMet } from '@/course/rules'
import type { Lesson, StageInfo } from '@/course/types'
import type { Composition, CompositionVersion, LessonProgress, ModuleProgress, StudentProfile } from '@/entities/types'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { BadgeService } from './badgeService'
import type { BadgeInfo } from './progressRules'
import { handsOnFor, type HandsOnStep } from '@/course/handsOn'

export const XP_LESSON_COMPLETE = 30

export interface StageStatus {
  info: StageInfo
  unlocked: boolean
  lessonsDone: number
  requirements: Array<{ label: string; met: boolean; module: string; level: number }>
  /** All requirements met (the lessons of the previous stage are tracked separately). */
  requirementsMet: boolean
}

/** Pure: status of every stage for display. */
export function computeStageStatus(profile: StudentProfile, lessons: LessonProgress[], modules: ModuleProgress[]): StageStatus[] {
  const done = new Set(lessons.filter((l) => l.completedAt).map((l) => l.lessonId))
  const byModule = new Map(modules.map((m) => [m.moduleId, m]))
  return STAGES.map((info) => {
    const requirements = info.requirements.map((r) => ({ label: r.label, module: r.module, level: r.level, met: requirementMet(r, byModule.get(r.module)) }))
    return {
      info,
      unlocked: info.stage <= profile.unlockedStage,
      lessonsDone: info.lessons.filter((l) => done.has(l.id)).length,
      requirements,
      requirementsMet: requirements.every((r) => r.met),
    }
  })
}

/** Pure: the next stage to unlock, if the current one is finished and the next one's thresholds are met. */
export function nextUnlock(statuses: StageStatus[], unlockedStage: number): number | null {
  const current = statuses.find((s) => s.info.stage === unlockedStage)
  const next = statuses.find((s) => s.info.stage === unlockedStage + 1)
  if (!current || !next) return null
  const lessonsComplete = current.info.lessons.length > 0 && current.lessonsDone === current.info.lessons.length
  return lessonsComplete && next.requirementsMet ? next.info.stage : null
}

export const CourseService = {
  async progressAll(): Promise<LessonProgress[]> {
    return getDb().lessonProgress.toArray()
  },

  async progress(lessonId: string): Promise<LessonProgress> {
    const existing = await getDb().lessonProgress.get(lessonId)
    if (existing) return existing
    const lesson = lessonById(lessonId)
    return { lessonId, stage: lesson?.stage ?? 0, exercisesDone: [], updatedAt: Date.now() }
  },

  async markExercise(lessonId: string, blockId: string): Promise<LessonProgress> {
    const p = await this.progress(lessonId)
    const next: LessonProgress = { ...p, exercisesDone: Array.from(new Set([...p.exercisesDone, blockId])), updatedAt: Date.now() }
    await getDb().lessonProgress.put(next)
    return next
  },

  /**
   * Record a 课后实操 step. A pass is never taken back by a later skip or
   * miss (the student can always practise again); the best score is kept.
   */
  async markHandsOn(lessonId: string, stepId: string, status: 'passed' | 'failed' | 'skipped', score = 0): Promise<LessonProgress> {
    const p = await this.progress(lessonId)
    const prev = p.handsOn?.[stepId]
    const keep = prev?.status === 'passed' ? 'passed' : status
    const next: LessonProgress = {
      ...p,
      handsOn: { ...p.handsOn, [stepId]: { status: keep, score: Math.max(score, prev?.score ?? 0), at: Date.now() } },
      updatedAt: Date.now(),
    }
    await getDb().lessonProgress.put(next)
    return next
  },

  /**
   * 待补的实操: steps of opened lessons that were skipped or not passed yet,
   * most recent first. Steps a lesson no longer has are ignored.
   */
  async pendingHandsOn(): Promise<Array<{ lesson: Lesson; steps: HandsOnStep[]; at: number }>> {
    const rows = await this.progressAll()
    const out: Array<{ lesson: Lesson; steps: HandsOnStep[]; at: number }> = []
    for (const p of rows) {
      if (!p.handsOn) continue
      const lesson = lessonById(p.lessonId)
      if (!lesson) continue
      const steps = handsOnFor(lesson).filter((s) => {
        const r = p.handsOn?.[s.id]
        return r && r.status !== 'passed'
      })
      if (steps.length) out.push({ lesson, steps, at: Math.max(...steps.map((s) => p.handsOn![s.id]!.at)) })
    }
    return out.sort((a, b) => b.at - a.at)
  },

  async attachCreation(lessonId: string, compositionId: string): Promise<LessonProgress> {
    const p = await this.progress(lessonId)
    const next: LessonProgress = { ...p, compositionId, updatedAt: Date.now() }
    await getDb().lessonProgress.put(next)
    return next
  },

  /** Complete the lesson when every drill passed and a creation is saved. Returns XP awarded (0 if not completed now). */
  async completeIfReady(lesson: Lesson): Promise<{ completed: boolean; xp: number; unlockedStage: number | null; badges: BadgeInfo[] }> {
    const p = await this.progress(lesson.id)
    if (p.completedAt) return { completed: false, xp: 0, unlockedStage: null, badges: [] }
    const drills = lesson.blocks.filter((b) => b.type === 'drill').map((b) => (b as { id: string }).id)
    const ready = drills.every((d) => p.exercisesDone.includes(d)) && Boolean(p.compositionId)
    if (!ready) return { completed: false, xp: 0, unlockedStage: null, badges: [] }
    await getDb().lessonProgress.put({ ...p, completedAt: Date.now(), updatedAt: Date.now() })
    await ProfileService.addXp(XP_LESSON_COMPLETE)
    const badges: BadgeInfo[] = []
    const stageLessons = STAGES.find((st) => st.stage === lesson.stage)?.lessons ?? []
    const all = await this.progressAll()
    const doneIds = new Set(all.filter((l) => l.completedAt).map((l) => l.lessonId))
    if (stageLessons.length > 0 && stageLessons.every((l) => doneIds.has(l.id))) {
      const b = await BadgeService.award(`stage-${lesson.stage}`)
      if (b) badges.push(b)
    }
    const unlockedStage = await this.evaluateUnlock()
    return { completed: true, xp: XP_LESSON_COMPLETE, unlockedStage, badges }
  },

  async status(): Promise<StageStatus[]> {
    const [profile, lessons, modules] = await Promise.all([ProfileService.ensure(), this.progressAll(), ModuleProgressService.all()])
    return computeStageStatus(profile, lessons, modules)
  },

  /** Unlock the next stage when allowed. Returns the newly unlocked stage, or null. */
  async evaluateUnlock(): Promise<number | null> {
    const profile = await ProfileService.ensure()
    const statuses = await this.status()
    const next = nextUnlock(statuses, profile.unlockedStage)
    if (next === null) return null
    await ProfileService.update({ unlockedStage: next })
    return next
  },
}

/** Version snapshots kept per work; the oldest are dropped beyond this. */
export const MAX_VERSIONS = 40

export const CompositionService = {
  /**
   * Save a work. Fields the caller does not pass (graduation flag, export
   * time) are kept. Songs get a version snapshot whenever the score changed.
   */
  async save(input: Omit<Composition, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }, opts: { versionNote?: string } = {}): Promise<Composition> {
    const db = getDb()
    const now = Date.now()
    const existing = input.id ? await db.compositions.get(input.id) : undefined
    const comp: Composition = { ...existing, ...input, id: input.id ?? uuid(), createdAt: existing?.createdAt ?? now, updatedAt: now }
    await db.transaction('rw', db.compositions, db.compositionVersions, async () => {
      await db.compositions.put(comp)
      if (!comp.score) return
      const versions = await db.compositionVersions.where('[compositionId+createdAt]').between([comp.id, 0], [comp.id, Infinity]).toArray()
      const last = versions[versions.length - 1]
      if (last && JSON.stringify(last.score) === JSON.stringify(comp.score)) return
      await db.compositionVersions.put({ id: uuid(), compositionId: comp.id, createdAt: now, score: comp.score, ...(opts.versionNote ? { note: opts.versionNote } : {}) })
      const excess = versions.length + 1 - MAX_VERSIONS
      if (excess > 0) await db.compositionVersions.bulkDelete(versions.slice(0, excess).map((v) => v.id))
    })
    return comp
  },
  /** Versions of a work, newest first. */
  async versions(id: string): Promise<CompositionVersion[]> {
    const rows = await getDb().compositionVersions.where('[compositionId+createdAt]').between([id, 0], [id, Infinity]).toArray()
    return rows.reverse()
  },
  /** Make an old version current again (saved as a new version, so nothing is lost). */
  async restore(versionId: string): Promise<Composition | undefined> {
    const db = getDb()
    const v = await db.compositionVersions.get(versionId)
    const comp = v ? await db.compositions.get(v.compositionId) : undefined
    if (!v || !comp) return undefined
    const when = new Date(v.createdAt)
    const label = `${when.getMonth() + 1}/${when.getDate()} ${String(when.getHours()).padStart(2, '0')}:${String(when.getMinutes()).padStart(2, '0')}`
    return this.save({ ...comp, score: v.score, bpm: v.score.bpm, steps: v.score.bars * v.score.beatsPerBar }, { versionNote: `恢复自 ${label} 的版本` })
  },
  async markExported(id: string): Promise<void> {
    const db = getDb()
    const comp = await db.compositions.get(id)
    if (comp) await db.compositions.put({ ...comp, exportedAt: Date.now() })
  },
  async get(id: string): Promise<Composition | undefined> {
    return getDb().compositions.get(id)
  },
  async list(): Promise<Composition[]> {
    return getDb().compositions.orderBy('createdAt').reverse().toArray()
  },
  /** Delete a work. An unfinished lesson that pointed at it must be saved again. */
  async remove(id: string): Promise<void> {
    const db = getDb()
    await db.transaction('rw', [db.compositions, db.lessonProgress, db.compositionVersions, db.critiques], async () => {
      await db.compositions.delete(id)
      await db.compositionVersions.where('compositionId').equals(id).delete()
      await db.critiques.where('compositionId').equals(id).delete()
      const linked = await db.lessonProgress.filter((l) => l.compositionId === id).toArray()
      for (const l of linked) {
        if (!l.completedAt) {
          const { compositionId: _drop, ...rest } = l
          await db.lessonProgress.put({ ...rest, updatedAt: Date.now() })
        }
      }
    })
  },
}
