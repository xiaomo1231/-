/**
 * 每日一练 (daily practice): one shared store over the account's progress and the
 * program, plus the day arithmetic the page and the band page share. Day 1 is the
 * local calendar day the account first opened the program; each later local
 * calendar day is the next day number, capped at 365.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, errorText, type DailyState } from './api'

export const DAY_COUNT = 365
const DAY_MS = 86_400_000

/**
 * Whole local calendar days from `a` to `b` (negative when b is earlier). Counts the
 * calendar dates of both instants in local time, so a 23-hour or 25-hour DST day is
 * still one day and a late-night / early-morning pair across midnight is one day.
 */
export function daysBetweenLocal(a: number, b: number): number {
  const da = new Date(a)
  const db = new Date(b)
  const ua = Date.UTC(da.getFullYear(), da.getMonth(), da.getDate())
  const ub = Date.UTC(db.getFullYear(), db.getMonth(), db.getDate())
  return Math.round((ub - ua) / DAY_MS)
}

/** A day number clamped to 1…365 (a non-number becomes day 1). */
export function clampDay(n: number): number {
  if (!Number.isFinite(n)) return 1
  return Math.min(DAY_COUNT, Math.max(1, Math.trunc(n)))
}

/** Today's day number for an account that started on `startedAt` (null = not started, day 1). */
export function todayNumber(startedAt: number | null, now: number): number {
  if (startedAt === null) return 1
  return clampDay(daysBetweenLocal(startedAt, now) + 1)
}

function isDone(done: Record<string, number>, day: number): boolean {
  return typeof done[String(day)] === 'number'
}

/** Consecutive done days that end today, or yesterday when today is not marked yet. */
export function streak(done: Record<string, number>, today: number): number {
  let day = isDone(done, today) ? today : today - 1
  let count = 0
  while (day >= 1 && isDone(done, day)) {
    count++
    day--
  }
  return count
}

/** How many days are marked done. */
export function doneCount(done: Record<string, number>): number {
  return Object.keys(done).filter((k) => typeof done[k] === 'number').length
}

/**
 * The backing track for a style and tempo: the exact bpm when there is one, otherwise
 * the nearest bpm of that style (the lower one on a tie). Null when the style has none.
 */
export function pickBacking<T extends { style: string; bpm: number }>(
  backing: T[],
  style: string,
  bpm: number,
): T | null {
  let best: T | null = null
  for (const b of backing) {
    if (b.style !== style) continue
    if (b.bpm === bpm) return b
    if (
      best === null ||
      Math.abs(b.bpm - bpm) < Math.abs(best.bpm - bpm) ||
      (Math.abs(b.bpm - bpm) === Math.abs(best.bpm - bpm) && b.bpm < best.bpm)
    )
      best = b
  }
  return best
}

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

let state: DailyState | null = null
let error: string | null = null
let loading: Promise<void> | null = null
let startRequested = false
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Reads the program from the server; a request already in flight is shared. Never rejects. */
function refresh(): Promise<void> {
  if (!loading)
    loading = api
      .daily()
      .then(
        (s) => {
          state = s
          error = null
        },
        (e: unknown) => {
          error = errorText(e)
        },
      )
      .finally(() => {
        loading = null
        emit()
      })
  return loading
}

/** Stores the state the server returned for a change; rejects with a readable message. */
async function commit(request: Promise<DailyState>): Promise<void> {
  try {
    state = await request
    error = null
    emit()
  } catch (e) {
    throw new Error(errorText(e))
  }
}

/** The program and this account's progress (null until read), a read error, and a re-read. */
export function useDaily(): { state: DailyState | null; error: string | null; reload(): void } {
  useEffect(() => {
    void refresh()
  }, [])
  const s = useSyncExternalStore(subscribe, () => state)
  const e = useSyncExternalStore(subscribe, () => error)
  return { state: s, error: e, reload: () => void refresh() }
}

/** Opens the program for this account (day 1 = today) when it has not been started yet. */
export async function ensureStarted(): Promise<void> {
  if (!state) await refresh()
  if (!state || state.startedAt !== null || startRequested) return
  startRequested = true
  try {
    await commit(api.startDaily())
  } catch (e) {
    startRequested = false
    error = errorText(e)
    emit()
  }
}

/** Marks a day done or not done and stores the returned progress. Rejects with a readable message. */
export function markDone(day: number, done: boolean): Promise<void> {
  return commit(api.markDaily(day, done))
}

/** Records that tempo `bpm` was played 10 times on `day` (the server keeps the highest). Rejects with a readable message. */
export function markBpm(day: number, bpm: number): Promise<void> {
  return commit(api.markDailyBpm(day, bpm))
}

// ---------------------------------------------------------------------------
// practice ladder and rep counting (pure helpers first)
// ---------------------------------------------------------------------------

/** Repetitions that complete one tempo. */
export const REPS_PER_TEMPO = 10

/**
 * The next faster rung after `bpm` in a ladder of rungs with a `bpm` field. Null when `bpm`
 * is already the top (or nothing is faster). The list order does not matter.
 */
export function nextTempo<T extends { bpm: number }>(list: T[], bpm: number): T | null {
  let best: T | null = null
  for (const t of list) {
    if (t.bpm > bpm && (best === null || t.bpm < best.bpm)) best = t
  }
  return best
}

/**
 * The rung to start on: the slowest one faster than `doneBpm` (the highest tempo already
 * completed; null = none). When every rung is completed, the top rung. Null for an empty list.
 */
export function startTempo<T extends { bpm: number }>(list: T[], doneBpm: number | null): T | null {
  if (list.length === 0) return null
  const floor = doneBpm ?? 0
  let best: T | null = null
  let top: T = list[0]
  for (const t of list) {
    if (t.bpm > floor && (best === null || t.bpm < best.bpm)) best = t
    if (t.bpm > top.bpm) top = t
  }
  return best ?? top
}

// ---------------------------------------------------------------------------
// rep counts kept per day and tempo for this browser session (reload-safe)
// ---------------------------------------------------------------------------

const repsKey = (day: number, bpm: number) => `daily-reps:${day}:${bpm}`

/** The reps counted for this day and tempo in this tab's session (0 when unknown or storage is blocked). */
export function readReps(day: number, bpm: number): number {
  try {
    const n = Number(window.sessionStorage.getItem(repsKey(day, bpm)))
    return Number.isInteger(n) && n > 0 ? Math.min(n, REPS_PER_TEMPO) : 0
  } catch {
    return 0
  }
}

/** Stores the reps for this day and tempo; a blocked storage is ignored. */
export function writeReps(day: number, bpm: number, reps: number): void {
  try {
    window.sessionStorage.setItem(repsKey(day, bpm), String(reps))
  } catch {
    // Storage unavailable: the count only lasts while the page is open.
  }
}
