/**
 * 鼓谱 on the score server: the saved drum parts (`drums.json` in the data dir),
 * request parsing for generation and saving, the template library, and the
 * generation handler. The score file itself is never changed. Validation of a
 * part's shape lives in src/songs/drumPart.ts; this file adds the path checks.
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import * as alphaTab from '@coderline/alphatab'
import { validatePart } from '../src/songs/drumPart'
import { songBars } from '../src/songs/drumScore'
import type {
  DrumPart,
  DrumStyleInfo,
  DrumTemplateLibrary,
  GenerateDrumsBody,
  GenerateDrumsResult,
  SongBarInfo,
} from '../src/songs/drumTypes'
import drumTemplates from '../src/songs/drumTemplates.json' with { type: 'json' }
import {
  createSerialQueue,
  MAX_TEXT_CHARS,
  textOk,
  type InRoot,
  type ParseResult,
} from './favorites'
import { writeFileAtomic } from './util'

// alphaTab logs warnings for odd files; the server must stay quiet.
alphaTab.Logger.logLevel = alphaTab.LogLevel.None

export const DRUMS_FILE = 'drums.json'
export const DRUMS_VERSION = 1
export const MAX_DRUM_PARTS = 5000
export const DRUM_EXTENSIONS = [
  '.gp',
  '.gp3',
  '.gp4',
  '.gp5',
  '.gpx',
  '.musicxml',
  '.xml',
  '.mxl',
] as const
const MAX_STYLE_CHARS = 40
const MAX_RANGE_BAR = 4000
const MAX_GUIDE_TRACK = 63
const DEFAULT_TEMPERATURE = 0.7

// ---------------------------------------------------------------------------
// the saved parts
// ---------------------------------------------------------------------------

/** Keeps the newest `max` parts (by updatedAt); returns the map to store. */
function capParts(parts: Map<string, DrumPart>, max: number): Map<string, DrumPart> {
  if (parts.size <= max) return parts
  const sorted = [...parts.values()].sort((a, b) => b.updatedAt - a.updatedAt)
  return new Map(sorted.slice(0, max).map((p) => [p.path, p]))
}

/** The saved drum parts, one per score file. Writes are serialized and atomic. */
export class DrumStore {
  private readonly file: string
  private readonly queue = createSerialQueue()

  private constructor(
    private readonly dataDir: string,
    private parts: Map<string, DrumPart>,
  ) {
    this.file = path.join(dataDir, DRUMS_FILE)
  }

  /** Reads drums.json once at startup. Missing is empty; damaged is set aside; bad entries are dropped. */
  static async load(dataDir: string, inRoot: InRoot): Promise<DrumStore> {
    const file = path.join(dataDir, DRUMS_FILE)
    const empty = () => new DrumStore(dataDir, new Map())
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      console.warn(`[鼓谱] 鼓谱数据读取失败，已当作空：${(err as Error).message}`)
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
    if (
      !rec ||
      rec.version !== DRUMS_VERSION ||
      !rec.parts ||
      typeof rec.parts !== 'object' ||
      Array.isArray(rec.parts)
    ) {
      // Keep the damaged file for a look; start empty.
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[鼓谱] 鼓谱数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const parts = new Map<string, DrumPart>()
    for (const entry of Object.values(rec.parts as Record<string, unknown>)) {
      const r = validatePart(entry)
      if (!r.ok || !inRoot(r.value.path)) continue
      parts.set(r.value.path, r.value)
    }
    return new DrumStore(dataDir, capParts(parts, MAX_DRUM_PARTS))
  }

  get(rel: string): DrumPart | undefined {
    return this.parts.get(rel)
  }

  has(rel: string): boolean {
    return this.parts.has(rel)
  }

  /** Stores the part (updatedAt / updatedBy are set here) and returns the stored copy. */
  async save(part: DrumPart, userId: string, now: number): Promise<DrumPart> {
    const stored: DrumPart = { ...part, updatedAt: now, updatedBy: userId }
    await this.queue(async () => {
      const next = new Map(this.parts)
      next.set(stored.path, stored)
      await this.write(capParts(next, MAX_DRUM_PARTS))
    })
    return stored
  }

  /** Removes the part of `rel`; false when there was none. */
  async remove(rel: string): Promise<boolean> {
    return this.queue(async () => {
      if (!this.parts.has(rel)) return false
      const next = new Map(this.parts)
      next.delete(rel)
      await this.write(next)
      return true
    })
  }

  private async write(parts: Map<string, DrumPart>): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    const body = { version: DRUMS_VERSION, parts: Object.fromEntries(parts) }
    await writeFileAtomic(this.file, JSON.stringify(body))
    this.parts = parts
  }
}

