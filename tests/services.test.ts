import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { appendObservation, computeMastery, decideLevel, masteryBand } from '@/services/masteryMath'
import {
  advanceStreak,
  localDateKey,
  previousDateKey,
  rankFor,
  rankProgress,
  streakAlive,
  xpForAnswer,
} from '@/services/progressRules'
import { buildPlan } from '@/services/dailyPlanService'
import { DrillService } from '@/services/drillService'
import { MasteryService } from '@/services/masteryService'
import { ModuleProgressService } from '@/services/moduleProgressService'
import { ProfileService } from '@/services/profileService'
import { PLACEMENT_SECTIONS, advanceLadder, initialLadder, summarisePlacement } from '@/services/placementService'
import { generateQuestion } from '@/drills/generators'
import type { ModuleProgress, SkillMastery } from '@/entities/types'

let counter = 0
beforeEach(() => {
  setDbForTests(new GrooveLabDB(`test-${Date.now()}-${counter++}`))
})

describe('masteryMath', () => {
  it('weights recent observations more', () => {
    const old = [
      { credit: 1, weight: 1, at: 1 },
      { credit: 1, weight: 1, at: 2 },
      { credit: 0, weight: 1, at: 3 },
    ]
    const recent = [
      { credit: 0, weight: 1, at: 1 },
      { credit: 1, weight: 1, at: 2 },
      { credit: 1, weight: 1, at: 3 },
    ]
    expect(computeMastery(recent)).toBeGreaterThan(computeMastery(old))
    expect(computeMastery([])).toBe(0)
  })
  it('caps observations', () => {
    let list: Array<{ credit: number; weight: number; at: number }> = []
    for (let i = 0; i < 60; i++) list = appendObservation(list, { credit: 1, weight: 1, at: i })
    expect(list.length).toBe(40)
  })
  it('level decisions need a full window to go up and fewer to come down', () => {
    const good = Array.from({ length: 10 }, () => ({ correct: true, credit: 1 }))
    expect(decideLevel(good, 1, 6).action).toBe('up')
    expect(decideLevel(good.slice(0, 8), 1, 6).action).toBe('stay')
    expect(decideLevel(good, 6, 6).action).toBe('stay')
    const bad = Array.from({ length: 6 }, () => ({ correct: false, credit: 0 }))
    expect(decideLevel(bad, 3, 6).action).toBe('down')
    expect(decideLevel(bad, 1, 6).action).toBe('stay')
  })
  it('bands', () => {
    expect(masteryBand(0, 0)).toBe('new')
    expect(masteryBand(0.95, 10)).toBe('mastered')
    expect(masteryBand(0.95, 3)).toBe('solid')
    expect(masteryBand(0.4, 3)).toBe('learning')
  })
})

describe('progressRules', () => {
  it('ranks and progress', () => {
    expect(rankFor(0).name).toBe('练习室')
    expect(rankFor(400).index).toBe(1)
    expect(rankProgress(200)).toBeCloseTo(0.5)
    expect(rankProgress(999999)).toBe(1)
  })
  it('xp per answer', () => {
    expect(xpForAnswer(true, 1)).toBe(10)
    expect(xpForAnswer(false, 0.6)).toBe(4)
    expect(xpForAnswer(false, 0)).toBe(1)
  })
  it('streaks advance on consecutive days only', () => {
    const d1 = '2026-10-07'
    const s1 = advanceStreak({ current: 0, best: 0, lastDate: null }, d1)
    expect(s1.current).toBe(1)
    expect(advanceStreak(s1, d1)).toBe(s1)
    const s2 = advanceStreak(s1, '2026-10-08')
    expect(s2.current).toBe(2)
    const s3 = advanceStreak(s2, '2026-10-10')
    expect(s3.current).toBe(1)
    expect(s3.best).toBe(2)
    expect(streakAlive(s2, '2026-10-09')).toBe(true)
    expect(streakAlive(s2, '2026-10-10')).toBe(false)
  })
  it('date keys', () => {
    expect(previousDateKey('2026-03-01')).toBe('2026-02-28')
    expect(localDateKey(new Date(2026, 0, 5))).toBe('2026-01-05')
  })
})

