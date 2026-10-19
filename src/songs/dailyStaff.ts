/**
 * 每日一练 staff: the notes of the current quarter (13 program weeks) for the home page.
 * Pure. The caller passes `today` (the program day number, i.e. todayNumber() from
 * web/lib/daily.ts) instead of startedAt / now, so this module does no date arithmetic.
 * Program weeks are 7-day blocks counted from day 1; `slot` is the day's position in its week.
 */

export interface DailyStaffInput {
  /** Today's program day number (1-based). */
  today: number
  /** Days marked done: day number → count (any finite number marks the day). */
  done: Record<string, number>
  /** Highest tempo completed per day: day number → bpm. */
  bpm: Record<string, number>
  /** The program's tempo ladders per day. */
  days: Array<{ day: number; tempos: number[] }>
  /** Weeks shown per window (default 13, one quarter). */
  weeks?: number
}

export type DailyNoteKind = 'done' | 'missed' | 'today'

export interface DailyStaffNote {
  day: number
  /** 1-based program week. */
  week: number
  /** Weekday position within the week, 0–6. */
  slot: number
  kind: DailyNoteKind
  /** 0…1: how fast that day got (0 = slowest of its ladder). */
  height: number
  /** Highest tempo completed that day, or null. */
  bpm: number | null
}

export interface DailyStaffData {
  firstWeek: number
  weeks: number
  today: number
  notes: DailyStaffNote[]
}

const WEEK_DAYS = 7
const DEFAULT_WEEKS = 13

function numberAt(map: Record<string, number>, day: number): number | null {
  const v = map[String(day)]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** Position of `bpm` within the day's ladder, clamped to 0…1; 0.5 when the ladder has no range. */
function speedOf(bpm: number, tempos: number[]): number {
  const valid = tempos.filter((t) => Number.isFinite(t))
  if (valid.length === 0) return 0.5
  const min = Math.min(...valid)
  const max = Math.max(...valid)
  if (max === min) return 0.5
  return Math.min(1, Math.max(0, (bpm - min) / (max - min)))
}

export function dailyStaffNotes(input: DailyStaffInput): DailyStaffData {
  const weeks = Math.max(1, Math.trunc(input.weeks ?? DEFAULT_WEEKS))
  const today = Math.max(1, Math.trunc(input.today))
  const todayWeek = Math.floor((today - 1) / WEEK_DAYS) + 1
  const firstWeek = weeks * Math.floor((todayWeek - 1) / weeks) + 1
  const firstDay = (firstWeek - 1) * WEEK_DAYS + 1
  const lastDay = Math.min(today, (firstWeek - 1 + weeks) * WEEK_DAYS)

  const ladders = new Map(input.days.map((d) => [d.day, d.tempos]))
  const notes: DailyStaffNote[] = []
  for (let day = firstDay; day <= lastDay; day++) {
    const bpm = numberAt(input.bpm, day)
    const done = numberAt(input.done, day) !== null || bpm !== null
    const kind: DailyNoteKind = done ? 'done' : day === today ? 'today' : 'missed'
    let height = 0
    if (kind === 'done') height = bpm === null ? 0.5 : speedOf(bpm, ladders.get(day) ?? [])
    notes.push({
      day,
      week: Math.floor((day - 1) / WEEK_DAYS) + 1,
      slot: (day - 1) % WEEK_DAYS,
      kind,
      height,
      bpm,
    })
  }
  return { firstWeek, weeks, today, notes }
}
