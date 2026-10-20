/**
 * Members' own score files (自己上传的谱). They live OUTSIDE the read-only
 * library: SCORES_DATA/uploads.json holds the metadata and
 * SCORES_DATA/uploads/<songId>/<fileId>.<ext> the bytes. The type is decided
 * from the file's first bytes only, never from the name (the name only picks
 * between formats that share a container). Writes are serialised and atomic.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import type http from 'node:http'
import path from 'node:path'
import type {
  NewUploadSongBody,
  UploadFile,
  UploadFileQuery,
  UploadKind,
  UploadSong,
} from '../src/songs/scoreServerTypes'
import { parseUploadPath, uploadPath } from '../src/songs/uploadPaths'
import { createSerialQueue, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const UPLOADS_FILE = 'uploads.json'
export const UPLOADS_DIR = 'uploads'
export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
export const MAX_FILES_PER_SONG = 30
export const MAX_UPLOAD_SONGS = 1000

const UPLOADS_VERSION = 1
const DEFAULT_LABEL = '其他'
const MAX_LABEL_CHARS = 20
const MAX_TITLE_CHARS = 80
const MAX_ARTIST_CHARS = 80
const MAX_BAND_ID_CHARS = 64
const MAX_FILE_NAME_CHARS = 200
const ID_PATTERN = /^[0-9a-f]{12}$/
const EXT_PATTERN = /^[a-z0-9]{2,8}$/
const SIZE_MESSAGE = '文件太大了（最多 50 MB）。'
const TYPE_MESSAGE = '只支持 GP（Guitar Pro 3–8）、MusicXML、PDF 或 PNG / JPG / WebP 图片。'

/** An error the route can turn into an HTTP status and a Chinese message. */
export class UploadError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'UploadError'
    this.status = status
  }
}

export interface UploadType {
  kind: UploadKind
  ext: string
}

const codePoints = (s: string): number => [...s].length
const cut = (s: string, n: number): string => [...s].slice(0, n).join('')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)
const newId = (): string => randomBytes(6).toString('hex')

const startsWith = (bytes: Buffer, sig: readonly number[], offset = 0): boolean =>
  sig.every((b, i) => bytes[offset + i] === b)
const ascii = (bytes: Buffer, from: number, to: number): string =>
  bytes.toString('latin1', from, to)

/** MusicXML text: optional BOM and whitespace, an XML / DOCTYPE / score root, and a score-partwise or score-timewise in the head. */
function looksLikeMusicXml(bytes: Buffer): boolean {
  const text = bytes
    .subarray(0, 4096)
    .toString('utf8')
    .replace(/^\uFEFF/, '')
    .trimStart()
  if (!/^(<\?xml|<!DOCTYPE score-|<score-(partwise|timewise))/.test(text)) return false
  const head = text.slice(0, 2000)
  return head.includes('score-partwise') || head.includes('score-timewise')
}

/** The upload type from the magic bytes, or null when it is not a supported score or image. */
export function detectUploadType(bytes: Buffer, name: string): UploadType | null {
  const lower = name.toLowerCase()
  if (ascii(bytes, 1, 19) === 'FICHIER GUITAR PRO') {
    const m = /v([345])/.exec(ascii(bytes, 19, 60))
    return { kind: 'score', ext: m ? `gp${m[1]}` : 'gp5' }
  }
  const head4 = ascii(bytes, 0, 4)
  if (head4 === 'BCFZ' || head4 === 'BCFS') return { kind: 'score', ext: 'gpx' }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (lower.endsWith('.mxl')) return { kind: 'score', ext: 'mxl' }
    if (lower.endsWith('.gp')) return { kind: 'score', ext: 'gp' }
    return null
  }
  if (looksLikeMusicXml(bytes)) return { kind: 'score', ext: 'musicxml' }
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return { kind: 'pdf', ext: 'pdf' }
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47])) return { kind: 'image', ext: 'png' }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return { kind: 'image', ext: 'jpg' }
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8))
    return { kind: 'image', ext: 'webp' }
  return null
}

/** Label guessed from the file name. More specific words are checked first (节奏吉他 before 吉他). */
const LABEL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/贝斯|bass/i, '贝斯'],
  [/鼓|drum/i, '鼓'],
  [/键盘|钢琴|keys|keyboard|piano|synth/i, '键盘'],
  [/主唱|人声|vocal|vox|简谱/i, '主唱'],
  [/节奏|rhythm/i, '节奏吉他'],
  [/主音|lead|solo/i, '主音吉他'],
  [/吉他|guitar|gtr/i, '吉他'],
]

