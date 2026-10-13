/**
 * 后期课堂 (0.19.0): the student's own voice for the lessons, lesson progress,
 * ear-drill records, and saved mix presets (0.21.0). All local.
 */
import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import type { EarDrillStats, MixCourseVoice, MixLessonProgress, UserMixPreset } from '@/entities/types'
import type { MixSettings } from '@/songs/singTypes'
import { encodeWav } from '@/export/wav'
import { ProfileService } from './profileService'
import { nextLevel } from '@/mixing/drills'

/** XP for a lesson read, a task passed, a correct ear-drill answer. */
export const XP_MIX_READ = 5
export const XP_MIX_TASK = 15
export const XP_EAR_RIGHT = 2

export const MixCourseService = {
  async voice(): Promise<MixCourseVoice | undefined> {
    return getDb().mixCourse.get('voice')
  },

  /** Keep a recording (mono samples) as the lesson voice. */
  async saveVoice(samples: Float32Array, sampleRate: number, source: MixCourseVoice['source']): Promise<MixCourseVoice> {
    const row: MixCourseVoice = {
      id: 'voice',
      blob: new Blob([encodeWav([samples], sampleRate) as BlobPart], { type: 'audio/wav' }),
      sampleRate,
      durationMs: Math.round((samples.length / sampleRate) * 1000),
      source,
      createdAt: Date.now(),
    }
    await getDb().mixCourse.put(row)
    return row
  },

  async removeVoice(): Promise<void> {
    await getDb().mixCourse.delete('voice')
  },

  async progress(): Promise<MixLessonProgress[]> {
    return getDb().mixProgress.toArray()
  },

  /** Mark a lesson read (XP once). */
  async markRead(lessonId: string): Promise<void> {
    const db = getDb()
    const p = await db.mixProgress.get(lessonId)
    if (p?.readAt) return
    await db.mixProgress.put({ ...p, lessonId, readAt: Date.now() })
    await ProfileService.addXp(XP_MIX_READ)
  },

  /** Mark a lesson's task passed (XP once). Returns true the first time. */
  async markTaskPassed(lessonId: string): Promise<boolean> {
    const db = getDb()
    const p = await db.mixProgress.get(lessonId)
    if (p?.taskPassedAt) return false
    await db.mixProgress.put({ ...p, lessonId, readAt: p?.readAt ?? Date.now(), taskPassedAt: Date.now() })
    await ProfileService.addXp(XP_MIX_TASK)
    return true
  },

  async earStats(): Promise<EarDrillStats[]> {
    return getDb().earStats.toArray()
  },

  /** Record an answer; moves the level up / down and returns the new record. */
  async recordAnswer(kind: string, right: boolean): Promise<EarDrillStats> {
    const db = getDb()
    const cur = (await db.earStats.get(kind)) ?? { kind, level: 1, attempts: 0, correct: 0, recent: [], best: 1, updatedAt: 0 }
    const recent = [...cur.recent, right].slice(-10)
    const level = nextLevel(cur.level, recent)
    const next: EarDrillStats = {
      ...cur,
      attempts: cur.attempts + 1,
      correct: cur.correct + (right ? 1 : 0),
      level,
      recent: level === cur.level ? recent : [],
      best: Math.max(cur.best, level),
      updatedAt: Date.now(),
    }
    await db.earStats.put(next)
    if (right) await ProfileService.addXp(XP_EAR_RIGHT)
    return next
  },

  async setDrillLevel(kind: string, level: number): Promise<void> {
    const db = getDb()
    const cur = (await db.earStats.get(kind)) ?? { kind, level: 1, attempts: 0, correct: 0, recent: [], best: 1, updatedAt: 0 }
    await db.earStats.put({ ...cur, level, recent: [], updatedAt: Date.now() })
  },

  // ---- 跟唱后期: the student's own presets (0.21.0) ----------------------------

  async presets(): Promise<UserMixPreset[]> {
    return getDb().userMixPresets.orderBy('createdAt').toArray()
  },

  async savePreset(name: string, mix: MixSettings): Promise<UserMixPreset> {
    const row: UserMixPreset = { id: uuid(), name: name.trim().slice(0, 30) || '我的预设', mix: JSON.parse(JSON.stringify(mix)) as MixSettings, createdAt: Date.now() }
    await getDb().userMixPresets.put(row)
    return row
  },

  async removePreset(id: string): Promise<void> {
    await getDb().userMixPresets.delete(id)
  },
}
