import { getDb } from '@/infrastructure/db/database'
import type { Badge } from '@/entities/types'
import type { ModuleId } from '@/drills/types'
import { badgeInfo, type BadgeInfo } from './progressRules'

/** Level milestones that earn a badge. */
const LEVEL_BADGES: Array<{ module: ModuleId; level: number; id: string }> = [
  { module: 'E2', level: 7, id: 'interval-all' },
  { module: 'E1', level: 6, id: 'pitch-10c' },
  { module: 'E5', level: 6, id: 'chord-inv' },
  { module: 'E8', level: 4, id: 'dictation-4' },
]

export const BadgeService = {
  async all(): Promise<Badge[]> {
    return getDb().badges.toArray()
  },

  /** Award once. Returns the badge info when it is new, otherwise null. */
  async award(id: string): Promise<BadgeInfo | null> {
    const db = getDb()
    const info = badgeInfo(id)
    if (!info) return null
    const existing = await db.badges.get(id)
    if (existing) return null
    await db.badges.put({ id, earnedAt: Date.now() })
    return info
  },

  async checkLevel(module: ModuleId, level: number): Promise<BadgeInfo[]> {
    const out: BadgeInfo[] = []
    for (const b of LEVEL_BADGES) {
      if (b.module === module && level >= b.level) {
        const got = await this.award(b.id)
        if (got) out.push(got)
      }
    }
    return out
  },

  async checkStreak(current: number): Promise<BadgeInfo[]> {
    const out: BadgeInfo[] = []
    for (const [n, id] of [
      [3, 'streak-3'],
      [7, 'streak-7'],
      [30, 'streak-30'],
    ] as const) {
      if (current >= n) {
        const got = await this.award(id)
        if (got) out.push(got)
      }
    }
    return out
  },
}