export function guessLabel(name: string): string {
  for (const [re, label] of LABEL_RULES) if (re.test(name)) return label
  return DEFAULT_LABEL
}

/** Trimmed label, at most 20 characters; empty becomes 其他. */
function cleanLabel(raw: string): string {
  const t = raw.trim()
  return t ? cut(t, MAX_LABEL_CHARS) : DEFAULT_LABEL
}

/** Last path segment only, no control characters or reserved symbols, at most 200 characters. */
function cleanFileName(raw: string, ext: string): string {
  const base = raw.split(/[\\/]/).pop() ?? ''
  const kept = [...base]
    .filter((c) => c.charCodeAt(0) >= 0x20 && c.charCodeAt(0) !== 0x7f && !'<>:"|?*'.includes(c))
    .join('')
    .trim()
    .replace(/^\.+/, '')
    .trim()
  return kept ? cut(kept, MAX_FILE_NAME_CHARS) : `乐谱.${ext}`
}

/** Validates the body of POST /api/uploads/create. */
export function parseNewUploadSong(body: unknown): ParseResult<NewUploadSongBody> {
  if (!isRecord(body)) return { ok: false, error: '请求内容格式不对。' }
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  if (!title || codePoints(title) > MAX_TITLE_CHARS)
    return { ok: false, error: '歌名要在 1–80 个字之间。' }
  const artist = body.artist === undefined || body.artist === null ? '' : body.artist
  if (typeof artist !== 'string' || codePoints(artist.trim()) > MAX_ARTIST_CHARS)
    return { ok: false, error: '歌手名最多 80 个字。' }
  const band = body.bandSongId ?? null
  if (band !== null && (typeof band !== 'string' || !band || codePoints(band) > MAX_BAND_ID_CHARS))
    return { ok: false, error: '所选的歌曲不对，请刷新后再试。' }
  return { ok: true, value: { title, artist: artist.trim(), bandSongId: band } }
}

/** Validates the query of POST /api/uploads/file (the body is the raw file). */
export function parseUploadQuery(url: URL): ParseResult<UploadFileQuery> {
  const id = url.searchParams.get('id') ?? ''
  if (!ID_PATTERN.test(id)) return { ok: false, error: '缺少上传的歌曲编号。' }
  const rawLabel = (url.searchParams.get('label') ?? '').trim()
  if (codePoints(rawLabel) > MAX_LABEL_CHARS)
    return { ok: false, error: `声部名称最多 ${MAX_LABEL_CHARS} 个字。` }
  const name = url.searchParams.get('name') ?? ''
  if (codePoints(name) > MAX_FILE_NAME_CHARS)
    return { ok: false, error: `文件名太长（最多 ${MAX_FILE_NAME_CHARS} 个字符）。` }
  return { ok: true, value: { id, label: rawLabel || DEFAULT_LABEL, name } }
}

/**
 * Collects the raw request body. Stops as soon as `maxBytes` is exceeded: the
 * request is destroyed and the promise rejects with an UploadError (status 413).
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
        fail(new UploadError(413, SIZE_MESSAGE))
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

function cloneSong(s: UploadSong): UploadSong {
  return { ...s, files: s.files.map((f) => ({ ...f })) }
}

/** Checks one stored file row; null when it is malformed or its bytes are missing. */
function sanitizeFile(raw: unknown, songId: string, songDir: string): UploadFile | null {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null
  if (raw.kind !== 'score' && raw.kind !== 'pdf' && raw.kind !== 'image') return null
  if (typeof raw.ext !== 'string' || !EXT_PATTERN.test(raw.ext)) return null
  if (!fs.existsSync(path.join(songDir, `${raw.id}.${raw.ext}`))) return null
  return {
    id: raw.id,
    name: typeof raw.name === 'string' ? cut(raw.name, MAX_FILE_NAME_CHARS) : '',
    label: typeof raw.label === 'string' ? cleanLabel(raw.label) : DEFAULT_LABEL,
    kind: raw.kind,
    ext: raw.ext,
    size: Math.max(0, num(raw.size)),
    path: uploadPath(songId, raw.id, raw.ext),
    uploadedBy: typeof raw.uploadedBy === 'string' ? raw.uploadedBy : '',
    uploadedAt: num(raw.uploadedAt),
  }
}

