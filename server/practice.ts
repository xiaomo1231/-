/**
 * Practice records (练习记录) of the score server: per score, how long the
 * student practised it, the speed and loop used, and which tracks were muted.
 * Kept in SCORES_DATA/practice.json. Validation and the list update are pure
 * so they can be tested; the file helpers write atomically.
 */
import fs from 'node:fs'
import path from 'node:path'
import { MAX_TEXT_CHARS, textOk, type InRoot, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const PRACTICE_FILE = 'practice.json'
export const MAX_PRACTICE = 5000
export const MAX_ADD_SECONDS = 600
const MAX_BARS = 10000
const MAX_TRACKS = 64

export interface PracticeRecord {
  path: string
  title: string
  artist: string
  /** Integer 15..175, default 100. */
  speedPct: number
  /** 1-based bar numbers, first <= last; null = no loop. */
  loopBars: [number, number] | null
  /** Track indexes (0..63), unique, sorted. */
  muted: number[]
  totalSeconds: number
  /** Highest speed actually played; 0 when never played. */
  maxSpeedPct: number
  firstAt: number
  lastAt: number
}

export interface PracticeUpdate {
  path: string
  title: string
  artist: string
  speedPct?: number
  loopBars?: [number, number] | null
  muted?: number[]
  addSeconds?: number
  playedSpeedPct?: number
}

const isSpeed = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 175

const isBar = (v: unknown): v is number =>
  Number.isInteger(v) && (v as number) >= 1 && (v as number) <= MAX_BARS

/** Validates the body of POST /api/practice. Optional fields are present only when given. */
export function parsePracticeUpdate(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<PracticeUpdate> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p))
    return { ok: false, error: '练习的文件不在谱库里。' }
  if (!textOk(body.title) || !textOk(body.artist))
    return { ok: false, error: `曲名或歌手名太长（最多 ${MAX_TEXT_CHARS} 个字符）。` }
  const out: PracticeUpdate = { path: p, title: body.title, artist: body.artist }

  if (body.speedPct !== undefined) {
    if (!isSpeed(body.speedPct)) return { ok: false, error: '速度必须是 15–175 之间的整数。' }
    out.speedPct = body.speedPct
  }

  if (body.loopBars !== undefined) {
    const lb = body.loopBars
    if (lb === null) out.loopBars = null
    else if (
      Array.isArray(lb) &&
      lb.length === 2 &&
      isBar(lb[0]) &&
      isBar(lb[1]) &&
      (lb[0] as number) <= (lb[1] as number)
    )
      out.loopBars = [lb[0] as number, lb[1] as number]
    else return { ok: false, error: '循环小节必须是两个 1–10000 之间的整数，且起始不晚于结束。' }
  }

  if (body.muted !== undefined) {
    const m = body.muted
    if (
      !Array.isArray(m) ||
      m.length > MAX_TRACKS ||
      !m.every((t) => Number.isInteger(t) && t >= 0 && t < MAX_TRACKS)
    )
      return { ok: false, error: '静音的声部编号不对（0–63 之间的整数，最多 64 个）。' }
    out.muted = [...new Set(m as number[])].sort((a, b) => a - b)
  }

  if (body.addSeconds !== undefined) {
    const s = body.addSeconds
    if (typeof s !== 'number' || !Number.isFinite(s) || s < 0)
      return { ok: false, error: '练习时长必须是不小于 0 的数字。' }
    out.addSeconds = Math.min(s, MAX_ADD_SECONDS)
  }

  if (body.playedSpeedPct !== undefined) {
    if (!isSpeed(body.playedSpeedPct))
      return { ok: false, error: '播放速度必须是 15–175 之间的整数。' }
    out.playedSpeedPct = body.playedSpeedPct
  }

  return { ok: true, value: out }
}

/** Validates the body of POST /api/practice/remove. */
export function parsePracticePath(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<string> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p))
    return { ok: false, error: '练习的文件不在谱库里。' }
  return { ok: true, value: p }
}

/**
 * Applies one practice update. Upserts by path: fields missing from the update
 * keep their old values; title and artist are always overwritten; firstAt is
 * kept. The list is sorted by lastAt (newest first) and capped at MAX_PRACTICE.
 */
export function applyPracticeUpdate(
  list: PracticeRecord[],
  update: PracticeUpdate,
  now: number,
): { list: PracticeRecord[]; record: PracticeRecord } {
  const old = list.find((r) => r.path === update.path)
  const base: PracticeRecord = old ?? {
    path: update.path,
    title: update.title,
    artist: update.artist,
    speedPct: 100,
    loopBars: null,
    muted: [],
    totalSeconds: 0,
    maxSpeedPct: 0,
    firstAt: now,
    lastAt: now,
  }
  const add = Math.min(update.addSeconds ?? 0, MAX_ADD_SECONDS)
  const record: PracticeRecord = {
    path: update.path,
    title: update.title,
    artist: update.artist,
    speedPct: update.speedPct ?? base.speedPct,
    loopBars: update.loopBars !== undefined ? update.loopBars : base.loopBars,
    muted: update.muted ?? base.muted,
    totalSeconds: Math.round(base.totalSeconds + add),
    maxSpeedPct:
      add > 0 && update.playedSpeedPct !== undefined
        ? Math.max(base.maxSpeedPct, update.playedSpeedPct)
        : base.maxSpeedPct,
    firstAt: base.firstAt,
    lastAt: now,
  }
  const next = [record, ...list.filter((r) => r.path !== update.path)]
    .sort((a, b) => b.lastAt - a.lastAt)
    .slice(0, MAX_PRACTICE)
  return { list: next, record }
}

