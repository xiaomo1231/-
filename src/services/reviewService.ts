import { getDb } from '@/infrastructure/db/database'
import type { ModuleId } from '@/drills/types'
import type { ReviewItem } from '@/entities/types'

export const DAY_MS = 24 * 60 * 60 * 1000
const HOUR_MS = 60 * 60 * 1000
export const INITIAL_EASE = 2.5
const MIN_EASE = 1.3

export type ReviewGrade = 'again' | 'hard' | 'good' | 'easy'

/** Map one answer to a recall grade. Fast, fully correct answers count as "easy". */
export function gradeFromOutcome(credit: number, responseMs?: number, expectedMs?: number): ReviewGrade {
  if (credit < 0.5) return 'again'
  if (credit < 0.999) return 'hard'
  if (responseMs !== undefined && expectedMs !== undefined && responseMs < expectedMs * 0.5) return 'easy'
  return 'good'
}

/**
 * SM-2-style scheduling at skill level. A miss brings the skill back within
 * the hour; correct answers move it out to 1 day, 3 days, then interval × ease.
 * Pure function for testing.
 */
export function scheduleItem(item: ReviewItem | undefined, skillId: string, module: ModuleId, grade: ReviewGrade, now: number): ReviewItem {
  const base: ReviewItem = item ?? { skillId, module, due: now, interval: 0, ease: INITIAL_EASE, reps: 0, lapses: 0, lastAt: now }
  let { interval, ease, reps, lapses } = base
  let dueIn: number
  if (grade === 'again') {
    lapses += reps > 0 ? 1 : 0
    reps = 0
    interval = 0
    ease = Math.max(MIN_EASE, ease - 0.2)
    dueIn = HOUR_MS
  } else if (grade === 'hard' && reps === 0) {
    interval = 0
    dueIn = 6 * HOUR_MS
  } else {
    if (grade === 'hard') {
      interval = Math.max(1, Math.round(interval * 1.2))
      ease = Math.max(MIN_EASE, ease - 0.15)
    } else if (grade === 'good') {
      interval = reps === 0 ? 1 : reps === 1 ? 3 : Math.round(interval * ease)
    } else {
      interval = reps === 0 ? 3 : Math.round(Math.max(interval, 1) * ease * 1.3)
      ease += 0.1
    }
    reps += 1
    dueIn = interval * DAY_MS
  }
  return { ...base, module, interval, ease, reps, lapses, due: now + dueIn, lastAt: now }
}

export const ReviewService = {
  async record(skillCredits: Record<string, number>, module: ModuleId, now = Date.now(), responseMs?: number, expectedMs?: number): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.reviewItems, async () => {
      for (const [skillId, credit] of Object.entries(skillCredits)) {
        const existing = await db.reviewItems.get(skillId)
        await db.reviewItems.put(scheduleItem(existing, skillId, module, gradeFromOutcome(credit, responseMs, expectedMs), now))
      }
    })
  },

  /** Skills due now, most overdue first. */
  async due(now = Date.now(), limit = 50): Promise<ReviewItem[]> {
    return getDb().reviewItems.where('due').belowOrEqual(now).limit(limit).toArray()
  },

  async dueCount(now = Date.now()): Promise<number> {
    return getDb().reviewItems.where('due').belowOrEqual(now).count()
  },
}
