/**
 * 每日一练 (12-每日一练, Guitar Aerobics 52 weeks / 365 days): the read-only program
 * found in the score library, and each account's own progress (SCORES_DATA/daily.json).
 * The library is never written; progress lives beside the other server data and is
 * saved atomically, one write at a time.
 */
import fs from 'node:fs'
import path from 'node:path'
import type { DailyBacking, DailyDay, DailyMemberProgress, DailyState } from '../src/songs/scoreServerTypes'
import { createSerialQueue } from './favorites'
import { writeFileAtomic } from './util'

export const DAILY_FILE = 'daily.json'
export const DAILY_VERSION = 1
export const DAILY_DAYS = 365

const CATEGORY_RE = /^\d+-每日一练$/
const INDEX_FILE = '每日练习索引.json'
const BACKING_DIR = '伴奏库'
const BOOK_DIR = '全书'
const WEEKLY_DIR = '示范音频(整周)'
const WEEKLY_RE = /^第(\d+)周示范\.mp3$/
const TUNING_FILE = '调音音频(E-A-D-G-B-E).mp3'
const IMAGE_ZH = '练习谱.png'
const IMAGE_EN = '练习谱_英文.png'
const DEMO_FILE = '示范.mp3'

export interface DailyProgram {
  /** Folder name of the program inside the library (e.g. 12-每日一练), or null. */
  category: string | null
  days: DailyDay[]
  backing: DailyBacking[]
  /** Library paths with labels: the 全书 PDFs, weekly demos, tuning audio. */
  extras: Array<{ label: string; path: string }>
}

export interface DailyAccountProgress {
  startedAt: number | null
  done: Record<string, number>
  /** Highest backing tempo completed (10 times through) per day: day key → bpm. */
  bpm: Record<string, number>
}

/** Drops a leading byte-order mark (U+FEFF), written as a code point so the source stays plain. */
const stripBom = (text: string): string => (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text)

const emptyProgram = (): DailyProgram => ({ category: null, days: [], backing: [], extras: [] })

const DAY_INFO_FILE = '练习信息.json'

interface DayInfo {
  backingList: Array<{ bpm: number; path: string }>
  bookPage: { zh: number | null; en: number | null } | null
  method: string | null
}

const emptyDayInfo = (): DayInfo => ({ backingList: [], bookPage: null, method: null })

/** A page number: a positive integer, otherwise null. */
const pageNumber = (v: unknown): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null

/**
 * One day's 练习信息.json (read-only). Missing, unreadable or malformed gives empty fields.
 * Each backing 文件 is relative to the day folder; it is resolved inside the library and kept
 * only when the file exists. Duplicate bpm values are dropped; the list is sorted slowest first.
 */
async function readDayInfo(
  root: string,
  category: string,
  dayAbs: string,
  dayLib: string,
): Promise<DayInfo> {
  let raw: unknown
  try {
    raw = JSON.parse(stripBom(await fs.promises.readFile(path.join(dayAbs, DAY_INFO_FILE), 'utf8')))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
      console.warn(`[每日一练] 练习信息读取失败，已忽略：${dayLib}：${(err as Error).message}`)
    return emptyDayInfo()
  }
  if (!isObj(raw)) return emptyDayInfo()
  const info = emptyDayInfo()
  if (Array.isArray(raw.伴奏)) {
    const seen = new Set<number>()
    const list: Array<{ bpm: number; path: string }> = []
    for (const item of raw.伴奏 as unknown[]) {
      if (!isObj(item) || typeof item.文件 !== 'string' || !item.文件.trim()) continue
      const bpm = item.bpm
      if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm <= 0 || seen.has(bpm)) continue
      const rel = path.posix.join(dayLib, item.文件.trim().replace(/\\/g, '/'))
      if (!rel.startsWith(`${category}/`)) continue
      if (!(await isFile(path.join(root, ...rel.split('/'))))) continue
      seen.add(bpm)
      list.push({ bpm, path: rel })
    }
    info.backingList = list.sort((a, b) => a.bpm - b.bpm)
  }
  if (isObj(raw.书页)) {
    const zh = pageNumber(raw.书页.中文版)
    const en = pageNumber(raw.书页.英文版)
    if (zh !== null || en !== null) info.bookPage = { zh, en }
  }
  if (typeof raw.练法 === 'string' && raw.练法.trim()) info.method = raw.练法.trim()
  return info
}

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

async function isFile(abs: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(abs)).isFile()
  } catch {
    return false
  }
}

