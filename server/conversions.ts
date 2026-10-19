/**
 * PDF → Guitar Pro conversion on the score server (PDF 转谱). A Python helper
 * (pdf2gp/) does the work in a child process. This module runs it one at a time,
 * checks what it printed, and keeps the GP5 files and their star ratings in
 * SCORES_DATA/conversions.json + SCORES_DATA/conversions/<id>.gp5. The score
 * library itself is never touched.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ConversionRecord, ConversionStatus } from '../src/songs/scoreServerTypes'
import { createSerialQueue } from './favorites'
import { writeFileAtomic } from './util'

export const PDF2GP_DIR = 'pdf2gp'
export const CONVERTER_SCRIPT = 'convert_cli.py'
export const CONVERSIONS_FILE = 'conversions.json'
export const CONVERSIONS_DIR = 'conversions'
export const CONVERSIONS_VERSION = 1
export const MAX_CONVERSIONS = 3000
export const MAX_CONVERSIONS_PER_SONG = 20
export const MAX_CONVERTER_WAITING = 5
export const CONVERTER_TIMEOUT_MS = 120_000
export const CONVERTER_OUTPUT_CAP = 64 * 1024
export const GP5_HEADER = 'FICHIER GUITAR PRO'

export const CONVERTER_MISSING_REASON =
  '服务器还没装 PDF 转换组件：请在服务器上安装 Python 3.11+ 并运行 pdf2gp/setup.sh。'
const TIMEOUT_MESSAGE = '转换超时（超过 2 分钟），这份 PDF 可能太复杂。'
const NO_RESULT_MESSAGE = '转换组件没有返回可识别的结果，请稍后再试。'
const START_MESSAGE = '转换组件无法启动，请检查服务器上的 pdf2gp 安装。'
const OUTPUT_TOO_LONG_MESSAGE = '转换组件输出过长，已停止。'
const BUSY_MESSAGE = '正在转换其他谱子，请稍后再试。'
const SONG_FULL_MESSAGE = '这首歌的转换版太多了，请先删掉一些。'
const RATING_MESSAGE = '星级必须是 1–5 的整数（0 表示取消）。'

/** A found converter: the venv python and the CLI script. */
export interface ConverterTool {
  python: string
  script: string
}

export type ConverterFailureKind = 'image' | 'no-tab' | 'invalid' | 'too-big' | 'error'

/** What the CLI printed as its last JSON line, checked. */
export type CliResult =
  | { ok: true; bars: number; tracks: string[]; warnings: string[]; title: string; artist: string }
  | { ok: false; kind: ConverterFailureKind; message: string }

/** A conversion as stored: the record fields without the derived rating, plus per-user stars. */
export type StoredConversion = Omit<ConversionRecord, 'rating' | 'myRating'> & {
  ratings: Record<string, number>
}

/** What a stored conversion needs from the caller. */
export interface NewConversionMeta {
  songKey: string
  sourcePath: string
  title: string
  artist: string
  bars: number
  tracks: string[]
  warnings: string[]
}

/** An error the route can turn into an HTTP status and a Chinese message. */
export class ConversionError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ConversionError'
    this.status = status
  }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/**
 * Finds the converter. `baseDirs` are the directories that may hold a `pdf2gp/`
 * folder (the running server's directory first, then the working directory).
 * Returns the first one whose venv python and CLI script both exist, or null.
 */
export function resolvePdf2gp(baseDirs: string[]): ConverterTool | null {
  const venvPython =
    process.platform === 'win32'
      ? path.join('.venv', 'Scripts', 'python.exe')
      : path.join('.venv', 'bin', 'python')
  for (const base of baseDirs) {
    const dir = path.join(base, PDF2GP_DIR)
    const python = path.join(dir, venvPython)
    const script = path.join(dir, CONVERTER_SCRIPT)
    if (fs.existsSync(python) && fs.existsSync(script)) return { python, script }
  }
  return null
}

/** The status the page shows: available, or the Chinese reason it is not. */
export function conversionStatus(found: ConverterTool | null): ConversionStatus {
  return found ? { available: true, reason: null } : { available: false, reason: CONVERTER_MISSING_REASON }
}

const failure = (kind: ConverterFailureKind, message: string): CliResult => ({ ok: false, kind, message })
const FAILURE_KINDS: readonly ConverterFailureKind[] = ['image', 'no-tab', 'invalid', 'too-big', 'error']

