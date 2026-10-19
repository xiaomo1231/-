/**
 * Band members' rehearsal recordings (audio) attached to a band song. The files
 * live OUTSIDE the score library, in SCORES_DATA/recordings/<id>.<ext>, with
 * their metadata in SCORES_DATA/recordings.json. The format is decided from the
 * file's first bytes only, never from the name. Writes are serialised and atomic.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { RecordingInfo, RecordingUploadQuery } from '../src/songs/scoreServerTypes'
import { createSerialQueue, type ParseResult } from './favorites'
import { parseRange, writeFileAtomic } from './util'

export const RECORDINGS_DIR = 'recordings'
export const RECORDINGS_FILE = 'recordings.json'
export const RECORDINGS_VERSION = 1
export const MAX_RECORDING_BYTES = 300 * 1024 * 1024
export const MAX_RECORDINGS = 3000
export const MAX_PER_SONG = 200

const DEFAULT_LABEL = '排练录音'
const MAX_LABEL_CHARS = 60
const MAX_FILE_NAME_CHARS = 120
const MAX_QUERY_NAME_CHARS = 300
const MAX_SONG_ID_CHARS = 64
const ID_PATTERN = /^[0-9a-f]{16}$/
const SIZE_MESSAGE = '录音太大了（最多 300 MB）。'
const TYPE_MESSAGE = '只支持 MP3、M4A、WAV、OGG、WebM 或 FLAC 录音。'

export type RecordingExt = 'mp3' | 'm4a' | 'wav' | 'ogg' | 'webm' | 'flac'

const EXT_TYPE: Record<RecordingExt, string> = {
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  flac: 'audio/flac',
}
const EXTS = Object.keys(EXT_TYPE) as RecordingExt[]

/** An error the route can turn into an HTTP status and a Chinese message. */
export class RecordingError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'RecordingError'
    this.status = status
  }
}

const startsWith = (bytes: Buffer, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b)
const ascii = (s: string): number[] => [...Buffer.from(s, 'latin1')]

function detectExt(bytes: Buffer): RecordingExt | null {
  if (startsWith(bytes, ascii('ID3'))) return 'mp3'
  // MPEG audio frame sync: 11 set bits.
  if (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'mp3'
  if (startsWith(bytes, ascii('ftyp'), 4)) return 'm4a'
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WAVE'), 8)) return 'wav'
  if (startsWith(bytes, ascii('OggS'))) return 'ogg'
  if (startsWith(bytes, [0x1a, 0x45, 0xdf, 0xa3])) return 'webm'
  if (startsWith(bytes, ascii('fLaC'))) return 'flac'
  return null
}

/** The audio format from the magic bytes, or null for anything else (HTML, images, PDF … are all null). */
export function detectAudioType(bytes: Buffer): { ext: RecordingExt; type: string } | null {
  const ext = detectExt(bytes)
  return ext ? { ext, type: EXT_TYPE[ext] } : null
}

const codePoints = (s: string): number => [...s].length
const cut = (s: string, n: number): string => [...s].slice(0, n).join('')

/** Trimmed label, up to 60 characters; empty becomes the default. */
function cleanLabel(raw: string): string {
  const t = raw.trim()
  return t ? cut(t, MAX_LABEL_CHARS) : DEFAULT_LABEL
}

/** Last path segment only, no control characters or reserved symbols, at most 120 characters. */
function cleanFileName(raw: string, ext: RecordingExt): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const kept = [...base]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f && !'<>:"|?*'.includes(c))
    .join('')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return kept ? cut(kept, MAX_FILE_NAME_CHARS) : `${DEFAULT_LABEL}.${ext}`
}

/** Validates the query of POST /api/recordings/upload (the body is the raw audio file). */
export function parseRecordingQuery(url: URL): ParseResult<RecordingUploadQuery> {
  const songId = url.searchParams.get('songId') ?? ''
  if (!songId) return { ok: false, error: '缺少乐曲编号。' }
  if (codePoints(songId) > MAX_SONG_ID_CHARS) return { ok: false, error: '乐曲编号太长。' }
  const label = url.searchParams.get('label') ?? ''
  if (codePoints(label) > MAX_LABEL_CHARS)
    return { ok: false, error: `录音名称最多 ${MAX_LABEL_CHARS} 个字符。` }
  const name = url.searchParams.get('name') ?? ''
  if (codePoints(name) > MAX_QUERY_NAME_CHARS)
    return { ok: false, error: `文件名太长（最多 ${MAX_QUERY_NAME_CHARS} 个字符）。` }
  return { ok: true, value: { songId, label, name } }
}

