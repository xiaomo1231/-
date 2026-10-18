/**
 * Uploaded 简谱 (images / PDFs) attached to a song. The files live OUTSIDE the
 * score library, in SCORES_DATA/sheets/<id>.<ext>, with their metadata in
 * SCORES_DATA/sheets.json. The type is decided from the file's first bytes
 * only, never from the name. Writes are serialised and atomic.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import type { SheetKind, SheetUpload, SheetUploadQuery } from '../src/songs/scoreServerTypes'
import { createSerialQueue, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const SHEETS_DIR = 'sheets'
export const SHEETS_FILE = 'sheets.json'
export const SHEETS_VERSION = 1
export const MAX_SHEET_BYTES = 20 * 1024 * 1024
export const MAX_SHEETS_PER_SONG = 60

const DEFAULT_LABEL = '简谱'
const MAX_LABEL_CHARS = 40
const MAX_FILE_NAME_CHARS = 120
const MAX_QUERY_NAME_CHARS = 300
const MAX_QUERY_PATH_CHARS = 1024
const ID_PATTERN = /^[0-9a-f]{16}$/
const SIZE_MESSAGE = '文件太大了（最多 20 MB）。'
const TYPE_MESSAGE = '只支持 PNG、JPEG、WebP、GIF 图片或 PDF 文件。'

export type SheetExt = 'png' | 'jpg' | 'webp' | 'gif' | 'pdf'

export interface SheetType {
  kind: SheetKind
  ext: SheetExt
}

/** An error the route can turn into an HTTP status and a Chinese message. */
export class SheetError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'SheetError'
    this.status = status
  }
}

const startsWith = (bytes: Buffer, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b)

/** The type from the magic bytes, or null for anything else (HTML, SVG, EXE … are all null). */
export function detectSheetType(bytes: Buffer): SheetType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', ext: 'png' }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', ext: 'jpg' }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return { kind: 'image', ext: 'webp' }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return { kind: 'image', ext: 'gif' }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', ext: 'pdf' }
  return null
}

/** Content-Type for serving a stored sheet. Only the whitelisted types above are possible. */
export function sheetContentType(kind: SheetKind, ext: string): string {
  if (kind === 'pdf' || ext === 'pdf') return 'application/pdf'
  switch (ext) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'webp':
      return 'image/webp'
    case 'gif':
      return 'image/gif'
    default:
      return 'application/octet-stream'
  }
}

const codePoints = (s: string): number => [...s].length
const cut = (s: string, n: number): string => [...s].slice(0, n).join('')

/** Trimmed label, 1–40 characters; empty becomes the default. */
export function cleanLabel(raw: string): string {
  const t = raw.trim()
  return t ? cut(t, MAX_LABEL_CHARS) : DEFAULT_LABEL
}

/** Last path segment only, no control characters or reserved symbols, at most 120 characters. */
export function cleanFileName(raw: string, ext: SheetExt): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const kept = [...base]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f && !'<>:"|?*'.includes(c))
    .join('')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return kept ? cut(kept, MAX_FILE_NAME_CHARS) : `${DEFAULT_LABEL}.${ext}`
}

/** Validates GET-style query params of POST /api/sheets/upload (the body is the raw file). */
export function parseUploadQuery(url: URL): ParseResult<SheetUploadQuery> {
  const p = url.searchParams.get('path')
  if (!p) return { ok: false, error: '缺少乐谱文件路径。' }
  if (codePoints(p) > MAX_QUERY_PATH_CHARS) return { ok: false, error: '乐谱文件路径太长。' }
  const label = url.searchParams.get('label') ?? ''
  if (codePoints(label) > MAX_LABEL_CHARS) return { ok: false, error: `简谱名称最多 ${MAX_LABEL_CHARS} 个字符。` }
  const name = url.searchParams.get('name') ?? ''
  if (codePoints(name) > MAX_QUERY_NAME_CHARS)
    return { ok: false, error: `文件名太长（最多 ${MAX_QUERY_NAME_CHARS} 个字符）。` }
  return { ok: true, value: { path: p, label, name } }
}

/**
 * Collects the raw request body. Stops as soon as `maxBytes` is exceeded: the
 * request is destroyed and the promise rejects with a SheetError (status 413).
 */
