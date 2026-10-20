/**
 * The band (乐队) of the score server: one shared setlist with each song's
 * status, who plays which part, a shared note, a rehearsal speed, the 补位
 * settings, 小节留言, and today's rehearsal setlist. Kept in SCORES_DATA/band.json.
 * Validation and the state view are pure so they can be tested; the store writes
 * atomically and serialises its changes.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AddBandSongBody,
  AddCommentBody,
  BandLimits,
  BandSong,
  BandState,
  BarComment,
  FillConfig,
  FillDrumSource,
  FillMode,
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
/** 小节留言 text, in code points. */
export const MAX_COMMENT_CHARS = 200
export const MAX_COMMENTS_PER_SONG = 200
/** 今天排练的歌单 length. */
export const MAX_SETLIST = 50
const MAX_TRACKS = 64
const MAX_BAR = 10000

const SCORE_EXTENSIONS = ['.gp', '.gp3', '.gp4', '.gp5', '.gpx', '.musicxml', '.xml', '.mxl']
const STATUSES: readonly SongStatus[] = ['learning', 'ready', 'maybe']
const FILL_MODES: readonly FillMode[] = ['auto', 'on', 'off']
const DRUM_SOURCES: readonly FillDrumSource[] = ['auto', 'file', 'saved', 'generated', 'metronome']

/** Track index as a string key: "0".."63", no leading zeros. */
const TRACK_KEY = /^(?:0|[1-9]|[1-5]\d|6[0-3])$/
/** A 组合乐队谱 recipe id (see server/combos.ts). */
const COMBO_ID = /^[0-9a-f]{12}$/
/** An uploaded song id (see server/uploads.ts). */
const UPLOAD_ID = /^[0-9a-f]{12}$/
/** A 鼓的风格 template id. */
const DRUM_STYLE = /^[A-Za-z0-9_-]{1,40}$/

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

const isFillMode = (v: unknown): v is FillMode => typeof v === 'string' && (FILL_MODES as readonly string[]).includes(v)

const isDrumSource = (v: unknown): v is FillDrumSource =>
  typeof v === 'string' && (DRUM_SOURCES as readonly string[]).includes(v)

const isVolume = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= 150

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

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

/**
 * Validates the 补位 settings (the `fill` of a song). Every field is required:
 * the client always sends the whole config.
 */
export function parseFill(raw: unknown): ParseResult<FillConfig> {
  const bad = { ok: false as const, error: '补位设置格式不对。' }
  if (!isPlainObject(raw)) return bad
  const { tracks, volumes, drums, drumSource, drumStyle, metronome, countIn } = raw

  if (!isPlainObject(tracks)) return bad
  const trackEntries = Object.entries(tracks)
  if (trackEntries.length > MAX_TRACKS) return { ok: false, error: `声部补位设置最多 ${MAX_TRACKS} 项。` }
  const trackOut: Record<string, FillMode> = {}
  for (const [key, mode] of trackEntries) {
    if (!TRACK_KEY.test(key)) return { ok: false, error: '声部编号必须是 0–63 之间的整数。' }
    if (!isFillMode(mode)) return { ok: false, error: '补位模式必须是 auto、on 或 off。' }
    trackOut[key] = mode
  }

  if (!isPlainObject(volumes)) return bad
  const volumeEntries = Object.entries(volumes)
  if (volumeEntries.length > MAX_TRACKS + 1) return { ok: false, error: `音量设置最多 ${MAX_TRACKS + 1} 项。` }
  const volumeOut: Record<string, number> = {}
  for (const [key, vol] of volumeEntries) {
    if (key !== 'drums' && !TRACK_KEY.test(key)) return { ok: false, error: '音量设置里的声部编号不对。' }
    if (!isVolume(vol)) return { ok: false, error: '音量要在 0–150 之间。' }
    volumeOut[key] = vol
  }

  if (!isFillMode(drums)) return { ok: false, error: '鼓的补位模式必须是 auto、on 或 off。' }
  if (!isDrumSource(drumSource)) return { ok: false, error: '鼓的来源不对。' }
  if (drumStyle !== null && (typeof drumStyle !== 'string' || !DRUM_STYLE.test(drumStyle)))
    return { ok: false, error: '鼓的风格不对。' }
  if (typeof metronome !== 'boolean') return { ok: false, error: '节拍器要是开或关。' }
  if (typeof countIn !== 'boolean') return { ok: false, error: '预备拍要是开或关。' }

  return {
    ok: true,
    value: {
      tracks: trackOut,
      volumes: volumeOut,
      drums,
      drumSource,
      drumStyle,
      metronome,
      countIn,
    },
  }
}