/** '40/48/56' (or an array of numbers) → [40, 48, 56]; anything unreadable gives []. */
export function parseTempos(raw: unknown): number[] {
  const parts: unknown[] = Array.isArray(raw)
    ? raw
    : typeof raw === 'string'
      ? raw.split(/[/／]/)
      : []
  return parts
    .map((p) => (typeof p === 'number' ? p : Number(String(p).trim())))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/** Index folder path ('第01周\\第001天_周一_交替拨弦') → segments without '.', '..' or empty parts. */
function folderSegments(raw: unknown): string[] {
  if (typeof raw !== 'string') return []
  return raw
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.trim())
    .filter((s) => s && s !== '.' && s !== '..')
}

/**
 * Reads the 每日一练 program from the library root. Never throws: a missing folder
 * or a bad index gives an empty program with category null (one console.warn).
 */
export async function loadDailyProgram(root: string): Promise<DailyProgram> {
  let category: string | null = null
  try {
    const names = (await fs.promises.readdir(root, { withFileTypes: true }))
      .filter((d) => d.isDirectory() && CATEGORY_RE.test(d.name))
      .map((d) => d.name)
      .sort()
    category = names[0] ?? null
  } catch (err) {
    console.warn(`[每日一练] 无法读取谱库目录，已当作没有每日一练：${(err as Error).message}`)
    return emptyProgram()
  }
  if (!category) {
    console.warn('[每日一练] 谱库里没有「每日一练」文件夹，已忽略。')
    return emptyProgram()
  }

  const dir = path.join(root, category)
  let index: Record<string, unknown>
  try {
    const text = await fs.promises.readFile(path.join(dir, INDEX_FILE), 'utf8')
    const raw: unknown = JSON.parse(stripBom(text))
    if (!isObj(raw) || !Array.isArray(raw.每日)) throw new Error('缺少「每日」列表')
    index = raw
  } catch (err) {
    console.warn(`[每日一练] 每日练习索引读取失败，已忽略：${(err as Error).message}`)
    return emptyProgram()
  }

  const lib = (...segments: string[]) => [category, ...segments].join('/')
  const abs = (...segments: string[]) => path.join(dir, ...segments)

  const days: DailyDay[] = []
  for (const item of index.每日 as unknown[]) {
    if (!isObj(item) || !Number.isInteger(item.天)) continue
    const day = item.天 as number
    const folder = folderSegments(item.文件夹)
    const folderLib = folder.length ? lib(...folder) : null
    const folderAbs = folder.length ? abs(...folder) : null
    const pick = async (name: string): Promise<string | null> =>
      folderAbs && folderLib && (await isFile(path.join(folderAbs, name)))
        ? `${folderLib}/${name}`
        : null
    const demoSeconds =
      typeof item['示范时长(秒)'] === 'number' && Number.isFinite(item['示范时长(秒)'])
        ? (item['示范时长(秒)'] as number)
        : null
    const info =
      folderAbs && folderLib
        ? await readDayInfo(root, category, folderAbs, folderLib)
        : emptyDayInfo()
    days.push({
      day,
      week: Number.isInteger(item.周) ? (item.周 as number) : 0,
      weekday: typeof item.星期 === 'string' ? item.星期 : '',
      technique: typeof item.技巧 === 'string' ? item.技巧 : '',
      backingStyle: typeof item.伴奏风格 === 'string' ? item.伴奏风格 : '',
      tempos: parseTempos(item['伴奏速度(bpm)']),
      demoSeconds,
      imageZh: await pick(IMAGE_ZH),
      imageEn: await pick(IMAGE_EN),
      demo: await pick(DEMO_FILE),
      backingList: info.backingList,
      bookPage: info.bookPage,
      method: info.method,
    })
  }

  const backing: DailyBacking[] = []
  if (Array.isArray(index.伴奏库)) {
    for (const item of index.伴奏库 as unknown[]) {
      if (!isObj(item) || typeof item.文件 !== 'string' || !item.文件) continue
      const file = item.文件
      if (file.includes('/') || file.includes('\\') || file === '.' || file === '..') continue
      if (!(await isFile(abs(BACKING_DIR, file)))) continue
      backing.push({
        track: Number.isInteger(item.曲目) ? (item.曲目 as number) : backing.length + 1,
        style: typeof item.风格 === 'string' ? item.风格 : '',
        bpm: typeof item.bpm === 'number' && Number.isFinite(item.bpm) ? item.bpm : 0,
        path: lib(BACKING_DIR, file),
      })
    }
  }

  const extras: Array<{ label: string; path: string }> = []
  const book: Array<[string, string]> = [
    ['有氧吉他训练（中文版）', '有氧吉他训练(中文版).pdf'],
    ['Guitar Aerobics（英文原版）', 'Guitar Aerobics(英文原版).pdf'],
  ]
  for (const [label, file] of book) {
    if (await isFile(abs(BOOK_DIR, file))) extras.push({ label, path: lib(BOOK_DIR, file) })
  }
  let weekly: Array<{ week: number; file: string }> = []
  try {
    weekly = (await fs.promises.readdir(abs(BOOK_DIR, WEEKLY_DIR)))
      .map((f) => ({ f, m: WEEKLY_RE.exec(f) }))
      .filter((x): x is { f: string; m: RegExpExecArray } => x.m !== null)
      .map((x) => ({ week: Number(x.m[1]), file: x.f }))
      .sort((a, b) => a.week - b.week)
  } catch {
    weekly = []
  }
  for (const w of weekly) {
    extras.push({ label: `第 ${w.week} 周示范`, path: lib(BOOK_DIR, WEEKLY_DIR, w.file) })
  }
  if (await isFile(abs(BOOK_DIR, TUNING_FILE))) {
    extras.push({ label: '调音（E-A-D-G-B-E）', path: lib(BOOK_DIR, TUNING_FILE) })
  }

  return { category, days, backing, extras }
}