describe('buildPlan', () => {
  const progress = (id: ModuleProgress['moduleId'], attempts: number, level = 1): ModuleProgress => ({
    moduleId: id,
    level,
    unlockedLevel: level,
    recentAtLevel: [],
    totalAttempts: attempts,
    totalCorrect: attempts,
    updatedAt: 0,
  })
  it('puts modules with weak skills first', () => {
    const weak: SkillMastery[] = [
      { skillId: 'interval:m6', module: 'E2', observations: [], mastery: 0.3, attempts: 5, lastAt: 0 },
    ]
    const plan = buildPlan([progress('E1', 50), progress('E2', 50, 4), progress('E3', 0), progress('R1', 3)], weak, '2026-10-07')
    expect(plan.items[0]!.module).toBe('E2')
    expect(plan.items[0]!.level).toBe(4)
    expect(plan.items[0]!.focusSkills).toEqual(['interval:m6'])
    expect(plan.items.filter((i) => i.module.startsWith('R'))).toHaveLength(1)
    for (const i of plan.items) expect(i.questions).toBeGreaterThanOrEqual(4)
  })
})

describe('placement ladder', () => {
  const def = PLACEMENT_SECTIONS[0]!
  it('climbs after two correct and stops after two wrong', () => {
    let s = initialLadder()
    s = advanceLadder(s, true, def)
    s = advanceLadder(s, true, def)
    expect(s.level).toBe(2)
    expect(s.reachedLevel).toBe(1)
    s = advanceLadder(s, false, def)
    s = advanceLadder(s, false, def)
    expect(s.finished).toBe(true)
  })
  it('summarises into starting levels and a stage', () => {
    const out = summarisePlacement([
      { id: 'T1', title: '', module: 'E1', reachedLevel: 4, attempts: 6, correct: 5, skipped: false },
      { id: 'T2', title: '', module: 'R1', reachedLevel: 1, attempts: 1, correct: 1, skipped: false },
      { id: 'T3', title: '', module: 'E2', reachedLevel: 3, attempts: 8, correct: 6, skipped: false },
      { id: 'T4', title: '', module: 'E5', reachedLevel: 2, attempts: 6, correct: 4, skipped: false },
      { id: 'T5', title: '', module: 'E3', reachedLevel: 1, attempts: 5, correct: 2, skipped: false },
    ])
    expect(out.startingLevels.E1).toBe(4)
    expect(out.startingLevels.R1).toBe(2)
    expect(out.recommendedStage).toBe(2)
    expect(out.strengths).toContain('音程听辨')
    expect(out.gaps).toContain('级数感')
  })
})

describe('DrillService (fake-indexeddb)', () => {
  it('records attempts, mastery, progress and xp', async () => {
    const session = await DrillService.startSession('free', ['E2'])
    const q = generateQuestion('E2', 1, { seed: 42 })
    if (q.kind !== 'interval') throw new Error('kind')
    const res = await DrillService.submit(session.id, q, { kind: 'choice', value: q.answer }, 1200)
    expect(res.grade.correct).toBe(true)
    expect(res.xp).toBe(10)
    const mastery = await MasteryService.byModule('E2')
    expect(mastery.find((m) => m.skillId === `interval:${q.answer}`)?.attempts).toBe(1)
    const profile = await ProfileService.ensure()
    expect(profile.xp).toBe(10)
    const progress = await ModuleProgressService.ensure('E2')
    expect(progress.totalAttempts).toBe(1)
    const s = await DrillService.session(session.id)
    expect(s?.questions).toBe(1)
    expect(s?.correct).toBe(1)
  })

  it('levels up after ten correct answers at a level', async () => {
    const session = await DrillService.startSession('free', ['E1'])
    let last: Awaited<ReturnType<typeof DrillService.submit>> | null = null
    for (let i = 0; i < 10; i++) {
      const q = await DrillService.nextQuestion('E1')
      if (q.kind !== 'pitch_compare') throw new Error('kind')
      last = await DrillService.submit(session.id, q, { kind: 'choice', value: q.answer }, 500)
    }
    expect(last!.level.after).toBe(2)
    expect(last!.xp).toBe(50)
    const progress = await ModuleProgressService.ensure('E1')
    expect(progress.unlockedLevel).toBe(2)
  })

  it('records confusion pairs for wrong choices', async () => {
    const session = await DrillService.startSession('free', ['E5'])
    const q = generateQuestion('E5', 1, { seed: 8 })
    if (q.kind !== 'chord') throw new Error('kind')
    const wrong = q.options.find((o) => o !== q.answer)!
    await DrillService.submit(session.id, q, { kind: 'choice', value: wrong }, 900)
    const conf = await DrillService.confusions('E5')
    expect(conf).toHaveLength(1)
    expect(conf[0]!.expected).toBe(q.answer)
    expect(conf[0]!.given).toBe(wrong)
  })
})
