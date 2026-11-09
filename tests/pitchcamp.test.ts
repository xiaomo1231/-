import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { ProfileService } from '@/services/profileService'
import { PitchProgramService } from '@/services/pitchProgramService'
import {
  EMPTY_METRICS,
  PROGRAM_SESSIONS,
  RETEST_SESSIONS,
  buildSession,
  classifyProblem,
  feedbackFor,
  judgeCorrect,
  actualJudge,
  newStaircase,
  slipping,
  staircaseThreshold,
  stepStaircase,
  weakestBlock,
  weekOf,
  type PitchMetrics,
  type ProgramMinutes,
} from '@/pitchcamp/plan'
import { trailingLock } from '@/pitchcamp/lock'
import { midiToFrequency } from '@/music/pitch'

const metrics = (m: Partial<PitchMetrics>): PitchMetrics => ({ ...EMPTY_METRICS, ...m })

describe('音准矫正：计划编排', () => {
  it('分周、撤反馈', () => {
    expect([1, 7, 8, 14, 15, 22, 28, 29, 30].map(weekOf)).toEqual([1, 1, 2, 2, 3, 4, 4, 4, 4])
    expect([1, 2, 3, 4].map(feedbackFor)).toEqual(['live', 'after', 'score', 'score'])
  })

  it('诊断分类：先看耳朵，再看嗓子', () => {
    expect(classifyProblem(metrics({ discCents: 60, matchCents: 80 }))).toBe('hearing')
    expect(classifyProblem(metrics({ discCents: 20, matchCents: 45 }))).toBe('control')
    expect(classifyProblem(metrics({ discCents: 20, matchCents: 15, hitRate: 0.5 }))).toBe('control')
    expect(classifyProblem(metrics({ discCents: 15, matchCents: 15, hitRate: 0.9, driftCents: 20 }))).toBe('melody')
  })

  it('每天的总时长接近选的分钟数，复测日带复测、不带小测', () => {
    for (const minutes of [15, 20, 30] as ProgramMinutes[])
      for (let session = 1; session <= PROGRAM_SESSIONS; session++) {
        const blocks = buildSession({ session, minutes, problem: 'control', latest: metrics({ matchCents: 30 }), recentMatch: [] })
        const total = blocks.reduce((s, b) => s + b.minutes, 0)
        expect(total).toBeGreaterThanOrEqual(minutes - 1)
        expect(total).toBeLessThanOrEqual(Math.max(minutes, 2 + 8 + 5) + 1)
        expect(blocks[0]!.kind).toBe('warmup')
        expect(new Set(blocks.map((b) => b.id)).size).toBe(blocks.length)
        const isTest = RETEST_SESSIONS.includes(session)
        expect(blocks.some((b) => b.kind === 'test')).toBe(isTest)
        expect(blocks.some((b) => b.kind === 'quick')).toBe(!isTest)
      }
  })

  it('各周的主练内容', () => {
    const kinds = (session: number) =>
      buildSession({ session, minutes: 20, problem: 'melody', latest: EMPTY_METRICS, recentMatch: [] }).map((b) => b.kind)
    expect(kinds(1)).toEqual(expect.arrayContaining(['discrimination', 'match', 'sustain', 'siren']))
    expect(kinds(9)).toEqual(expect.arrayContaining(['selfcheck', 'drone', 'interval', 'scale']))
    expect(kinds(16)).toEqual(expect.arrayContaining(['selfcheck', 'echo3', 'sight']))
    expect(kinds(23)).toEqual(expect.arrayContaining(['song', 'echo3']))
  })

  it('听不准的人听辨占的时间更多', () => {
    const listen = (problem: 'hearing' | 'melody') =>
      buildSession({ session: 3, minutes: 20, problem, latest: EMPTY_METRICS, recentMatch: [] })
        .filter((b) => b.kind === 'discrimination' || b.kind === 'selfcheck')
        .reduce((s, b) => s + b.minutes, 0)
    expect(listen('hearing')).toBeGreaterThan(listen('melody'))
  })

  it('复习补最弱的一项；单音连着两次退步就先补单音', () => {
    expect(weakestBlock(metrics({ discCents: 10, matchCents: 15, intervalHit: 0.2, melodyHit: 0.8 }))).toBe('interval')
    expect(slipping([20, 25, 30])).toBe(true)
    expect(slipping([30, 25, 20])).toBe(false)
    expect(slipping([20, 25])).toBe(false)
    // 第 1 周已有单音：退步时并进去，不重复出现。
    const blocks = buildSession({ session: 3, minutes: 20, problem: 'melody', latest: metrics({ intervalHit: 0.1 }), recentMatch: [20, 26, 31] })
    expect(blocks.filter((b) => b.kind === 'match')).toHaveLength(1)
    expect(blocks.find((b) => b.kind === 'match')!.why).toContain('偏差变大')
    // 没退步：复习今天还没练到的最弱一项（音程）。
    const plain = buildSession({ session: 3, minutes: 20, problem: 'melody', latest: metrics({ intervalHit: 0.1 }), recentMatch: [] })
    expect(plain[plain.length - 2]!.kind).toBe('interval')
  })

  it('同一种练习一天只出现一次，小测 3 题', () => {
    for (let session = 1; session <= PROGRAM_SESSIONS; session++) {
      const blocks = buildSession({ session, minutes: 20, problem: 'control', latest: metrics({ matchCents: 50 }), recentMatch: [] })
      const kinds = blocks.map((b) => b.kind)
      expect(new Set(kinds).size).toBe(kinds.length)
      const quick = blocks.find((b) => b.kind === 'quick')
      if (quick) expect(quick.count).toBe(3)
    }
  })
})

