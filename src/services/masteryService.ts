import { getDb } from '@/infrastructure/db/database'
import type { ModuleId } from '@/drills/types'
import { skillModule } from '@/drills/skills'
import type { SkillMastery } from '@/entities/types'
import { appendObservation, computeMastery } from './masteryMath'

export const MasteryService = {
  /**
   * Record one observation per skill. `weight` < 1 for placement answers so a
   * 6-question test never looks like real mastery.
   */
  async record(skillCredits: Record<string, number>, weight = 1, at = Date.now(), moduleHint?: ModuleId): Promise<SkillMastery[]> {
    const db = getDb()
    const ids = Object.keys(skillCredits)
    if (ids.length === 0) return []
    return db.transaction('rw', db.skillMastery, async () => {
      const out: SkillMastery[] = []
      for (const skillId of ids) {
        const existing = await db.skillMastery.get(skillId)
        const observations = appendObservation(existing?.observations ?? [], {
          credit: clamp01(skillCredits[skillId] ?? 0),
          weight,
          at,
        })
        const row: SkillMastery = {
          skillId,
          module: moduleHint ?? existing?.module ?? skillModule(skillId),
          observations,
          mastery: computeMastery(observations),
          attempts: (existing?.attempts ?? 0) + 1,
          lastAt: at,
        }
        await db.skillMastery.put(row)
        out.push(row)
      }
      return out
    })
  },

  async all(): Promise<SkillMastery[]> {
    return getDb().skillMastery.toArray()
  },

  async byModule(module: ModuleId): Promise<SkillMastery[]> {
    return getDb().skillMastery.where('module').equals(module).toArray()
  },

  /** Skills under the threshold with enough attempts to be meaningful, weakest first. */
  async weakest(module: ModuleId | null, limit = 4, threshold = 0.7): Promise<SkillMastery[]> {
    const rows = module ? await this.byModule(module) : await this.all()
    return rows
      .filter((r) => r.attempts >= 3 && r.mastery < threshold)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, limit)
  },

  /** Average mastery for a module (0 when nothing practised). */
  async moduleAverage(module: ModuleId): Promise<{ mastery: number; skills: number }> {
    const rows = await this.byModule(module)
    if (rows.length === 0) return { mastery: 0, skills: 0 }
    return { mastery: rows.reduce((s, r) => s + r.mastery, 0) / rows.length, skills: rows.length }
  },
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}
