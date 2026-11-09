/**
 * 音准矫正（30 天）：每天练什么、诊断怎么分类、分辨力阶梯和「高了还是低了」怎么判。
 * 纯函数，方便测试；存取在 services/pitchProgramService.ts，界面在 pages/PitchProgramPage.tsx。
 */

/** 练多少天算完成一个周期。 */
export const PROGRAM_SESSIONS = 30
/** 第几次练时做复测（第 1 次之前另有诊断）。 */
export const RETEST_SESSIONS: readonly number[] = [8, 15, 22, 30]
/** 复测大约占的分钟数。 */
export const TEST_MINUTES = 8

export type ProgramMinutes = 15 | 20 | 30
export const MINUTE_CHOICES: readonly ProgramMinutes[] = [15, 20, 30]

/** 唱的时候看不看得到音准表：第 1 周一直看，第 2 周唱完看，第 3–4 周只给结果。 */
export type FeedbackMode = 'live' | 'after' | 'score'

/** 诊断出的主要问题。 */
export type PitchProblem = 'hearing' | 'control' | 'melody'

export const PROBLEM_TEXT: Record<PitchProblem, { title: string; detail: string }> = {
  hearing: {
    title: '先要听准',
    detail: '两个很近的音，你还不太能分出谁高谁低。耳朵分不清，嗓子就没有目标。前两周会多练听辨。',
  },
  control: {
    title: '听得出，但嗓子还找不准',
    detail: '你能分辨音高，但唱出来常偏或者晃。会多练看着音准表唱长音、滑音找音，先让嗓子记住「准」的感觉。',
  },
  melody: {
    title: '单音不错，连起来容易跑',
    detail: '单个音唱得比较准，问题出在音程和旋律上。会多练持续音上唱级数、音程和短旋律。',
  },
}

/** 一次测试量出来的几项指标；没测到的是 null。 */
export interface PitchMetrics {
  /** 能稳定分辨的最小音差（音分），越小越好。 */
  discCents: number | null
  /** 跟唱单音的平均偏差（绝对值，音分），越小越好。 */
  matchCents: number | null
  /** 跟唱单音落在 ±50 音分以内的比例（0–1）。 */
  hitRate: number | null
  /** 唱长音时的晃动（音分），越小越好。 */
  driftCents: number | null
  /** 音程唱对的比例（0–1）。 */
  intervalHit: number | null
  /** 短旋律唱对的音的比例（0–1）。 */
  melodyHit: number | null
}

export const EMPTY_METRICS: PitchMetrics = {
  discCents: null,
  matchCents: null,
  hitRate: null,
  driftCents: null,
  intervalHit: null,
  melodyHit: null,
}

/** 诊断分类：先看耳朵，再看嗓子，都还行就是旋律问题。 */
export function classifyProblem(m: PitchMetrics): PitchProblem {
  if (m.discCents !== null && m.discCents > 40) return 'hearing'
  const control =
    (m.matchCents !== null && m.matchCents > 35) ||
    (m.hitRate !== null && m.hitRate < 0.6) ||
    (m.driftCents !== null && m.driftCents > 45)
  if (control) return 'control'
  return 'melody'
}

/** 第几次练属于第几周（1–4；第 29、30 次也算第 4 周）。 */
export function weekOf(session: number): 1 | 2 | 3 | 4 {
  return Math.min(4, Math.max(1, Math.ceil(session / 7))) as 1 | 2 | 3 | 4
}

export function feedbackFor(week: number): FeedbackMode {
  if (week <= 1) return 'live'
  if (week === 2) return 'after'
  return 'score'
}

export const FEEDBACK_TEXT: Record<FeedbackMode, string> = {
  live: '这周唱的时候一直看得到音准表：先用眼睛把音唱准。',
  after: '这周唱的时候不看表，唱完再看偏了多少：开始靠耳朵。',
  score: '这周只告诉你唱对没有，不看表：练脑子里的音高。',
}

export type BlockKind =
  | 'warmup'
  | 'test'
  | 'discrimination'
  | 'selfcheck'
  | 'match'
  | 'sustain'
  | 'siren'
  | 'drone'
  | 'interval'
  | 'scale'
  | 'echo3'
  | 'sight'
  | 'song'
  | 'quick'

export interface SessionBlock {
  /** 在这一次里唯一（用来记哪些做完了）。 */
  id: string
  kind: BlockKind
  title: string
  /** 为什么练这个（显示给学生）。 */
  why: string
  /** 题数 / 次数（歌曲和热身按分钟）。 */
  count: number
  /** 唱歌题用的级别。 */
  level: number
  /** 预计分钟数。 */
  minutes: number
}

