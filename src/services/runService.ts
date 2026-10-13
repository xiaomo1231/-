import { getDb } from '@/infrastructure/db/database'
import type { ActiveRun } from '@/entities/types'

/** Unfinished drills are kept this long. */
export const RUN_TTL_MS = 7 * 24 * 60 * 60 * 1000

/** Local midnight after `t` (daily-plan runs do not carry over to the next day). */
export function endOfLocalDay(t: number): number {
  const d = new Date(t)
  d.setHours(24, 0, 0, 0)
  return d.getTime()
}

export function isExpired(run: Pick<ActiveRun, 'expiresAt'>, now = Date.now()): boolean {
  return run.expiresAt <= now
}

export type RunInput = Omit<ActiveRun, 'createdAt' | 'updatedAt' | 'expiresAt'> & {
  /** Plan items expire at the end of the day; everything else after 7 days. */
  daily?: boolean
}

/**
 * Saved progress of drills the student left halfway. Each drill flow writes a
 * snapshot after every answer and deletes it when it finishes; on return the
 * flow offers "继续 / 重新开始". Sessions of abandoned runs are closed so the
 * history does not fill with sessions that never ended.
 */
export const RunService = {
  /** The saved run for `id`, or null (expired runs are removed and their session closed). */
  async get(id: string): Promise<ActiveRun | null> {
    const run = await getDb().activeRuns.get(id)
    if (!run) return null
    if (isExpired(run)) {
      await this.discard(id)
      return null
    }
    return run
  },

  async save(input: RunInput): Promise<void> {
    const db = getDb()
    const now = Date.now()
    const prev = await db.activeRuns.get(input.id)
    const { daily, ...rest } = input
    const createdAt = prev?.createdAt ?? now
    const expiresAt = daily ? endOfLocalDay(createdAt) : now + RUN_TTL_MS
    await db.activeRuns.put({ ...rest, createdAt, updatedAt: now, expiresAt })
  },

  /** The flow finished normally: forget the snapshot (its session is closed by the flow). */
  async clear(id: string): Promise<void> {
    await getDb().activeRuns.delete(id)
  },

  /** The student chose to start over, or the run expired: close its session and forget it. */
  async discard(id: string): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.activeRuns, db.drillSessions, db.drillAttempts, async () => {
      const run = await db.activeRuns.get(id)
      if (run?.sessionId) await closeSession(run.sessionId, run.updatedAt)
      await db.activeRuns.delete(id)
    })
  },

  /** Unfinished runs, most recent first (expired ones are cleaned up). */
  async list(): Promise<ActiveRun[]> {
    const db = getDb()
    const rows = await db.activeRuns.orderBy('updatedAt').reverse().toArray()
    const now = Date.now()
    const live = rows.filter((r) => !isExpired(r, now))
    for (const r of rows) if (isExpired(r, now)) await this.discard(r.id)
    return live
  },

  /**
   * Start-up housekeeping: drop expired runs, and close sessions older than
   * the TTL that never ended and are not held by a saved run.
   */
  async cleanup(now = Date.now()): Promise<{ runs: number; sessions: number }> {
    const db = getDb()
    const expired = await db.activeRuns.where('expiresAt').belowOrEqual(now).toArray()
    for (const r of expired) await this.discard(r.id)
    const held = new Set((await db.activeRuns.toArray()).map((r) => r.sessionId).filter(Boolean))
    const old = await db.drillSessions.where('startedAt').below(now - RUN_TTL_MS).toArray()
    let sessions = 0
    for (const s of old) {
      if (s.endedAt || held.has(s.id)) continue
      await closeSession(s.id)
      sessions++
    }
    return { runs: expired.length, sessions }
  },
}

/** Give a session an end time: its last attempt, else the given time, else its start. */
async function closeSession(sessionId: string, fallback?: number): Promise<void> {
  const db = getDb()
  const s = await db.drillSessions.get(sessionId)
  if (!s || s.endedAt) return
  const attempts = await db.drillAttempts.where('sessionId').equals(sessionId).toArray()
  const last = attempts.reduce((m, a) => Math.max(m, a.createdAt), 0)
  await db.drillSessions.put({ ...s, endedAt: last || fallback || s.startedAt })
}
