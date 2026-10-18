/**
 * The band (乐队) of the score server: one shared setlist with each song's
 * status, who plays which part, a shared note and a rehearsal speed. Kept in
 * SCORES_DATA/band.json. Validation and the state view are pure so they can be
 * tested; the store writes atomically and serialises its changes.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AddBandSongBody,
  BandSong,
  BandState,
  MemberProgress,
  SongStatus,
  UpdateBandSongBody,
  UserInfo,
} from '../src/songs/scoreServerTypes'
import { createSerialQueue, MAX_TEXT_CHARS, textOk, type InRoot, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const BAND_FILE = 'band.json'
export const DEFAULT_BAND_NAME = '我们的乐队'
export const MAX_BAND_NAME = 40
export const MAX_BAND_NOTE = 2000
const MAX_TRACKS = 64

const SCORE_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.xml', '.mxl']
const STATUSES: readonly SongStatus[] = ['learning', 'ready', 'maybe']

/** Track index as a string key: "0".."63", no leading zeros. */
const TRACK_KEY = /^(?:0|[1-9]|[1-5]\d|6[0-3])$/

export class BandError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BandError'
    this.status = status
  }
}

const isSpeed = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 15 && (v as number) <= 175

const codePoints = (s: string) => [...s].length

const isStatus = (v: unknown): v is SongStatus => typeof v === 'string' && (STATUSES as readonly string[]).includes(v)

const isScorePath = (p: string) => {
  const lower = p.toLowerCase()
  return SCORE_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

/** Validates the body of POST /api/band/songs/add. */
export function parseAddSong(body: Record<string, unknown>, inRoot: InRoot): ParseResult<AddBandSongBody> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p)) return { ok: false, error: '这个文件不在谱库里。' }
  if (!isScorePath(p)) return { ok: false, error: '只能把乐谱文件（GP / MusicXML）加入歌单。' }
  if (!textOk(body.title) || !textOk(body.artist))
    return { ok: false, error: `曲名或歌手名太长（最多 ${MAX_TEXT_CHARS} 个字符）。` }
  return { ok: true, value: { path: p, title: body.title, artist: body.artist } }
}

/** Validates the body of POST /api/band/songs/update. Only fields present in the body are returned. */
export function parseUpdateSong(
  body: Record<string, unknown>,
  isUser: (id: string) => boolean,
): ParseResult<UpdateBandSongBody> {
  const id = body.id
  if (typeof id !== 'string' || !id || id.length > 64) return { ok: false, error: '找不到这首歌。' }
  const out: UpdateBandSongBody = { id }

  if (body.status !== undefined) {
    if (!isStatus(body.status)) return { ok: false, error: '歌曲状态必须是 learning、ready 或 maybe。' }
    out.status = body.status
  }

  if (body.parts !== undefined) {
    const parts = body.parts
    if (!parts || typeof parts !== 'object' || Array.isArray(parts))
      return { ok: false, error: '声部分配格式不对。' }
    const entries = Object.entries(parts as Record<string, unknown>)
    if (entries.length > MAX_TRACKS) return { ok: false, error: `声部分配最多 ${MAX_TRACKS} 项。` }
    const next: Record<string, string> = {}
    for (const [key, user] of entries) {
      if (!TRACK_KEY.test(key)) return { ok: false, error: '声部编号必须是 0–63 之间的整数。' }
      if (typeof user !== 'string' || !isUser(user)) return { ok: false, error: '分配的成员不存在。' }
      next[key] = user
    }
    out.parts = next
  }

  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || codePoints(body.note) > MAX_BAND_NOTE)
      return { ok: false, error: `备注最多 ${MAX_BAND_NOTE} 个字符。` }
    out.note = body.note
  }

  if (body.rehearsalSpeedPct !== undefined) {
    const s = body.rehearsalSpeedPct
    if (s !== null && !isSpeed(s)) return { ok: false, error: '排练速度必须是 15–175 之间的整数，或留空。' }
    out.rehearsalSpeedPct = s as number | null
  }

  return { ok: true, value: out }
}