describe('分辨力阶梯', () => {
  it('一直答对音差缩到最小，答错放大', () => {
    let s = newStaircase(100)
    for (let i = 0; i < 30; i++) s = stepStaircase(s, true)
    expect(s.cents).toBe(5)
    s = stepStaircase(s, false)
    expect(s.cents).toBe(7)
  })

  it('在阈值附近来回时，估计值落在那附近', () => {
    // 模拟一个能分辨 20 音分以上的人。
    let s = newStaircase(100)
    for (let i = 0; i < 40; i++) s = stepStaircase(s, s.cents >= 20)
    const t = staircaseThreshold(s)
    expect(t).toBeGreaterThanOrEqual(12)
    expect(t).toBeLessThanOrEqual(30)
  })
})

describe('高了还是低了', () => {
  it('±20 音分以内算准，边界附近两种说法都算对', () => {
    expect(actualJudge(30)).toBe('high')
    expect(actualJudge(-10)).toBe('ok')
    expect(judgeCorrect('high', 40)).toBe(true)
    expect(judgeCorrect('low', 40)).toBe(false)
    expect(judgeCorrect('ok', 25)).toBe(true)
    expect(judgeCorrect('high', 25)).toBe(true)
    expect(judgeCorrect('high', 8)).toBe(false)
    expect(judgeCorrect('ok', 45)).toBe(false)
  })
})

describe('唱稳判定', () => {
  const frames = (cents: number[], step = 0.025) =>
    cents.map((c, i) => ({ t: i * step, hz: Number.isNaN(c) ? null : midiToFrequency(60) * 2 ** (c / 1200), clarity: 0.9, rms: 0.1, peak: 0.2 }))

  it('末尾连续落在容差内的时长', () => {
    const f = frames([200, 150, ...Array(30).fill(5)])
    const lock = trailingLock(f, 60, 25)
    expect(lock.seconds).toBeGreaterThan(0.7)
    expect(lock.cents).toBe(5)
  })

  it('偶尔一帧没测到不打断，偏离就打断', () => {
    expect(trailingLock(frames([...Array(10).fill(0), NaN, ...Array(10).fill(0)]), 60, 25).seconds).toBeGreaterThan(0.45)
    expect(trailingLock(frames([...Array(10).fill(0), 80, ...Array(4).fill(0)]), 60, 25).seconds).toBeLessThan(0.15)
  })
})

describe('PitchProgramService', () => {
  let n = 0
  beforeEach(async () => {
    setDbForTests(new GrooveLabDB(`pitch-${Date.now()}-${n++}`))
    await ProfileService.ensure()
  })

  it('开始 → 诊断 → 练完一次：次数 +1，写日志，算打卡', async () => {
    await PitchProgramService.start(20)
    const p = await PitchProgramService.saveDiagnosis(metrics({ discCents: 50, matchCents: 40 }), 300)
    expect(p.diagnosis?.problem).toBe('hearing')
    const { session, blocks } = await PitchProgramService.sessionPlan()
    expect(session).toBe(1)
    for (const b of blocks) await PitchProgramService.completeBlock(b.id, 60, b.kind === 'quick' ? { matchCents: 30, hitRate: 0.67 } : {})
    const r = await PitchProgramService.finishSession()
    expect(r.program.sessionsDone).toBe(1)
    expect(r.bonusXp).toBeGreaterThan(0)
    const logs = await PitchProgramService.logs()
    expect(logs.map((l) => l.kind)).toEqual(['diagnosis', 'session'])
    expect(logs[1]!.metrics.matchCents).toBe(30)
    expect(logs[1]!.seconds).toBe(blocks.length * 60)
    // 同一天再练一次：不再给打卡奖励。
    const again = await PitchProgramService.sessionPlan()
    expect(again.session).toBe(2)
    for (const b of again.blocks) await PitchProgramService.completeBlock(b.id, 10)
    expect((await PitchProgramService.finishSession()).bonusXp).toBe(0)
  })

  it('中途离开：做完的块记着；第 30 次做完计划结束', async () => {
    await PitchProgramService.start(15)
    await PitchProgramService.saveDiagnosis(metrics({ matchCents: 20 }), 100)
    const { blocks } = await PitchProgramService.sessionPlan()
    await PitchProgramService.completeBlock(blocks[0]!.id, 30)
    expect((await PitchProgramService.progress()).done).toEqual([blocks[0]!.id])
    const db = (await import('@/infrastructure/db/database')).getDb()
    const p = (await PitchProgramService.get())!
    await db.pitchProgram.put({ ...p, sessionsDone: PROGRAM_SESSIONS - 1 })
    await PitchProgramService.finishSession()
    expect((await PitchProgramService.get())?.finishedAt).toBeDefined()
    expect(await PitchProgramService.active()).toBeUndefined()
  })
})
