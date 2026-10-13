import { getDb } from '@/infrastructure/db/database'
import type { GuitarProgress } from '@/entities/types'
import { ALL_UNITS, type GuitarUnit } from '@/guitar/units'
import { ProfileService } from './profileService'

export const GUITAR_EXERCISE_XP = 5
export const GUITAR_PASS_XP = 15

export interface UnitStatus {
  unit: GuitarUnit
  passed: number
  total: number
  complete: boolean
}

export const GuitarService = {
  async all(): Promise<GuitarProgress[]> {
    return getDb().guitarProgress.toArray()
  },

  async unitStatus(): Promise<UnitStatus[]> {
    const rows = await this.all()
    return ALL_UNITS.map((unit) => {
      const passed = unit.exercises.filter((e) => rows.some((r) => r.exerciseId === e.id && r.passedAt)).length
      return { unit, passed, total: unit.exercises.length, complete: unit.exercises.length > 0 && passed === unit.exercises.length }
    })
  },

  /** Accumulate how often the chord hint agreed with the chart (hint accuracy per input kind). */
  async recordHint(kind: 'cable' | 'mic', agree: number, total: number): Promise<void> {
    if (total <= 0) return
    const p = await ProfileService.ensure()
    const prev = p.chordHintStats?.[kind] ?? { agree: 0, total: 0 }
    await ProfileService.update({ chordHintStats: { ...p.chordHintStats, [kind]: { agree: prev.agree + agree, total: prev.total + total } } })
  },

  /** Record one attempt. Returns whether it was the first pass and the XP earned. */
  async record(exerciseId: string, unitId: string, score: number, passed: boolean, last: string): Promise<{ firstPass: boolean; xp: number; progress: GuitarProgress }> {
    const db = getDb()
    const now = Date.now()
    const prev = await db.guitarProgress.get(exerciseId)
    const firstPass = passed && !prev?.passedAt
    const progress: GuitarProgress = {
      exerciseId,
      unitId,
      best: Math.max(prev?.best ?? 0, Math.max(0, Math.min(1, score))),
      attempts: (prev?.attempts ?? 0) + 1,
      ...(prev?.passedAt || passed ? { passedAt: prev?.passedAt ?? now } : {}),
      last,
      updatedAt: now,
    }
    await db.guitarProgress.put(progress)
    const xp = GUITAR_EXERCISE_XP + (firstPass ? GUITAR_PASS_XP : 0)
    await ProfileService.addXp(xp)
    return { firstPass, xp, progress }
  },
}
