/**
 * 找乐队谱 (ensemble index) of the score server: finds which Guitar Pro files
 * in the library are full band arrangements (drums + bass + guitar or keys).
 *
 * The library can hold tens of thousands of GP files, so the server reads each
 * file's track list once in the background (one file at a time, yielding to the
 * event loop between files) and caches the result in <dataDir>/ensembles.json.
 * Only track names, kinds and counts are kept — no notes.
 *
 * The classification helpers (classifyTrack, summarize, parseNeed, matchesNeed)
 * are pure so they can be tested without alphaTab's parser.
 */
import fs from 'node:fs'
import path from 'node:path'
import * as alphaTab from '@coderline/alphatab'
import type { EnsembleFile, EnsembleResult, EnsembleTrack, TrackKind } from '../src/songs/scoreServerTypes'
import { writeFileAtomic } from './util'

// alphaTab logs warnings for odd files; the server must stay quiet.
alphaTab.Logger.logLevel = alphaTab.LogLevel.None

export const ENSEMBLE_FILE = 'ensembles.json'
export const ENSEMBLE_VERSION = 2 // 2: track names read as GBK / Big5 when garbled in UTF-8
/** Extensions read by the index. .gtp (GP 1–2) and .ptb are not parsed by alphaTab. */
export const ENSEMBLE_EXTENSIONS = new Set(['.gp', '.gp3', '.gp4', '.gp5', '.gpx'])
const SAVE_EVERY = 200
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100

// ---------------------------------------------------------------------------
// classification (pure)
// ---------------------------------------------------------------------------

export interface TrackFacts {
  name: string
  /** General MIDI program (0–127). */
  program: number
  isPercussion: boolean
  /** Number of strings (the length of the tuning); 0 for non-string tracks. */
  stringCount: number
  /** Lowest tuning as a MIDI note, or null when there is no tuning. */
  lowestMidi: number | null
}

// Name hints. Chinese terms match anywhere; English terms match at the start of
// a word, so "keyboard" and "guitars" match but "monkey" does not.
const DRUM_NAME = /鼓|\bdrum|\bperc/i
const BASS_NAME = /贝斯|低音|\bbass/i
const KEYS_NAME = /键盘|钢琴|\bkey|\bpiano|\borgan|\bsynth|\bpad/i
const VOCAL_NAME = /人声|主唱|唱|\bvocal|\bvoice|\bvox|\bmelody|旋律/i
const GUITAR_NAME = /吉他|\bguitar|\bgtr|\bsolo|\blead|\brhythm|节奏|主音/i

/** Lowest open string (MIDI) of a bass guitar range: below this a 4–5 string track is a bass. */
const BASS_MAX_LOWEST_MIDI = 36

/**
 * The kind of one track. Percussion is drums. Then the name (Chinese and
 * English hints), then the GM program, then the strings.
 */
export function classifyTrack(t: TrackFacts): TrackKind {
  if (t.isPercussion) return 'drums'
  const name = t.name ?? ''
  if (DRUM_NAME.test(name)) return 'drums'
  if (BASS_NAME.test(name)) return 'bass'
  if (KEYS_NAME.test(name)) return 'keys'
  if (VOCAL_NAME.test(name)) return 'vocal'
  if (GUITAR_NAME.test(name)) return 'guitar'

  const p = t.program
  if (p >= 24 && p <= 31) return 'guitar'
  if (p >= 32 && p <= 39) return 'bass'
  if (p >= 52 && p <= 54) return 'vocal'
  // Piano and organ programs: but a track with strings is a string instrument
  // (many GP guitar tracks are saved with program 0), so the strings decide.
  if (((p >= 0 && p <= 7) || (p >= 16 && p <= 23)) && t.stringCount < 4) return 'keys'

  if (t.stringCount >= 4 && t.stringCount <= 5) {
    return t.lowestMidi !== null && t.lowestMidi < BASS_MAX_LOWEST_MIDI ? 'bass' : 'other'
  }
  if (t.stringCount >= 6 && t.stringCount <= 8) return 'guitar'
  return 'other'
}