/** Checks one stored song row. Its files whose bytes are missing are dropped; the song stays. */
function sanitizeSong(raw: unknown, uploadsDir: string, defaultBandId: string): UploadSong | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !ID_PATTERN.test(raw.id)) return null
  const songDir = path.join(uploadsDir, raw.id)
  const seen = new Set<string>()
  const files: UploadFile[] = []
  if (Array.isArray(raw.files)) {
    for (const row of raw.files) {
      const f = sanitizeFile(row, raw.id, songDir)
      if (!f || seen.has(f.id) || files.length >= MAX_FILES_PER_SONG) continue
      seen.add(f.id)
      files.push(f)
    }
  }
  return {
    id: raw.id,
    // Songs uploaded before several bands belong to the first band.
    bandId: typeof raw.bandId === 'string' && raw.bandId ? raw.bandId : defaultBandId,
    title: typeof raw.title === 'string' ? cut(raw.title, MAX_TITLE_CHARS) : '',
    artist: typeof raw.artist === 'string' ? cut(raw.artist, MAX_ARTIST_CHARS) : '',
    files,
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : '',
    createdAt: num(raw.createdAt),
    updatedAt: num(raw.updatedAt),
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

/** The members' uploaded songs. Reads are from memory; changes are written to disk first. */
export class UploadStore {
  private songs: UploadSong[]
  private readonly dataDir: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, songs: UploadSong[]) {
    this.dataDir = dataDir
    this.songs = songs
  }

  /**
   * Reads uploads.json once. Missing is empty; damaged is set aside; files whose bytes
   * are missing are dropped. Songs without a band join `defaultBandId`.
   */
  static async load(dataDir: string, defaultBandId = ''): Promise<UploadStore> {
    const file = path.join(dataDir, UPLOADS_FILE)
    const empty = () => new UploadStore(dataDir, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(`[谱库] 上传的谱读取失败，已当作空：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    if (!isRecord(raw) || raw.version !== UPLOADS_VERSION || !Array.isArray(raw.songs)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] 上传的谱数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const uploadsDir = path.join(dataDir, UPLOADS_DIR)
    const seen = new Set<string>()
    const songs: UploadSong[] = []
    for (const row of raw.songs) {
      const s = sanitizeSong(row, uploadsDir, defaultBandId)
      if (!s || seen.has(s.id)) continue
      seen.add(s.id)
      songs.push(s)
    }
    return new UploadStore(dataDir, songs)
  }

  private get uploadsDir(): string {
    return path.join(this.dataDir, UPLOADS_DIR)
  }

  private songDir(songId: string): string {
    return path.join(this.uploadsDir, songId)
  }

  private find(id: string): UploadSong | undefined {
    return this.songs.find((s) => s.id === id)
  }

  private mustSong(id: string): UploadSong {
    const song = this.find(id)
    if (!song) throw new UploadError(404, '找不到这首上传的歌。')
    return song
  }

  private mustFile(song: UploadSong, fileId: string): UploadFile {
    const file = song.files.find((f) => f.id === fileId)
    if (!file) throw new UploadError(404, '找不到这个文件。')
    return file
  }

  /** The uploaded songs (of one band, when given), newest update first. */
  list(bandId?: string): UploadSong[] {
    return this.songs
      .filter((s) => bandId === undefined || s.bandId === bandId)
      .map(cloneSong)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  /** Bytes of every file a band uploaded. */
  bytesOf(bandId: string): number {
    let total = 0
    for (const s of this.songs) if (s.bandId === bandId) for (const f of s.files) total += f.size
    return total
  }

  /** A band was deleted: its songs and their folders go too. */
  removeBand(bandId: string): Promise<void> {
    return this.queue(async () => {
      const gone = this.songs.filter((s) => s.bandId === bandId)
      if (gone.length === 0) return
      await this.commit(this.songs.filter((s) => s.bandId !== bandId))
      for (const s of gone)
        await fs.promises.rm(this.songDir(s.id), { recursive: true, force: true }).catch(() => {})
    })
  }

  get(id: string): UploadSong | undefined {
    const s = this.find(id)
    return s ? cloneSong(s) : undefined
  }

  /** The song and file behind an upload path, or null when it is not a listed upload. */
  fileOf(p: string): { song: UploadSong; file: UploadFile } | null {
    const parsed = parseUploadPath(p)
    if (!parsed) return null
    const song = this.find(parsed.songId)
    const file = song?.files.find((f) => f.id === parsed.fileId && f.ext === parsed.ext)
    return song && file ? { song: cloneSong(song), file: { ...file } } : null
  }

  /** Absolute path of a stored file. */
  filePath(songId: string, file: UploadFile): string {
    return path.join(this.songDir(songId), `${file.id}.${file.ext}`)
  }

  /** Absolute path for a well-formed, listed upload whose bytes exist on disk; otherwise null. */
  async resolve(relPath: string): Promise<string | null> {
    const found = this.fileOf(relPath)
    if (!found) return null
    const abs = this.filePath(found.song.id, found.file)
    const stat = await fs.promises.stat(abs).catch(() => null)
    return stat?.isFile() ? abs : null
  }

  /** Makes a new, empty song of a band. */
  create(
    body: { title: string; artist: string; bandId?: string },
    userId: string,
    now: number,
  ): Promise<UploadSong> {
    return this.queue(async () => {
      if (this.songs.length >= MAX_UPLOAD_SONGS)
        throw new UploadError(409, '上传的歌太多了，请先删掉一些。')
      const song: UploadSong = {
        id: newId(),
        bandId: body.bandId ?? '',
        title: body.title,
        artist: body.artist,
        files: [],
        createdBy: userId,
        createdAt: now,
        updatedAt: now,
      }
      await this.commit([...this.songs, song])
      return cloneSong(song)
    })
  }

  /** Changes the title and artist of a song. */
  update(id: string, body: { title: string; artist: string }, now: number): Promise<UploadSong> {
    return this.queue(async () => {
      const song = this.mustSong(id)
      const updated: UploadSong = {
        ...song,
        title: body.title,
        artist: body.artist,
        updatedAt: now,
      }
      await this.commit(this.songs.map((s) => (s.id === id ? updated : s)))
      return cloneSong(updated)
    })
  }

  /**
   * Stores a file at the end of the song's list. The type comes from the bytes
   * only; anything else, an oversized file or a full song is refused.
   */
  addFile(
    id: string,
    meta: { label: string; name: string },
    bytes: Buffer,
    userId: string,
    now: number,
  ): Promise<UploadSong> {
    return this.queue(async () => {
      const song = this.mustSong(id)
      if (bytes.length > MAX_UPLOAD_BYTES) throw new UploadError(413, SIZE_MESSAGE)
      const type = detectUploadType(bytes, meta.name)
      if (!type) throw new UploadError(400, TYPE_MESSAGE)
      if (song.files.length >= MAX_FILES_PER_SONG)
        throw new UploadError(409, `每首歌最多 ${MAX_FILES_PER_SONG} 个文件。`)

      const fileId = newId()
      const file: UploadFile = {
        id: fileId,
        name: cleanFileName(meta.name, type.ext),
        label: cleanLabel(meta.label),
        kind: type.kind,
        ext: type.ext,
        size: bytes.length,
        path: uploadPath(id, fileId, type.ext),
        uploadedBy: userId,
        uploadedAt: now,
      }
      const target = this.filePath(id, file)
      await fs.promises.mkdir(this.songDir(id), { recursive: true })
      await writeBytesAtomic(target, bytes)
      const updated: UploadSong = { ...song, files: [...song.files, file], updatedAt: now }
      try {
        await this.commit(this.songs.map((s) => (s.id === id ? updated : s)))
      } catch (err) {
        await fs.promises.rm(target, { force: true }).catch(() => {})
        throw err
      }
      return cloneSong(updated)
    })
  }

  /** Changes the label (instrument / part) of one file. */
  relabel(id: string, fileId: string, label: string, now: number): Promise<UploadSong> {
    return this.queue(async () => {
      const song = this.mustSong(id)
      const file = this.mustFile(song, fileId)
      const nextFile: UploadFile = { ...file, label: cleanLabel(label) }
      const updated: UploadSong = {
        ...song,
        files: song.files.map((f) => (f === file ? nextFile : f)),
        updatedAt: now,
      }
      await this.commit(this.songs.map((s) => (s.id === id ? updated : s)))
      return cloneSong(updated)
    })
  }

  /** Deletes one file: the metadata first, then its bytes. */
  removeFile(id: string, fileId: string, now: number): Promise<UploadSong> {
    return this.queue(async () => {
      const song = this.mustSong(id)
      const file = this.mustFile(song, fileId)
      const updated: UploadSong = {
        ...song,
        files: song.files.filter((f) => f !== file),
        updatedAt: now,
      }
      await this.commit(this.songs.map((s) => (s.id === id ? updated : s)))
      await fs.promises.rm(this.filePath(id, file), { force: true }).catch(() => {})
      return cloneSong(updated)
    })
  }

  /** Deletes a whole song: the metadata first, then its folder. */
  remove(id: string): Promise<void> {
    return this.queue(async () => {
      this.mustSong(id)
      await this.commit(this.songs.filter((s) => s.id !== id))
      await fs.promises.rm(this.songDir(id), { recursive: true, force: true }).catch(() => {})
    })
  }

  /** Writes the new state first; only then does it replace the in-memory one. */
  private async commit(next: UploadSong[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, UPLOADS_FILE),
      JSON.stringify({ version: UPLOADS_VERSION, songs: next }),
    )
    this.songs = next
  }
}
