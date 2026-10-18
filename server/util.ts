/**
 * Pure helpers for the read-only score server (谱库服务): path safety, Range
 * parsing, sessions, the login rate limiter and small text helpers. Kept free
 * of HTTP so they can be tested directly.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

/** Names the scan leaves out (OS and NAS clutter). */
const SKIP_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini', '@eadir'])

export function isSkippedName(name: string): boolean {
  const lower = name.toLowerCase()
  return SKIP_NAMES.has(lower) || name.startsWith('._')
}

/** True when `target` is `root` itself or lies below it (both absolute, already resolved). */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  if (rel === '') return true
  if (path.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith('..' + path.sep)
}

/**
 * Lexical check only: maps a relative path ('/' separated, already decoded) to
 * an absolute path inside `root`, or null. Rejects NUL, absolute paths, and any
 * path that climbs out of the root.
 */
export function resolveInside(root: string, rel: string): string | null {
  if (rel.includes('\0')) return null
  if (rel === '' || path.isAbsolute(rel) || /^[a-zA-Z]:/.test(rel)) return null
  const abs = path.resolve(root, rel)
  if (abs === path.resolve(root)) return null
  return isInside(path.resolve(root), abs) ? abs : null
}

/**
 * Lexical check plus symlink check: the file must exist, be a regular file,
 * and its real location (after symlinks) must still be inside `realRoot`
 * (the realpath of the library root). Returns the real path or null.
 */
export async function resolveRealFile(
  root: string,
  realRoot: string,
  rel: string,
): Promise<string | null> {
  const abs = resolveInside(root, rel)
  if (!abs) return null
  let real: string
  try {
    real = await fs.promises.realpath(abs)
  } catch {
    return null
  }
  if (!isInside(realRoot, real)) return null
  try {
    const st = await fs.promises.stat(real)
    if (!st.isFile()) return null
  } catch {
    return null
  }
  return real
}

/** Decodes a URL path ('/files/a%20b/c.gp5') segment by segment into a relative path. */
export function decodeUrlPath(rawAfterPrefix: string): string | null {
  const parts = rawAfterPrefix.split('/')
  const out: string[] = []
  for (const p of parts) {
    try {
      out.push(decodeURIComponent(p))
    } catch {
      return null
    }
  }
  const joined = out.join('/')
  if (joined.includes('\0')) return null
  return joined
}

export type RangeResult =
  { kind: 'full' } | { kind: 'partial'; start: number; end: number } | { kind: 'unsatisfiable' }

/**
 * A single `bytes=` range (PDF viewers need it). Multiple ranges and other
 * units are ignored (the whole file is sent), as RFC 9110 allows.
 */
export function parseRange(header: string | undefined, size: number): RangeResult {
  if (!header) return { kind: 'full' }
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return { kind: 'full' }
  const [, a = '', b = ''] = m
  if (a === '' && b === '') return { kind: 'unsatisfiable' }
  if (size <= 0) return { kind: 'unsatisfiable' }
  let start: number
  let end: number
  if (a === '') {
    const n = Number(b)
    if (n <= 0) return { kind: 'unsatisfiable' }
    start = Math.max(0, size - n)
    end = size - 1
  } else {
    start = Number(a)
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1)
    if (start >= size || (b !== '' && Number(b) < start)) return { kind: 'unsatisfiable' }
  }
  return { kind: 'partial', start, end }
}

const MIME: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  webp: 'image/webp',
  txt: 'text/plain',
  tab: 'text/plain',
  html: 'text/html; charset=utf-8',
  js: 'text/javascript; charset=utf-8',
  mjs: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  json: 'application/json; charset=utf-8',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  webmanifest: 'application/manifest+json',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
  wasm: 'application/wasm',
  map: 'application/json; charset=utf-8',
  mp3: 'audio/mpeg',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
}

/** Content-Type by file name; Guitar Pro, MIDI and anything unknown are opaque bytes. */
export function mimeFor(name: string): string {
  const i = name.lastIndexOf('.')
  const ext = i >= 0 ? name.slice(i + 1).toLowerCase() : ''
  return MIME[ext] ?? 'application/octet-stream'
}

/** Content-Disposition for a download, with an ASCII fallback name. */
export function attachmentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_')
  const encoded = encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`
}

/**
 * Decodes a plain text file: UTF-8 if it is valid, else GBK, else Big5.
 * Never throws for bad bytes (GBK and Big5 decoders are lenient).
 */
export function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    /* not UTF-8 */
  }
  for (const enc of ['gbk', 'big5']) {
    try {
      return new TextDecoder(enc).decode(bytes)
    } catch {
      /* this build has no such decoder */
    }
  }
  return new TextDecoder('utf-8').decode(bytes)
}

// ---------------------------------------------------------------------------
// passwords and sessions
// ---------------------------------------------------------------------------

const sha256 = (s: string) => createHash('sha256').update(s, 'utf8').digest()

/** Constant-time comparison of a typed password with the configured one. */
export function passwordMatches(given: string, expected: string): boolean {
  return timingSafeEqual(sha256(given), sha256(expected))
}

const SESSION_RE = /^[0-9a-f]{64}\.[0-9a-f]{64}$/

/** A new session token: `<32 random bytes hex>.<HMAC-SHA256(secret, random) hex>`. */
export function createSessionToken(secret: Buffer): string {
  const random = randomBytes(32).toString('hex')
  const mac = createHmac('sha256', secret).update(random).digest('hex')
  return `${random}.${mac}`
}

export function verifySessionToken(token: string | undefined, secret: Buffer): boolean {
  if (!token || !SESSION_RE.test(token)) return false
  const [random, mac] = token.split('.') as [string, string]
  const expected = createHmac('sha256', secret).update(random).digest()
  return timingSafeEqual(Buffer.from(mac, 'hex'), expected)
}

/** The value of one cookie from a Cookie header. */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return undefined
}

// ---------------------------------------------------------------------------
// login rate limit
// ---------------------------------------------------------------------------

export interface RateLimiter {
  /** True when `key` has already used up its failures in the window. */
  isBlocked(key: string, now?: number): boolean
  /** Records one failure for `key`. */
  recordFailure(key: string, now?: number): void
  /** Forgets `key` (after a successful login). */
  clear(key: string): void
}

/** At most `max` failures per key within `windowMs`. */
export function createRateLimiter(max: number, windowMs: number): RateLimiter {
  const failures = new Map<string, number[]>()
  const recent = (key: string, now: number): number[] => {
    const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs)
    if (list.length) failures.set(key, list)
    else failures.delete(key)
    return list
  }
  return {
    isBlocked(key, now = Date.now()) {
      return recent(key, now).length >= max
    },
    recordFailure(key, now = Date.now()) {
      const list = recent(key, now)
      list.push(now)
      failures.set(key, list)
      // Keep the map bounded even under a flood from many addresses.
      if (failures.size > 10_000) {
        for (const k of failures.keys()) {
          recent(k, now)
          if (failures.size <= 5_000) break
        }
      }
    },
    clear(key) {
      failures.delete(key)
    },
  }
}

/** Runs `fn` over `items` with at most `limit` in flight. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return out
}