/** Validates the body of POST /api/band/songs/update. Only fields present in the body are returned. */
export function parseUpdateSong(
  body: Record<string, unknown>,
  isUser: (id: string) => boolean,
): ParseResult<UpdateBandSongBody> {
  const id = body.id
  if (typeof id !== 'string' || !id || id.length > 64) return { ok: false, error: '找不到这首歌。' }
  const out: UpdateBandSongBody = { id }

  if (body.comboId !== undefined) {
    const c = body.comboId
    if (c !== null && (typeof c !== 'string' || !COMBO_ID.test(c))) return { ok: false, error: '组合乐队谱编号不对。' }
    out.comboId = c as string | null
  }

  if (body.uploadId !== undefined) {
    const u = body.uploadId
    if (u !== null && (typeof u !== 'string' || !UPLOAD_ID.test(u)))
      return { ok: false, error: '上传的谱的编号不对。' }
    out.uploadId = u as string | null
  }

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

  if (body.fill !== undefined) {
    const fill = parseFill(body.fill)
    if (!fill.ok) return fill
    out.fill = fill.value
  }

  return { ok: true, value: out }
}

/** Validates the body of POST /api/band/comments/add. */
export function parseAddComment(body: Record<string, unknown>): ParseResult<AddCommentBody> {
  const songId = body.songId
  if (typeof songId !== 'string' || !songId || songId.length > 64) return { ok: false, error: '找不到这首歌。' }
  const bar = body.bar
  if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > MAX_BAR)
    return { ok: false, error: `小节号要在 1–${MAX_BAR} 之间。` }
  const text = typeof body.text === 'string' ? body.text.trim() : ''
  if (codePoints(text) < 1 || codePoints(text) > MAX_COMMENT_CHARS)
    return { ok: false, error: `留言要在 1–${MAX_COMMENT_CHARS} 个字之间。` }
  return { ok: true, value: { songId, bar, text } }
}

/**
 * Validates the body of POST /api/band/setlist: `ids` are unique band song ids
 * (at most MAX_SETLIST), each one in `currentIds`.
 */