/** 每种练习一题大约多少秒（用来把分钟换成题数）。 */
export const SECONDS_PER: Record<BlockKind, number> = {
  warmup: 120,
  test: TEST_MINUTES * 60,
  discrimination: 6,
  selfcheck: 24,
  match: 15,
  sustain: 18,
  siren: 18,
  drone: 40,
  interval: 15,
  scale: 30,
  echo3: 80,
  sight: 30,
  song: 60,
  quick: 20,
}

const MIN_COUNT: Record<BlockKind, number> = {
  warmup: 1,
  test: 1,
  discrimination: 10,
  selfcheck: 3,
  match: 3,
  sustain: 2,
  siren: 2,
  drone: 2,
  interval: 3,
  scale: 2,
  echo3: 1,
  sight: 2,
  song: 3,
  quick: 3,
}

export const BLOCK_TITLE: Record<BlockKind, string> = {
  warmup: '热身',
  test: '复测',
  discrimination: '细分辨音',
  selfcheck: '高了还是低了',
  match: '单音跟唱',
  sustain: '看着唱长音',
  siren: '滑音找音',
  drone: '持续音上唱级数',
  interval: '唱音程',
  scale: '唱音阶',
  echo3: '短旋律三步法',
  sight: '视唱',
  song: '用到歌里',
  quick: '今天的小测',
}

const BLOCK_WHY: Record<BlockKind, string> = {
  warmup: '哼鸣、唇颤、滑音，让声带和气息先活动开。',
  test: '和第 1 天同一套题，看这一周进步了多少。',
  discrimination: '两个很近的音比谁高。音差会跟着你的水平自动变小。',
  selfcheck: '回放你刚唱的音，自己判断偏高、偏低还是准：学会听自己。',
  match: '听一个音，唱出同一个音。',
  sustain: '把一个音稳稳地唱几秒，不往下掉、不晃。',
  siren: '从低往上滑，滑到目标音停住：给「知道不对但找不到」的嗓子找方向。',
  drone: '一直响着主音，在上面唱 1、3、5 这些级数：有参照，偏了马上听得出来。',
  interval: '听一个音，唱出它上方的音程。',
  scale: '跟着节拍一拍一个音唱音阶。',
  echo3: '同一句旋律练三遍：跟着琴唱 → 听完再唱 → 只给第一个音自己唱。',
  sight: '看谱唱一小节旋律。',
  song: '去「跟唱」里逐句唱你选的歌，导唱声慢慢关小。',
  quick: '三个单音，记进进步曲线。',
}

/** 指标是不是退步了：最近两次小测都比再前一次差（偏差更大）。 */
export function slipping(recentMatch: readonly number[]): boolean {
  if (recentMatch.length < 3) return false
  const [a, b, c] = recentMatch.slice(-3) as [number, number, number]
  return b > a && c > a
}

/** 最需要补的那一项（按最近一次测试），对应的练习。 */
export function weakestBlock(m: PitchMetrics): BlockKind {
  return weaknessOrder(m)[0]!
}

/** 按最近一次测试从弱到强排的练习。 */
export function weaknessOrder(m: PitchMetrics): BlockKind[] {
  // 每项换成 0–1 的「差」分，越大越差。
  const scores: Array<[BlockKind, number]> = [
    ['discrimination', m.discCents === null ? 0 : Math.min(1, m.discCents / 60)],
    ['match', m.matchCents === null ? 0 : Math.min(1, m.matchCents / 60)],
    ['sustain', m.driftCents === null ? 0 : Math.min(1, m.driftCents / 70)],
    ['interval', m.intervalHit === null ? 0 : 1 - m.intervalHit],
    ['echo3', m.melodyHit === null ? 0 : 1 - m.melodyHit],
  ]
  scores.sort((x, y) => y[1] - x[1])
  return scores.map((x) => x[0])
}

export interface SessionInput {
  /** 这是第几次（从 1 开始）。 */
  session: number
  minutes: ProgramMinutes
  problem: PitchProblem
  /** 最近一次测试（诊断或复测）的指标。 */
  latest: PitchMetrics
  /** 最近几次小测的单音偏差（旧 → 新）。 */
  recentMatch: readonly number[]
}