/** Validates the body of POST /api/drums/save: `{ part }`. */
export function parseSaveBody(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<DrumPart> {
  const r = validatePart(body.part)
  if (!r.ok) return { ok: false, error: r.error }
  if (!inRoot(r.value.path)) return { ok: false, error: '这个鼓谱对应的文件不在谱库里。' }
  return { ok: true, value: r.value }
}

// ---------------------------------------------------------------------------
// generation request
// ---------------------------------------------------------------------------

const hasDrumExtension = (rel: string): boolean => {
  const lower = rel.toLowerCase()
  return DRUM_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)

/** Validates the body of POST /api/drums/generate. */
export function parseGenerateBody(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<GenerateDrumsBody> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p) || !hasDrumExtension(p))
    return { ok: false, error: '这个文件不是可以生成鼓谱的乐谱（支持 GP / MusicXML）。' }
  if (!textOk(body.title) || !textOk(body.artist))
    return { ok: false, error: `曲名或歌手名太长（最多 ${MAX_TEXT_CHARS} 个字符）。` }
  if (body.engine !== 'template' && body.engine !== 'drumify')
    return { ok: false, error: '鼓谱生成方式不对。' }
  const style = body.style ?? null
  if (style !== null && (typeof style !== 'string' || [...style].length > MAX_STYLE_CHARS))
    return { ok: false, error: `鼓型编号不对（最多 ${MAX_STYLE_CHARS} 个字符）。` }
  const guideTrack = body.guideTrack ?? null
  if (
    guideTrack !== null &&
    (!isInteger(guideTrack) || guideTrack < 0 || guideTrack > MAX_GUIDE_TRACK)
  )
    return { ok: false, error: '节奏参考音轨不对。' }
  let range: [number, number] | null = null
  if (body.range !== null && body.range !== undefined) {
    const r = body.range
    if (!Array.isArray(r) || r.length !== 2) return { ok: false, error: '重新生成的小节范围不对。' }
    const [a, b] = r
    if (!isInteger(a) || !isInteger(b) || a < 0 || a > b || b > MAX_RANGE_BAR)
      return {
        ok: false,
        error: `重新生成的小节范围不对（应为 0 ≤ 起始 ≤ 结束 ≤ ${MAX_RANGE_BAR}）。`,
      }
    range = [a, b]
  }
  const t = body.temperature ?? DEFAULT_TEMPERATURE
  if (typeof t !== 'number' || !Number.isFinite(t) || t < 0.1 || t > 1.5)
    return { ok: false, error: '随机程度应在 0.1 到 1.5 之间。' }
  return {
    ok: true,
    value: {
      path: p,
      title: body.title,
      artist: body.artist,
      engine: body.engine,
      style,
      guideTrack,
      range,
      temperature: t,
    },
  }
}

// ---------------------------------------------------------------------------
// template library
// ---------------------------------------------------------------------------

/** The bundled template library (src/songs/drumTemplates.json). */
export function loadTemplates(): DrumTemplateLibrary {
  return drumTemplates as unknown as DrumTemplateLibrary
}

/** Style list for the picker, without the patterns. */
export function styleInfos(lib: DrumTemplateLibrary): DrumStyleInfo[] {
  return lib.styles.map((s) => ({
    id: s.id,
    zh: s.zh,
    meter: s.meter,
    minBpm: s.minBpm,
    maxBpm: s.maxBpm,
  }))
}