/** Counts per kind (only kinds that occur) and whether the set is a full band. */
export function summarize(tracks: EnsembleTrack[]): {
  counts: Partial<Record<TrackKind, number>>
  band: boolean
} {
  const counts: Partial<Record<TrackKind, number>> = {}
  for (const t of tracks) counts[t.kind] = (counts[t.kind] ?? 0) + 1
  const band = (counts.drums ?? 0) >= 1 && (counts.bass ?? 0) >= 1 && ((counts.guitar ?? 0) >= 1 || (counts.keys ?? 0) >= 1)
  return { counts, band }
}

export const NEED_TOKENS = ['band', 'guitar2', 'guitar', 'keys', 'vocal', 'bass', 'drums'] as const
export type NeedToken = (typeof NEED_TOKENS)[number]

/**
 * A comma list of needs ("guitar2,keys"). Unknown tokens are ignored; when no
 * known token is left the need is `band` (the default of the index).
 */
export function parseNeed(need: string): NeedToken[] {
  const out: NeedToken[] = []
  for (const raw of (need ?? '').split(/[,，]/)) {
    const token = raw.trim().toLowerCase() as NeedToken
    if ((NEED_TOKENS as readonly string[]).includes(token) && !out.includes(token)) out.push(token)
  }
  // Nothing chosen: every file whose tracks were read (the page leaves filtering to the user).
  return out
}

function matchesTokens(file: Pick<EnsembleFile, 'counts' | 'band'>, tokens: NeedToken[]): boolean {
  const c = file.counts
  return tokens.every((token) => {
    switch (token) {
      case 'band':
        return file.band
      case 'guitar2':
        return (c.guitar ?? 0) >= 2
      case 'guitar':
        return (c.guitar ?? 0) >= 1
      case 'keys':
        return (c.keys ?? 0) >= 1
      case 'vocal':
        return (c.vocal ?? 0) >= 1
      case 'bass':
        return (c.bass ?? 0) >= 1
      case 'drums':
        return (c.drums ?? 0) >= 1
    }
  })
}

/** True when the file has every kind the need asks for (all tokens must hold). */
export function matchesNeed(file: Pick<EnsembleFile, 'counts' | 'band'>, need: string): boolean {
  return matchesTokens(file, parseNeed(need))
}

// ---------------------------------------------------------------------------
// reading a file with alphaTab (Node)
// ---------------------------------------------------------------------------

const garbled = (names: string[]) =>
  names.reduce((n, t) => n + (t.match(/�/g) ?? []).length, 0)

/**
 * Guitar Pro 3–5 files from Chinese writers keep their texts in GBK (or Big5): read as
 * UTF-8 first and, only when the track names come out garbled, try those (as the page does).
 */
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

/** Track list of a Guitar Pro file's bytes, or null when alphaTab cannot read it. */
export function tracksFromBytes(bytes: Uint8Array): EnsembleTrack[] | null {
  try {
    const score = loadReadable(bytes)
    return score.tracks.map((track) => {
      const tuning = track.staves[0]?.tuning ?? []
      const facts: TrackFacts = {
        name: track.name ?? '',
        program: track.playbackInfo.program,
        isPercussion: track.isPercussion,
        stringCount: tuning.length,
        lowestMidi: tuning.length ? Math.min(...tuning) : null,
      }
      return { name: facts.name, kind: classifyTrack(facts) }
    })
  } catch {
    return null
  }
}

const loggedErrors = new Set<string>()
function logOnce(kind: string, detail: string): void {
  if (loggedErrors.has(kind)) return
  loggedErrors.add(kind)
  console.warn(`[ensembles] ${kind}: ${detail} (further errors of this kind are not logged)`)
}

/** Reads one file's tracks; null when the file cannot be read or parsed. */
export async function readEnsembleTracks(abs: string): Promise<EnsembleTrack[] | null> {
  let bytes: Uint8Array
  try {
    bytes = await fs.promises.readFile(abs)
  } catch (e) {
    logOnce('read-failed', (e as NodeJS.ErrnoException).code ?? 'unknown error')
    return null
  }
  const tracks = tracksFromBytes(bytes)
  if (!tracks) logOnce('parse-failed', 'alphaTab could not read a file')
  return tracks
}

// ---------------------------------------------------------------------------
// the index
// ---------------------------------------------------------------------------