export function readUploadBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    let settled = false

    const cleanup = () => {
      req.removeListener('data', onData)
      req.removeListener('end', onEnd)
      req.removeListener('error', onError)
    }
    const fail = (err: Error) => {
      if (settled) return
      settled = true
      cleanup()
      req.destroy()
      reject(err)
    }
    function onData(chunk: Buffer) {
      total += chunk.length
      if (total > maxBytes) {
        fail(new SheetError(413, SIZE_MESSAGE))
        return
      }
      chunks.push(chunk)
    }
    function onEnd() {
      if (settled) return
      settled = true
      cleanup()
      resolve(Buffer.concat(chunks, total))
    }
    function onError(err: Error) {
      fail(err)
    }

    req.on('data', onData)
    req.on('end', onEnd)
    req.on('error', onError)
  })
}

/** Whether a user may change or remove an upload: its uploader, or an admin. */
export function canEditSheet(item: SheetUpload, user: { id: string; role: 'admin' | 'member' }): boolean {
  return user.role === 'admin' || item.uploadedBy === user.id
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

interface Entry {
  item: SheetUpload
  ext: SheetExt
}

const KIND_EXTS: Record<SheetKind, SheetExt[]> = {
  image: ['png', 'jpg', 'webp', 'gif'],
  pdf: ['pdf'],
}

/** Checks one stored metadata row; null when it is malformed. */
function sanitizeItem(raw: unknown): SheetUpload | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const num = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
  if (typeof rec.id !== 'string' || !ID_PATTERN.test(rec.id)) return null
  if (typeof rec.songKey !== 'string' || !rec.songKey) return null
  if (rec.kind !== 'image' && rec.kind !== 'pdf') return null
  const uploadedAt = num(rec.uploadedAt, 0)
  return {
    id: rec.id,
    songKey: rec.songKey,
    label: typeof rec.label === 'string' && rec.label ? cut(rec.label, MAX_LABEL_CHARS) : DEFAULT_LABEL,
    kind: rec.kind,
    fileName: typeof rec.fileName === 'string' ? rec.fileName : '',
    size: Math.max(0, num(rec.size, 0)),
    order: num(rec.order, 0),
    uploadedBy: typeof rec.uploadedBy === 'string' ? rec.uploadedBy : '',
    uploadedAt,
  }
}

/** Per song: order 0..n-1 in the stored order. Returns new objects. */
function renumber(entries: readonly Entry[]): Entry[] {
  const bySong = new Map<string, Entry[]>()
  for (const e of entries) {
    const list = bySong.get(e.item.songKey)
    if (list) list.push(e)
    else bySong.set(e.item.songKey, [e])
  }
  const out: Entry[] = []
  for (const list of bySong.values()) {
    list
      .sort((a, b) => a.item.order - b.item.order || a.item.uploadedAt - b.item.uploadedAt)
      .forEach((e, i) => out.push({ ext: e.ext, item: { ...e.item, order: i } }))
  }
  return out
}

/** Writes bytes to a temp file, then renames it into place. */
async function writeBytesAtomic(target: string, bytes: Buffer): Promise<void> {
  const tmp = `${target}.tmp`
  try {
    await fs.promises.writeFile(tmp, bytes, { mode: 0o600 })
    await fs.promises.rename(tmp, target)
  } catch (err) {
    await fs.promises.rm(tmp, { force: true }).catch(() => {})
    throw err
  }
}

