/**
 * 谱库服务 (read-only): serves the student's own guitar-score folder to their
 * own browser, behind a password. Nothing is uploaded, nothing is written to
 * the folder. Run it with `node server-dist/server.mjs` (see server/README.md).
 *
 * Configuration (environment variables):
 *   SCORES_ROOT      required  absolute path of the score folder
 *   SCORES_PASSWORD  required  access password, at least 8 characters
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
  loadFavorites,
  parseFavoriteInput,
  parseFavoritePath,
  removeFavorite,
  saveFavorites,
  upsertFavorite,
  type FavoriteItem,
  type InRoot,
} from './favorites'
import {
  applyPracticeUpdate,
  loadPractice,
  parsePracticePath,
  parsePracticeUpdate,
  removePractice,
  savePractice,
  type PracticeRecord,
} from './practice'
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
  createSessionToken,
  decodeText,
  decodeUrlPath,
  mimeFor,
  parseRange,
  passwordMatches,
  readCookie,
  resolveInside,
  resolveRealFile,
  verifySessionToken,
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
let favorites: FavoriteItem[] = []
const favoriteQueue = createSerialQueue()
let practice: PracticeRecord[] = []
const practiceQueue = createSerialQueue()
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
        return
      }
    }
    log('开始扫描谱库，文件多时需要几分钟…')
    const files = await scanFolder(cfg.root, log)
    const scannedAt = Date.now()
    loaded = loadFromFiles(files, scannedAt)
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

const isLoggedIn = (req: http.IncomingMessage): boolean =>
  verifySessionToken(readCookie(req.headers.cookie, SESSION_COOKIE), secret)

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
): Promise<void> {
  if (p === '/api/favorites') {
    if (req.method === 'GET') return sendJson(res, 200, favorites)
    if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    const body = await readJsonBody(req, MAX_FAVORITE_BODY)
    const item = orBadRequest(parseFavoriteInput(body, inRoot, Date.now()))
    const next = await favoriteQueue(() => persistFavorites((list) => upsertFavorite(list, item)))
    return sendJson(res, 200, next)
  }
  // POST /api/favorites/remove
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = await readJsonBody(req, MAX_FAVORITE_BODY)
  const rel = orBadRequest(parseFavoritePath(body, inRoot))
  const next = await favoriteQueue(() => persistFavorites((list) => removeFavorite(list, rel)))
  return sendJson(res, 200, next)
}

/** Applies `change` to the favourites, writes the file, then keeps the new list in memory. */
async function persistFavorites(
  change: (list: FavoriteItem[]) => FavoriteItem[],
): Promise<FavoriteItem[]> {
  const next = change(favorites)
  try {
    await saveFavorites(cfg.dataDir, next)
  } catch (err) {
    log(`收藏保存失败：${errorText(err)}`)
    throw new HttpError(500, '收藏保存失败，请检查 SCORES_DATA 文件夹是否可写。')
  }
  favorites = next
  return next
}

async function handlePractice(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  p: string,
): Promise<void> {
  if (p === '/api/practice' && req.method === 'GET') return sendJson(res, 200, practice)
  if (req.method !== 'POST') return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const body = await readJsonBody(req, MAX_FAVORITE_BODY)
  if (p === '/api/practice') {
    const update = orBadRequest(parsePracticeUpdate(body, inRoot))
    const record = await practiceQueue(async () => {
      const r = applyPracticeUpdate(practice, update, Date.now())
      await persistPractice(r.list)
      return r.record
    })
    return sendJson(res, 200, record)
  }
  // POST /api/practice/remove
  const rel = orBadRequest(parsePracticePath(body, inRoot))
  const next = await practiceQueue(async () => {
    const list = removePractice(practice, rel)
    await persistPractice(list)
    return list
  })
  return sendJson(res, 200, next)
}

/** Writes the practice records, then keeps them in memory. */
async function persistPractice(next: PracticeRecord[]): Promise<void> {
  try {
    await savePractice(cfg.dataDir, next)
  } catch (err) {
    log(`练习记录保存失败：${errorText(err)}`)
    throw new HttpError(500, '练习记录保存失败，请检查 SCORES_DATA 文件夹是否可写。')
  }
  practice = next
}