export interface EnsembleCacheEntry {
  size: number
  mtimeMs: number
  /** null = the file could not be read (retried when its size or mtime changes). */
  tracks: EnsembleTrack[] | null
}

interface EnsembleCacheFile {
  version: number
  files: Record<string, EnsembleCacheEntry>
}

export interface EnsembleSource {
  /** Path relative to the library root, '/' separated. */
  path: string
  title: string
  artist: string
}

/** A cached file with its title and artist, for seed() (tests) and restore. */
export interface SeedEntry extends EnsembleSource, EnsembleCacheEntry {}

const isEntry = (v: unknown): v is EnsembleCacheEntry => {
  if (!v || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  if (typeof e.size !== 'number' || typeof e.mtimeMs !== 'number') return false
  if (e.tracks === null) return true
  return (
    Array.isArray(e.tracks) &&
    e.tracks.every(
      (t) => t && typeof t === 'object' && typeof (t as EnsembleTrack).name === 'string' && typeof (t as EnsembleTrack).kind === 'string',
    )
  )
}

const collator = new Intl.Collator('zh')

/** Track count of a typical band arrangement (guitars, bass, drums, keys or vocal). */
const TYPICAL_TRACKS = 5

/** Title for sorting: leading brackets, quotes and marks (“(地下城与勇士)…”, “!!!…”) do not count. */
const sortKey = (title: string) => title.replace(/^[\p{P}\p{S}\s]+/u, '') || title

export class EnsembleIndex {
  private readonly root: string
  private readonly cacheFile: string
  /** Current list: relative path → title and artist (GP files only). */
  private meta = new Map<string, { title: string; artist: string }>()
  /** Cached results by relative path. */
  private entries = new Map<string, EnsembleCacheEntry>()
  /** Files of the current pass still to check, in order. */
  private queue: string[] = []
  private total = 0
  private draining = false
  private unsaved = 0
  private loading: Promise<void> | null = null
  private loaded = false

  constructor(root: string, dataDir: string) {
    this.root = root
    this.cacheFile = path.join(dataDir, ENSEMBLE_FILE)
  }

  /**
   * Starts (or restarts after a rescan) the background pass over `files`. Cached
   * results are kept; files no longer listed are dropped. Never throws.
   */
  async start(files: EnsembleSource[]): Promise<void> {
    try {
      await this.ensureLoaded()
    } catch (e) {
      logOnce('cache-load-failed', (e as Error).message)
    }
    const meta = new Map<string, { title: string; artist: string }>()
    for (const f of files) {
      if (ENSEMBLE_EXTENSIONS.has(path.extname(f.path).toLowerCase())) {
        meta.set(f.path, { title: f.title, artist: f.artist })
      }
    }
    this.meta = meta
    let dropped = false
    for (const p of [...this.entries.keys()]) {
      if (!meta.has(p)) {
        this.entries.delete(p)
        dropped = true
      }
    }
    if (dropped) this.unsaved += 1
    this.queue = [...meta.keys()]
    this.total = this.queue.length
    if (!this.draining) void this.drain()
  }

  /** Progress of the background pass for the current list. */
  status(): { indexed: number; toIndex: number; indexing: boolean } {
    return { indexed: this.total - this.queue.length, toIndex: this.queue.length, indexing: this.draining }
  }

  /**
   * Replaces the in-memory index without touching disk: the entries and their
   * titles and artists. Used by tests; start() reads the same shape from disk.
   */
  seed(items: SeedEntry[]): void {
    this.meta = new Map()
    this.entries = new Map()
    for (const it of items) {
      this.meta.set(it.path, { title: it.title, artist: it.artist })
      this.entries.set(it.path, { size: it.size, mtimeMs: it.mtimeMs, tracks: it.tracks })
    }
    this.queue = []
    this.total = items.length
    this.loaded = true
  }

  /** Band-first list of indexed files matching `need`, one page. */
  query(o: {
    paths?: Set<string>
    need: string
    offset: number
    limit: number
    /** Also list files whose title could not be read (otherwise only counted). */
    untitled?: boolean
  }): EnsembleResult {
    const tokens = parseNeed(o.need)
    const matched: EnsembleFile[] = []
    let hiddenUntitled = 0
    for (const [p, entry] of this.entries) {
      if (o.paths && !o.paths.has(p)) continue
      const m = this.meta.get(p)
      if (!m || !entry.tracks) continue
      const { counts, band } = summarize(entry.tracks)
      if (!matchesTokens({ counts, band }, tokens)) continue
      if (!m.title && !o.untitled) {
        hiddenUntitled++
        continue
      }
      matched.push({ path: p, title: m.title, artist: m.artist, tracks: entry.tracks, counts, band })
    }
    matched.sort(
      (a, b) =>
        // Songs with a title first: a file called 1129121537.gp4 says nothing about the song.
        Number(!a.title) - Number(!b.title) ||
        Number(b.band) - Number(a.band) ||
        // A rock band's 4–6 tracks first; huge MIDI-style arrangements (20+ tracks) last.
        Math.abs(a.tracks.length - TYPICAL_TRACKS) - Math.abs(b.tracks.length - TYPICAL_TRACKS) ||
        collator.compare(sortKey(a.title), sortKey(b.title)) ||
        collator.compare(a.path, b.path),
    )
    const limit = Number.isFinite(o.limit) ? Math.min(MAX_LIMIT, Math.max(1, Math.floor(o.limit))) : DEFAULT_LIMIT
    const offset = Number.isFinite(o.offset) ? Math.max(0, Math.floor(o.offset)) : 0
    const st = this.status()
    return {
      items: matched.slice(offset, offset + limit),
      total: matched.length,
      hiddenUntitled,
      indexed: st.indexed,
      toIndex: st.toIndex,
      indexing: st.indexing,
    }
  }

  private async ensureLoaded(): Promise<void> {
    if (this.loaded) return
    if (!this.loading) {
      this.loading = (async () => {
        let parsed: unknown = null
        try {
          parsed = JSON.parse(await fs.promises.readFile(this.cacheFile, 'utf8'))
        } catch {
          parsed = null // no cache yet, or unreadable: start from scratch
        }
        const file = parsed as Partial<EnsembleCacheFile> | null
        if (file && file.version === ENSEMBLE_VERSION && file.files && typeof file.files === 'object') {
          for (const [p, v] of Object.entries(file.files)) {
            if (isEntry(v)) this.entries.set(p, v)
          }
        }
        this.loaded = true
      })()
    }
    await this.loading
  }

  /** One pass at a time: takes the queue (replaced by start) until it is empty. */
  private async drain(): Promise<void> {
    this.draining = true
    try {
      while (this.queue.length) {
        const rel = this.queue.shift()!
        try {
          if (await this.checkOne(rel)) this.unsaved += 1
          if (this.unsaved >= SAVE_EVERY) await this.save()
        } catch (e) {
          logOnce('index-failed', (e as Error).message)
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
      if (this.unsaved > 0) await this.save()
    } catch (e) {
      logOnce('save-failed', (e as Error).message)
    } finally {
      this.draining = false
    }
  }

  /** Re-reads the file when it is new or changed; true when the entry changed. */
  private async checkOne(rel: string): Promise<boolean> {
    const abs = path.join(this.root, rel)
    let st: fs.Stats
    try {
      st = await fs.promises.stat(abs)
    } catch {
      // Vanished (or unreadable right now): forget it.
      return this.entries.delete(rel)
    }
    if (!st.isFile()) return false
    const cached = this.entries.get(rel)
    if (cached && cached.size === st.size && cached.mtimeMs === st.mtimeMs) return false
    const tracks = await readEnsembleTracks(abs)
    if (!this.meta.has(rel)) return false // the list changed while reading
    this.entries.set(rel, { size: st.size, mtimeMs: st.mtimeMs, tracks })
    return true
  }

  private async save(): Promise<void> {
    const files: Record<string, EnsembleCacheEntry> = {}
    for (const [p, e] of this.entries) files[p] = e
    const body: EnsembleCacheFile = { version: ENSEMBLE_VERSION, files }
    await fs.promises.mkdir(path.dirname(this.cacheFile), { recursive: true })
    await writeFileAtomic(this.cacheFile, JSON.stringify(body))
    this.unsaved = 0
  }
}