/** 唱歌题按周用的级别。 */
function levelFor(kind: BlockKind, week: number): number {
  switch (kind) {
    case 'match':
      return Math.min(4, week + 1)
    case 'sustain':
      return Math.min(3, week)
    case 'interval':
      return week <= 2 ? 1 : 2
    case 'scale':
      return week <= 2 ? 1 : 2
    case 'drone':
      return week <= 2 ? 1 : week === 3 ? 2 : 3
    case 'echo3':
    case 'sight':
      return week <= 3 ? 1 : 2
    default:
      return 1
  }
}

/**
 * 排出第 n 次的练习：热身 →（复测日：复测）→ 听辨 → 本周主练 → 复习 → 小测。
 * 分钟数按比例分配；问题类型决定听辨和主练的比重。
 */
export function buildSession(input: SessionInput): SessionBlock[] {
  const { session, minutes, problem, latest } = input
  const week = weekOf(session)
  const isTest = RETEST_SESSIONS.includes(session)
  const blocks: SessionBlock[] = []
  const add = (kind: BlockKind, mins: number, why?: string) => {
    if (mins <= 0) return
    const count = Math.max(MIN_COUNT[kind], Math.round((mins * 60) / SECONDS_PER[kind]))
    blocks.push({
      id: `${kind}-${blocks.length}`,
      kind,
      title: BLOCK_TITLE[kind],
      why: why ?? BLOCK_WHY[kind],
      count,
      level: levelFor(kind, week),
      minutes: Math.round(mins * 10) / 10,
    })
  }

  add('warmup', 2)
  let rest = minutes - 2
  if (isTest) {
    add('test', TEST_MINUTES)
    rest -= TEST_MINUTES
  } else {
    rest -= 1 // 留给最后的小测
  }
  rest = Math.max(rest, 5)

  const listenShare = problem === 'hearing' ? 0.35 : problem === 'melody' ? 0.18 : 0.22
  const reviewShare = 0.2
  const listen = rest * listenShare
  const review = rest * reviewShare
  const main = rest - listen - review

  // 听辨：第 1 周只比音高；第 2 周加入听自己；之后以听自己为主。
  if (week === 1 || problem === 'hearing') {
    if (week === 1) add('discrimination', listen)
    else {
      add('discrimination', listen * 0.5)
      add('selfcheck', listen * 0.5)
    }
  } else if (week === 2) {
    add('selfcheck', listen * 0.6)
    add('discrimination', listen * 0.4)
  } else add('selfcheck', listen)

  // 本周主练。
  const mainPlan: Record<1 | 2 | 3 | 4, Array<[BlockKind, number]>> = {
    1:
      problem === 'control'
        ? [
            ['sustain', 0.4],
            ['siren', 0.35],
            ['match', 0.25],
          ]
        : [
            ['match', 0.4],
            ['sustain', 0.35],
            ['siren', 0.25],
          ],
    2: [
      ['drone', 0.45],
      ['interval', 0.35],
      ['scale', 0.2],
    ],
    3: [
      ['echo3', 0.6],
      ['sight', 0.4],
    ],
    4: [
      ['song', 0.6],
      ['echo3', 0.4],
    ],
  }
  for (const [kind, share] of mainPlan[week]) add(kind, main * share)

  // 复习：今天还没练到的最弱一项；单音连着两次退步就先补单音。
  const slip = slipping(input.recentMatch)
  const planned = new Set(blocks.map((b) => b.kind))
  const order = slip ? (['match'] as BlockKind[]) : weaknessOrder(latest)
  const weakKind = order.find((k) => !planned.has(k)) ?? order[0]!
  const reviewMins = slip ? review * 1.5 : review
  const why = slip ? '最近两次小测的单音偏差变大了，今天多补一下单音。' : `复习你最弱的一项：${BLOCK_TITLE[weakKind]}。`
  const same = blocks.find((b) => b.kind === weakKind)
  if (same) {
    // 今天已经有这一项：并进去，不重复出现。
    same.minutes = Math.round((same.minutes + reviewMins) * 10) / 10
    same.count = Math.max(MIN_COUNT[weakKind], Math.round((same.minutes * 60) / SECONDS_PER[weakKind]))
    same.why = `${same.why}（${slip ? '今天多补一些：最近两次小测的单音偏差变大了' : '这也是你最弱的一项，今天多练一些'}）`
  } else add(weakKind, reviewMins, why)

  if (!isTest) add('quick', 1)
  return blocks
}