/** Checks one parsed JSON line; anything that does not fit the contract is an 'error'. */
function toCliResult(raw: Record<string, unknown>): CliResult | null {
  const strings = (v: unknown): string[] | null =>
    Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null
  if (raw.ok === true) {
    const tracks = strings(raw.tracks)
    const warnings = strings(raw.warnings)
    if (typeof raw.bars !== 'number' || !Number.isFinite(raw.bars) || !tracks || !warnings) return null
    return {
      ok: true,
      bars: raw.bars,
      tracks,
      warnings,
      title: typeof raw.title === 'string' ? raw.title : '',
      artist: typeof raw.artist === 'string' ? raw.artist : '',
    }
  }
  if (raw.ok === false) {
    const kind = FAILURE_KINDS.find((k) => k === raw.kind) ?? 'error'
    const message = typeof raw.message === 'string' && raw.message ? raw.message : NO_RESULT_MESSAGE
    return failure(kind, message)
  }
  return null
}

/** The last JSON object line of the output, or an 'error' when there is none. */
function parseOutput(text: string): CliResult {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    let raw: unknown
    try {
      raw = JSON.parse(lines[i])
    } catch {
      continue
    }
    if (!isObject(raw)) continue
    return toCliResult(raw) ?? failure('error', NO_RESULT_MESSAGE)
  }
  return failure('error', NO_RESULT_MESSAGE)
}

/**
 * Runs the converter once: `python script input output`, no shell. Stdout is
 * capped; over the cap or past `timeoutMs` the process is killed and an 'error'
 * comes back. Never rejects.
 */