/**
 * Collects the raw request body. Stops as soon as `maxBytes` is exceeded: the
 * request is destroyed and the promise rejects with a RecordingError (status 413).
 */
export function readRecordingBody(req: http.IncomingMessage, maxBytes: number): Promise<Buffer> {
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
        fail(new RecordingError(413, SIZE_MESSAGE))
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

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

interface Entry {
  item: RecordingInfo
  ext: RecordingExt
}

/** Checks one stored metadata row; null when it is malformed. */
function sanitizeRow(raw: unknown): Entry | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const rec = raw as Record<string, unknown>
  const ext = EXTS.find((x) => x === rec.ext)
  if (!ext) return null
  if (typeof rec.id !== 'string' || !ID_PATTERN.test(rec.id)) return null
  if (typeof rec.songId !== 'string' || !rec.songId || codePoints(rec.songId) > MAX_SONG_ID_CHARS)
    return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    ext,
    item: {
      id: rec.id,
      songId: rec.songId,
      label:
        typeof rec.label === 'string' && rec.label
          ? cut(rec.label, MAX_LABEL_CHARS)
          : DEFAULT_LABEL,
      fileName: typeof rec.fileName === 'string' ? rec.fileName : '',
      size: Math.max(0, num(rec.size)),
      type: EXT_TYPE[ext],
      uploadedBy: typeof rec.uploadedBy === 'string' ? rec.uploadedBy : '',
      uploadedAt: num(rec.uploadedAt),
    },
  }
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