function libraryInfo(): unknown {
  const root = path.basename(cfg.root) || 'root'
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

  if (!isLoggedIn(req)) return sendJson(res, 401, { error: '请先登录。' })

  if (p === '/api/favorites' || p === '/api/favorites/remove') return handleFavorites(req, res, p)
  if (p === '/api/practice' || p === '/api/practice/remove') return handlePractice(req, res, p)

  const routes: Record<string, { method: string; run: () => Promise<unknown> | unknown }> = {
    '/api/me': { method: 'GET', run: () => ({ ok: true }) },
    '/api/library': { method: 'GET', run: libraryInfo },
    '/api/artists': {
      method: 'GET',
      run: () => {
        const group = url.searchParams.get('group')
        if (!group) throw new HttpError(400, '缺少 group 参数。')
        return requireLibrary().lib.artists.get(group) ?? []
      },
    },
    '/api/songs': {
      method: 'GET',
      run: () => {
        const artist = url.searchParams.get('artist')
        if (!artist) throw new HttpError(400, '缺少 artist 参数。')
        return requireLibrary().lib.songs.get(artist) ?? []
      },
    },
    '/api/search': {
      method: 'GET',
      run: () => {
        const q = (url.searchParams.get('q') ?? '').trim()
        if ([...q].length > MAX_QUERY_LENGTH) throw new HttpError(400, '搜索内容太长。')
        if (!q) return { artists: [], songs: [], moreSongs: false }
        const opts = orBadRequest(parseCatalogParams(url.searchParams))
        const lib = requireLibrary()
        // Filters apply before the search's own 200-song limit.
        const result = search(lib.lib, narrowIndex(lib.index, opts), q, tools)
        return { ...result, songs: sortResultSongs(result.songs, opts.sort) }
      },
    },
    '/api/top': {
      method: 'GET',
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
          songs: songs.map((r) => ({ song: r.song, artistName: r.artistName, match: 'name' })),
          moreSongs,
        }
      },
    },
    '/api/rescan': {
      method: 'POST',
      run: () => {
        if (scanning) throw new HttpError(409, '正在扫描，请稍候。')
        void refreshLibrary(false)
        return { ok: true, scanning: true }
      },
    },
  }

  if (p === '/api/text') {
    if (req.method !== 'GET') return sendJson(res, 405, { error: '不支持这种请求方式。' })
    return handleText(res, url.searchParams.get('p') ?? '')
  }

  const route = routes[p]
  if (!route) return sendJson(res, 404, { error: '找不到这个接口。' })
  if (req.method !== route.method) return sendJson(res, 405, { error: '不支持这种请求方式。' })
  const status = p === '/api/rescan' ? 202 : 200
  const body = await route.run()
  sendJson(res, status, body)
}

async function handleLogin(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const ip = req.socket.remoteAddress ?? 'unknown'
  if (limiter.isBlocked(ip)) return sendJson(res, 429, { error: '尝试次数太多，10 分钟后再试。' })
  const body = await readJsonBody(req)
  const password = typeof body.password === 'string' ? body.password : ''
  if (!password) return sendJson(res, 400, { error: '请输入密码。' })
  if (!passwordMatches(password, cfg.password)) {
    limiter.recordFailure(ip)
    log(`登录失败（来自 ${ip}）。`)
    return sendJson(res, 401, { error: '密码不对。' })
  }
  limiter.clear(ip)
  const token = createSessionToken(secret)
  res.setHeader('Set-Cookie', sessionCookie(token, SESSION_MAX_AGE, isSecure(req)))
  sendJson(res, 200, { ok: true })
}

async function handleText(res: http.ServerResponse, rel: string): Promise<void> {
  const ext = rel.slice(rel.lastIndexOf('.') + 1).toLowerCase()
  if (rel.lastIndexOf('.') < 0 || (ext !== 'txt' && ext !== 'tab'))
    throw new HttpError(400, '只能读取 .txt 或 .tab 文件。')
  const real = await resolveRealFile(cfg.root, realRoot, rel)
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
  if (!isLoggedIn(req)) return sendJson(res, 401, { error: '请先登录。' })
  if (req.method !== 'GET' && req.method !== 'HEAD')
    return sendJson(res, 405, { error: '不支持这种请求方式。' })

  const rel = decodeUrlPath(url.pathname.slice('/files/'.length))
  const real = rel === null ? null : await resolveRealFile(cfg.root, realRoot, rel)
  if (!real || rel === null) return sendJson(res, 404, { error: '找不到文件。' })

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
    favorites = await loadFavorites(cfg.dataDir, inRoot)
  } catch (err) {
    console.error(`收藏文件读取失败：${errorText(err)}`)
    process.exit(1)
  }
  practice = await loadPractice(cfg.dataDir, inRoot)
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