// ---------------------------------------------------------------------------
// 分辨力阶梯（两次答对变难，一次答错变易）
// ---------------------------------------------------------------------------

export interface Staircase {
  cents: number
  /** 连续答对次数（到 2 就缩小音差）。 */
  streak: number
  /** 上一次变化的方向：-1 变难，1 变易，0 还没变过。 */
  lastDir: -1 | 0 | 1
  /** 每次方向改变时的音差。 */
  reversals: number[]
  trials: number
}

export const STAIR_MIN = 5
export const STAIR_MAX = 200

export function newStaircase(start = 100): Staircase {
  return { cents: start, streak: 0, lastDir: 0, reversals: [], trials: 0 }
}

export function stepStaircase(s: Staircase, correct: boolean): Staircase {
  let { cents, streak, lastDir } = s
  const reversals = [...s.reversals]
  let dir: -1 | 0 | 1 = 0
  if (correct) {
    streak += 1
    if (streak >= 2) {
      dir = -1
      streak = 0
    }
  } else {
    streak = 0
    dir = 1
  }
  if (dir !== 0) {
    if (lastDir !== 0 && dir !== lastDir) reversals.push(cents)
    cents = dir === -1 ? Math.max(STAIR_MIN, Math.round(cents * 0.7)) : Math.min(STAIR_MAX, Math.round(cents * 1.4))
    lastDir = dir
  }
  return { cents, streak, lastDir, reversals, trials: s.trials + 1 }
}

/** 估计的分辨阈值：最后 4 次转折的几何平均；转折不够就用当前音差。 */
export function staircaseThreshold(s: Staircase): number {
  const last = s.reversals.slice(-4)
  if (last.length < 2) return s.cents
  const logMean = last.reduce((sum, c) => sum + Math.log(c), 0) / last.length
  return Math.round(Math.exp(logMean))
}

// ---------------------------------------------------------------------------
// 高了还是低了
// ---------------------------------------------------------------------------

export type SelfJudge = 'high' | 'ok' | 'low'

/** 实际偏差对应的答案：±20 音分以内算准。 */
export function actualJudge(cents: number): SelfJudge {
  if (cents > 20) return 'high'
  if (cents < -20) return 'low'
  return 'ok'
}

/** 判断对不对：边界附近（15–30 音分）两种说法都算对。 */
export function judgeCorrect(answer: SelfJudge, cents: number): boolean {
  const abs = Math.abs(cents)
  if (answer === 'ok') return abs <= 30
  if (abs < 15) return false
  return answer === 'high' ? cents > 0 : cents < 0
}

export const JUDGE_TEXT: Record<SelfJudge, string> = { high: '偏高', ok: '准', low: '偏低' }

// ---------------------------------------------------------------------------
// 持续音上唱级数
// ---------------------------------------------------------------------------

/** 级数（相对主音的半音数）的练习型，按级别越来越难。 */
export const DRONE_PATTERNS: ReadonlyArray<ReadonlyArray<ReadonlyArray<number>>> = [
  // 级别 1：1、3、5 和级进
  [
    [0, 4, 7, 4, 0],
    [0, 2, 4, 2, 0],
    [0, 7, 4, 0],
    [0, 4, 2, 0],
  ],
  // 级别 2：加入 4、6 级和五度跳进
  [
    [0, 2, 4, 5, 7],
    [7, 5, 4, 2, 0],
    [0, 4, 7, 9, 7],
    [0, 5, 4, 2, 0],
    [0, 7, 9, 7, 4, 0],
  ],
  // 级别 3：加入 7 级、高八度的 1 和更大的跳进
  [
    [0, 4, 7, 12, 7, 4, 0],
    [0, 9, 7, 5, 4, 2, 0],
    [0, 11, 12, 7, 4, 0],
    [0, 5, 9, 7, 2, 0],
  ],
]

export const DEGREE_NAME: Record<number, string> = {
  0: '1',
  2: '2',
  4: '3',
  5: '4',
  7: '5',
  9: '6',
  11: '7',
  12: '高音 1',
}

/** 把一组读数（音分）汇总成平均绝对偏差。 */
export function meanAbs(xs: ReadonlyArray<number | null>): number | null {
  const v = xs.filter((x): x is number => x !== null)
  if (!v.length) return null
  return Math.round(v.reduce((s, x) => s + Math.abs(x), 0) / v.length)
}

export function ratio(hits: number, total: number): number | null {
  return total > 0 ? Math.round((hits / total) * 100) / 100 : null
}
