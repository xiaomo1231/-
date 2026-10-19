/**
 * 谱库服务 (read-only): serves the student's own guitar-score folder to their
 * own browser and their band's, behind accounts. Nothing is uploaded, nothing is
 * written to the folder. Run it with `node server-dist/server.mjs` (see server/README.md).
 *
 * Configuration (environment variables):
 *   SCORES_ROOT      required  absolute path of the score folder
 *   SCORES_PASSWORD  required  first password of the admin account "admin" (at least 8 characters;
 *                              used only while SCORES_DATA has no accounts yet)
 *   PORT             default 8790
 *   HOST             default 127.0.0.1 (use 0.0.0.0 or the Tailscale IP on purpose)
 *   SCORES_DATA      default ~/.groovelab-scores (scan cache and session secret)
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { search } from '../src/songs/scoreLibrary'
import {
  narrowIndex,
  parseCatalogParams,
  parseTopLimit,
  rankByVersions,
  sortResultSongs,
  topSongs,
  type RankedSong,
} from './catalog'
import {
  createSerialQueue,
  inRootOf,
  loadFavoritesByUser,
  parseFavoriteInput,
  parseFavoritePath,
  parseRenameInput,
  parseRenameSongInput,
  removeFavorite,
  renameItems,
  saveFavoritesByUser,
  upsertFavorite,
  type FavoriteItem,
  type FavoritesByUser,
  type InRoot,
} from './favorites'
import {
  applyPracticeUpdate,
  loadPracticeByUser,
  parsePracticePath,
  parsePracticeUpdate,
  progressFor,
  removePractice,
  savePracticeByUser,
  type PracticeByUser,
} from './practice'
import {
  createSession,
  parseLogin,
  parseNewUser,
  parseUpdateMe,
  parseUpdateUser,
  publicUser,
  UserError,
  UserStore,
  verifySession,
  type StoredUser,
} from './users'
import {
  BandError,
  BandStore,
  bandState,
  parseAddSong,
  parseRename,
  parseAddComment,
  parseSetlist,
  parseReorder,
  parseUpdateSong,
} from './band'
import { RehearsalHub, parseRehearsalBody } from './rehearsal'
import {
  MAX_UPLOAD_BYTES,
  UploadError,
  UploadStore,
  parseNewUploadSong,
  parseUploadQuery as parseUploadFileQuery,
  readUploadBody as readUploadFileBody,
} from './uploads'
import { isUploadPath } from '../src/songs/uploadPaths'
import { InviteError, InviteStore, newUserFromInvite, parseAccept, parseNewInvite } from './invites'
import {
  MAX_RECORDING_BYTES,
  RecordingError,
  RecordingStore,
  parseRecordingQuery,
  readRecordingBody,
  serveRecording,
} from './recordings'
import { songBars } from '../src/songs/drumScore'
import { EnsembleIndex } from './ensembles'
import {
  DrumStore,
  generateDrums,
  loadTemplates,
  parseGenerateBody,
  parseSaveBody,
  styleInfos,
  readScoreFile,
  type DrumEngines,
} from './drums'
import { drumify, drumifyAvailable } from './drumify'
import { generateFromTemplates } from '../src/songs/drumGenerate'
import { buildSongIndex, songInfo } from './songs'
import { annotateSongs, buildJianpuIndex, jianpuForSong } from './jianpu'
import {
  DailyProgressStore,
  dailyState,
  isDailyPath,
  loadDailyProgram,
  type DailyProgram,
} from './daily'
import { ComboError, ComboStore, MAX_COMBO_PARTS, canEditCombo, parseSaveCombo } from './combos'
import {
  ConversionError,
  ConversionQueue,
  ConversionStore,
  conversionStatus,
  convertPdf,
  resolvePdf2gp,
} from './conversions'
import {
  MAX_SHEET_BYTES,
  SheetError,
  SheetStore,
  canEditSheet,
  parseUploadQuery,
  readUploadBody,
  sheetContentType,
} from './sheets'
import type {
  BandState,
  ComboPart,
  InviteCheck,
  SongInfo,
  UploadSong,
} from '../src/songs/scoreServerTypes'
import type { GenerateDrumsResult } from '../src/songs/drumTypes'
import type { ScoreSong } from '../src/songs/scoreLibraryTypes'
import {
  loadFromFiles,
  readCache,
  scanFolder,
  tools,
  writeCache,
  type LoadedLibrary,
} from './library'
import {
  attachmentDisposition,
  createRateLimiter,
  decodeText,
  decodeUrlPath,
  mimeFor,
  parseRange,
  readCookie,
  resolveInside,
  resolveRealFile,
} from './util'

const SESSION_COOKIE = 'gl_session'
const SESSION_MAX_AGE = 30 * 24 * 60 * 60
const LOGIN_MAX_FAILURES = 5
const LOGIN_WINDOW_MS = 10 * 60 * 1000
const MAX_JSON_BODY = 4096
const MAX_FAVORITE_BODY = 64 * 1024
const MAX_TEXT_BYTES = 5 * 1024 * 1024
const MAX_QUERY_LENGTH = 200

export interface Config {
  root: string
  password: string
  port: number
  host: string
  dataDir: string
}

/** Reads the environment; returns a Chinese error message when it is not usable. */
export function readConfig(env: NodeJS.ProcessEnv, home: string): Config | string {
  const root = (env.SCORES_ROOT ?? '').trim()
  if (!root)
    return '缺少 SCORES_ROOT：请设置谱库文件夹的绝对路径，例如 SCORES_ROOT=/Users/你的名字/吉他谱库'
  if (!path.isAbsolute(root)) return 'SCORES_ROOT 必须是绝对路径（以 / 开头）。'
  const password = env.SCORES_PASSWORD ?? ''
  if (!password) return '缺少 SCORES_PASSWORD：请设置访问密码（至少 8 个字符）。'
  if ([...password].length < 8) return 'SCORES_PASSWORD 至少需要 8 个字符，请换一个更长的密码。'
  const portText = (env.PORT ?? '').trim() || '8790'
  const port = Number(portText)
  if (!/^\d+$/.test(portText) || !Number.isInteger(port) || port < 1 || port > 65535)
    return 'PORT 必须是 1–65535 之间的整数。'
  const host = (env.HOST ?? '').trim() || '127.0.0.1'
  const dataDir = (env.SCORES_DATA ?? '').trim() || path.join(home, '.groovelab-scores')
  return { root: path.resolve(root), password, port, host, dataDir }
}

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err))

// ---------------------------------------------------------------------------
// responses
// ---------------------------------------------------------------------------

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  })
  res.end(text)
}

function sendText(res: http.ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(text)
}

async function readJsonBody(
  req: http.IncomingMessage,
  maxBytes = MAX_JSON_BODY,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > maxBytes) throw new HttpError(413, '请求内容太长。')
    chunks.push(chunk as Buffer)
  }
  let body: unknown
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, '请求格式不对。')
  }
  if (!body || typeof body !== 'object' || Array.isArray(body))
    throw new HttpError(400, '请求格式不对。')
  return body as Record<string, unknown>
}

// ---------------------------------------------------------------------------
// server state
// ---------------------------------------------------------------------------

let cfg: Config
let secret: Buffer
let realRoot: string
let webDir: string
let loaded: LoadedLibrary | null = null
let scanning = false
const limiter = createRateLimiter(LOGIN_MAX_FAILURES, LOGIN_WINDOW_MS)
let inRoot: InRoot
let users: UserStore
let band: BandStore
let favorites: FavoritesByUser = new Map()
const favoriteQueue = createSerialQueue()
let practice: PracticeByUser = new Map()
const practiceQueue = createSerialQueue()
const rehearsal = new RehearsalHub()
/** Template drums of the rehearsal, per score file and style (the same on every device). */
const rehearsalDrums = new Map<string, GenerateDrumsResult>()
let ensembles: EnsembleIndex
let drums: DrumStore
let sheets: SheetStore
let invites: InviteStore
let recordings: RecordingStore
let uploads: UploadStore
let combos: ComboStore
let conversions: ConversionStore
let daily: DailyProgressStore
let dailyProgram: DailyProgram = { category: null, days: [], backing: [], extras: [] }
const conversionQueue = new ConversionQueue()
const drumLib = loadTemplates()
const drumEngines: DrumEngines = {
  template: (song, o) =>
    generateFromTemplates(song, o.lib, {
      style: o.style,
      seed: o.seed,
      ...(o.range ? { range: o.range } : {}),
    }),
  drumify: (song, o) => {
    if (!drumifyAvailable())
      throw new HttpError(503, '服务器上没有 AI 鼓模型（drumify 文件夹），请改用「模板」生成。')
    return drumify(song, { ...o, seed: Date.now() >>> 0 })
  },
}
/** The unfiltered "most versions" ranking, per library build (a new scan makes a new object). */
const topCache = new WeakMap<LoadedLibrary, RankedSong[]>()

