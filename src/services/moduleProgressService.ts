import { getDb } from '@/infrastructure/db/database'
import { isAdmin } from './adminMode'
import { ProfileService } from './profileService'
import { clampLevel } from '@/drills/levels'
import { MODULES, moduleInfo, type ModuleId } from '@/drills/types'
import type { ModuleProgress } from '@/entities/types'
import { decideLevel, type LevelDecision } from './masteryMath'

const RECENT_CAP = 20

export const ModuleProgressService = {
  async ensure(moduleId: ModuleId): Promise<ModuleProgress> {
    const db = getDb()
    const existing = await db.moduleProgress.get(moduleId)
    if (existing) return existing
    const fresh: ModuleProgress = {
      moduleId,
      level: 1,
      unlockedLevel: 1,
      recentAtLevel: [],
      totalAttempts: 0,
      totalCorrect: 0,
      updatedAt: Date.now(),
    }
    await db.moduleProgress.put(fresh)
    return fresh
  },

  async all(): Promise<ModuleProgress[]> {
    const rows = await getDb().moduleProgress.toArray()
    const byId = new Map(rows.map((r) => [r.moduleId, r]))
    return MODULES.map(
      (m) =>
        byId.get(m.id) ?? {
          moduleId: m.id,
          level: 1,
          unlockedLevel: 1,
          recentAtLevel: [],
          totalAttempts: 0,
          totalCorrect: 0,
          updatedAt: 0,
        },
    )
  },

  /** Student picks a level they have already unlocked. */
  async setLevel(moduleId: ModuleId, level: number): Promise<ModuleProgress> {
    const db = getDb()
    const cur = await this.ensure(moduleId)
    const admin = isAdmin(await ProfileService.get())
    const target = admin ? clampLevel(moduleId, level) : Math.min(clampLevel(moduleId, level), cur.unlockedLevel)
    if (target === cur.level) return cur
    const next: ModuleProgress = { ...cur, level: target, recentAtLevel: [], updatedAt: Date.now() }
    await db.moduleProgress.put(next)
    return next
  },

  /** Placement sets a starting level directly (and unlocks up to it). */
  async setStartingLevel(moduleId: ModuleId, level: number): Promise<ModuleProgress> {
    const db = getDb()
    const cur = await this.ensure(moduleId)
    const target = clampLevel(moduleId, level)
    const next: ModuleProgress = {
      ...cur,
      level: target,
      unlockedLevel: Math.max(cur.unlockedLevel, target),
      recentAtLevel: [],
      updatedAt: Date.now(),
    }
    await db.moduleProgress.put(next)
    return next
  },

  /**
   * Record an outcome at the module's current level and apply the level rule.
   * Returns the new progress plus the decision so the UI can celebrate.
   */
  async recordOutcome(
    moduleId: ModuleId,
    outcome: { correct: boolean; credit: number },
    level: number,
  ): Promise<{ progress: ModuleProgress; decision: LevelDecision; leveledUp: boolean }> {
    const db = getDb()
    const cur = await this.ensure(moduleId)
    const max = moduleInfo(moduleId).maxLevel
    // Outcomes from a different level (e.g. daily plan at a lower level) still
    // count toward totals but not toward the current level's window.
    const sameLevel = level === cur.level
    const recent = sameLevel ? [...cur.recentAtLevel, outcome].slice(-RECENT_CAP) : cur.recentAtLevel
    const decision = sameLevel ? decideLevel(recent, cur.level, max) : { action: 'stay' as const, reason: '', accuracy: null }
    let nextLevel = cur.level
    if (decision.action === 'up') nextLevel = Math.min(max, cur.level + 1)
    if (decision.action === 'down') nextLevel = Math.max(1, cur.level - 1)
    const changed = nextLevel !== cur.level
    const next: ModuleProgress = {
      ...cur,
      level: nextLevel,
      unlockedLevel: Math.max(cur.unlockedLevel, nextLevel),
      recentAtLevel: changed ? [] : recent,
      totalAttempts: cur.totalAttempts + 1,
      totalCorrect: cur.totalCorrect + (outcome.correct ? 1 : 0),
      updatedAt: Date.now(),
    }
    await db.moduleProgress.put(next)
    return { progress: next, decision, leveledUp: decision.action === 'up' && changed }
  },
}
