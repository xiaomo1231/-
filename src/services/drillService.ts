import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import { logger } from '@/infrastructure/logger/logger'
import { generateQuestion, type GenerateOptions } from '@/drills/generators'
import { gradeQuestion } from '@/drills/grading'
import { moduleInfo, type DrillQuestion, type DrillResponse, type GradeResult, type ModuleId } from '@/drills/types'
import type { DrillAttempt, DrillSession, SessionKind } from '@/entities/types'
import { MasteryService } from './masteryService'
import { ReviewService } from './reviewService'
import { ModuleProgressService } from './moduleProgressService'
import { ProfileService } from './profileService'
import { xpForAnswer, XP_LEVEL_UP_BONUS } from './progressRules'
import type { LevelDecision } from './masteryMath'

export interface SubmitResult {
  grade: GradeResult
  attempt: DrillAttempt
  xp: number
  rankedUp: boolean
  level: { before: number; after: number; decision: LevelDecision }
}

/**
 * Orchestrates one practice session: generates questions at the module's
 * current level (favouring weak skills), grades answers locally, and writes
 * attempt / mastery / progress / confusion / XP in that order. The grade is
 * computed before any write so a storage failure never loses the feedback.
 */
export const DrillService = {
  async startSession(kind: SessionKind, modules: ModuleId[]): Promise<DrillSession> {
    const session: DrillSession = {
      id: uuid(),
      kind,
      modules,
      startedAt: Date.now(),
      questions: 0,
      correct: 0,
      creditSum: 0,
      xpEarned: 0,
      bestStreak: 0,
    }
    await getDb().drillSessions.put(session)
    return session
  },

  async endSession(sessionId: string): Promise<DrillSession | undefined> {
    const db = getDb()
    const s = await db.drillSessions.get(sessionId)
    if (!s || s.endedAt) return s
    const next = { ...s, endedAt: Date.now() }
    await db.drillSessions.put(next)
    return next
  },

  /**
   * Next question for a module. Uses the stored level unless `levelOverride`
   * is given (daily plan items pin their level). Weak skills get extra weight.
   */
  async nextQuestion(
    module: ModuleId,
    opts: { levelOverride?: number; avoidAnswer?: string; focusSkills?: string[] } = {},
  ): Promise<DrillQuestion> {
    const [progress, profile] = await Promise.all([ModuleProgressService.ensure(module), ProfileService.ensure()])
    const level = opts.levelOverride ?? progress.level
    let focus = opts.focusSkills
    if (!focus) {
      const [weak, due] = await Promise.all([MasteryService.weakest(module, 4), ReviewService.due()])
      focus = Array.from(new Set([...weak.map((w) => w.skillId), ...due.filter((d) => d.module === module).map((d) => d.skillId)]))
    }
    const instrument = module === 'I2' ? profile.secondInstrument : module === 'I1' ? profile.instrument : undefined
    const genOpts: GenerateOptions = {
      ...(focus.length ? { focusSkills: focus } : {}),
      ...(opts.avoidAnswer ? { avoidAnswer: opts.avoidAnswer } : {}),
      ...(profile.vocalRange ? { vocalRange: profile.vocalRange } : {}),
      octaveEquivalence: profile.octaveEquivalence,
      ...(instrument ? { instrument } : {}),
    }
    return generateQuestion(module, level, genOpts)
  },

  async submit(
    sessionId: string,
    question: DrillQuestion,
    response: DrillResponse,
    responseMs: number,
    opts: { observationWeight?: number; countsTowardLevel?: boolean } = {},
  ): Promise<SubmitResult> {
    const grade = gradeQuestion(question, response)
    const db = getDb()
    const now = Date.now()

    const attempt: DrillAttempt = {
      id: uuid(),
      sessionId,
      module: question.module,
      level: question.level,
      seed: question.seed,
      skillIds: question.skillIds,
      correct: grade.correct,
      credit: grade.credit,
      expectedLabel: grade.expectedLabel,
      givenLabel: grade.givenLabel,
      ...(grade.confusedWith ? { confusedWith: grade.confusedWith } : {}),
      ...(grade.timing ? { timingMs: grade.timing.meanAbsDeviationMs } : {}),
      responseMs: Math.max(0, Math.round(responseMs)),
      createdAt: now,
    }

    // Skill credits: per-skill when provided, otherwise the overall credit.
    const skillCredits: Record<string, number> = grade.skillCredits ?? Object.fromEntries(question.skillIds.map((s) => [s, grade.credit]))

    try {
      await db.drillAttempts.put(attempt)
      await MasteryService.record(skillCredits, opts.observationWeight ?? 1, now, question.module)
      if (response.kind !== 'skip' && (opts.observationWeight ?? 1) >= 1) {
        await ReviewService.record(skillCredits, question.module, now, responseMs, moduleInfo(question.module).secondsPerQuestion * 1000)
      }
      if (grade.confusedWith && response.kind !== 'skip') {
        await recordConfusion(question, grade)
      }
      const session = await db.drillSessions.get(sessionId)
      if (session) {
        await db.drillSessions.put({
          ...session,
          questions: session.questions + 1,
          correct: session.correct + (grade.correct ? 1 : 0),
          creditSum: session.creditSum + grade.credit,
        })
      }
    } catch (err) {
      logger.error('Failed to persist drill attempt', { error: err instanceof Error ? err.message : String(err) })
    }

    const before = (await ModuleProgressService.ensure(question.module)).level
    let after = before
    let decision: LevelDecision = { action: 'stay', reason: '', accuracy: null }
    if (opts.countsTowardLevel !== false && response.kind !== 'skip') {
      const res = await ModuleProgressService.recordOutcome(question.module, { correct: grade.correct, credit: grade.credit }, question.level)
      after = res.progress.level
      decision = res.decision
    }

    let xp = response.kind === 'skip' ? 0 : xpForAnswer(grade.correct, grade.credit)
    if (after > before) xp += XP_LEVEL_UP_BONUS
    let rankedUp = false
    if (xp > 0) {
      const r = await ProfileService.addXp(xp)
      rankedUp = r.rankedUp
      const session = await db.drillSessions.get(sessionId)
      if (session) await db.drillSessions.put({ ...session, xpEarned: session.xpEarned + xp })
    }

    return { grade, attempt, xp, rankedUp, level: { before, after, decision } }
  },

  async recentAttempts(module: ModuleId | null, limit = 50): Promise<DrillAttempt[]> {
    const db = getDb()
    if (module) {
      return db.drillAttempts.where('module').equals(module).reverse().sortBy('createdAt').then((r) => r.slice(0, limit))
    }
    return db.drillAttempts.orderBy('createdAt').reverse().limit(limit).toArray()
  },

  async session(id: string): Promise<DrillSession | undefined> {
    return getDb().drillSessions.get(id)
  },

  async sessionCount(): Promise<number> {
    return getDb().drillSessions.count()
  },

  /** Confusion pairs for a module, most frequent first. */
  async confusions(module: ModuleId | null, limit = 6) {
    const db = getDb()
    const rows = module ? await db.confusions.where('module').equals(module).toArray() : await db.confusions.toArray()
    return rows.sort((a, b) => b.count - a.count).slice(0, limit)
  },
}

async function recordConfusion(question: DrillQuestion, grade: GradeResult): Promise<void> {
  const expected = grade.confusedExpected
  const given = grade.confusedWith
  if (!expected || !given || expected === given) return
  const db = getDb()
  const id = `${question.module}|${expected}|${given}`
  const existing = await db.confusions.get(id)
  await db.confusions.put({
    id,
    module: question.module,
    expected,
    given,
    count: (existing?.count ?? 0) + 1,
    lastAt: Date.now(),
  })
}

