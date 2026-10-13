import { getDb } from '@/infrastructure/db/database'
import type { InstrumentId, NotationId, StudentProfile, ThemeMode } from '@/entities/types'
import { advanceStreak, localDateKey, rankFor } from './progressRules'

const ID = 'me' as const

export function defaultProfile(now = Date.now()): StudentProfile {
  return {
    id: ID,
    displayName: '',
    instrument: 'none',
    notation: 'staff',
    theme: 'dark',
    octaveEquivalence: true,
    deviceLatencyMs: 0,
    setupDone: false,
    placementDone: false,
    unlockedStage: 0,
    xp: 0,
    streak: { current: 0, best: 0, lastDate: null },
    createdAt: now,
    updatedAt: now,
  }
}

export const ProfileService = {
  async get(): Promise<StudentProfile | undefined> {
    return getDb().profile.get(ID)
  },

  /** Returns the stored profile, creating a default one on first launch. */
  async ensure(): Promise<StudentProfile> {
    const db = getDb()
    const existing = await db.profile.get(ID)
    if (existing) return existing
    const fresh = defaultProfile()
    await db.profile.put(fresh)
    return fresh
  },

  async update(patch: Partial<Omit<StudentProfile, 'id' | 'createdAt'>>): Promise<StudentProfile> {
    const db = getDb()
    const current = await this.ensure()
    const next: StudentProfile = { ...current, ...patch, id: ID, updatedAt: Date.now() }
    await db.profile.put(next)
    return next
  },

  async setup(input: {
    displayName: string
    instrument: InstrumentId
    secondInstrument?: InstrumentId
    notation: NotationId
  }): Promise<StudentProfile> {
    return this.update({
      displayName: input.displayName.trim(),
      instrument: input.instrument,
      ...(input.secondInstrument && input.secondInstrument !== 'none' ? { secondInstrument: input.secondInstrument } : { secondInstrument: undefined }),
      notation: input.notation,
      setupDone: true,
    })
  },

  async setTheme(theme: ThemeMode): Promise<void> {
    await this.update({ theme })
  },

  /** Add XP and report whether the rank changed. */
  async addXp(amount: number): Promise<{ profile: StudentProfile; rankedUp: boolean }> {
    const current = await this.ensure()
    const before = rankFor(current.xp).index
    const profile = await this.update({ xp: current.xp + Math.max(0, Math.round(amount)) })
    return { profile, rankedUp: rankFor(profile.xp).index > before }
  },

  /** Called when today's plan is finished. Idempotent for the same day. */
  async markDailyComplete(today = localDateKey()): Promise<StudentProfile> {
    const current = await this.ensure()
    const streak = advanceStreak(current.streak, today)
    if (streak === current.streak) return current
    return this.update({ streak })
  },

  async setLatency(ms: number): Promise<void> {
    await this.update({ deviceLatencyMs: Math.max(0, Math.min(400, Math.round(ms))) })
  },
}