export function parseSetlist(body: Record<string, unknown>, currentIds: readonly string[]): ParseResult<string[]> {
  const ids = body.ids
  if (!Array.isArray(ids) || !ids.every((v): v is string => typeof v === 'string'))
    return { ok: false, error: '今天的歌单格式不对。' }
  if (ids.length > MAX_SETLIST) return { ok: false, error: `今天的歌单最多 ${MAX_SETLIST} 首。` }
  if (new Set(ids).size !== ids.length) return { ok: false, error: '今天的歌单里有重复的歌。' }
  const current = new Set(currentIds)
  if (ids.some((id) => !current.has(id))) return { ok: false, error: '今天的歌单里有歌已经不在乐队歌单里了。' }
  return { ok: true, value: [...ids] }
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

/** Keeps the stored 小节留言 that are well-formed (oldest first, at most MAX_COMMENTS_PER_SONG). */
function sanitizeComments(raw: unknown): BarComment[] {
  if (!Array.isArray(raw)) return []
  const out: BarComment[] = []
  const seen = new Set<string>()
  for (const e of raw) {
    if (out.length >= MAX_COMMENTS_PER_SONG) break
    if (!e || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const { id, bar, text, userId, at } = rec
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > MAX_BAR) continue
    if (typeof text !== 'string') continue
    const trimmed = text.trim()
    if (codePoints(trimmed) < 1 || codePoints(trimmed) > MAX_COMMENT_CHARS) continue
    if (typeof userId !== 'string' || !userId) continue
    if (typeof at !== 'number' || !Number.isFinite(at)) continue
    seen.add(id)
    out.push({ id, bar, text: trimmed, userId, at })
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
    // Rows saved before 补位 have no valid fill: they stay without one (all automatic).
    const fill = parseFill(rec.fill)
    out.push({
      // Rows saved before combos have no comboId: treat as null.
      comboId: typeof rec.comboId === 'string' && COMBO_ID.test(rec.comboId) ? rec.comboId : null,
      uploadId: typeof rec.uploadId === 'string' && UPLOAD_ID.test(rec.uploadId) ? rec.uploadId : null,
      id: rec.id,
      path: p,
      title: typeof rec.title === 'string' ? rec.title : '',
      artist: typeof rec.artist === 'string' ? rec.artist : '',
      status: isStatus(rec.status) ? rec.status : 'learning',
      parts: sanitizeParts(rec.parts),
      note: typeof rec.note === 'string' ? [...rec.note].slice(0, MAX_BAND_NOTE).join('') : '',
      rehearsalSpeedPct: speed === null || isSpeed(speed) ? (speed as number | null) : null,
      ...(fill.ok ? { fill: fill.value } : {}),
      comments: sanitizeComments(rec.comments),
      addedBy: typeof rec.addedBy === 'string' ? rec.addedBy : '',
      addedAt,
      updatedAt: num(rec.updatedAt, addedAt),
    })
  }
  return out
}

/** Keeps the stored 今天的歌单 ids that are songs of the band, once each, in order. */
function sanitizeSetlist(raw: unknown, songs: readonly BandSong[]): string[] {
  if (!Array.isArray(raw)) return []
  const known = new Set(songs.map((s) => s.id))
  const seen = new Set<string>()
  const out: string[] = []
  for (const id of raw) {
    if (out.length >= MAX_SETLIST) break
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

const freshId = (taken: readonly BandSong[]): string => {
  for (;;) {
    const id = randomBytes(5).toString('hex')
    if (!taken.some((s) => s.id === id)) return id
  }
}

const freshCommentId = (taken: readonly BarComment[]): string => {
  for (;;) {
    const id = randomBytes(4).toString('hex')
    if (!taken.some((c) => c.id === id)) return id
  }
}

/**
 * The band's setlist and name. Reads are synchronous from memory; every change
 * goes through one serial queue and is written to disk before it becomes visible.
 */
export class BandStore {
  private list: BandSong[]
  private bandName: string
  private setlistIds: string[]
  private readonly dataDir: string
  private readonly file: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, fileName: string, name: string, songs: BandSong[], setlist: string[]) {
    this.dataDir = dataDir
    this.file = path.join(dataDir, fileName)
    this.bandName = name
    this.list = songs
    this.setlistIds = setlist
  }

  /** Reads the band's file once at startup. A missing file is an empty band; a damaged one is set aside. */
  static async load(dataDir: string, inRoot: InRoot, fileName: string = BAND_FILE): Promise<BandStore> {
    const file = path.join(dataDir, fileName)
    const empty = () => new BandStore(dataDir, fileName, DEFAULT_BAND_NAME, [], [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      // Not readable now (permissions, a disk not mounted yet): never start empty, or the
      // next change would overwrite the real file.
      throw new Error(`乐队数据 ${file} 读取失败：${(err as Error).message}`)
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
    const songs = sanitizeSongs(rec.songs, inRoot)
    // Files saved before the rehearsal setlist have none: an empty list.
    return new BandStore(dataDir, fileName, name, songs, sanitizeSetlist(rec.rehearsalSetlist, songs))
  }

  songs(): BandSong[] {
    return [...this.list]
  }

  name(): string {
    return this.bandName
  }

  /** Today's rehearsal setlist (band song ids, in order). */
  setlist(): string[] {
    return [...this.setlistIds]
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
        comboId: null,
        uploadId: null,
        comments: [],
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
        comboId: body.comboId !== undefined ? body.comboId : (old.comboId ?? null),
        uploadId: body.uploadId !== undefined ? body.uploadId : (old.uploadId ?? null),
        fill: body.fill ?? old.fill,
        updatedAt: now,
      }
      await this.commit(this.list.map((s) => (s.id === old.id ? updated : s)))
      return updated
    })
  }

  /** Appends a 小节留言 to a song. A full song (200 comments) is a 409. */
  addComment(body: AddCommentBody, userId: string, now: number): Promise<BandSong> {
    return this.queue(async () => {
      const old = this.list.find((s) => s.id === body.songId)
      if (!old) throw new BandError(404, '找不到这首歌。')
      const comments = old.comments ?? []
      if (comments.length >= MAX_COMMENTS_PER_SONG)
        throw new BandError(409, `这首歌的留言太多了（最多 ${MAX_COMMENTS_PER_SONG} 条），先删掉一些。`)
      const comment: BarComment = {
        id: freshCommentId(comments),
        bar: body.bar,
        text: body.text,
        userId,
        at: now,
      }
      const updated: BandSong = { ...old, comments: [...comments, comment], updatedAt: now }
      await this.commit(this.list.map((s) => (s.id === old.id ? updated : s)))
      return updated
    })
  }

  /** Deletes a 小节留言; only its author, or a moderator (the band's leader or an admin), may. */
  removeComment(songId: string, commentId: string, actor: { id: string; moderator: boolean }): Promise<BandSong> {
    return this.queue(async () => {
      const old = this.list.find((s) => s.id === songId)
      if (!old) throw new BandError(404, '找不到这首歌。')
      const comment = (old.comments ?? []).find((c) => c.id === commentId)
      if (!comment) throw new BandError(404, '找不到这条留言。')
      if (comment.userId !== actor.id && !actor.moderator)
        throw new BandError(403, '只有写留言的人、队长或管理员可以删除。')
      const updated: BandSong = { ...old, comments: (old.comments ?? []).filter((c) => c.id !== commentId) }
      await this.commit(this.list.map((s) => (s.id === old.id ? updated : s)))
      return updated
    })
  }

  remove(id: string): Promise<void> {
    return this.queue(async () => {
      if (!this.list.some((s) => s.id === id)) throw new BandError(404, '找不到这首歌。')
      await this.commit(
        this.list.filter((s) => s.id !== id),
        this.bandName,
        this.setlistIds.filter((x) => x !== id),
      )
    })
  }

  /** Sets today's rehearsal setlist; every id must be a song of the band (unique, at most MAX_SETLIST). */
  setSetlist(ids: string[]): Promise<void> {
    return this.queue(async () => {
      const checked = parseSetlist({ ids }, this.list.map((s) => s.id))
      if (!checked.ok) throw new BandError(400, checked.error)
      await this.commit(this.list, this.bandName, checked.value)
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

  /** Takes a member out of every song's parts (used when their account is deleted). Comments stay. */
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
  private async commit(
    songs: BandSong[],
    name: string = this.bandName,
    setlist: string[] = this.setlistIds,
  ): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ version: 1, name, songs, rehearsalSetlist: setlist }))
    this.list = songs
    this.bandName = name
    this.setlistIds = setlist
  }
}

/**
 * The band view for GET /api/band. `progress` gives each song's members' practice
 * (keyed by library path); only current members with some practice are kept.
 */
export function bandState(
  store: BandStore,
  meta: { id: string; leaderId: string; limits: BandLimits; storageUsed: number },
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
  return {
    id: meta.id,
    leaderId: meta.leaderId,
    limits: { ...meta.limits },
    storageUsed: meta.storageUsed,
    name: store.name(),
    songs,
    rehearsalSetlist: store.setlist(),
    members: [...members],
    progress: progressById,
  }
}
