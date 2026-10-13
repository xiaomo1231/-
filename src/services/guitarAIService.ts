import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { GeneratedExercise } from '@/entities/types'
import { guitarCoach, improvReviewer } from '@/infrastructure/ai/prompts'
import { STRUM_PATTERNS } from '@/guitar/strum'
import { ALL_UNITS, type GuitarExercise } from '@/guitar/units'
import type { RomanId } from '@/music/keys'
import { AIValidationError, getAI } from './ai/aiClient'
import { validateCoachExercises, validateImprovReview, type CoachExercise, type ImprovReview } from './ai/validate'
import { GuitarService } from './guitarService'

/** Chords the AI may use: open-position chords only, so every exercise is playable. */
export const COACH_ROMANS = { major: ['I', 'ii', 'IV', 'V', 'vi'], minor: ['i', 'iv', 'v', 'III', 'VI', 'VII'] }

/** Minor roman → the same chord as a roman in the relative major (A minor → C major). */
const RELATIVE_MAJOR: Record<string, RomanId> = { i: 'vi', 'ii°': 'vii°', III: 'I', iv: 'ii', v: 'iii', VI: 'IV', VII: 'V' }

const STRINGS = [40, 45, 50, 55, 59, 64]
const PATTERN_NAME = new Map(STRUM_PATTERNS.map((p) => [p.id, p.name]))

/** Turn a validated AI proposal into a normal workshop exercise. */
export function coachToExercise(c: CoachExercise, id: string): GuitarExercise {
  if (c.type === 'strum') {
    const major = c.mode === 'major'
    const romans = (major ? c.romans : c.romans.map((r) => RELATIVE_MAJOR[r]!)) as RomanId[]
    return { id, kind: 'strum', title: `${PATTERN_NAME.get(c.pattern) ?? c.pattern} · ${major ? 'G 大调' : 'A 小调'}`, pattern: c.pattern, tonic: major ? 55 : 60, romans, bars: 4, bpm: c.bpm, pass: 0.75, tip: c.reason, preset: 'clean-pop' }
  }
  if (c.type === 'lick') return { id, kind: 'play', title: 'AI 句型', source: { type: 'notes', name: 'AI 句型', notes: c.notes }, bpm: c.bpm, tip: c.reason, preset: 'lead' }
  return { id, kind: 'bend', title: `${c.semitones === 2 ? '全音' : '半音'}推弦：${6 - c.string} 弦 ${c.fret} 品`, string: c.string, fret: c.fret, semitones: c.semitones, tip: c.reason, preset: 'lead' }
}

export const GuitarAIService = {
  async generate(count = 4): Promise<{ saved: GeneratedExercise[]; rejected: number }> {
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const rows = await GuitarService.all()
    const titles = new Map(ALL_UNITS.flatMap((u) => u.exercises.map((e) => [e.id, e] as const)))
    const weak = rows
      .filter((r) => r.unitId !== 'AI' && (!r.passedAt || r.best < 0.85))
      .sort((a, b) => a.best - b.best)
      .slice(0, 6)
      .map((r) => {
        const ex = titles.get(r.exerciseId)
        return { title: ex?.title ?? r.exerciseId, kind: ex?.kind ?? 'unknown', best: r.best, attempts: r.attempts, ...(r.last ? { last: r.last } : {}) }
      })
    const input: guitarCoach.GuitarCoachInput = {
      weak,
      patterns: STRUM_PATTERNS.map((p) => ({ id: p.id, name: p.name })),
      romansMajor: COACH_ROMANS.major,
      romansMinor: COACH_ROMANS.minor,
      count,
    }
    const { data, raw } = await ai.chatJSON<unknown>([
      { role: 'system', content: guitarCoach.buildSystemPrompt() },
      { role: 'user', content: guitarCoach.buildUserPrompt(input) },
    ])
    const { valid, rejected } = validateCoachExercises(data, { patterns: new Set(STRUM_PATTERNS.map((p) => p.id)), romansMajor: COACH_ROMANS.major, romansMinor: COACH_ROMANS.minor, strings: STRINGS })
    const now = Date.now()
    const saved: GeneratedExercise[] = valid.map((c, i) => {
      const id = uuid()
      return { id, module: 'guitar', level: 1, spec: { kind: 'guitar', exercise: coachToExercise(c, `ai-${id}`) }, targetSkills: [], reason: c.reason, promptVersion: guitarCoach.VERSION, model: raw.model, createdAt: now + i }
    })
    await getDb().generatedExercises.bulkPut(saved)
    return { saved, rejected }
  },

  async pending(): Promise<GeneratedExercise[]> {
    const rows = await getDb().generatedExercises.orderBy('createdAt').toArray()
    return rows.filter((r) => r.module === 'guitar' && !r.usedAt)
  },

  async markUsed(id: string): Promise<void> {
    const db = getDb()
    const row = await db.generatedExercises.get(id)
    if (row && !row.usedAt) await db.generatedExercises.put({ ...row, usedAt: Date.now() })
  },

  async reviewImprov(input: improvReviewer.ImprovReviewerInput): Promise<{ review: ImprovReview; dropped: number; model: string }> {
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const { data, raw } = await ai.chatJSON<unknown>([
      { role: 'system', content: improvReviewer.buildSystemPrompt() },
      { role: 'user', content: improvReviewer.buildUserPrompt(input) },
    ])
    return { ...validateImprovReview(data, input.bars), model: raw.model }
  },
}
