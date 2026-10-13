import { getDb } from '@/infrastructure/db/database'
import type { Composition } from '@/entities/types'
import { STAGES } from '@/course/stages'
import { graduationComplete, graduationStarter, graduationSteps, type GradProgress, type GradStep } from '@/course/graduation'
import { CompositionService, CourseService } from './courseService'
import { ProfileService } from './profileService'
import { BadgeService } from './badgeService'
import type { BadgeInfo } from './progressRules'

export const GraduationService = {
  /** Unlocked once every stage-5 lesson is complete. */
  async unlocked(): Promise<{ ok: boolean; done: number; total: number }> {
    const stage5 = STAGES.find((s) => s.stage === 5)!
    const progress = await CourseService.progressAll()
    const done = stage5.lessons.filter((l) => progress.some((p) => p.lessonId === l.id && p.completedAt)).length
    return { ok: done === stage5.lessons.length, done, total: stage5.lessons.length }
  },

  async project(): Promise<Composition | undefined> {
    const rows = await getDb().compositions.toArray()
    return rows.filter((c) => c.project === 'graduation').sort((a, b) => b.updatedAt - a.updatedAt)[0]
  },

  /** The project, created with a 56-bar section skeleton on first open. */
  async ensureProject(): Promise<Composition> {
    const existing = await this.project()
    if (existing) return existing
    const profile = await ProfileService.ensure()
    const score = graduationStarter()
    return CompositionService.save({ title: '毕业作品', kind: 'song', stage: profile.unlockedStage, bpm: score.bpm, steps: score.bars * score.beatsPerBar, cells: [], score, project: 'graduation' })
  },

  async progress(c: Composition): Promise<GradProgress> {
    const db = getDb()
    const [critiques, versions] = await Promise.all([db.critiques.where('compositionId').equals(c.id).toArray(), CompositionService.versions(c.id)])
    const first = critiques.reduce<number | undefined>((m, r) => (m === undefined || r.createdAt < m ? r.createdAt : m), undefined)
    return {
      ...(first ? { firstCritiqueAt: first } : {}),
      ...(versions[0] ? { lastVersionAt: versions[0].createdAt } : {}),
      ...(c.exportedAt ? { exportedAt: c.exportedAt } : {}),
    }
  },

  async steps(c: Composition): Promise<GradStep[]> {
    const profile = await ProfileService.ensure()
    return graduationSteps(c.score!, profile.instrument, await this.progress(c))
  },

  /** Mark graduation once everything passes (idempotent). Returns the badge when newly earned. */
  async tryGraduate(c: Composition): Promise<BadgeInfo | null> {
    const steps = await this.steps(c)
    if (!graduationComplete(steps)) return null
    const profile = await ProfileService.ensure()
    if (!profile.graduatedAt) await ProfileService.update({ graduatedAt: Date.now() })
    return BadgeService.award('graduate')
  },
}
