import { getDb } from '@/infrastructure/db/database'
import { uuid } from '@/infrastructure/crypto/crypto'
import {
  EMPTY_METRICS,
  PROGRAM_SESSIONS,
  RETEST_SESSIONS,
  buildSession,
  classifyProblem,
  type PitchMetrics,
  type ProgramMinutes,
  type SessionBlock,
} from '@/pitchcamp/plan'
import type { PitchLog, PitchProgram, PitchSessionProgress } from '@/pitchcamp/types'
import { ProfileService } from './profileService'
import { localDateKey, XP_DAILY_PLAN_BONUS } from './progressRules'

const ID = 'current'

/** 只填了一部分的指标补成完整的一组。 */
const full = (m: Partial<PitchMetrics>): PitchMetrics => ({ ...EMPTY_METRICS, ...m })

/**
 * 30 天音准矫正的存取：开始、诊断、每次练习的进度（可中途离开）、练完记录、
 * 进步曲线。计划进行中时，训练营的「每日训练」由它代替。
 */
export const PitchProgramService = {
  async get(): Promise<PitchProgram | undefined> {
    return getDb().pitchProgram.get(ID)
  },

  /** 进行中（开始了、还没练完 30 次）。 */
  async active(): Promise<PitchProgram | undefined> {
    const p = await this.get()
    return p && !p.finishedAt ? p : undefined
  },

  async start(minutes: ProgramMinutes): Promise<PitchProgram> {
    const program: PitchProgram = { id: ID, startedAt: Date.now(), minutes, sessionsDone: 0 }
    await getDb().pitchProgram.put(program)
    return program
  },

  async setMinutes(minutes: ProgramMinutes): Promise<PitchProgram> {
    const p = await this.mustGet()
    const next = { ...p, minutes }
    await getDb().pitchProgram.put(next)
    return next
  },

  /** 放弃当前计划（记录保留，可以重新开始）。 */
  async stop(): Promise<void> {
    await getDb().pitchProgram.delete(ID)
  },

  /** 诊断做完：存指标、分出问题类型、记一条日志。 */
  async saveDiagnosis(metrics: PitchMetrics, seconds: number): Promise<PitchProgram> {
    const p = await this.mustGet()
    const problem = classifyProblem(metrics)
    const now = Date.now()
    const next: PitchProgram = { ...p, diagnosis: { at: now, metrics, problem } }
    await getDb().pitchProgram.put(next)
    await getDb().pitchLogs.put({ id: uuid(), at: now, date: localDateKey(), session: 0, kind: 'diagnosis', seconds, metrics })
    return next
  },

  async logs(): Promise<PitchLog[]> {
    return getDb().pitchLogs.orderBy('at').toArray()
  },

  /** 最近一次诊断或复测的指标。 */
  async latestTest(): Promise<PitchMetrics> {
    const logs = await this.logs()
    const tests = logs.filter((l) => l.kind !== 'session')
    return tests[tests.length - 1]?.metrics ?? EMPTY_METRICS
  },

  /** 今天这一次的练习块（第几次 = 已练次数 + 1）。 */
  async sessionPlan(): Promise<{ program: PitchProgram; session: number; blocks: SessionBlock[] }> {
    const program = await this.mustGet()
    if (!program.diagnosis) throw new Error('还没做诊断')
    const session = Math.min(PROGRAM_SESSIONS, program.sessionsDone + 1)
    const logs = await this.logs()
    const recentMatch = logs
      .filter((l) => l.kind === 'session' && l.metrics.matchCents !== null)
      .map((l) => l.metrics.matchCents!)
      .slice(-3)
    const blocks = buildSession({
      session,
      minutes: program.minutes,
      problem: program.diagnosis.problem,
      latest: await this.latestTest(),
      recentMatch,
    })
    return { program, session, blocks }
  },

  /** 这一次的进度；换了一天或已经练完就开新的。 */
  async progress(): Promise<PitchSessionProgress> {
    const p = await this.mustGet()
    const session = p.sessionsDone + 1
    const cur = p.current
    if (cur && cur.session === session) return cur
    const fresh: PitchSessionProgress = { date: localDateKey(), session, done: [], startedAt: Date.now(), seconds: 0, metrics: {} }
    await getDb().pitchProgram.put({ ...p, current: fresh })
    return fresh
  },

  /** 一个练习块做完：记下来，并合并它量到的指标。 */
  async completeBlock(blockId: string, seconds: number, metrics: Partial<PitchMetrics> = {}): Promise<PitchSessionProgress> {
    const p = await this.mustGet()
    const cur = await this.progress()
    const next: PitchSessionProgress = {
      ...cur,
      done: cur.done.includes(blockId) ? cur.done : [...cur.done, blockId],
      seconds: cur.seconds + Math.max(0, Math.round(seconds)),
      metrics: { ...cur.metrics, ...metrics },
    }
    await getDb().pitchProgram.put({ ...p, current: next })
    return next
  },

  /**
   * 这一次全部做完：写日志（复测日记为复测），次数 +1，连续天数和经验值照每日训练算。
   * 第 30 次做完计划结束。
   */
  async finishSession(): Promise<{ program: PitchProgram; finished: boolean; bonusXp: number }> {
    const p = await this.mustGet()
    const cur = await this.progress()
    const date = localDateKey()
    const now = Date.now()
    const isTest = RETEST_SESSIONS.includes(cur.session)
    await getDb().pitchLogs.put({
      id: uuid(),
      at: now,
      date,
      session: cur.session,
      kind: isTest ? 'retest' : 'session',
      seconds: cur.seconds,
      metrics: full(cur.metrics),
    })
    const sessionsDone = cur.session
    const finished = sessionsDone >= PROGRAM_SESSIONS
    const next: PitchProgram = {
      ...p,
      sessionsDone,
      lastSessionDate: date,
      ...(finished ? { finishedAt: now } : {}),
    }
    delete next.current
    await getDb().pitchProgram.put(next)
    // 一天第一次练完才算打卡和奖励。
    let bonusXp = 0
    if (p.lastSessionDate !== date) {
      bonusXp = XP_DAILY_PLAN_BONUS
      await ProfileService.addXp(bonusXp)
      await ProfileService.markDailyComplete(date)
    }
    return { program: next, finished, bonusXp }
  },

  async mustGet(): Promise<PitchProgram> {
    const p = await this.get()
    if (!p) throw new Error('音准矫正计划还没开始')
    return p
  },
}