/** The uploaded sheets of every song. Reads are from memory; changes are written to disk first. */
export class SheetStore {
  private entries: Entry[]
  private readonly dataDir: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, entries: Entry[]) {
    this.dataDir = dataDir
    this.entries = entries
  }

  /** Reads sheets.json once. Missing is empty; damaged is set aside; rows whose file is missing are dropped. */
  static async load(dataDir: string): Promise<SheetStore> {
    const file = path.join(dataDir, SHEETS_FILE)
    const empty = () => new SheetStore(dataDir, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(`[谱库] 简谱数据读取失败，已当作空：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    const rec =
      raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
    if (!rec || rec.version !== SHEETS_VERSION || !Array.isArray(rec.items)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] 简谱数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const sheetsDir = path.join(dataDir, SHEETS_DIR)
    const seen = new Set<string>()
    const entries: Entry[] = []
    for (const row of rec.items) {
      const item = sanitizeItem(row)
      if (!item || seen.has(item.id)) continue
      const ext = KIND_EXTS[item.kind].find((x) =>
        fs.existsSync(path.join(sheetsDir, `${item.id}.${x}`)),
      )
      if (!ext) continue
      seen.add(item.id)
      entries.push({ item, ext })
    }
    return new SheetStore(dataDir, renumber(entries))
  }

  private get sheetsDir(): string {
    return path.join(this.dataDir, SHEETS_DIR)
  }

  /** The song's uploads in page order. */
  list(songKey: string): SheetUpload[] {
    return this.entries
      .filter((e) => e.item.songKey === songKey)
      .sort((a, b) => a.item.order - b.item.order)
      .map((e) => ({ ...e.item }))
  }

  get(id: string): SheetUpload | undefined {
    const e = this.entries.find((x) => x.item.id === id)
    return e ? { ...e.item } : undefined
  }

  /** Absolute path of the stored file. Throws when the upload is not in the store. */
  filePath(item: SheetUpload): string {
    const e = this.entries.find((x) => x.item.id === item.id)
    if (!e) throw new SheetError(404, '找不到这个简谱文件。')
    return path.join(this.sheetsDir, `${e.item.id}.${e.ext}`)
  }

  /**
   * Stores an upload at the end of the song's list. The type comes from the
   * bytes only; anything else, an oversized file or a full song is refused.
   */
  add(
    songKey: string,
    meta: { label: string; fileName: string },
    bytes: Buffer,
    userId: string,
    now: number,
  ): Promise<SheetUpload> {
    return this.queue(async () => {
      if (bytes.length > MAX_SHEET_BYTES) throw new SheetError(413, SIZE_MESSAGE)
      const type = detectSheetType(bytes)
      if (!type) throw new SheetError(400, TYPE_MESSAGE)
      const count = this.list(songKey).length
      if (count >= MAX_SHEETS_PER_SONG)
        throw new SheetError(400, `每首歌最多上传 ${MAX_SHEETS_PER_SONG} 个简谱文件。`)

      const id = randomBytes(8).toString('hex')
      const item: SheetUpload = {
        id,
        songKey,
        label: cleanLabel(meta.label),
        kind: type.kind,
        fileName: cleanFileName(meta.fileName, type.ext),
        size: bytes.length,
        order: count,
        uploadedBy: userId,
        uploadedAt: now,
      }
      const file = path.join(this.sheetsDir, `${id}.${type.ext}`)
      await fs.promises.mkdir(this.sheetsDir, { recursive: true })
      await writeBytesAtomic(file, bytes)
      try {
        await this.commit([...this.entries, { item, ext: type.ext }])
      } catch (err) {
        await fs.promises.rm(file, { force: true }).catch(() => {})
        throw err
      }
      return { ...item }
    })
  }

  /** Deletes the metadata first, then the file (a leftover file is ignored on load). */
  remove(id: string): Promise<void> {
    return this.queue(async () => {
      const e = this.entries.find((x) => x.item.id === id)
      if (!e) throw new SheetError(404, '找不到这个简谱。')
      await this.commit(this.entries.filter((x) => x !== e))
      await fs.promises.rm(path.join(this.sheetsDir, `${e.item.id}.${e.ext}`), { force: true }).catch(() => {})
    })
  }

  /** Sets the page order of one song; `ids` must be a permutation of its current uploads. */
  reorder(songKey: string, ids: readonly string[]): Promise<void> {
    return this.queue(async () => {
      const mine = this.entries.filter((e) => e.item.songKey === songKey)
      const known = new Set(mine.map((e) => e.item.id))
      const ok =
        ids.length === mine.length && new Set(ids).size === ids.length && ids.every((id) => known.has(id))
      if (!ok) throw new SheetError(400, '简谱顺序已变化，请刷新后再调整。')
      const rank = new Map(ids.map((id, i) => [id, i] as const))
      const next = this.entries.map((e) =>
        e.item.songKey === songKey ? { ...e, item: { ...e.item, order: rank.get(e.item.id) ?? 0 } } : e,
      )
      await this.commit(next)
    })
  }

  /** Writes the new state first; only then does it replace the in-memory one. */
  private async commit(next: readonly Entry[]): Promise<void> {
    const renumbered = renumber(next)
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, SHEETS_FILE),
      JSON.stringify({ version: SHEETS_VERSION, items: renumbered.map((e) => e.item) }),
    )
    this.entries = renumbered
  }
}
