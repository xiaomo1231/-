import type { PitchMetrics, PitchProblem, ProgramMinutes } from './plan'

/** 这一次正在练的进度（中途离开再回来接着练）。 */
export interface PitchSessionProgress {
  /** 本地日期 YYYY-MM-DD。 */
  date: string
  /** 第几次（从 1 开始）。 */
  session: number
  /** 已完成的练习块 id。 */
  done: string[]
  startedAt: number
  /** 这一次累计的练习秒数。 */
  seconds: number
  /** 复测和小测量到的指标（练完时写进记录）。 */
  metrics: Partial<PitchMetrics>
}

/** 30 天音准矫正（只有一行，id 固定为 'current'）。 */
export interface PitchProgram {
  id: 'current'
  startedAt: number
  minutes: ProgramMinutes
  /** 已经练完的次数。 */
  sessionsDone: number
  lastSessionDate?: string
  diagnosis?: { at: number; metrics: PitchMetrics; problem: PitchProblem }
  current?: PitchSessionProgress
  finishedAt?: number
}

/** 一次诊断 / 复测 / 日常练习的记录，用来画进步曲线。 */
export interface PitchLog {
  id: string
  at: number
  date: string
  /** 第几次（诊断记为 0）。 */
  session: number
  kind: 'diagnosis' | 'retest' | 'session'
  seconds: number
  metrics: PitchMetrics
}
