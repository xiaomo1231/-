import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { GeneratedExercise } from '@/entities/types'
import type { DrillQuestion } from '@/drills/types'
import type { RomanId } from '@/music/keys'
import { COMFORTABLE_TONICS } from '@/music/keys'
import { PROGRESSION_LEVELS, DICTATION_LEVELS } from '@/drills/levelsP2'
import { buildDictationQuestion, buildProgressionQuestion, progressionOptions } from '@/drills/generatorsP2'
import { melodySkill, romanSkill, skillLabel } from '@/drills/skills'
import { createRng, randomSeed } from '@/music/random'
import { ModuleProgressService } from './moduleProgressService'
import { MasteryService } from './masteryService'
import { DrillService } from './drillService'
import { confusionLabel } from '@/drills/confusionLabel'
import { drillGenerator } from '@/infrastructure/ai/prompts'
import { getAI, AIValidationError } from './ai/aiClient'
import { validateExercises, type ExerciseContext } from './ai/validate'

/** Scale steps → semitones for the dictation leap limit. */
const LEAP_SEMITONES = [0, 2, 4, 5, 7]

/** What the AI is allowed to write for this student, derived from their current levels. */
export async function exerciseContext(): Promise<ExerciseContext & { levels: { E6: number; E8: number } }> {
  const [p6, p8] = await Promise.all([ModuleProgressService.ensure('E6'), ModuleProgressService.ensure('E8')])
  const cfg6 = PROGRESSION_LEVELS[p6.level - 1]!
  const cfg8 = DICTATION_LEVELS[p8.level - 1]!
  // Melodic dictation from AI starts at four notes; two-note questions add nothing.
  const melody = cfg8.notes < 4 ? DICTATION_LEVELS[1]! : cfg8
  const allowed = { major: progressionOptions(p6.level, 'major') as string[], minor: progressionOptions(p6.level, 'minor') as string[] }
  const knownSkills = new Set<string>([
    ...allowed.major.map((r) => romanSkill('major', r)),
    ...allowed.minor.map((r) => romanSkill('minor', r)),
    melodySkill('step'),
    melodySkill('leap'),
    melodySkill('chromatic'),
  ])
  return {
    levels: { E6: p6.level, E8: Math.max(p8.level, melody.level) },
    progression: { chords: cfg6.chords, allowed },
    melody: { notes: melody.notes, maxLeapSemitones: LEAP_SEMITONES[melody.maxLeap] ?? 7, chromatic: melody.chromatic },
    knownSkills,
  }
}

export const ExerciseService = {
  /** Ask the AI for targeted E6 / E8 exercises, validate them locally and store the valid ones. */
  async generate(count = { progression: 4, melody: 3 }): Promise<{ saved: GeneratedExercise[]; rejected: number }> {
    const ai = await getAI()
    if (!ai) throw new AIValidationError('还没有配置 AI。到“设置 → AI 导师”填入服务商和 API Key 后再试。')
    const ctx = await exerciseContext()
    const [weak6, weak8, conf] = await Promise.all([MasteryService.weakest('E6', 4), MasteryService.weakest('E8', 2), DrillService.confusions('E6', 4)])
    const input: drillGenerator.DrillGeneratorInput = {
      progression: { level: ctx.levels.E6, chords: ctx.progression.chords, allowed: ctx.progression.allowed },
      melody: { level: ctx.levels.E8, notes: ctx.melody.notes, maxLeapSemitones: ctx.melody.maxLeapSemitones, chromatic: ctx.melody.chromatic },
      weakSkills: [...weak6, ...weak8].filter((w) => ctx.knownSkills.has(w.skillId)).map((w) => ({ skillId: w.skillId, label: skillLabel(w.skillId), mastery: w.mastery })),
      confusions: conf.map((c) => ({ module: c.module, expected: confusionLabel(c.module, c.expected), given: confusionLabel(c.module, c.given), count: c.count })),
      count,
    }
    const { data, raw } = await ai.chatJSON<unknown>([
      { role: 'system', content: drillGenerator.buildSystemPrompt() },
      { role: 'user', content: drillGenerator.buildUserPrompt(input) },
    ])
    const { valid, rejected } = validateExercises(data, ctx)
    const now = Date.now()
    const saved: GeneratedExercise[] = valid.map((v, i) => ({
      id: uuid(),
      module: v.module,
      level: v.module === 'E6' ? ctx.levels.E6 : ctx.levels.E8,
      spec: v.spec,
      targetSkills: v.targets,
      reason: v.reason,
      promptVersion: drillGenerator.VERSION,
      model: raw.model,
      createdAt: now + i,
    }))
    await getDb().generatedExercises.bulkPut(saved)
    return { saved, rejected }
  },

  /** Exercises not yet practised, oldest first. */
  async pending(): Promise<GeneratedExercise[]> {
    const rows = await getDb().generatedExercises.orderBy('createdAt').toArray()
    return rows.filter((r) => !r.usedAt && r.module !== 'guitar')
  },

  async counts(): Promise<{ pending: number; used: number }> {
    const rows = (await getDb().generatedExercises.toArray()).filter((r) => r.module !== 'guitar')
    const pending = rows.filter((r) => !r.usedAt).length
    return { pending, used: rows.length - pending }
  },

  async markUsed(id: string): Promise<void> {
    const db = getDb()
    const row = await db.generatedExercises.get(id)
    if (row && !row.usedAt) await db.generatedExercises.put({ ...row, usedAt: Date.now() })
  },

  async discardPending(): Promise<void> {
    const db = getDb()
    const ids = (await this.pending()).map((r) => r.id)
    await db.generatedExercises.bulkDelete(ids)
  },
}

/** Build the drill question for a stored exercise. Grading is the normal local grader. */
export function questionFromExercise(ex: GeneratedExercise, seed = randomSeed()): DrillQuestion {
  const rng = createRng(seed)
  const tonic = rng.pick(COMFORTABLE_TONICS)
  if (ex.spec.kind === 'guitar') throw new Error('guitar exercises are not drill questions')
  const base =
    ex.spec.kind === 'progression'
      ? buildProgressionQuestion(ex.level, seed, tonic, ex.spec.mode, ex.spec.romans as RomanId[])
      : buildDictationQuestion(
          ex.level,
          seed,
          tonic,
          ex.spec.notes.map((n) => ({ midi: tonic + n.semitones, beats: n.beats })),
          ex.spec.notes.some((n) => ![-1, 0, 2, 4, 5, 7, 9, 11, 12, 14].includes(n.semitones)),
        )
  return { ...base, id: `ai-${ex.id}` }
}