/** The rehearsal recordings of every band song. Reads are from memory; changes are written to disk first. */
export class RecordingStore {
  private entries: Entry[]
  private readonly dataDir: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, entries: Entry[]) {
    this.dataDir = dataDir
    this.entries = entries
  }

  /** Reads recordings.json once. Missing is empty; damaged is set aside; rows whose file is missing are dropped. */
  static async load(dataDir: string): Promise<RecordingStore> {
    const file = path.join(dataDir, RECORDINGS_FILE)
    const empty = () => new RecordingStore(dataDir, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(`[排练录音] 数据读取失败，已当作空：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    const rec =
      raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as Record<string, unknown>)
        : null
    if (!rec || rec.version !== RECORDINGS_VERSION || !Array.isArray(rec.items)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[排练录音] 数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const dir = path.join(dataDir, RECORDINGS_DIR)
    const seen = new Set<string>()
    const entries: Entry[] = []
    for (const row of rec.items) {
      const entry = sanitizeRow(row)
      if (!entry || seen.has(entry.item.id)) continue
      if (!fs.existsSync(path.join(dir, `${entry.item.id}.${entry.ext}`))) continue
      seen.add(entry.item.id)
      entries.push(entry)
    }
    return new RecordingStore(dataDir, entries)
  }

  private get recordingsDir(): string {
    return path.join(this.dataDir, RECORDINGS_DIR)
  }

  /** The song's recordings, newest first. */
  list(songId: string): RecordingInfo[] {
    return this.entries
      .filter((e) => e.item.songId === songId)
      .reverse()
      .sort((a, b) => b.item.uploadedAt - a.item.uploadedAt)
      .map((e) => ({ ...e.item }))
  }

  get(id: string): RecordingInfo | undefined {
    const e = this.entries.find((x) => x.item.id === id)
    return e ? { ...e.item } : undefined
  }

  /** Absolute path of the stored file. Throws when the recording is not in the store. */
  filePath(rec: RecordingInfo): string {
    const e = this.entries.find((x) => x.item.id === rec.id)
    if (!e) throw new RecordingError(404, '找不到这段录音。')
    return path.join(this.recordingsDir, `${e.item.id}.${e.ext}`)
  }

  /**
   * Stores a recording for a song. The format comes from the bytes only; anything
   * else, an oversized file or a full song is refused. When the store is full the
   * oldest recordings (of any song) make way, with their files.
   */
  add(
    songId: string,
    meta: { label: string; fileName: string },
    bytes: Buffer,
    userId: string,
    now: number,
  ): Promise<RecordingInfo> {
    return this.queue(async () => {
      if (bytes.length > MAX_RECORDING_BYTES) throw new RecordingError(413, SIZE_MESSAGE)
      const type = detectAudioType(bytes)
      if (!type) throw new RecordingError(400, TYPE_MESSAGE)
      if (this.list(songId).length >= MAX_PER_SONG)
        throw new RecordingError(400, `每首歌最多保存 ${MAX_PER_SONG} 段排练录音，请先删除一些。`)

      const id = randomBytes(8).toString('hex')
      const item: RecordingInfo = {
        id,
        songId,
        label: cleanLabel(meta.label),
        fileName: cleanFileName(meta.fileName, type.ext),
        size: bytes.length,
        type: type.type,
        uploadedBy: userId,
        uploadedAt: now,
      }
      const file = path.join(this.recordingsDir, `${id}.${type.ext}`)
      await fs.promises.mkdir(this.recordingsDir, { recursive: true })
      await writeBytesAtomic(file, bytes)

      const overflow = this.entries.length + 1 - MAX_RECORDINGS
      const oldest = [...this.entries].sort((a, b) => a.item.uploadedAt - b.item.uploadedAt)
      const dropped = overflow > 0 ? oldest.slice(0, overflow) : []
      const kept = this.entries.filter((e) => !dropped.includes(e))
      try {
        await this.commit([...kept, { item, ext: type.ext }])
      } catch (err) {
        await fs.promises.rm(file, { force: true }).catch(() => {})
        throw err
      }
      await this.removeFiles(dropped)
      return { ...item }
    })
  }

  /** Deletes the metadata first, then the file (a leftover file is ignored on load). */
  remove(id: string): Promise<void> {
    return this.queue(async () => {
      const e = this.entries.find((x) => x.item.id === id)
      if (!e) throw new RecordingError(404, '找不到这段录音。')
      await this.commit(this.entries.filter((x) => x !== e))
      await this.removeFiles([e])
    })
  }

  /** Removes every recording of one song (used when the band song is deleted). */
  removeSong(songId: string): Promise<void> {
    return this.queue(async () => {
      const gone = this.entries.filter((e) => e.item.songId === songId)
      if (gone.length === 0) return
      await this.commit(this.entries.filter((e) => e.item.songId !== songId))
      await this.removeFiles(gone)
    })
  }

  private async removeFiles(list: readonly Entry[]): Promise<void> {
    for (const e of list) {
      await fs.promises
        .rm(path.join(this.recordingsDir, `${e.item.id}.${e.ext}`), { force: true })
        .catch(() => {})
    }
  }

  /** Writes the new state first; only then does it replace the in-memory one. */
  private async commit(next: readonly Entry[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, RECORDINGS_FILE),
      JSON.stringify({
        version: RECORDINGS_VERSION,
        items: next.map((e) => ({ ...e.item, ext: e.ext })),
      }),
    )
    this.entries = [...next]
  }
}

const encodeRfc5987 = (name: string): string =>
  encodeURIComponent(name).replace(
    /['()*]/g,
    (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase(),
  )

function sendText(res: http.ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(message)
}

/**
 * Streams a stored recording. Supports one `Range: bytes=` span (audio players
 * seek with it) and HEAD; an unsatisfiable range gets 416.
 */
export async function serveRecording(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  file: string,
  rec: RecordingInfo,
): Promise<void> {
  let size: number
  try {
    size = (await fs.promises.stat(file)).size
  } catch {
    sendText(res, 404, '找不到这段录音文件。')
    return
  }
  const headers: Record<string, string | number> = {
    'Content-Type': rec.type,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'private, max-age=86400',
    'Content-Disposition': `inline; filename*=UTF-8''${encodeRfc5987(rec.fileName)}`,
  }
  const range = parseRange(req.headers.range, size)
  if (range.kind === 'unsatisfiable') {
    res.writeHead(416, { ...headers, 'Content-Range': `bytes */${size}`, 'Content-Length': 0 })
    res.end()
    return
  }
  let status = 200
  let start = 0
  let end = size - 1
  if (range.kind === 'partial') {
    status = 206
    start = range.start
    end = range.end
    headers['Content-Range'] = `bytes ${start}-${end}/${size}`
  }
  const length = size === 0 ? 0 : end - start + 1
  res.writeHead(status, { ...headers, 'Content-Length': length })
  if (req.method === 'HEAD' || length === 0) {
    res.end()
    return
  }
  try {
    await pipeline(fs.createReadStream(file, { start, end }), res)
  } catch {
    // The listener went away mid-stream; nothing more to send.
  }
}