/** Validates the body of POST /api/band/songs/reorder: `ids` must be a permutation of `currentIds`. */
export function parseReorder(body: Record<string, unknown>, currentIds: readonly string[]): ParseResult<string[]> {
  const ids = body.ids
  if (!Array.isArray(ids) || !ids.every((v): v is string => typeof v === 'string'))
    return { ok: false, error: '歌单顺序格式不对。' }
  const current = new Set(currentIds)
  const given = new Set(ids)
  if (ids.length !== currentIds.length || given.size !== ids.length || [...given].some((id) => !current.has(id)))
    return { ok: false, error: '歌单顺序已变化，请刷新后再调整。' }
  return { ok: true, value: [...ids] }
}

/** Validates the body of POST /api/band/rename. */
export function parseRename(body: Record<string, unknown>): ParseResult<string> {
  const name = body.name
  if (typeof name !== 'string') return { ok: false, error: `乐队名要在 1–${MAX_BAND_NAME} 个字符之间。` }
  const trimmed = name.trim()
  if (codePoints(trimmed) < 1 || codePoints(trimmed) > MAX_BAND_NAME)
    return { ok: false, error: `乐队名要在 1–${MAX_BAND_NAME} 个字符之间。` }
  return { ok: true, value: trimmed }
}

/** Keeps the parts map only when every key and user is well-formed. Load-time, no member check. */
function sanitizeParts(raw: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out
  let count = 0
  for (const [key, user] of Object.entries(raw as Record<string, unknown>)) {
    if (count >= MAX_TRACKS) break
    if (!TRACK_KEY.test(key) || typeof user !== 'string' || !user) continue
    out[key] = user
    count++
  }
  return out
}

/** Keeps only the stored songs that still pass the checks (path in the library, no duplicate path). */
function sanitizeSongs(raw: unknown, inRoot: InRoot): BandSong[] {
  if (!Array.isArray(raw)) return []
  const out: BandSong[] = []
  const seenPaths = new Set<string>()
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const p = rec.path
    if (typeof rec.id !== 'string' || !rec.id) continue
    if (typeof p !== 'string' || !p || !inRoot(p) || seenPaths.has(p)) continue
    seenPaths.add(p)
    const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
    const addedAt = num(rec.addedAt, 0)
    const speed = rec.rehearsalSpeedPct
    out.push({
      id: rec.id,
      path: p,
      title: typeof rec.title === 'string' ? rec.title : '',
      artist: typeof rec.artist === 'string' ? rec.artist : '',
      status: isStatus(rec.status) ? rec.status : 'learning',
      parts: sanitizeParts(rec.parts),
      note: typeof rec.note === 'string' ? [...rec.note].slice(0, MAX_BAND_NOTE).join('') : '',
      rehearsalSpeedPct: speed === null || isSpeed(speed) ? (speed as number | null) : null,
      addedBy: typeof rec.addedBy === 'string' ? rec.addedBy : '',
      addedAt,
      updatedAt: num(rec.updatedAt, addedAt),
    })
  }
  return out
}

const freshId = (taken: readonly BandSong[]): string => {
  for (;;) {
    const id = randomBytes(5).toString('hex')
    if (!taken.some((s) => s.id === id)) return id
  }
}

/**
 * The band's setlist and name. Reads are synchronous from memory; every change
 * goes through one serial queue and is written to disk before it becomes visible.
 */