const log = (msg: string) => console.log(`[谱库] ${msg}`)

/** Loads the cached scan if it is for this folder, else scans. One scan at a time. */
async function refreshLibrary(useCache: boolean): Promise<void> {
  if (scanning) return
  scanning = true
  const started = Date.now()
  try {
    if (useCache) {
      const cached = await readCache(cfg.dataDir, cfg.root)
      if (cached) {
        loaded = loadFromFiles(cached.files, cached.scannedAt)
        log(`已从缓存载入：${cached.files.length} 个文件。`)
        startEnsembles(loaded)
        dailyProgram = await loadDailyProgram(cfg.root)
        return
      }
    }
    log('开始扫描谱库，文件多时需要几分钟…')
    const files = await scanFolder(cfg.root, log)
    const scannedAt = Date.now()
    loaded = loadFromFiles(files, scannedAt)
    startEnsembles(loaded)
    dailyProgram = await loadDailyProgram(cfg.root)
    try {
      await writeCache(cfg.dataDir, cfg.root, scannedAt, files)
    } catch (err) {
      log(`缓存保存失败（下次启动会重新扫描）：${errorText(err)}`)
    }
    log(
      `建好谱库：${loaded.lib.artistById.size} 位歌手，用时 ${Math.round((Date.now() - started) / 1000)} 秒。`,
    )
  } catch (err) {
    log(`扫描失败：${errorText(err)}`)
  } finally {
    scanning = false
  }
}

async function loadSecret(dataDir: string): Promise<Buffer> {
  const file = path.join(dataDir, 'secret')
  let hex: string
  try {
    hex = (await fs.promises.readFile(file, 'utf8')).trim()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    hex = randomBytes(32).toString('hex')
    await fs.promises.writeFile(file, hex, { mode: 0o600, flag: 'wx' }).catch(() => {})
    hex = (await fs.promises.readFile(file, 'utf8')).trim()
  }
  const key = Buffer.from(hex, 'hex')
  if (key.length < 32) throw new Error(`${file} 内容损坏，请删除它后重新启动。`)
  return key
}

function isSecure(req: http.IncomingMessage): boolean {
  const proto = String(req.headers['x-forwarded-proto'] ?? '')
    .split(',')[0]
    ?.trim()
  return proto === 'https' || (req.socket as { encrypted?: boolean }).encrypted === true
}

