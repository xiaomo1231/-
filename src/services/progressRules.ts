/**
 * Gamification rules: XP, levels (named after a band's career) and streaks.
 * Deliberately small — motivation, not a casino.
 */

export const XP_PER_CORRECT = 10
export const XP_PER_PARTIAL = 4
export const XP_PER_WRONG = 1
export const XP_DAILY_PLAN_BONUS = 60
export const XP_LEVEL_UP_BONUS = 40
export const XP_PLACEMENT_BONUS = 50

export interface RankInfo {
  index: number
  name: string
  /** Total XP required to reach this rank. */
  minXp: number
  flavor: string
}

export const RANKS: readonly RankInfo[] = [
  { index: 0, name: '练习室', minXp: 0, flavor: '一切从一间小练习室开始。' },
  { index: 1, name: '地下 Livehouse', minXp: 400, flavor: '第一次面对观众，耳朵开始变灵。' },
  { index: 2, name: '校园舞台', minXp: 1200, flavor: '能听出大部分和弦了。' },
  { index: 3, name: '音乐节副舞台', minXp: 2800, flavor: '节奏稳得像鼓机。' },
  { index: 4, name: '录音室', minXp: 5500, flavor: '开始写自己的作品。' },
  { index: 5, name: '巡演', minXp: 10000, flavor: '作曲、编曲，一人一支乐队。' },
]

export function rankFor(xp: number): RankInfo {
  let current = RANKS[0]!
  for (const r of RANKS) if (xp >= r.minXp) current = r
  return current
}

export function nextRank(xp: number): RankInfo | null {
  const cur = rankFor(xp)
  return RANKS[cur.index + 1] ?? null
}

/** 0–1 progress between the current rank and the next one. */
export function rankProgress(xp: number): number {
  const cur = rankFor(xp)
  const next = nextRank(xp)
  if (!next) return 1
  return Math.max(0, Math.min(1, (xp - cur.minXp) / (next.minXp - cur.minXp)))
}

export function xpForAnswer(correct: boolean, credit: number): number {
  if (correct) return XP_PER_CORRECT
  if (credit >= 0.5) return XP_PER_PARTIAL
  return XP_PER_WRONG
}

/** Local calendar date as YYYY-MM-DD. */
export function localDateKey(d = new Date()): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function previousDateKey(key: string): string {
  const [y, m, d] = key.split('-').map(Number)
  const date = new Date(y!, m! - 1, d!)
  date.setDate(date.getDate() - 1)
  return localDateKey(date)
}

export interface StreakState {
  current: number
  best: number
  lastDate: string | null
}

/** Update the streak for a completed daily plan on `today`. Idempotent per day. */
export function advanceStreak(s: StreakState, today: string): StreakState {
  if (s.lastDate === today) return s
  const continues = s.lastDate === previousDateKey(today)
  const current = continues ? s.current + 1 : 1
  return { current, best: Math.max(s.best, current), lastDate: today }
}

/** A streak is "alive" today if the last completion was today or yesterday. */
export function streakAlive(s: StreakState, today: string): boolean {
  return s.lastDate === today || s.lastDate === previousDateKey(today)
}

export interface BadgeInfo {
  id: string
  name: string
  description: string
}

export const BADGES: readonly BadgeInfo[] = [
  { id: 'first-session', name: '第一声', description: '完成第一次训练。' },
  { id: 'first-daily', name: '开张', description: '完成第一份每日训练。' },
  { id: 'streak-3', name: '三天不断', description: '连续 3 天完成每日训练。' },
  { id: 'streak-7', name: '一周乐手', description: '连续 7 天完成每日训练。' },
  { id: 'streak-30', name: '月度常驻', description: '连续 30 天完成每日训练。' },
  { id: 'interval-all', name: '十二音程', description: '音程听辨到达全部混合级。' },
  { id: 'pitch-10c', name: '金耳朵', description: '音高比较到达 10 音分级。' },
  { id: 'rhythm-tight', name: '鼓机', description: '一次跟拍平均偏差 ≤ 25 毫秒。' },
  { id: 'chord-inv', name: '听出低音', description: '和弦性质到达转位级。' },
  { id: 'placement', name: '起点已定', description: '完成入门分级测试。' },
  { id: 'combo-10', name: '十连', description: '挑战模式连对 10 题。' },
  { id: 'range-set', name: '认识自己的声音', description: '完成音域标定。' },
  { id: 'pitch-15c', name: '准星', description: '单音模仿在 ±15 音分内唱准。' },
  { id: 'first-composition', name: '处女作', description: '保存第一份微创作。' },
  { id: 'stage-0', name: '阶段 0 毕业', description: '完成「节奏与声音」全部课程。' },
  { id: 'stage-1', name: '阶段 1 毕业', description: '完成「音高系统」全部课程。' },
  { id: 'dictation-4', name: '听写手', description: '旋律听写到达第 4 级。' },
  { id: 'first-song', name: '第一首歌', description: '在作曲台保存一首 8 小节以上、每小节都有和弦的作品。' },
  { id: 'stage-2', name: '阶段 2 毕业', description: '完成「和声基础」全部课程。' },
  { id: 'stage-3', name: '阶段 3 毕业', description: '完成「旋律与歌曲结构」全部课程。' },
  { id: 'first-arrangement', name: '一人乐队', description: '保存一首有段落、4 个以上声部、每小节都有和弦的编曲。' },
  { id: 'stage-4', name: '阶段 4 毕业', description: '完成「进阶和声」全部课程。' },
  { id: 'stage-5', name: '阶段 5 毕业', description: '完成「编曲」全部课程。' },
  { id: 'guitar-first', name: '第一次过关', description: '在吉他工坊里通过第一个练习。' },
  { id: 'guitar-rhythm', name: '节奏吉他手', description: '完成节奏吉他的全部 8 个单元。' },
  { id: 'guitar-lead', name: '主音吉他手', description: '完成主音吉他的全部 8 个单元。' },
  { id: 'graduate', name: '毕业作品', description: '完成毕业项目：一首 2–3 分钟、4 个以上声部、经过点评和修改并导出的完整作品。' },
]

export function badgeInfo(id: string): BadgeInfo | undefined {
  return BADGES.find((b) => b.id === id)
}
