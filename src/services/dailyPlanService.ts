import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import { skillLabel } from '@/drills/skills'
import { MODULES, moduleInfo, type ModuleId } from '@/drills/types'
import type { DailyPlan, DailyPlanItem, ModuleProgress, ReviewItem, SkillMastery } from '@/entities/types'
import { ReviewService } from './reviewService'
import { MasteryService } from './masteryService'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { localDateKey, XP_DAILY_PLAN_BONUS } from './progressRules'

/** Bump when the plan composition changes; untouched older plans are rebuilt. */
export const PLAN_VERSION = 4

/** Target length of a daily plan in seconds (about 15 minutes). */
const TARGET_SECONDS = 15 * 60

/**
 * A module only enters the daily plan once its basics have some practice,
 * so a beginner is not handed sight-singing on day one.
 */
export const PLAN_PREREQ: Partial<Record<ModuleId, { module: ModuleId; attempts: number }>> = {
  E6: { module: 'E5', attempts: 10 },
  E7: { module: 'E5', attempts: 10 },
  E8: { module: 'E3', attempts: 10 },
  E9: { module: 'R2', attempts: 5 },
  S2: { module: 'S1', attempts: 10 },
  S3: { module: 'S1', attempts: 10 },
  S4: { module: 'S1', attempts: 10 },
  S5: { module: 'S3', attempts: 10 },
  S6: { module: 'S4', attempts: 5 },
  S7: { module: 'S4', attempts: 5 },
  T1: { module: 'N1', attempts: 5 },
}

/** Instrument tasks (I1 / I2) and the guitar workshop are self-chosen, never planned. */
const isInstrumentItem = (i: DailyPlanItem): boolean => i.module === 'I1' || i.module === 'I2' || Boolean(i.link?.startsWith('/guitar'))

/**
 * Build today's plan: three knowledge items (listening, reading, theory), one
 * rhythm item and one singing item. Instrument practice is left to the student. Modules with weak or
 * due skills come first, then the least practised, rotated by day. Pure given
 * its inputs so it can be unit-tested.
 */
export function buildPlan(
  progress: ModuleProgress[],
  weak: SkillMastery[],
  date: string,
  seedNow = Date.now(),
  due: ReviewItem[] = [],
): DailyPlan {
  const byId = new Map(progress.map((p) => [p.moduleId, p]))
  const attempts = (m: ModuleId) => byId.get(m)?.totalAttempts ?? 0
  const weakBy = groupBy(weak, (w) => w.module)
  const dueBy = groupBy(due, (d) => d.module)
  const dayIndex = Number(date.replaceAll('-', '')) % 7

  const eligible = (m: ModuleId): boolean => {
    const req = PLAN_PREREQ[m]
    return !req || attempts(req.module) >= req.attempts
  }
  const rank = (ids: ModuleId[]): ModuleId[] =>
    ids.filter(eligible).sort((a, b) => {
      const pa = (weakBy.get(a)?.length ?? 0) + (dueBy.get(a)?.length ?? 0)
      const pb = (weakBy.get(b)?.length ?? 0) + (dueBy.get(b)?.length ?? 0)
      if (pa !== pb) return pb - pa
      const ta = attempts(a)
      const tb = attempts(b)
      if (ta !== tb) return ta - tb
      return ((ids.indexOf(a) + dayIndex) % ids.length) - ((ids.indexOf(b) + dayIndex) % ids.length)
    })

  const ofKind = (kinds: string[]) => MODULES.filter((m) => kinds.includes(m.kind) && !m.id.startsWith('I')).map((m) => m.id)
  const chosen: ModuleId[] = [
    ...rank(ofKind(['ear', 'read'])).slice(0, 3),
    ...rank(ofKind(['rhythm'])).slice(0, 1),
    ...rank(ofKind(['sing'])).slice(0, 1),
  ]

  const perItem = TARGET_SECONDS / chosen.length
  const items: DailyPlanItem[] = chosen.map((m) => {
    const p = byId.get(m)
    const level = p?.level ?? 1
    const weakSkills = (weakBy.get(m) ?? []).map((w) => w.skillId)
    const dueSkills = (dueBy.get(m) ?? []).map((d) => d.skillId)
    const focus = Array.from(new Set([...dueSkills, ...weakSkills])).slice(0, 4)
    const questions = Math.max(4, Math.min(12, Math.round(perItem / moduleInfo(m).secondsPerQuestion)))
    let reason: string
    if (dueSkills.length) reason = `到期复习：${dueSkills.slice(0, 3).map(skillLabel).join('、')}`
    else if (weakSkills.length) reason = `针对性加练：${weakSkills.slice(0, 3).map(skillLabel).join('、')}`
    else if (!p || p.totalAttempts === 0) reason = '还没练过，先建立基线'
    else if (p.recentAtLevel.length >= 6) reason = `第 ${level} 级冲刺，接近升级`
    else reason = `第 ${level} 级巩固`
    return { id: uuid(), module: m, level, questions, focusSkills: focus, reason, completed: false }
  })
  return { date, version: PLAN_VERSION, items, createdAt: seedNow }
}