/** The list without the record for `rel`. */
export function removePractice(list: PracticeRecord[], rel: string): PracticeRecord[] {
  return list.filter((r) => r.path !== rel)
}

/** Keeps only the stored records that still pass validation (newest first, capped). */
export function sanitizePractice(raw: unknown, inRoot: InRoot): PracticeRecord[] {
  if (!Array.isArray(raw)) return []
  const out: PracticeRecord[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const r = parsePracticeUpdate(rec, inRoot)
    if (!r.ok) continue
    const num = (v: unknown, fallback: number) =>
      typeof v === 'number' && Number.isFinite(v) ? v : fallback
    const u = r.value
    const firstAt = num(rec.firstAt, 0)
    const lastAt = num(rec.lastAt, firstAt)
    const maxSpeed = Math.round(num(rec.maxSpeedPct, 0))
    out.push({
      path: u.path,
      title: u.title,
      artist: u.artist,
      speedPct: u.speedPct ?? 100,
      loopBars: u.loopBars ?? null,
      muted: u.muted ?? [],
      totalSeconds: Math.max(0, Math.round(num(rec.totalSeconds, 0))),
      maxSpeedPct: maxSpeed === 0 || isSpeed(maxSpeed) ? maxSpeed : 0,
      firstAt,
      lastAt,
    })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt).slice(0, MAX_PRACTICE)
}

/** On-disk format version: `{ version, users: { [userId]: records[] } }`. */
export const PRACTICE_VERSION = 2

/** Each account's practice records, keyed by user id. */
export type PracticeByUser = Map<string, PracticeRecord[]>

/**
 * Turns the parsed file into per-user lists. A plain array is the old
 * single-list format and belongs to `adminId`; the v2 object holds one list per
 * user. Anything else is an empty map.
 */
export function practiceFromFile(raw: unknown, inRoot: InRoot, adminId: string): PracticeByUser {
  const out: PracticeByUser = new Map()
  if (Array.isArray(raw)) {
    out.set(adminId, sanitizePractice(raw, inRoot))
    return out
  }
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  if (rec.version !== PRACTICE_VERSION || !rec.users || typeof rec.users !== 'object') return out
  for (const [userId, list] of Object.entries(rec.users as Record<string, unknown>))
    out.set(userId, sanitizePractice(list, inRoot))
  return out
}

/**
 * Reads every account's records once at startup. A missing file is an empty
 * map; a damaged one is set aside with a warning. An old single-list file is
 * migrated to `adminId` and rewritten in the v2 format on the next save.
 */
export async function loadPracticeByUser(
  dataDir: string,
  inRoot: InRoot,
  adminId: string,
): Promise<PracticeByUser> {
  const file = path.join(dataDir, PRACTICE_FILE)
  let text: string
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    console.warn(`[谱库] 练习记录读取失败，已当作空列表：${(err as Error).message}`)
    return new Map()
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    console.warn(`[谱库] 练习记录文件损坏，已改名保留并从空列表开始：${file}`)
    await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
    return new Map()
  }
  return practiceFromFile(raw, inRoot, adminId)
}

/** Writes every account's records atomically (temp file, then rename). */
export async function savePracticeByUser(dataDir: string, byUser: PracticeByUser): Promise<void> {
  const users: Record<string, PracticeRecord[]> = {}
  for (const [userId, list] of byUser) users[userId] = list
  await writeFileAtomic(
    path.join(dataDir, PRACTICE_FILE),
    JSON.stringify({ version: PRACTICE_VERSION, users }),
  )
}

/** One account's totals for a score, for the band page. */
export interface PracticeProgress {
  userId: string
  totalSeconds: number
  maxSpeedPct: number
  lastAt: number
}

/**
 * Which accounts practised the score at `path`, most recent first. Accounts
 * without a record for it are left out.
 */
export function progressFor(byUser: PracticeByUser, path: string): PracticeProgress[] {
  const out: PracticeProgress[] = []
  for (const [userId, list] of byUser) {
    const rec = list.find((r) => r.path === path)
    if (!rec) continue
    out.push({
      userId,
      totalSeconds: rec.totalSeconds,
      maxSpeedPct: rec.maxSpeedPct,
      lastAt: rec.lastAt,
    })
  }
  return out.sort((a, b) => b.lastAt - a.lastAt)
}
