import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import { generateQuestion } from '@/drills/generators'
import { gradeQuestion } from '@/drills/grading'
import { moduleInfo, type DrillQuestion, type DrillResponse, type GradeResult, type ModuleId } from '@/drills/types'
import type { PlacementResult, PlacementSectionResult } from '@/entities/types'
import { MasteryService } from './masteryService'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { XP_PLACEMENT_BONUS } from './progressRules'

/**
 * The placement test is a short adaptive ladder per section: start at level 1,
 * two correct in a row → next level, two wrong in a row → stop. Observations
 * are recorded at low weight so six answers never look like mastery.
 */
export interface PlacementSectionDef {
  id: string
  title: string
  module: ModuleId
  maxQuestions: number
  /** Highest level the ladder may climb to during the test. */
  maxLevel: number
  intro: string
  /** Needs the microphone (skippable without penalty). */
  mic?: boolean
}

export const PLACEMENT_SECTIONS: readonly PlacementSectionDef[] = [
  { id: 'T1', title: '音高比较', module: 'E1', maxQuestions: 6, maxLevel: 5, intro: '先热身：两个音，谁高谁低。' },
  { id: 'T2', title: '跟拍', module: 'R1', maxQuestions: 1, maxLevel: 1, intro: '跟着节拍器用空格键打 8 拍。' },
  { id: 'T3', title: '识谱', module: 'N1', maxQuestions: 6, maxLevel: 4, intro: '看五线谱上的音，选出它的音名。没学过五线谱也没关系，直接跳过。' },
  { id: 'T4', title: '音程', module: 'E2', maxQuestions: 8, maxLevel: 5, intro: '两个音之间的距离叫什么。' },
  { id: 'T5', title: '和弦性质', module: 'E5', maxQuestions: 6, maxLevel: 4, intro: '明亮还是暗，几层音。' },
  { id: 'T6', title: '级数', module: 'E3', maxQuestions: 5, maxLevel: 3, intro: '先听和弦，再听一个音，它是第几级。' },
  { id: 'T7', title: '乐理知识', module: 'T1', maxQuestions: 6, maxLevel: 4, intro: '拍号、半音全音、调号这些基本规则。' },
  { id: 'T8', title: '音准', module: 'S1', maxQuestions: 3, maxLevel: 3, intro: '听一个音，用麦克风唱回来。需要允许浏览器使用麦克风；不方便唱可以跳过。', mic: true },
]

export const PLACEMENT_OBSERVATION_WEIGHT = 0.35

export interface LadderState {
  level: number
  streakCorrect: number
  streakWrong: number
  attempts: number
  correct: number
  /** Highest level at which the student answered correctly. */
  reachedLevel: number
  finished: boolean
}

export function initialLadder(): LadderState {
  return { level: 1, streakCorrect: 0, streakWrong: 0, attempts: 0, correct: 0, reachedLevel: 0, finished: false }
}

/** Pure ladder step. */
export function advanceLadder(s: LadderState, correct: boolean, def: PlacementSectionDef): LadderState {
  const attempts = s.attempts + 1
  const correctCount = s.correct + (correct ? 1 : 0)
  let level = s.level
  let streakCorrect = correct ? s.streakCorrect + 1 : 0
  let streakWrong = correct ? 0 : s.streakWrong + 1
  const reachedLevel = correct ? Math.max(s.reachedLevel, s.level) : s.reachedLevel
  let finished = attempts >= def.maxQuestions
  if (streakCorrect >= 2) {
    if (level < def.maxLevel) {
      level += 1
      streakCorrect = 0
    } else {
      finished = true
    }
  }
  if (streakWrong >= 2) {
    finished = true
    streakWrong = 0
  }
  return { level, streakCorrect, streakWrong, attempts, correct: correctCount, reachedLevel, finished }
}

export function placementQuestion(def: PlacementSectionDef, level: number, avoidAnswer?: string): DrillQuestion {
  return generateQuestion(def.module, level, avoidAnswer ? { avoidAnswer } : {})
}