function groupBy<T>(xs: readonly T[], key: (x: T) => ModuleId): Map<ModuleId, T[]> {
  const m = new Map<ModuleId, T[]>()
  for (const x of xs) {
    const k = key(x)
    m.set(k, [...(m.get(k) ?? []), x])
  }
  return m
}

async function planInputs() {
  const [progress, weak, due] = await Promise.all([ModuleProgressService.all(), MasteryService.weakest(null, 20), ReviewService.due()])
  return { progress, weak, due }
}

export const DailyPlanService = {
  async today(): Promise<DailyPlan> {
    const date = localDateKey()
    const db = getDb()
    const existing = await db.dailyPlans.get(date)
    if (existing && (existing.version ?? 1) >= PLAN_VERSION) return existing
    // An older plan the student already started keeps its progress; only the
    // instrument items (no longer planned) are dropped.
    if (existing && existing.items.some((i) => i.completed && !isInstrumentItem(i))) {
      const items = existing.items.filter((i) => !isInstrumentItem(i))
      const allDone = items.every((i) => i.completed)
      const kept: DailyPlan = { ...existing, version: PLAN_VERSION, items, ...(allDone && !existing.completedAt ? { completedAt: Date.now() } : {}) }
      await db.dailyPlans.put(kept)
      if (allDone && !existing.completedAt) {
        await ProfileService.addXp(XP_DAILY_PLAN_BONUS)
        await ProfileService.markDailyComplete(date)
      }
      return kept
    }
    const { progress, weak, due } = await planInputs()
    const plan = buildPlan(progress, weak, date, Date.now(), due)
    await db.dailyPlans.put(plan)
    return plan
  },

  /** Rebuild today's plan (after placement changes starting levels). */
  async rebuildToday(): Promise<DailyPlan> {
    const date = localDateKey()
    const db = getDb()
    const { progress, weak, due } = await planInputs()
    const plan = buildPlan(progress, weak, date, Date.now(), due)
    await db.dailyPlans.put(plan)
    return plan
  },

  /** Mark an item done. When the plan is complete, award the bonus and streak. */
  async completeItem(itemId: string): Promise<{ plan: DailyPlan; planCompleted: boolean; bonusXp: number }> {
    const date = localDateKey()
    const db = getDb()
    const plan = await db.dailyPlans.get(date)
    if (!plan) throw new Error('今天的训练计划不存在')
    const items = plan.items.map((i) => (i.id === itemId ? { ...i, completed: true } : i))
    const allDone = items.every((i) => i.completed)
    const alreadyDone = Boolean(plan.completedAt)
    const next: DailyPlan = { ...plan, items, ...(allDone && !alreadyDone ? { completedAt: Date.now() } : {}) }
    await db.dailyPlans.put(next)
    let bonusXp = 0
    if (allDone && !alreadyDone) {
      bonusXp = XP_DAILY_PLAN_BONUS
      await ProfileService.addXp(bonusXp)
      await ProfileService.markDailyComplete(date)
    }
    return { plan: next, planCompleted: allDone && !alreadyDone, bonusXp }
  },

  async history(limit = 30): Promise<DailyPlan[]> {
    return getDb().dailyPlans.orderBy('date').reverse().limit(limit).toArray()
  },
}