function sessionCookie(value: string, maxAge: number, secure: boolean): string {
  return `${SESSION_COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

function setSession(req: http.IncomingMessage, res: http.ServerResponse, u: StoredUser): void {
  const token = createSession(secret, u, Date.now(), SESSION_MAX_AGE * 1000)
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE, isSecure(req)))
}

/** The signed-in account, or null (no cookie, expired, account removed or password changed since). */
function currentUser(req: http.IncomingMessage): StoredUser | null {
  const s = verifySession(readCookie(req.headers.cookie, SESSION_COOKIE), secret, Date.now())
  if (!s) return null
  const u = users.get(s.userId)
  return u && u.sessionVersion === s.version ? u : null
}

const canBrowse = (u: StoredUser) => u.role === 'admin' || u.libraryAccess

function requireBrowse(u: StoredUser): void {
  if (!canBrowse(u)) throw new HttpError(403, '你的账号只能查看乐队歌单里的谱子。')
}

function requireAdmin(u: StoredUser): void {
  if (u.role !== 'admin') throw new HttpError(403, '只有管理员可以这样做。')
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

function requireLibrary(): LoadedLibrary {
  if (!loaded) throw new HttpError(503, '谱库正在扫描，请稍后再试。')
  return loaded
}

/** Turns a validation result into its value, or a 400 response. */
function orBadRequest<T>(r: { ok: true; value: T } | { ok: false; error: string }): T {
  if (!r.ok) throw new HttpError(400, r.error)
  return r.value
}

async function handleFavorites(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  uid: string,
): Promise<void> {
  if (p === '/api/favorites') {
    if (req.method === 'GET') return sendJson(res, 200, favorites.get(uid) ?? [])
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const body = await readJsonBody(req, MAX_FAVORITE_BODY)
    const item = orBadRequest(parseFavoriteInput(body, inRoot, Date.now()))
    const next = await favoriteQueue(() =>
      persistFavorites(uid, (list) => upsertFavorite(list, item)),
    )
    return sendJson(res, 200, next)
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = await readJsonBody(req, MAX_FAVORITE_BODY)
  // POST /api/favorites/rename: this account's own name for one favourite.
  if (p === '/api/favorites/rename') {
    const { path: rel, alias } = orBadRequest(parseRenameInput(body, inRoot))
    const next = await favoriteQueue(() =>
      persistFavorites(uid, (list) => {
        if (!list.some((f) => f.path === rel)) throw new HttpError(404, '收藏里没有这个谱。')
        return renameItems(list, [rel], 'alias', alias)
      }),
    )
    return sendJson(res, 200, next)
  }
  // POST /api/favorites/renameSong: this account's own name for a song heading.
  if (p === '/api/favorites/renameSong') {
    const { paths, songAlias } = orBadRequest(parseRenameSongInput(body))
    const next = await favoriteQueue(() =>
      persistFavorites(uid, (list) => renameItems(list, paths, 'songAlias', songAlias)),
    )
    return sendJson(res, 200, next)
  }
  // POST /api/favorites/remove
  const rel = orBadRequest(parseFavoritePath(body, inRoot))
  const next = await favoriteQueue(() => persistFavorites(uid, (list) => removeFavorite(list, rel)))
  return sendJson(res, 200, next)
}

/** Changes one account's favourites (or drops the account's list), writes the file, then keeps the result. */
async function persistFavorites(
  uid: string,
  change: ((list: FavoriteItem[]) => FavoriteItem[]) | null,
): Promise<FavoriteItem[]> {
  const next = new Map(favorites)
  let list: FavoriteItem[] = []
  if (change) {
    list = change(favorites.get(uid) ?? [])
    next.set(uid, list)
  } else next.delete(uid)
  try {
    await saveFavoritesByUser(cfg.dataDir, next)
  } catch (err) {
    log(`收藏保存失败：${errorText(err)}`)
    throw new HttpError(500, '收藏保存失败，请检查 SCORES_DATA 文件夹是否可写。')
  }
  favorites = next
  return list
}

async function handlePractice(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  uid: string,
): Promise<void> {
  if (p === '/api/practice' && req.method === 'GET')
    return sendJson(res, 200, practice.get(uid) ?? [])
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = await readJsonBody(req, MAX_FAVORITE_BODY)
  if (p === '/api/practice') {
    const update = orBadRequest(parsePracticeUpdate(body, inRoot))
    const record = await practiceQueue(async () => {
      const r = applyPracticeUpdate(practice.get(uid) ?? [], update, Date.now())
      await persistPractice(new Map(practice).set(uid, r.list))
      return r.record
    })
    return sendJson(res, 200, record)
  }
  // POST /api/practice/remove
  const rel = orBadRequest(parsePracticePath(body, inRoot))
  const next = await practiceQueue(async () => {
    const list = removePractice(practice.get(uid) ?? [], rel)
    await persistPractice(new Map(practice).set(uid, list))
    return list
  })
  return sendJson(res, 200, next)
}

/** Writes the practice records, then keeps them in memory. */
async function persistPractice(next: PracticeByUser): Promise<void> {
  try {
    await savePracticeByUser(cfg.dataDir, next)
  } catch (err) {
    log(`练习记录保存失败：${errorText(err)}`)
    throw new HttpError(500, '练习记录保存失败，请检查 SCORES_DATA 文件夹是否可写。')
  }
  practice = next
}

/** Account and band errors carry their own status. */
function asHttp(err: unknown): never {
  if (err instanceof UserError || err instanceof BandError)
    throw new HttpError(err.status, err.message)
  throw err
}

const storedUsers = (): StoredUser[] =>
  users
    .list()
    .map((u) => users.get(u.id))
    .filter((u): u is StoredUser => u !== undefined)

async function handleUsers(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  me: StoredUser,
): Promise<void> {
  if (p === '/api/me/update') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const body = orBadRequest(parseUpdateMe(await readJsonBody(req)))
    const info = await users.updateMe(me.id, body).catch(asHttp)
    // A new password signs out the other devices; this one gets a fresh session.
    const fresh = users.get(me.id)
    if (fresh && body.newPassword) setSession(req, res, fresh)
    return sendJson(res, 200, info)
  }
  requireAdmin(me)
  if (p === '/api/users') {
    if (req.method === 'GET') return sendJson(res, 200, users.list())
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const body = orBadRequest(parseNewUser(await readJsonBody(req), storedUsers()))
    await users.create(body).catch(asHttp)
    log(`新建账号：${body.username}`)
    return sendJson(res, 200, users.list())
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  if (p === '/api/users/update') {
    const body = orBadRequest(parseUpdateUser(await readJsonBody(req), storedUsers()))
    await users.update(body).catch(asHttp)
    return sendJson(res, 200, users.list())
  }
  if (p !== '/api/users/remove') return sendJson(res, 404, { error: '找不到这个接口。' })
  const body = await readJsonBody(req)
  const id = typeof body.id === 'string' ? body.id : ''
  if (id === me.id) throw new HttpError(400, '不能删除自己的账号。')
  await users.remove(id).catch(asHttp)
  // Their part assignments, favourites and practice go with the account.
  await band.dropUser(id).catch(asHttp)
  await invites.forgetUser(id)
  await daily.dropUser(id)
  await favoriteQueue(() => persistFavorites(id, null))
  await practiceQueue(async () => {
    const next = new Map(practice)
    next.delete(id)
    await persistPractice(next)
  })
  log(`删除账号：${id}`)
  return sendJson(res, 200, users.list())
}

/** A library file, or an uploaded one (`~uploads/…`, kept in SCORES_DATA/uploads/). */
function resolveAnyFile(rel: string): Promise<string | null> {
  return isUploadPath(rel) ? uploads.resolve(rel) : resolveRealFile(cfg.root, realRoot, rel)
}

/** Tells every open band page and rehearsal screen to read the band again. */
function bandChanged(): void {
  rehearsal.notifyBand()
}

function currentBand(): BandState {
  return bandState(band, users.list(), (path) => progressFor(practice, path))
}

async function handleBand(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  me: StoredUser,
): Promise<void> {
  if (p === '/api/band') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    return sendJson(res, 200, currentBand())
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = await readJsonBody(req, MAX_FAVORITE_BODY)
  const now = Date.now()
  if (p === '/api/band/songs/add') {
    // Adding a song means picking it from the library.
    requireBrowse(me)
    await band.add(orBadRequest(parseAddSong(body, inRoot)), me.id, now).catch(asHttp)
  } else if (p === '/api/band/songs/update') {
    const u = orBadRequest(parseUpdateSong(body, (id) => users.get(id) !== undefined))
    if (u.comboId && !combos.get(u.comboId)) throw new HttpError(400, '找不到这个组合乐队谱。')
    await band.update(u, now).catch(asHttp)
  } else if (p === '/api/band/songs/remove') {
    const id = typeof body.id === 'string' ? body.id : ''
    await band.remove(id).catch(asHttp)
    await recordings.removeSong(id)
  } else if (p === '/api/band/songs/reorder') {
    const ids = orBadRequest(
      parseReorder(
        body,
        band.songs().map((x) => x.id),
      ),
    )
    await band.reorder(ids).catch(asHttp)
  } else if (p === '/api/band/rename') {
    await band.rename(orBadRequest(parseRename(body))).catch(asHttp)
  } else if (p === '/api/band/songs/addUpload') {
    const u = uploads.get(typeof body.uploadId === 'string' ? body.uploadId : '')
    if (!u) throw new HttpError(404, '找不到这首上传的歌。')
    await addUploadToBand(u, me, now)
  } else if (p === '/api/band/comments/add') {
    await band.addComment(orBadRequest(parseAddComment(body)), me.id, now).catch(asHttp)
  } else if (p === '/api/band/comments/remove') {
    const songId = typeof body.songId === 'string' ? body.songId : ''
    const commentId = typeof body.commentId === 'string' ? body.commentId : ''
    await band.removeComment(songId, commentId, { id: me.id, role: me.role }).catch(asHttp)
  } else if (p === '/api/band/setlist') {
    const ids = orBadRequest(
      parseSetlist(
        body,
        band.songs().map((x) => x.id),
      ),
    )
    await band.setSetlist(ids).catch(asHttp)
  } else return sendJson(res, 404, { error: '找不到这个接口。' })
  bandChanged()
  return sendJson(res, 200, currentBand())
}

/**
 * An uploaded song on the setlist: the band song plays its first score file; with
 * several score files every track of every file is put together as one 组合乐队谱
 * (aligned by bar; the 组合 page adjusts offsets). Called again, it re-makes the combo.
 */
async function addUploadToBand(u: UploadSong, me: StoredUser, now: number): Promise<void> {
  const scores = u.files.filter((f) => f.kind === 'score')
  if (scores.length === 0)
    throw new HttpError(400, '至少要上传一个 GP 或 MusicXML 文件才能加入歌单（PDF 可以先转换成 GP）。')
  let song = band.songs().find((b) => b.uploadId === u.id && isUploadPath(b.path))
  if (!song) {
    const added = await band
      .add({ path: scores[0]!.path, title: u.title, artist: u.artist }, me.id, now)
      .catch(asHttp)
    song = await band.update({ id: added.id, uploadId: u.id }, now).catch(asHttp)
  }
  if (scores.length < 2) return
  const parts: ComboPart[] = []
  for (const f of scores) {
    const real = await uploads.resolve(f.path)
    if (!real) continue
    let names: string[]
    try {
      names = (await readScoreFile(real)).tracks.map((t) => t.name.trim())
    } catch {
      throw new HttpError(422, `读不出「${f.name}」，请确认它是能用 Guitar Pro 打开的文件。`)
    }
    names.forEach((n, i) =>
      parts.push({
        path: f.path,
        track: i,
        name: names.length > 1 ? `${f.label} · ${n || `音轨 ${i + 1}`}` : f.label,
        offsetBars: 0,
        transpose: 0,
        unrollRepeats: false,
      }),
    )
  }
  if (parts.length > MAX_COMBO_PARTS)
    throw new HttpError(
      400,
      `这些文件一共有 ${parts.length} 个声部，组合乐队谱最多 ${MAX_COMBO_PARTS} 个。请删掉一些文件，或到「组合乐队谱」里自己挑。`,
    )
  const recipe = await combos
    .save(
      {
        id: song.comboId && combos.get(song.comboId) ? song.comboId : null,
        songKey: `upload#${u.id}`,
        title: u.title,
        artist: u.artist,
        base: scores[0]!.path,
        baseUnrollRepeats: false,
        parts,
      },
      me.id,
      now,
    )
    .catch((err: unknown) => {
      if (err instanceof ComboError) throw new HttpError(err.status, err.message)
      throw err
    })
  await band.update({ id: song.id, comboId: recipe.id, parts: {} }, now).catch(asHttp)
}