export interface PlacementSummaryInput {
  sections: PlacementSectionResult[]
}

/** Map section outcomes to a starting stage, starting levels and a short report. */
export function summarisePlacement(sections: PlacementSectionResult[]): Pick<PlacementResult, 'recommendedStage' | 'startingLevels' | 'strengths' | 'gaps'> {
  const by = new Map(sections.map((s) => [s.module, s]))
  const lvl = (m: ModuleId): number => by.get(m)?.reachedLevel ?? 0
  const startingLevels: Partial<Record<ModuleId, number>> = {}
  for (const s of sections) {
    if (!s.module || s.skipped) continue
    // Start one level below the highest level passed, never below 1.
    startingLevels[s.module] = Math.max(1, Math.min(moduleInfo(s.module).maxLevel, s.reachedLevel))
  }
  // Rhythm: a passed tap-along section unlocks level 2 pacing.
  const r1 = by.get('R1')
  if (r1 && !r1.skipped) startingLevels.R1 = r1.correct > 0 ? 2 : 1

  // Staff reading only gates the stage when the student actually took that section.
  const n1 = by.get('N1')
  const readsStaff = !n1 || n1.skipped || n1.reachedLevel >= 2
  let recommendedStage = 0
  if (lvl('E1') >= 3 && lvl('E2') >= 2 && readsStaff) recommendedStage = 1
  if (recommendedStage === 1 && lvl('E2') >= 3 && lvl('E5') >= 2) recommendedStage = 2
  if (recommendedStage === 2 && lvl('E5') >= 3 && lvl('E3') >= 2) recommendedStage = 3

  const strengths: string[] = []
  const gaps: string[] = []
  const describe = (m: ModuleId, strong: number, label: string): void => {
    const s = by.get(m)
    if (!s || s.skipped) return
    if (s.reachedLevel >= strong) strengths.push(label)
    else gaps.push(label)
  }
  describe('E1', 3, '音高分辨')
  describe('E2', 3, '音程听辨')
  describe('E5', 2, '和弦性质')
  describe('E3', 2, '级数感')
  describe('N1', 2, '五线谱识谱')
  describe('T1', 2, '乐理知识')
  describe('S1', 2, '音准')
  if (r1 && !r1.skipped) (r1.correct > 0 ? strengths : gaps).push('节奏稳定')

  return { recommendedStage, startingLevels, strengths, gaps }
}

export const PlacementService = {
  /** Grade without touching module levels; records light-weight mastery. */
  async gradeAndRecord(question: DrillQuestion, response: DrillResponse): Promise<GradeResult> {
    const grade = gradeQuestion(question, response)
    if (response.kind !== 'skip') {
      const credits = grade.skillCredits ?? Object.fromEntries(question.skillIds.map((s) => [s, grade.credit]))
      await MasteryService.record(credits, PLACEMENT_OBSERVATION_WEIGHT)
    }
    return grade
  },

  async finalize(sections: PlacementSectionResult[], startedAt: number): Promise<PlacementResult> {
    const summary = summarisePlacement(sections)
    const result: PlacementResult = {
      id: uuid(),
      startedAt,
      finishedAt: Date.now(),
      sections,
      ...summary,
    }
    const db = getDb()
    await db.placements.put(result)
    for (const [module, level] of Object.entries(summary.startingLevels) as Array<[ModuleId, number]>) {
      await ModuleProgressService.setStartingLevel(module, level)
    }
    const profile = await ProfileService.ensure()
    await ProfileService.update({ placementDone: true, unlockedStage: Math.max(profile.unlockedStage, summary.recommendedStage) })
    await ProfileService.addXp(XP_PLACEMENT_BONUS)
    const hasBadge = await db.badges.get('placement')
    if (!hasBadge) await db.badges.put({ id: 'placement', earnedAt: Date.now() })
    return result
  },

  async latest(): Promise<PlacementResult | undefined> {
    return getDb().placements.orderBy('finishedAt').reverse().first()
  },
}