/**
 * True for a library-relative path inside the program folder (e.g. `12-每日一练/第01周/…`).
 * Lexical only: it rejects traversal, absolute and drive-letter paths; the caller still
 * resolves the real file. Backslashes are accepted and treated as '/'.
 */
export function isDailyPath(category: string | null, rel: string): boolean {
  if (!category || typeof rel !== 'string') return false
  if (rel.includes('\0')) return false
  const norm = rel.replace(/\\/g, '/')
  if (norm.startsWith('/') || /^[a-zA-Z]:/.test(norm)) return false
  const prefix = `${category}/`
  if (!norm.startsWith(prefix) || norm.length === prefix.length) return false
  return norm.split('/').every((s) => s !== '..' && s !== '.')
}

// ---------------------------------------------------------------------------
// progress
// ---------------------------------------------------------------------------

interface AccountRecord {
  startedAt: number | null
  done: Record<string, number>
  bpm: Record<string, number>
}

const TEMPO_MIN = 20
const TEMPO_MAX = 300

function isDay(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= DAILY_DAYS
}

function isTempo(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= TEMPO_MIN && n <= TEMPO_MAX
}

/** Keeps only well-formed rows; a wrong envelope (version, shape) is treated as corrupt by the caller. */
function parseStore(raw: unknown): Map<string, AccountRecord> | null {
  if (!isObj(raw) || raw.version !== DAILY_VERSION || !isObj(raw.users)) return null
  const out = new Map<string, AccountRecord>()
  for (const [userId, rec] of Object.entries(raw.users)) {
    if (!isObj(rec)) continue
    const startedAt =
      typeof rec.startedAt === 'number' && Number.isFinite(rec.startedAt) ? rec.startedAt : null
    const done: Record<string, number> = {}
    if (isObj(rec.done)) {
      for (const [key, at] of Object.entries(rec.done)) {
        const day = Number(key)
        if (String(day) === key && isDay(day) && typeof at === 'number' && Number.isFinite(at)) {
          done[key] = at
        }
      }
    }
    const bpm: Record<string, number> = {}
    if (isObj(rec.bpm)) {
      for (const [key, tempo] of Object.entries(rec.bpm)) {
        const day = Number(key)
        if (String(day) === key && isDay(day) && isTempo(tempo)) bpm[key] = tempo as number
      }
    }
    out.set(userId, { startedAt, done, bpm })
  }
  return out
}

/**
 * Each account's 每日一练 progress in `<dataDir>/daily.json`. Load once with `load()`;
 * mutations update memory at once and save in order (atomic write).
 */