/** 自己上传的谱 / 新建歌曲: any member can upload; the files stay in SCORES_DATA/uploads/. */
async function handleUploads(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  const now = Date.now()
  const find = (id: unknown) => {
    const u = uploads.get(typeof id === 'string' ? id : '')
    if (!u) throw new HttpError(404, '找不到这首上传的歌。')
    return u
  }
  try {
    if (p === '/api/uploads') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      return sendJson(res, 200, uploads.list())
    }
    if (p === '/api/uploads/get') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      return sendJson(res, 200, find(url.searchParams.get('id')))
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    if (p === '/api/uploads/file') {
      const q = orBadRequest(parseUploadFileQuery(url))
      find(q.id)
      const bytes = await readUploadFileBody(req, MAX_UPLOAD_BYTES)
      const song = await uploads.addFile(q.id, { label: q.label, name: q.name }, bytes, me.id, now)
      log(`上传自己的谱：${song.title}（${q.label}）`)
      bandChanged()
      return sendJson(res, 200, song)
    }
    const body = await readJsonBody(req)
    if (p === '/api/uploads/create') {
      const b = orBadRequest(parseNewUploadSong(body))
      const owner = b.bandSongId ? band.get(b.bandSongId) : null
      if (b.bandSongId && !owner) throw new HttpError(404, '这首歌不在乐队歌单里。')
      if (owner?.uploadId && uploads.get(owner.uploadId))
        return sendJson(res, 200, uploads.get(owner.uploadId))
      const song = await uploads.create({ title: b.title, artist: b.artist }, me.id, now)
      if (owner) await band.update({ id: owner.id, uploadId: song.id }, now).catch(asHttp)
      bandChanged()
      return sendJson(res, 200, song)
    }
    const u = find(body.id)
    let out: UploadSong | null = null
    if (p === '/api/uploads/update') {
      const title = typeof body.title === 'string' ? body.title.trim() : ''
      const artist = typeof body.artist === 'string' ? body.artist.trim() : ''
      if ([...title].length < 1 || [...title].length > 80)
        throw new HttpError(400, '歌名要在 1–80 个字之间。')
      if ([...artist].length > 80) throw new HttpError(400, '歌手名最多 80 个字。')
      out = await uploads.update(u.id, { title, artist }, now)
    } else if (p === '/api/uploads/file/update') {
      const label = typeof body.label === 'string' ? body.label.trim() : ''
      if ([...label].length < 1 || [...label].length > 20)
        throw new HttpError(400, '声部名要在 1–20 个字之间。')
      out = await uploads.relabel(u.id, typeof body.fileId === 'string' ? body.fileId : '', label, now)
    } else if (p === '/api/uploads/file/remove') {
      const fileId = typeof body.fileId === 'string' ? body.fileId : ''
      const file = u.files.find((f) => f.id === fileId)
      if (file && band.songs().some((b) => b.path === file.path))
        throw new HttpError(409, '这个文件是乐队歌单里这首歌的主谱，不能删除。')
      out = await uploads.removeFile(u.id, fileId, now)
    } else if (p === '/api/uploads/remove') {
      if (band.songs().some((b) => b.uploadId === u.id))
        throw new HttpError(409, '乐队歌单里还有歌在用这些文件，请先从歌单里删除那首歌。')
      await uploads.remove(u.id)
      bandChanged()
      return sendJson(res, 200, { ok: true })
    } else return sendJson(res, 404, { error: '找不到这个接口。' })
    bandChanged()
    return sendJson(res, 200, out)
  } catch (err) {
    if (err instanceof UploadError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** 排练录音: audio files members upload to a band song (kept in SCORES_DATA/recordings/). */
async function handleRecordings(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  try {
    if (p === '/api/recordings') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const songId = url.searchParams.get('songId') ?? ''
      if (!band.get(songId)) return sendJson(res, 404, { error: '这首歌不在乐队歌单里。' })
      return sendJson(res, 200, recordings.list(songId))
    }
    if (p === '/api/recordings/file') {
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const rec = recordings.get(url.searchParams.get('id') ?? '')
      if (!rec) return sendJson(res, 404, { error: '找不到这段录音。' })
      return serveRecording(req, res, recordings.filePath(rec), rec)
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    if (p === '/api/recordings/upload') {
      const q = orBadRequest(parseRecordingQuery(url))
      if (!band.get(q.songId)) return sendJson(res, 404, { error: '这首歌不在乐队歌单里。' })
      const bytes = await readRecordingBody(req, MAX_RECORDING_BYTES)
      await recordings.add(q.songId, { label: q.label, fileName: q.name }, bytes, me.id, Date.now())
      log(`上传排练录音：${q.name || q.label}`)
      bandChanged()
      return sendJson(res, 200, recordings.list(q.songId))
    }
    if (p === '/api/recordings/remove') {
      const body = await readJsonBody(req)
      const rec = recordings.get(typeof body.id === 'string' ? body.id : '')
      if (!rec) return sendJson(res, 404, { error: '找不到这段录音。' })
      if (rec.uploadedBy !== me.id && me.role !== 'admin')
        throw new HttpError(403, '只有上传的人或管理员可以删除。')
      await recordings.remove(rec.id)
      bandChanged()
      return sendJson(res, 200, recordings.list(rec.songId))
    }
    return sendJson(res, 404, { error: '找不到这个接口。' })
  } catch (err) {
    if (err instanceof RecordingError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** 邀请链接 (admin): create, list, revoke. */
async function handleInvites(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  me: StoredUser,
): Promise<void> {
  if (me.role !== 'admin') throw new HttpError(403, '只有管理员可以管理邀请链接。')
  try {
    if (p === '/api/invites') {
      if (req.method === 'GET') return sendJson(res, 200, invites.list())
      if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const body = orBadRequest(parseNewInvite(await readJsonBody(req)))
      const out = await invites.create(body, me.id, Date.now())
      log('生成了一个邀请链接。')
      return sendJson(res, 200, out)
    }
    if (p === '/api/invites/revoke') {
      if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const body = await readJsonBody(req)
      await invites.revoke(typeof body.id === 'string' ? body.id : '')
      return sendJson(res, 200, invites.list())
    }
    return sendJson(res, 404, { error: '找不到这个接口。' })
  } catch (err) {
    if (err instanceof InviteError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** Opening an invite link (no login): check it, or create the account and sign it in. */
async function handleInviteLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown'
  if (limiter.isBlocked(ip)) return sendJson(res, 429, { error: '尝试次数太多，10 分钟后再试。' })
  const now = Date.now()
  if (url.pathname === '/api/invite/check') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const { invite, reason } = invites.check(url.searchParams.get('token') ?? '', now)
    // Guessing tokens counts like a failed login.
    if (!invite) limiter.recordFailure(ip)
    const out: InviteCheck = {
      valid: invite !== null,
      reason,
      bandName: band.name(),
      instrument: invite?.instrument ?? null,
      note: invite?.note ?? '',
    }
    return sendJson(res, 200, out)
  }
  if (url.pathname !== '/api/invite/accept')
    return sendJson(res, 404, { error: '找不到这个接口。' })
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = orBadRequest(parseAccept(await readJsonBody(req)))
  let invite
  try {
    invite = await invites.reserve(body.token, now)
  } catch (err) {
    limiter.recordFailure(ip)
    if (err instanceof InviteError) throw new HttpError(err.status, err.message)
    throw err
  }
  let user
  try {
    user = await users.create(newUserFromInvite(invite, body))
  } catch (err) {
    await invites.release(invite.id)
    return asHttp(err)
  }
  await invites.confirm(invite.id, user.id)
  const stored = users.get(user.id)
  if (stored) setSession(req, res, stored)
  log(`新成员通过邀请链接加入：${user.displayName}`)
  bandChanged()
  return sendJson(res, 200, user)
}

/** 32-bit FNV-1a of a string: the fixed seed of a song's rehearsal drums. */
function seedOf(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

/** 排练: the band's one rehearsal (live state over SSE, commands, template drums). */
async function handleRehearsal(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  if (p === '/api/rehearsal/events') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const device = url.searchParams.get('device') ?? ''
    if (!/^[A-Za-z0-9_-]{8,40}$/.test(device))
      return sendJson(res, 400, { error: '设备编号不对。' })
    const label = [...(url.searchParams.get('label') ?? '')].slice(0, 20).join('') || '设备'
    rehearsal.subscribe(me.id, device, label, req, res)
    return
  }
  if (p === '/api/rehearsal') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    return sendJson(res, 200, rehearsal.state())
  }
  if (p === '/api/rehearsal/drums') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const song = band.get(url.searchParams.get('songId') ?? '')
    if (!song) return sendJson(res, 404, { error: '这首歌不在乐队歌单里。' })
    const style = url.searchParams.get('style') || null
    if (style !== null && !drumLib.styles.some((x) => x.id === style))
      return sendJson(res, 400, { error: '没有这种鼓的风格。' })
    // A combo keeps the bars of its base file, so the drums follow that file.
    const rel = (song.comboId && combos.get(song.comboId)?.base) || song.path
    const key = `${rel}|${style ?? ''}`
    let out = rehearsalDrums.get(key)
    if (!out) {
      const real = await resolveAnyFile(rel)
      if (!real) return sendJson(res, 404, { error: '找不到文件。' })
      let bars
      try {
        bars = songBars(await readScoreFile(real), null)
      } catch {
        throw new HttpError(422, '读不出这个乐谱文件，无法生成鼓谱。')
      }
      if (bars.length === 0) throw new HttpError(422, '这个乐谱没有小节，无法生成鼓谱。')
      const g = generateFromTemplates(bars, drumLib, { style, seed: seedOf(rel) })
      out = { first: g.first, bars: g.bars, source: 'template', style: g.style }
      if (rehearsalDrums.size >= 50) rehearsalDrums.delete(rehearsalDrums.keys().next().value!)
      rehearsalDrums.set(key, out)
    }
    return sendJson(res, 200, out)
  }
  if (p !== '/api/rehearsal/command') return sendJson(res, 404, { error: '找不到这个接口。' })
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = orBadRequest(parseRehearsalBody(await readJsonBody(req, MAX_FAVORITE_BODY)))
  const cmd = body.command
  const ctx = { now: Date.now(), songExists: (id: string) => band.get(id) !== undefined }
  // Starting saves today's setlist first (it shows on the band page too).
  if (cmd.type === 'start') {
    const ids = orBadRequest(
      parseSetlist(
        { ids: cmd.setlist },
        band.songs().map((x) => x.id),
      ),
    )
    if (rehearsal.state().active) throw new HttpError(409, '排练已经开始了。')
    await band.setSetlist(ids).catch(asHttp)
    bandChanged()
  }
  const r = rehearsal.command({ userId: me.id, deviceId: body.deviceId }, cmd, ctx)
  if ('error' in r) return sendJson(res, r.status, { error: r.error })
  if (cmd.type === 'start') log(`开始排练（${me.displayName}）`)
  if (cmd.type === 'end') log(`结束排练（${me.displayName}）`)
  return sendJson(res, 200, r.state)
}

/** 鼓谱: the editable drum part of a score file, its generators and the template styles. */
async function handleDrums(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  // Members who only see the band work on the setlist's songs.
  const allowed = (rel: string) => {
    if (!canBrowse(me) && !band.hasPath(rel))
      throw new HttpError(403, '你的账号只能处理乐队歌单里的谱子。')
  }
  if (p === '/api/drums/styles') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    return sendJson(res, 200, styleInfos(drumLib))
  }
  if (p === '/api/drums') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const rel = url.searchParams.get('path') ?? ''
    allowed(rel)
    return sendJson(res, 200, drums.get(rel) ?? null)
  }
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  if (p === '/api/drums/generate') {
    const body = orBadRequest(parseGenerateBody(await readJsonBody(req), inRoot))
    allowed(body.path)
    const real = await resolveAnyFile(body.path)
    if (!real) return sendJson(res, 404, { error: '找不到文件。' })
    try {
      return sendJson(res, 200, await generateDrums(body, real, drumEngines, drumLib))
    } catch (err) {
      if (err instanceof HttpError) throw err
      throw new HttpError(400, errorText(err))
    }
  }
  if (p === '/api/drums/save') {
    // A long song's part: 2000 bars × a few hits each.
    const part = orBadRequest(parseSaveBody(await readJsonBody(req, 4 * 1024 * 1024), inRoot))
    allowed(part.path)
    return sendJson(res, 200, await drums.save(part, me.id, Date.now()))
  }
  if (p === '/api/drums/remove') {
    const body = await readJsonBody(req)
    const rel = typeof body.path === 'string' ? body.path : ''
    allowed(rel)
    await drums.remove(rel)
    return sendJson(res, 200, { ok: true })
  }
  return sendJson(res, 404, { error: '找不到这个接口。' })
}

/** Songs with `jianpu` = how many 13-简谱 files of the library belong to each. */
function withJianpu(songs: ScoreSong[]): ScoreSong[] {
  const lib = requireLibrary()
  const index = buildJianpuIndex(lib, tools)
  return annotateSongs(index, lib, songs, (id) => lib.lib.artistById.get(id)?.name ?? '')
}

/** The song a score file belongs to (its key and versions); 404 when the library has no such file. */
function songOfPath(rel: string): SongInfo {
  const info = findSong(rel)
  if (!info) throw new HttpError(404, '在谱库里找不到这首歌。')
  return info
}

/** The score files of an uploaded song as versions of a song. */
function uploadVersions(u: UploadSong): SongInfo['versions'] {
  return u.files
    .filter((f) => f.kind === 'score')
    .map((f) => ({ path: f.path, label: `自己上传 · ${f.label}`, tags: ['自己上传'], size: f.size }))
}

/**
 * The song a file belongs to. An uploaded file belongs to its uploaded song, or, when
 * those are the own files of a band song from the library, to that library song; a
 * library song's versions include such own files (so 组合乐队谱 can mix them).
 */
function findSong(rel: string): SongInfo | null {
  if (isUploadPath(rel)) {
    const hit = uploads.fileOf(rel)
    if (!hit) return null
    const owner = band.songs().find((b) => b.uploadId === hit.song.id && !isUploadPath(b.path))
    if (owner) return findSong(owner.path)
    return {
      songKey: `upload#${hit.song.id}`,
      title: hit.song.title,
      artist: hit.song.artist,
      versions: uploadVersions(hit.song),
    }
  }
  const info = songInfo(buildSongIndex(requireLibrary()), rel)
  if (!info) return null
  const index = buildSongIndex(requireLibrary())
  const extra = band
    .songs()
    .filter((b) => b.uploadId && !isUploadPath(b.path) && songInfo(index, b.path)?.songKey === info.songKey)
    .flatMap((b) => {
      const u = uploads.get(b.uploadId!)
      return u ? uploadVersions(u) : []
    })
  return extra.length ? { ...info, versions: [...info.versions, ...extra] } : info
}

/** GET /api/song and 上传的简谱 (/api/sheets…). */
async function handleSongs(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  const allowed = (rel: string) => {
    if (!canBrowse(me) && !band.hasPath(rel))
      throw new HttpError(403, '你的账号只能处理乐队歌单里的谱子。')
  }
  try {
    if (p === '/api/jianpu') {
      const rel = url.searchParams.get('path') ?? ''
      allowed(rel)
      const info = songOfPath(rel)
      const index = buildJianpuIndex(requireLibrary(), tools)
      return sendJson(res, 200, jianpuForSong(index, info.artist, info.title))
    }
    if (p === '/api/song' || p === '/api/sheets') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const rel = url.searchParams.get('path') ?? ''
      allowed(rel)
      const info = songOfPath(rel)
      return sendJson(res, 200, p === '/api/song' ? info : sheets.list(info.songKey))
    }
    if (p === '/api/sheets/file') {
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const item = sheets.get(url.searchParams.get('id') ?? '')
      if (!item) return sendJson(res, 404, { error: '找不到这个文件。' })
      const file = sheets.filePath(item)
      const st = await fs.promises.stat(file)
      const ext = path.extname(file).slice(1)
      res.writeHead(200, {
        'Content-Type': sheetContentType(item.kind, ext as never),
        'Content-Length': st.size,
        'Cache-Control': 'private, max-age=86400',
        // Never run uploaded content as a page of this site.
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
        'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(item.fileName)}`,
      })
      if (req.method === 'HEAD') return void res.end()
      pipeline(fs.createReadStream(file), res, () => {})
      return
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    if (p === '/api/sheets/upload') {
      const q = orBadRequest(parseUploadQuery(url))
      allowed(q.path)
      const info = songOfPath(q.path)
      const bytes = await readUploadBody(req, MAX_SHEET_BYTES)
      await sheets.add(info.songKey, { label: q.label, fileName: q.name }, bytes, me.id, Date.now())
      log(`上传简谱：${info.title}（${q.name || '未命名'}）`)
      return sendJson(res, 200, sheets.list(info.songKey))
    }
    if (p === '/api/sheets/remove') {
      const body = await readJsonBody(req)
      const item = sheets.get(typeof body.id === 'string' ? body.id : '')
      if (!item) return sendJson(res, 404, { error: '找不到这个文件。' })
      if (!canEditSheet(item, me)) throw new HttpError(403, '只有上传的人或管理员可以删除。')
      await sheets.remove(item.id)
      return sendJson(res, 200, sheets.list(item.songKey))
    }
    if (p === '/api/sheets/reorder') {
      const body = await readJsonBody(req, MAX_FAVORITE_BODY)
      const rel = typeof body.path === 'string' ? body.path : ''
      allowed(rel)
      const info = songOfPath(rel)
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((x): x is string => typeof x === 'string')
        : []
      await sheets.reorder(info.songKey, ids)
      return sendJson(res, 200, sheets.list(info.songKey))
    }
    return sendJson(res, 404, { error: '找不到这个接口。' })
  } catch (err) {
    if (err instanceof SheetError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** 组合乐队谱: recipes that put parts of several versions of a song onto one base version. */
async function handleCombos(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  const allowed = (rel: string) => {
    if (!canBrowse(me) && !band.hasPath(rel))
      throw new HttpError(403, '你的账号只能处理乐队歌单里的谱子。')
  }
  try {
    if (p === '/api/combos') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const rel = url.searchParams.get('path') ?? ''
      allowed(rel)
      return sendJson(res, 200, combos.list(songOfPath(rel).songKey))
    }
    if (p === '/api/combos/get') {
      if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
      const item = combos.get(url.searchParams.get('id') ?? '')
      if (!item) return sendJson(res, 404, { error: '找不到这个组合乐队谱。' })
      // Members of the band may open a combo used by a setlist song.
      if (!canBrowse(me) && !band.songs().some((x) => x.comboId === item.id)) allowed(item.base)
      return sendJson(res, 200, item)
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    if (p === '/api/combos/save') {
      const recipe = orBadRequest(
        parseSaveCombo(
          await readJsonBody(req, MAX_FAVORITE_BODY),
          inRoot,
          (rel, key) => findSong(rel)?.songKey === key,
        ),
      )
      if (!canBrowse(me) && !band.hasPath(recipe.base) && !isUploadPath(recipe.base))
        throw new HttpError(403, '你的账号只能处理乐队歌单里的谱子。')
      if (recipe.id) {
        const old = combos.get(recipe.id)
        if (old && !canEditCombo(old, me))
          throw new HttpError(403, '只有创建的人或管理员可以修改这个组合。')
      }
      return sendJson(res, 200, await combos.save(recipe, me.id, Date.now()))
    }
    if (p === '/api/combos/remove') {
      const body = await readJsonBody(req)
      const item = combos.get(typeof body.id === 'string' ? body.id : '')
      if (!item) return sendJson(res, 404, { error: '找不到这个组合乐队谱。' })
      if (!canEditCombo(item, me))
        throw new HttpError(403, '只有创建的人或管理员可以删除这个组合。')
      await combos.remove(item.id)
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { error: '找不到这个接口。' })
  } catch (err) {
    if (err instanceof ComboError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** A file every member may open: the setlist's files, a setlist 组合乐队谱's versions, and 每日一练. */
function bandCanOpen(rel: string): boolean {
  // Uploaded files belong to the band: every member may open them.
  if (isUploadPath(rel) || band.hasPath(rel) || isDailyPath(dailyProgram.category, rel)) return true
  return band.songs().some((x) => {
    const c = x.comboId ? combos.get(x.comboId) : undefined
    return c !== undefined && (c.base === rel || c.parts.some((pt) => pt.path === rel))
  })
}

/** The Python PDF → GP5 helper: next to server.mjs in the export, or in the project in development. */
function pdf2gpTool() {
  return resolvePdf2gp([path.dirname(fileURLToPath(import.meta.url)), process.cwd()])
}

/** PDF 转换版: a PDF converted only when a user asks for it, kept in SCORES_DATA/conversions/. */
async function handleConversions(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
  me: StoredUser,
): Promise<void> {
  const p = url.pathname
  const allowed = (rel: string) => {
    if (!canBrowse(me) && !bandCanOpen(rel))
      throw new HttpError(403, '你的账号只能处理乐队歌单里的谱子。')
  }
  try {
    if (p === '/api/conversions/status') return sendJson(res, 200, conversionStatus(pdf2gpTool()))
    if (p === '/api/conversions') {
      const rel = url.searchParams.get('path') ?? ''
      allowed(rel)
      const key = songOfPath(rel).songKey
      return sendJson(
        res,
        200,
        conversions.list(key).map((c) => conversions.toRecord(c, me.id)),
      )
    }
    if (p === '/api/conversions/get' || p === '/api/conversions/file') {
      const item = conversions.get(url.searchParams.get('id') ?? '')
      if (!item) return sendJson(res, 404, { error: '找不到这个转换版。' })
      allowed(item.sourcePath)
      if (p === '/api/conversions/get') return sendJson(res, 200, conversions.toRecord(item, me.id))
      const file = conversions.filePath(item.id)
      const st = await fs.promises.stat(file)
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'private, max-age=3600',
        'Content-Disposition': attachmentDisposition(`${item.title || '转换'}（PDF 转换）.gp5`),
      })
      pipeline(fs.createReadStream(file), res, () => {})
      return
    }
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const body = await readJsonBody(req)
    if (p === '/api/conversions/start') {
      const rel = typeof body.path === 'string' ? body.path : ''
      allowed(rel)
      if (!rel.toLowerCase().endsWith('.pdf')) throw new HttpError(400, '只能转换 PDF 文件。')
      const tool = pdf2gpTool()
      if (!tool)
        throw new HttpError(503, conversionStatus(null).reason ?? '服务器还没装 PDF 转换组件。')
      const real = await resolveAnyFile(rel)
      if (!real) return sendJson(res, 404, { error: '找不到文件。' })
      const info = songOfPath(rel)
      log(`转换 PDF：${rel}`)
      const record = await convertPdf({
        tool,
        queue: conversionQueue,
        store: conversions,
        absPdf: real,
        sourcePath: rel,
        songKey: info.songKey,
        title: info.title,
        artist: info.artist,
        userId: me.id,
        tmpDir: path.join(cfg.dataDir, 'tmp'),
        now: Date.now(),
      })
      return sendJson(res, 200, record)
    }
    const item = conversions.get(typeof body.id === 'string' ? body.id : '')
    if (!item) return sendJson(res, 404, { error: '找不到这个转换版。' })
    allowed(item.sourcePath)
    if (p === '/api/conversions/rate') {
      const stars = typeof body.stars === 'number' ? body.stars : -1
      await conversions.rate(item.id, me.id, stars)
      const fresh = conversions.get(item.id)
      return sendJson(res, 200, fresh ? conversions.toRecord(fresh, me.id) : null)
    }
    if (p === '/api/conversions/remove') {
      if (item.createdBy !== me.id && me.role !== 'admin')
        throw new HttpError(403, '只有转换的人或管理员可以删除。')
      await conversions.remove(item.id)
      return sendJson(res, 200, { ok: true })
    }
    return sendJson(res, 404, { error: '找不到这个接口。' })
  } catch (err) {
    if (err instanceof ConversionError) throw new HttpError(err.status, err.message)
    throw err
  }
}

/** 每日一练: the program from the library, and each account's progress (day 1 = their first visit). */
async function handleDaily(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
  me: StoredUser,
): Promise<void> {
  const state = () => dailyState(dailyProgram, daily.get(me.id))
  if (p === '/api/daily') return sendJson(res, 200, state())
  if (p === '/api/daily/members')
    return sendJson(res, 200, daily.members(users.list().map((u) => u.id)))
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  if (p === '/api/daily/start') {
    await daily.start(me.id, Date.now())
    return sendJson(res, 200, state())
  }
  if (p === '/api/daily/bpm') {
    const body = await readJsonBody(req)
    const day = body.day
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 365)
      throw new HttpError(400, '天数不对（1–365）。')
    const bpm = body.bpm
    if (typeof bpm !== 'number' || !Number.isInteger(bpm) || bpm < 20 || bpm > 300)
      throw new HttpError(400, '速度不对（20–300 bpm）。')
    await daily.markBpm(me.id, day, bpm, Date.now())
    return sendJson(res, 200, state())
  }
  if (p === '/api/daily/done') {
    const body = await readJsonBody(req)
    const day = body.day
    if (typeof day !== 'number' || !Number.isInteger(day) || day < 1 || day > 365)
      throw new HttpError(400, '天数不对（1–365）。')
    await daily.mark(me.id, day, body.done !== false, Date.now())
    return sendJson(res, 200, state())
  }
  return sendJson(res, 404, { error: '找不到这个接口。' })
}

/** Every score file of the library, for the background track reader (找乐队谱). */
function startEnsembles(lib: LoadedLibrary): void {
  const files: Array<{ path: string; title: string; artist: string }> = []
  for (const [artistId, songs] of lib.lib.songs) {
    const artist = lib.lib.artistById.get(artistId)?.name ?? ''
    for (const song of songs)
      for (const v of song.versions)
        if (v.file.format === 'score') files.push({ path: v.file.path, title: song.title, artist })
  }
  void ensembles.start(files)
}

/** GET /api/ensembles: a search narrows to the matching songs' files first. */
function queryEnsembles(url: URL): unknown {
  const q = (url.searchParams.get('q') ?? '').trim()
  if ([...q].length > MAX_QUERY_LENGTH) throw new HttpError(400, '搜索内容太长。')
  const num = (k: string, d: number) => {
    const v = Number(url.searchParams.get(k) ?? d)
    return Number.isFinite(v) ? Math.max(0, Math.floor(v)) : d
  }
  let paths: Set<string> | undefined
  if (q) {
    const lib = requireLibrary()
    const result = search(lib.lib, lib.index, q, tools)
    paths = new Set(result.songs.flatMap((r) => r.song.versions.map((v) => v.file.path)))
  }
  return ensembles.query({
    paths,
    need: url.searchParams.get('need') ?? '',
    offset: num('offset', 0),
    limit: num('limit', 50),
    untitled: url.searchParams.get('untitled') === '1',
  })
}

function libraryInfo(u: StoredUser): unknown {
  const root = path.basename(cfg.root) || 'root'
  if (!canBrowse(u)) return { root, scannedAt: 0, files: 0, scanning: false, categories: [] }
  if (!loaded) return { root, scannedAt: 0, files: 0, scanning: true, categories: [] }
  return {
    root,
    scannedAt: loaded.scannedAt,
    files: loaded.lib.files,
    scanning,
    categories: loaded.lib.categories,
  }
}

async function handleApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const p = url.pathname

  if (p === '/api/login') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    return handleLogin(req, res)
  }
  if (p === '/api/logout') {
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    res.setHeader('Set-Cookie', sessionCookie('', 0, isSecure(req)))
    return sendJson(res, 200, { ok: true })
  }

  if (p === '/api/invite/check' || p === '/api/invite/accept')
    return handleInviteLink(req, res, url)

  const me = currentUser(req)
  if (!me) return sendJson(res, 401, { error: '请先登录。' })

  if (
    p === '/api/favorites' ||
    p === '/api/favorites/remove' ||
    p === '/api/favorites/rename' ||
    p === '/api/favorites/renameSong'
  )
    return handleFavorites(req, res, p, me.id)
  if (p === '/api/practice' || p === '/api/practice/remove')
    return handlePractice(req, res, p, me.id)
  if (p === '/api/me/update' || p === '/api/users' || p.startsWith('/api/users/'))
    return handleUsers(req, res, p, me)
  if (p === '/api/band' || p.startsWith('/api/band/')) return handleBand(req, res, p, me)
  if (p === '/api/invites' || p.startsWith('/api/invites/')) return handleInvites(req, res, p, me)
  if (p === '/api/uploads' || p.startsWith('/api/uploads/')) return handleUploads(req, res, url, me)
  if (p === '/api/recordings' || p.startsWith('/api/recordings/'))
    return handleRecordings(req, res, url, me)
  if (p === '/api/rehearsal' || p.startsWith('/api/rehearsal/'))
    return handleRehearsal(req, res, url, me)
  if (p === '/api/drums' || p.startsWith('/api/drums/')) return handleDrums(req, res, url, me)
  if (
    p === '/api/song' ||
    p === '/api/jianpu' ||
    p === '/api/sheets' ||
    p.startsWith('/api/sheets/')
  )
    return handleSongs(req, res, url, me)
  if (p === '/api/combos' || p.startsWith('/api/combos/')) return handleCombos(req, res, url, me)
  if (p === '/api/daily' || p.startsWith('/api/daily/')) return handleDaily(req, res, p, me)
  if (p === '/api/conversions' || p.startsWith('/api/conversions/'))
    return handleConversions(req, res, url, me)

  const routes: Record<
    string,
    { method: string; browse?: boolean; run: () => Promise<unknown> | unknown }
  > = {
    '/api/me': { method: 'GET', run: () => publicUser(me) },
    '/api/time': { method: 'GET', run: () => ({ now: Date.now() }) },
    '/api/library': { method: 'GET', run: () => libraryInfo(me) },
    '/api/ensembles': { method: 'GET', browse: true, run: () => queryEnsembles(url) },
    '/api/artists': {
      method: 'GET',
      browse: true,
      run: () => {
        const group = url.searchParams.get('group')
        if (!group) throw new HttpError(400, '缺少 group 参数。')
        return requireLibrary().lib.artists.get(group) ?? []
      },
    },
    '/api/songs': {
      method: 'GET',
      browse: true,
      run: () => {
        const artist = url.searchParams.get('artist')
        if (!artist) throw new HttpError(400, '缺少 artist 参数。')
        return withJianpu(requireLibrary().lib.songs.get(artist) ?? [])
      },
    },
    '/api/search': {
      method: 'GET',
      browse: true,
      run: () => {
        const q = (url.searchParams.get('q') ?? '').trim()
        if ([...q].length > MAX_QUERY_LENGTH) throw new HttpError(400, '搜索内容太长。')
        if (!q) return { artists: [], songs: [], moreSongs: false }
        const opts = orBadRequest(parseCatalogParams(url.searchParams))
        const lib = requireLibrary()
        // Filters apply before the search's own 200-song limit.
        const result = search(lib.lib, narrowIndex(lib.index, opts), q, tools)
        const sorted = sortResultSongs(result.songs, opts.sort)
        const marked = withJianpu(sorted.map((r) => r.song))
        return { ...result, songs: sorted.map((r, i) => ({ ...r, song: marked[i] ?? r.song })) }
      },
    },
    '/api/top': {
      method: 'GET',
      browse: true,
      run: () => {
        const opts = orBadRequest(parseCatalogParams(url.searchParams))
        const lib = requireLibrary()
        let ranked = topCache.get(lib)
        if (!ranked) {
          ranked = rankByVersions(lib.lib)
          topCache.set(lib, ranked)
        }
        const { songs, moreSongs } = topSongs(
          ranked,
          opts,
          parseTopLimit(url.searchParams.get('limit')),
        )
        return {
          artists: [],
          songs: withJianpu(songs.map((r) => r.song)).map((song, i) => ({
            song,
            artistName: songs[i]!.artistName,
            match: 'name',
          })),
          moreSongs,
        }
      },
    },
    '/api/rescan': {
      method: 'POST',
      run: () => {
        requireAdmin(me)
        if (scanning) throw new HttpError(409, '正在扫描，请稍候。')
        void refreshLibrary(false)
        return { ok: true, scanning: true }
      },
    },
  }

  if (p === '/api/text') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    requireBrowse(me)
    return handleText(res, url.searchParams.get('p') ?? '')
  }

  const route = routes[p]
  if (!route) return sendJson(res, 404, { error: '找不到这个接口。' })
  if (req.method !== route.method) return sendJson(res, 405, { error: '不支持这种请求方式。' })
  if (route.browse) requireBrowse(me)
  const status = p === '/api/rescan' ? 202 : 200
  const body = await route.run()
  sendJson(res, status, body)
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown'
  if (limiter.isBlocked(ip)) return sendJson(res, 429, { error: '尝试次数太多，10 分钟后再试。' })
  const body = orBadRequest(parseLogin(await readJsonBody(req)))
  const u = await users.login(body.username, body.password)
  if (!u) {
    limiter.recordFailure(ip)
    log(`登录失败（来自 ${ip}）。`)
    return sendJson(res, 401, { error: '用户名或密码不对。' })
  }
  limiter.clear(ip)
  setSession(req, res, u)
  sendJson(res, 200, publicUser(u))
}

async function handleText(res: http.ServerResponse, rel: string): Promise<void> {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
  if (rel.lastIndexOf('.') < 0 || (ext !== 'txt' && ext !== 'tab'))
    throw new HttpError(400, '只能读取 .txt 或 .tab 文件。')
  const real = await resolveAnyFile(rel)
  if (!real) return sendJson(res, 404, { error: '找不到文件。' })
  const st = await fs.promises.stat(real)
  if (st.size > MAX_TEXT_BYTES)
    return sendJson(res, 413, { error: '文件太大了，无法在网页里显示。' })
  const bytes = await fs.promises.readFile(real)
  sendJson(res, 200, { text: decodeText(bytes) })
}

// ---------------------------------------------------------------------------
// files (score, PDF, image…): streamed, with single Range support
// ---------------------------------------------------------------------------

async function handleFile(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  const me = currentUser(req)
  if (!me) return sendJson(res, 401, { error: '请先登录。' })
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return sendJson(res, 405, { error: '不支持这种请求方式。' })

  const rel = decodeUrlPath(url.pathname.slice('/files/'.length))
  const real = rel === null ? null : await resolveAnyFile(rel)
  if (!real || rel === null) return sendJson(res, 404, { error: '找不到文件。' })
  // Members without library access open only the band's setlist.
  if (!canBrowse(me) && !bandCanOpen(rel))
    return sendJson(res, 403, { error: '你的账号只能查看乐队歌单里的谱子。' })

  const st = await fs.promises.stat(real)
  const size = st.size
  const name = path.basename(rel)
  const headers: Record<string, string | number> = {
    'Content-Type': mimeFor(name),
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=3600',
  }
  if (url.searchParams.get('download') === '1')
    headers['Content-Disposition'] = attachmentDisposition(name)

  const range = parseRange(req.headers.range, size)
  if (range.kind === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}` })
    res.end()
    return
  }
  let start = 0
  let end = size - 1
  if (range.kind === 'partial') {
    start = range.start
    end = range.end
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
    res.writeHead(206, { ...headers, 'Content-Length': end - start + 1 })
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size })
  }
  if (req.method === 'HEAD' || size === 0) {
    res.end()
    return
  }
  pipeline(fs.createReadStream(real, { start, end }), res, () => {
    /* the client went away, or the file vanished mid-read: nothing to add */
  })
}

// ---------------------------------------------------------------------------
// static: the built web UI (server-dist/web) and alphaTab (…/web/alphatab)
// ---------------------------------------------------------------------------

async function handleStatic(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  url: URL,
): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return sendText(res, 405, '不支持这种请求方式。')
  const p = url.pathname
  const inAlphaTab = p === '/alphatab' || p.startsWith('/alphatab/')
  const base = inAlphaTab ? path.join(webDir, 'alphatab') : webDir
  const rawRel = inAlphaTab ? p.slice('/alphatab'.length) : p
  const rel = decodeUrlPath(rawRel.replace(/^\//, ''))
  if (rel === null) return sendText(res, 404, '找不到文件。')

  let file = rel === '' ? null : resolveInside(base, rel)
  if (file && !(await isRegularFile(file))) file = null

  if (!file) {
    // Unknown page paths (no extension) get the app shell; missing assets are 404.
    const last = rel.split('/').pop() ?? ''
    if (inAlphaTab || last.includes('.')) return sendText(res, 404, '找不到文件。')
    file = path.join(webDir, 'index.html')
    if (!(await isRegularFile(file)))
      return sendText(res, 404, '网页还没有构建，请先运行 npm run build:server。')
  }

  const isIndex = path.basename(file) === 'index.html' && path.dirname(file) === webDir
  const st = await fs.promises.stat(file)
  res.writeHead(200, {
    'Content-Type': mimeFor(file),
    'Content-Length': st.size,
    // Sound fonts are large and never change.
    'Cache-Control': isIndex
      ? 'no-cache'
      : p.startsWith('/alphatab/soundfont/')
        ? 'public, max-age=2592000, immutable'
        : 'public, max-age=3600',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  pipeline(fs.createReadStream(file), res, () => {})
}

async function isRegularFile(file: string): Promise<boolean> {
  try {
    return (await fs.promises.stat(file)).isFile()
  } catch {
    return false
  }
}

// ---------------------------------------------------------------------------
// request dispatch
// ---------------------------------------------------------------------------

async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  setSecurityHeaders(res)
  const url = new URL(req.url ?? '/', 'http://localhost')
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url)
  if (url.pathname.startsWith('/files/')) return handleFile(req, res, url)
  return handleStatic(req, res, url)
}

function onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
  handle(req, res).catch((err: unknown) => {
    if (err instanceof HttpError) {
      if (!res.headersSent) sendJson(res, err.status, { error: err.message })
      else res.destroy()
      return
    }
    log(`服务器出错：${errorText(err)}`)
    if (!res.headersSent) sendJson(res, 500, { error: '服务器出错了，请查看服务器日志。' })
    else res.destroy()
  })
}

async function main(): Promise<void> {
  const parsed = readConfig(process.env, os.homedir())
  if (typeof parsed === 'string') {
    console.error(parsed)
    process.exit(1)
  }
  cfg = parsed

  try {
    const st = await fs.promises.stat(cfg.root)
    if (!st.isDirectory()) throw new Error('not a directory')
  } catch {
    console.error(`SCORES_ROOT 不是一个存在的文件夹：${cfg.root}`)
    process.exit(1)
  }
  realRoot = await fs.promises.realpath(cfg.root)
  await fs.promises.mkdir(cfg.dataDir, { recursive: true, mode: 0o700 })
  secret = await loadSecret(cfg.dataDir)
  inRoot = inRootOf(cfg.root)
  try {
    users = await UserStore.load(cfg.dataDir, cfg.password)
  } catch (err) {
    console.error(`账号文件读取失败：${errorText(err)}`)
    process.exit(1)
  }
  try {
    favorites = await loadFavoritesByUser(cfg.dataDir, inRoot, users.adminId())
  } catch (err) {
    console.error(`收藏文件读取失败：${errorText(err)}`)
    process.exit(1)
  }
  practice = await loadPracticeByUser(cfg.dataDir, inRoot, users.adminId())
  band = await BandStore.load(cfg.dataDir, inRoot)
  drums = await DrumStore.load(cfg.dataDir, inRoot)
  sheets = await SheetStore.load(cfg.dataDir)
  invites = await InviteStore.load(cfg.dataDir)
  recordings = await RecordingStore.load(cfg.dataDir)
  uploads = await UploadStore.load(cfg.dataDir)
  combos = await ComboStore.load(cfg.dataDir, inRoot)
  conversions = await ConversionStore.load(cfg.dataDir)
  daily = await DailyProgressStore.load(cfg.dataDir)
  ensembles = new EnsembleIndex(cfg.root, cfg.dataDir)
  webDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'web')

  const server = http.createServer(onRequest)
  server.on('error', (err: NodeJS.ErrnoException) => {
    const reason =
      err.code === 'EADDRINUSE'
        ? `端口 ${cfg.port} 已被其它程序占用，请换一个 PORT 或关掉旧的服务。`
        : err.code === 'EADDRNOTAVAIL'
          ? `HOST=${cfg.host} 不是这台电脑上的地址，请检查（Tailscale IP 可能已变）。`
          : `无法启动服务：${errorText(err)}`
    console.error(reason)
    process.exit(1)
  })
  server.listen(cfg.port, cfg.host, () => {
    log(`已启动：http://${cfg.host}:${cfg.port}（只读，文件不会离开这台电脑）`)
    if (cfg.host !== '127.0.0.1' && cfg.host !== 'localhost' && cfg.host !== '::1')
      log('注意：服务已对网络开放，请只通过 Tailscale 访问，不要在路由器上做端口转发。')
  })
  void refreshLibrary(true)
}

void main()