export function runConverter(
  tool: ConverterTool,
  inputPath: string,
  outputPath: string,
  timeoutMs = CONVERTER_TIMEOUT_MS,
): Promise<CliResult> {
  return new Promise((resolve) => {
    let settled = false
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(tool.python, [tool.script, inputPath, outputPath], {
        shell: false,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch {
      resolve(failure('error', START_MESSAGE))
      return
    }
    const finish = (result: CliResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    const stop = (result: CliResult) => {
      child.kill('SIGKILL')
      finish(result)
    }
    const timer = setTimeout(() => stop(failure('error', TIMEOUT_MESSAGE)), timeoutMs)
    const chunks: Buffer[] = []
    let size = 0
    child.stdout?.on('data', (chunk: Buffer) => {
      if (settled) return
      size += chunk.length
      if (size > CONVERTER_OUTPUT_CAP) {
        stop(failure('error', OUTPUT_TOO_LONG_MESSAGE))
        return
      }
      chunks.push(chunk)
    })
    child.stderr?.on('data', () => {})
    child.on('error', () => finish(failure('error', START_MESSAGE)))
    child.on('close', () => finish(parseOutput(Buffer.concat(chunks).toString('utf8'))))
  })
}

/** Runs conversions one at a time; a request arriving while one runs waits in FIFO order. */
export class ConversionQueue {
  private running = false
  private readonly waiting: Array<() => void> = []
  private readonly maxWaiting: number

  constructor(maxWaiting = MAX_CONVERTER_WAITING) {
    this.maxWaiting = maxWaiting
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.running) {
      if (this.waiting.length >= this.maxWaiting) throw new ConversionError(429, BUSY_MESSAGE)
      await new Promise<void>((resolve) => this.waiting.push(resolve))
      // The slot was handed over: `running` stays true.
    } else {
      this.running = true
    }
    try {
      return await task()
    } finally {
      const next = this.waiting.shift()
      if (next) next()
      else this.running = false
    }
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
const strings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []

/** Checks one stored row; null when it is malformed. */
function sanitizeRow(raw: unknown): StoredConversion | null {
  if (!isObject(raw)) return null
  if (typeof raw.id !== 'string' || !/^[0-9a-f]{12}$/.test(raw.id)) return null
  if (typeof raw.songKey !== 'string' || !raw.songKey) return null
  const ratings: Record<string, number> = {}
  if (isObject(raw.ratings)) {
    for (const [user, stars] of Object.entries(raw.ratings))
      if (typeof stars === 'number' && Number.isInteger(stars) && stars >= 1 && stars <= 5) ratings[user] = stars
  }
  return {
    id: raw.id,
    songKey: raw.songKey,
    sourcePath: str(raw.sourcePath),
    title: str(raw.title),
    artist: str(raw.artist),
    createdBy: str(raw.createdBy),
    createdAt: num(raw.createdAt),
    bars: num(raw.bars),
    tracks: strings(raw.tracks),
    warnings: strings(raw.warnings),
    ratings,
  }
}

/** Whether the bytes start with the Guitar Pro 5 header (byte 0 is a length prefix). */
export function isGp5(bytes: Buffer): boolean {
  return (
    bytes.length > 1 + GP5_HEADER.length &&
    bytes.subarray(1, 1 + GP5_HEADER.length).toString('latin1') === GP5_HEADER
  )
}

const copyStored = (s: StoredConversion): StoredConversion => ({
  ...s,
  tracks: [...s.tracks],
  warnings: [...s.warnings],
  ratings: { ...s.ratings },
})

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

/** The stored PDF conversions: metadata in memory, written to disk before each change takes effect. */
export class ConversionStore {
  private items: StoredConversion[]
  private readonly dataDir: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, items: StoredConversion[]) {
    this.dataDir = dataDir
    this.items = items
  }

  /** Reads conversions.json. Missing is empty; damaged is set aside; rows whose GP5 file is missing are dropped. */
  static async load(dataDir: string): Promise<ConversionStore> {
    const file = path.join(dataDir, CONVERSIONS_FILE)
    const empty = () => new ConversionStore(dataDir, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT')
        console.warn(`[谱库] PDF 转谱数据读取失败，已当作空：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    if (!isObject(raw) || raw.version !== CONVERSIONS_VERSION || !Array.isArray(raw.items)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] PDF 转谱数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const dir = path.join(dataDir, CONVERSIONS_DIR)
    const seen = new Set<string>()
    const items: StoredConversion[] = []
    for (const row of raw.items) {
      const item = sanitizeRow(row)
      if (!item || seen.has(item.id)) continue
      if (!fs.existsSync(path.join(dir, `${item.id}.gp5`))) continue
      seen.add(item.id)
      items.push(item)
    }
    return new ConversionStore(dataDir, items)
  }

  /** Absolute path of a conversion's GP5 file. */
  filePath(id: string): string {
    return path.join(this.dataDir, CONVERSIONS_DIR, `${id}.gp5`)
  }

  /** The song's conversions, newest first. */
  list(songKey: string): StoredConversion[] {
    return this.items
      .filter((i) => i.songKey === songKey)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(copyStored)
  }

  get(id: string): StoredConversion | undefined {
    const item = this.items.find((i) => i.id === id)
    return item ? copyStored(item) : undefined
  }

  /** The newest conversion made from this library PDF, if any. */
  findBySource(sourcePath: string): StoredConversion | undefined {
    const matches = this.items
      .filter((i) => i.sourcePath === sourcePath)
      .sort((a, b) => b.createdAt - a.createdAt)
    return matches[0] ? copyStored(matches[0]) : undefined
  }

  /** Stores a converted GP5 file. The bytes must be a GP5 file; a full song or a full store is refused. */
  add(meta: NewConversionMeta, gp5: Buffer, userId: string, now: number): Promise<StoredConversion> {
    return this.queue(async () => {
      if (!isGp5(gp5)) throw new ConversionError(422, '转换生成的文件不是有效的 Guitar Pro 乐谱，请换一份 PDF 再试。')
      if (this.items.filter((i) => i.songKey === meta.songKey).length >= MAX_CONVERSIONS_PER_SONG)
        throw new ConversionError(400, SONG_FULL_MESSAGE)

      let id = randomBytes(6).toString('hex')
      while (this.items.some((i) => i.id === id)) id = randomBytes(6).toString('hex')
      const item: StoredConversion = {
        id,
        songKey: meta.songKey,
        sourcePath: meta.sourcePath,
        title: meta.title,
        artist: meta.artist,
        createdBy: userId,
        createdAt: now,
        bars: meta.bars,
        tracks: [...meta.tracks],
        warnings: [...meta.warnings],
        ratings: {},
      }

      const file = this.filePath(id)
      await fs.promises.mkdir(path.dirname(file), { recursive: true })
      await writeBytesAtomic(file, gp5)

      // Over the total cap, the oldest existing conversions make room.
      const overflow = this.items.length + 1 - MAX_CONVERSIONS
      const evicted = overflow > 0 ? [...this.items].sort((a, b) => a.createdAt - b.createdAt).slice(0, overflow) : []
      const drop = new Set(evicted.map((e) => e.id))
      try {
        await this.commit([...this.items.filter((i) => !drop.has(i.id)), item])
      } catch (err) {
        await fs.promises.rm(file, { force: true }).catch(() => {})
        throw err
      }
      for (const e of evicted) await fs.promises.rm(this.filePath(e.id), { force: true }).catch(() => {})
      return copyStored(item)
    })
  }

  /** Sets (1–5) or clears (0) one user's stars. */
  rate(id: string, userId: string, stars: number): Promise<void> {
    return this.queue(async () => {
      if (!Number.isInteger(stars) || stars < 0 || stars > 5) throw new ConversionError(400, RATING_MESSAGE)
      const item = this.items.find((i) => i.id === id)
      if (!item) throw new ConversionError(404, '找不到这个转换版。')
      const ratings = { ...item.ratings }
      if (stars === 0) delete ratings[userId]
      else ratings[userId] = stars
      const updated: StoredConversion = { ...item, ratings }
      await this.commit(this.items.map((i) => (i === item ? updated : i)))
    })
  }

  /** Deletes the metadata first, then the GP5 file. */
  remove(id: string): Promise<void> {
    return this.queue(async () => {
      const item = this.items.find((i) => i.id === id)
      if (!item) throw new ConversionError(404, '找不到这个转换版。')
      await this.commit(this.items.filter((i) => i !== item))
      await fs.promises.rm(this.filePath(id), { force: true }).catch(() => {})
    })
  }

  /** The page's view of a conversion: average stars (0.1 precision), count and this user's own stars. */
  toRecord(stored: StoredConversion, userId: string): ConversionRecord {
    const values = Object.values(stored.ratings)
    const count = values.length
    const sum = values.reduce((a, b) => a + b, 0)
    const average = count ? Math.round((sum / count) * 10) / 10 : 0
    const mine = stored.ratings[userId]
    return {
      id: stored.id,
      songKey: stored.songKey,
      sourcePath: stored.sourcePath,
      title: stored.title,
      artist: stored.artist,
      createdBy: stored.createdBy,
      createdAt: stored.createdAt,
      bars: stored.bars,
      tracks: [...stored.tracks],
      warnings: [...stored.warnings],
      rating: { average, count },
      myRating: typeof mine === 'number' ? mine : null,
    }
  }

  private async commit(next: readonly StoredConversion[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, CONVERSIONS_FILE),
      JSON.stringify({ version: CONVERSIONS_VERSION, items: next }),
    )
    this.items = [...next]
  }
}

export interface ConvertOptions {
  tool: ConverterTool
  queue: ConversionQueue
  store: ConversionStore
  /** The library PDF, absolute path. */
  absPdf: string
  /** The library PDF, as the library names it. */
  sourcePath: string
  songKey: string
  title: string
  artist: string
  userId: string
  /** Where the CLI writes its temporary GP5 file. */
  tmpDir: string
  now: number
}

/**
 * Converts one PDF through the queue, stores the GP5 and returns its record.
 * The temporary file is removed whether or not the conversion worked. CLI
 * failures become a ConversionError with status 422 and the CLI's message.
 */
export async function convertPdf(opts: ConvertOptions): Promise<ConversionRecord> {
  const tmpFile = path.join(opts.tmpDir, `${randomBytes(8).toString('hex')}.gp5`)
  try {
    await fs.promises.mkdir(opts.tmpDir, { recursive: true })
    const result = await opts.queue.run(() => runConverter(opts.tool, opts.absPdf, tmpFile))
    if (!result.ok) throw new ConversionError(422, result.message)
    let bytes: Buffer
    try {
      bytes = await fs.promises.readFile(tmpFile)
    } catch {
      throw new ConversionError(422, '转换没有生成乐谱文件，请换一份 PDF 再试。')
    }
    if (!isGp5(bytes)) throw new ConversionError(422, '转换生成的文件不是有效的 Guitar Pro 乐谱，请换一份 PDF 再试。')
    const stored = await opts.store.add(
      {
        songKey: opts.songKey,
        sourcePath: opts.sourcePath,
        title: opts.title || result.title,
        artist: opts.artist || result.artist,
        bars: result.bars,
        tracks: result.tracks,
        warnings: result.warnings,
      },
      bytes,
      opts.userId,
      opts.now,
    )
    return opts.store.toRecord(stored, opts.userId)
  } finally {
    await fs.promises.rm(tmpFile, { force: true }).catch(() => {})
  }
}