export class DailyProgressStore {
  private readonly dataDir: string
  private readonly file: string
  private readonly users: Map<string, AccountRecord>
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, users: Map<string, AccountRecord>) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, DAILY_FILE)
    this.users = users
  }

  /** Missing file → empty; unreadable or damaged → set aside (`.broken-<time>`) and empty. */
  static async load(dataDir: string): Promise<DailyProgressStore> {
    const file = path.join(dataDir, DAILY_FILE)
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(`[每日一练] 进度数据读取失败，已当作空：${(err as Error).message}`)
      return new DailyProgressStore(dataDir, new Map())
    }
    let raw: unknown
    try {
      raw = JSON.parse(stripBom(text))
    } catch {
      raw = undefined
    }
    const users = parseStore(raw)
    if (!users) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[每日一练] 进度数据文件损坏，已改名保留并从空开始：${file}`)
      return new DailyProgressStore(dataDir, new Map())
    }
    return new DailyProgressStore(dataDir, users)
  }

  /** This account's progress (copies; an unknown account is empty). */
  get(userId: string): DailyAccountProgress {
    const rec = this.users.get(userId)
    return {
      startedAt: rec?.startedAt ?? null,
      done: { ...(rec?.done ?? {}) },
      bpm: { ...(rec?.bpm ?? {}) },
    }
  }

  /** Records the first time the account opened 每日一练. Later calls change nothing. */
  async start(userId: string, now: number): Promise<void> {
    const rec = this.users.get(userId)
    if (rec && rec.startedAt !== null) return
    this.ensure(userId).startedAt = now
    await this.save()
  }

  /**
   * Marks (done=true) or unmarks (done=false) one day. Starting is implied: an account
   * without a start time gets `now`. Marking an already-done day keeps its first time.
   */
  async mark(userId: string, day: number, done: boolean, now: number): Promise<void> {
    if (!isDay(day)) throw new RangeError(`天数必须是 1–${DAILY_DAYS} 之间的整数`)
    const rec = this.ensure(userId)
    if (rec.startedAt === null) rec.startedAt = now
    const key = String(day)
    if (done) {
      if (!(key in rec.done)) rec.done[key] = now
    } else {
      delete rec.done[key]
    }
    await this.save()
  }

  /**
   * Records that the account played day `day` through 10 times at tempo `bpm` (20–300).
   * The highest tempo per day is kept. Starting is implied, as for mark().
   */
  async markBpm(userId: string, day: number, bpm: number, now: number): Promise<void> {
    if (!isDay(day)) throw new RangeError(`天数必须是 1–${DAILY_DAYS} 之间的整数`)
    if (!isTempo(bpm)) throw new RangeError(`速度必须是 ${TEMPO_MIN}–${TEMPO_MAX} 之间的整数`)
    const rec = this.ensure(userId)
    if (rec.startedAt === null) rec.startedAt = now
    const key = String(day)
    if (!(key in rec.bpm) || rec.bpm[key] < bpm) rec.bpm[key] = bpm
    await this.save()
  }

  /** Removes an account's progress (when the account is deleted). */
  async dropUser(userId: string): Promise<void> {
    if (!this.users.delete(userId)) return
    await this.save()
  }

  /**
   * Progress for the given accounts, in the order given (duplicates dropped). lastDay is
   * the day whose done time is the latest (ties: the larger day).
   */
  members(userIds: string[]): DailyMemberProgress[] {
    const seen = new Set<string>()
    const out: DailyMemberProgress[] = []
    for (const userId of userIds) {
      if (seen.has(userId)) continue
      seen.add(userId)
      const rec = this.users.get(userId)
      let lastDay: number | null = null
      let lastDoneAt: number | null = null
      for (const [key, at] of Object.entries(rec?.done ?? {})) {
        const day = Number(key)
        if (lastDoneAt === null || at > lastDoneAt || (at === lastDoneAt && day > (lastDay ?? 0))) {
          lastDoneAt = at
          lastDay = day
        }
      }
      out.push({
        userId,
        startedAt: rec?.startedAt ?? null,
        doneCount: Object.keys(rec?.done ?? {}).length,
        lastDay,
        lastDoneAt,
      })
    }
    return out
  }

  private ensure(userId: string): AccountRecord {
    let rec = this.users.get(userId)
    if (!rec) {
      rec = { startedAt: null, done: {}, bpm: {} }
      this.users.set(userId, rec)
    }
    return rec
  }

  private save(): Promise<void> {
    return this.queue(async () => {
      const users: Record<string, AccountRecord> = {}
      for (const [userId, rec] of this.users) users[userId] = rec
      await fs.promises.mkdir(this.dataDir, { recursive: true })
      await writeFileAtomic(this.file, JSON.stringify({ version: DAILY_VERSION, users }))
    })
  }
}

/** The client's view of the program plus one account's progress. Pure; available when there are days. */
export function dailyState(
  program: DailyProgram,
  progress: DailyAccountProgress,
): DailyState {
  return {
    available: program.days.length > 0,
    days: program.days,
    backing: program.backing,
    extras: program.extras,
    startedAt: progress.startedAt,
    done: { ...progress.done },
    bpm: { ...progress.bpm },
  }
}