// ---------------------------------------------------------------------------
// reading the score
// ---------------------------------------------------------------------------

const garbled = (names: string[]) => names.reduce((n, t) => n + (t.match(/�/g) ?? []).length, 0)

/** UTF-8 first; GBK / Big5 only when the track names come out garbled (own copy of ensembles' rule). */
function loadReadable(bytes: Uint8Array): alphaTab.model.Score {
  const load = (encoding: string) => {
    const settings = new alphaTab.Settings()
    settings.importer.encoding = encoding
    return alphaTab.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
  }
  let best = load('utf-8')
  let bad = garbled(best.tracks.map((t) => t.name ?? ''))
  for (const encoding of ['gbk', 'big5']) {
    if (bad === 0) break
    try {
      const s = load(encoding)
      const b = garbled(s.tracks.map((t) => t.name ?? ''))
      if (b < bad) {
        best = s
        bad = b
      }
    } catch {
      // keep the UTF-8 reading
    }
  }
  return best
}

/** Loads a score file with alphaTab (Node). Throws when the file cannot be read or parsed. */
export async function readScoreFile(absPath: string): Promise<alphaTab.model.Score> {
  const bytes = await fs.promises.readFile(absPath)
  return loadReadable(bytes)
}

// ---------------------------------------------------------------------------
// generation handler
// ---------------------------------------------------------------------------

/** Template engine: bars from the template library (synchronous). */
export type TemplateEngine = (
  song: SongBarInfo[],
  opts: {
    lib: DrumTemplateLibrary
    style: string | null
    seed: number
    range: [number, number] | null
  },
) => { first: number; bars: GenerateDrumsResult['bars']; style: string | null }

/** Drumify engine: bars from the Magenta Drumify model running on this server. */
export type DrumifyEngine = (
  song: SongBarInfo[],
  opts: {
    lib: DrumTemplateLibrary
    style: string | null
    temperature: number
    range: [number, number] | null
  },
) => Promise<{ first: number; bars: GenerateDrumsResult['bars']; style: string | null }>

export interface DrumEngines {
  template: TemplateEngine
  drumify?: DrumifyEngine
}

export interface GenerateDeps {
  readScore?: (absPath: string) => Promise<alphaTab.model.Score>
}

/** Seed from the file path and the clock, so 再生成 gives a different result. */
function makeSeed(rel: string, now: number): number {
  const digest = createHash('sha256').update(`${rel}\n${now}`).digest()
  return digest.readUInt32BE(0)
}

/**
 * POST /api/drums/generate: reads the score, works out the song's bars and runs
 * the chosen engine. Returns the bars without saving them.
 */
export async function generateDrums(
  body: GenerateDrumsBody,
  absPath: string,
  engines: DrumEngines,
  lib: DrumTemplateLibrary = loadTemplates(),
  deps: GenerateDeps = {},
): Promise<GenerateDrumsResult> {
  const readScore = deps.readScore ?? readScoreFile
  let score: alphaTab.model.Score
  try {
    score = await readScore(absPath)
  } catch {
    throw new Error('读不出这个乐谱文件，无法生成鼓谱。请确认文件没有损坏。')
  }
  const song = songBars(score, body.guideTrack)
  if (song.length === 0) throw new Error('这个乐谱没有小节，无法生成鼓谱。')
  if (body.range && body.range[1] >= song.length)
    throw new Error(`重新生成的小节范围超出了曲子（共 ${song.length} 小节）。`)

  if (body.engine === 'template') {
    const seed = makeSeed(body.path, Date.now())
    const out = engines.template(song, { lib, style: body.style, seed, range: body.range })
    return { first: out.first, bars: out.bars, source: 'template', style: out.style }
  }
  if (!engines.drumify) throw new Error('智能鼓谱（Drumify）暂不可用，请改用模板生成。')
  const out = await engines.drumify(song, {
    lib,
    style: body.style,
    temperature: body.temperature,
    range: body.range,
  })
  return { first: out.first, bars: out.bars, source: 'drumify', style: out.style }
}