export class BandStore {
  private list: BandSong[]
  private bandName: string
  private readonly dataDir: string
  private readonly file: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, name: string, songs: BandSong[]) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, BAND_FILE)
    this.bandName = name
    this.list = songs
  }

  /** Reads band.json once at startup. A missing file is an empty band; a damaged one is set aside. */
  static async load(dataDir: string, inRoot: InRoot): Promise<BandStore> {
    const file = path.join(dataDir, BAND_FILE)
    const empty = () => new BandStore(dataDir, DEFAULT_BAND_NAME, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      console.warn(`[谱库] 乐队数据读取失败，已当作空乐队：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      // Keep the damaged file for the band to look at; start empty.
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] 乐队数据文件损坏，已改名保留并从空乐队开始：${file}`)
      return empty()
    }
    const rec = raw as Record<string, unknown>
    const name =
      typeof rec.name === 'string' && codePoints(rec.name.trim()) >= 1 && codePoints(rec.name.trim()) <= MAX_BAND_NAME
        ? rec.name.trim()
        : DEFAULT_BAND_NAME
    return new BandStore(dataDir, name, sanitizeSongs(rec.songs, inRoot))
  }

  songs(): BandSong[] {
    return [...this.list]
  }

  name(): string {
    return this.bandName
  }

  get(id: string): BandSong | undefined {
    return this.list.find((s) => s.id === id)
  }

  /** True when a song in the setlist uses this library path (used for access control). */
  hasPath(p: string): boolean {
    return this.list.some((s) => s.path === p)
  }

  /** Appends a song (status learning, no parts). The same path twice is a 409. */
  add(body: AddBandSongBody, userId: string, now: number): Promise<BandSong> {
    return this.queue(async () => {
      if (this.hasPath(body.path)) throw new BandError(409, '这首歌已经在歌单里了。')
      const song: BandSong = {
        id: freshId(this.list),
        path: body.path,
        title: body.title,
        artist: body.artist,
        status: 'learning',
        parts: {},
        note: '',
        rehearsalSpeedPct: null,
        addedBy: userId,
        addedAt: now,
        updatedAt: now,
      }
      await this.commit([...this.list, song])
      return song
    })
  }

  /** Merges the given fields into a song. `parts`, when given, replaces the whole map. */
  update(body: UpdateBandSongBody, now: number): Promise<BandSong> {
    return this.queue(async () => {
      const old = this.list.find((s) => s.id === body.id)
      if (!old) throw new BandError(404, '找不到这首歌。')
      const updated: BandSong = {
        ...old,
        status: body.status ?? old.status,
        parts: body.parts !== undefined ? { ...body.parts } : old.parts,
        note: body.note ?? old.note,
        rehearsalSpeedPct: body.rehearsalSpeedPct !== undefined ? body.rehearsalSpeedPct : old.rehearsalSpeedPct,
        updatedAt: now,
      }
      await this.commit(this.list.map((s) => (s.id === old.id ? updated : s)))
      return updated
    })
  }

  remove(id: string): Promise<void> {
    return this.queue(async () => {
      if (!this.list.some((s) => s.id === id)) throw new BandError(404, '找不到这首歌。')
      await this.commit(this.list.filter((s) => s.id !== id))
    })
  }

  /** Sets the setlist order; `ids` must be a permutation of the current ids. */
  reorder(ids: readonly string[]): Promise<void> {
    return this.queue(async () => {
      const byId = new Map(this.list.map((s) => [s.id, s]))
      const same =
        ids.length === this.list.length && new Set(ids).size === ids.length && ids.every((id) => byId.has(id))
      if (!same) throw new BandError(400, '歌单顺序已变化，请刷新后再调整。')
      await this.commit(ids.map((id) => byId.get(id)!))
    })
  }

  rename(name: string): Promise<void> {
    return this.queue(async () => {
      const trimmed = name.trim()
      if (codePoints(trimmed) < 1 || codePoints(trimmed) > MAX_BAND_NAME)
        throw new BandError(400, `乐队名要在 1–${MAX_BAND_NAME} 个字符之间。`)
      await this.commit(this.list, trimmed)
    })
  }

  /** Takes a member out of every song's parts (used when their account is deleted). */
  dropUser(userId: string): Promise<void> {
    return this.queue(async () => {
      const touched = this.list.some((s) => Object.values(s.parts).includes(userId))
      if (!touched) return
      const next = this.list.map((s) => {
        if (!Object.values(s.parts).includes(userId)) return s
        const parts: Record<string, string> = {}
        for (const [k, v] of Object.entries(s.parts)) if (v !== userId) parts[k] = v
        return { ...s, parts }
      })
      await this.commit(next)
    })
  }

  /** Writes the new state first; only then does it replace the in-memory one. */
  private async commit(songs: BandSong[], name: string = this.bandName): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ version: 1, name, songs }))
    this.list = songs
    this.bandName = name
  }
}

/**
 * The band view for GET /api/band. `progress` gives each song's members' practice
 * (keyed by library path); only current members with some practice are kept.
 */
export function bandState(
  store: BandStore,
  members: UserInfo[],
  progress: (path: string) => MemberProgress[],
): BandState {
  const memberIds = new Set(members.map((m) => m.id))
  const songs = store.songs()
  const progressById: Record<string, MemberProgress[]> = {}
  for (const song of songs) {
    const list = progress(song.path).filter((p) => memberIds.has(p.userId))
    if (list.length) progressById[song.id] = list
  }
  return { name: store.name(), songs, members: [...members], progress: progressById }
}
