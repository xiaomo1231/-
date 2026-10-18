/**
 * Drumify: AI drum generation with Magenta's tap2drum MusicVAE checkpoint
 * (Apache-2.0, bundled in drumify/ or server-assets/drumify/). The guide
 * rhythm of each 4/4 bar is "tapped" into a 2-bar sequence, the model writes a
 * drum part for it, and the result is converted back to the drum grid. Other
 * bars, fills and section crashes come from the template engine / rules here.
 * Everything runs locally: the checkpoint is read from disk, nothing is fetched.
 */
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { DRUM_PIECES } from '../src/songs/drumTypes'
import type { DrumBar, DrumHit, DrumPiece, DrumTemplateLibrary, DrumVelocity, SongBarInfo } from '../src/songs/drumTypes'
import { generateFromTemplates } from '../src/songs/drumGenerate'

const MODEL = 'tap2drum_2bar'
/** The model takes 2 bars of sixteenths (32 steps); a guide window is 1–2 bars. */
const WINDOW_BARS = 2
const STEPS_PER_BAR = 16
const STEPS_PER_QUARTER = 4
/** Section starts when the song has no `section` markers. */
const PHRASE_BARS = 8
const MIN_TEMPERATURE = 0.1
const MAX_TEMPERATURE = 1.5

export interface SequenceNote {
  pitch: number
  startTime: number
  endTime: number
  velocity: number
}

export interface NoteSequenceLike {
  notes: SequenceNote[]
  tempos: Array<{ time: number; qpm: number }>
  totalTime: number
  timeSignatures: Array<{ time: number; numerator: number; denominator: number }>
}

export interface DrumifyOptions {
  temperature: number
  /** Only these bars (0-based, inclusive) are generated; null = whole song. */
  range: [number, number] | null
  lib: DrumTemplateLibrary
  style: string | null
  seed: number
}

export interface DrumifyResult {
  bars: DrumBar[]
  /** Index of the first returned bar in the song. */
  first: number
  style: string | null
}

// ---------------------------------------------------------------------------
// checkpoints
// ---------------------------------------------------------------------------

const here = path.dirname(fileURLToPath(import.meta.url))

/** Production: <dir of server.mjs>/drumify/<model>. Development: <repo>/server-assets/drumify/<model>. */
function checkpointDir(model: string): string | null {
  const candidates = [path.join(here, 'drumify', model), path.join(here, '..', 'server-assets', 'drumify', model)]
  for (const dir of candidates) {
    if (['config.json', 'weights_manifest.json', 'group1-shard1of1'].every((f) => fs.existsSync(path.join(dir, f)))) {
      return dir
    }
  }
  return null
}

/** True when the Drumify checkpoint files exist (the API hides the AI option otherwise). */
export function drumifyAvailable(): boolean {
  return checkpointDir(MODEL) !== null
}

// ---------------------------------------------------------------------------
// reading the checkpoint from disk
// ---------------------------------------------------------------------------

interface LocalResponse {
  ok: boolean
  status: number
  statusText: string
  json(): Promise<unknown>
  text(): Promise<string>
  arrayBuffer(): Promise<ArrayBuffer>
}

/**
 * MusicVAE reads config.json / weights_manifest.json with node-fetch and the
 * weights with tfjs (global fetch). Both are answered here from local files;
 * any http(s) request is refused, so the model never reaches the network.
 */
async function localFetch(url: string): Promise<LocalResponse> {
  if (/^https?:/i.test(url)) throw new Error('Drumify 不访问网络')
  const file = url.startsWith('file:') ? fileURLToPath(url) : url
  const buf = await fs.promises.readFile(file)
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    json: async () => JSON.parse(buf.toString('utf8')) as unknown,
    text: async () => buf.toString('utf8'),
    arrayBuffer: async () => bytes,
  }
}

/** Registers the local reader as node-fetch for this process (dev / tests). In the bundle, build-server.mjs does the same. */
function installNodeFetchShim(): void {
  const req = createRequire(import.meta.url)
  let file: string
  try {
    file = req.resolve('node-fetch')
  } catch {
    return // bundled: node-fetch is already replaced at build time
  }
  req.cache[file] = { id: file, filename: file, loaded: true, exports: localFetch } as unknown as NodeModule
}

interface Note {
  pitch: number
  startTime: number
  velocity: number
}

interface TapModel {
  initialize(): Promise<void>
  encode(sequences: NoteSequenceLike[]): Promise<{ dispose(): void }>
  decode(
    z: { dispose(): void },
    temperature: number,
    controls: undefined,
    stepsPerQuarter: number,
    qpm: number,
  ): Promise<Array<{ notes: Note[] }>>
}

type MusicVaeCtor = new (checkpointURL: string) => TapModel

async function importMusicVae(): Promise<MusicVaeCtor> {
  const mod = (await import('@magenta/music/node/music_vae')) as unknown as {
    MusicVAE?: MusicVaeCtor
    default?: { MusicVAE?: MusicVaeCtor }
  }
  const ctor = mod.MusicVAE ?? mod.default?.MusicVAE
  if (!ctor) throw new Error('@magenta/music 中找不到 MusicVAE')
  return ctor
}

let modelPromise: Promise<TapModel> | null = null

/** Loads the checkpoint once; a failed load is retried on the next request. */
function getModel(): Promise<TapModel> {
  modelPromise ??= (async () => {
    const dir = checkpointDir(MODEL)
    if (!dir) throw new Error(`找不到 Drumify 模型文件（${MODEL}），「自动生成鼓（AI）」不可用`)
    installNodeFetchShim()
    const Ctor = await importMusicVae()
    const model = new Ctor(dir)
    // tfjs loads the weight shard through the global fetch; route it to disk while initialize() runs.
    const original = globalThis.fetch
    globalThis.fetch = ((input: string | URL | Request) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      return localFetch(url)
    }) as typeof fetch
    try {
      await model.initialize()
    } finally {
      globalThis.fetch = original
    }
    return model
  })()
  modelPromise.catch(() => {
    modelPromise = null
  })
  return modelPromise
}

/** One generation at a time: the model and its tensors are shared. */
let chain: Promise<unknown> = Promise.resolve()
function serialize<T>(task: () => Promise<T>): Promise<T> {
  const run = chain.then(task)
  chain = run.catch(() => undefined)
  return run
}

// ---------------------------------------------------------------------------
// pure helpers (exported for tests)
// ---------------------------------------------------------------------------

export function isModelBar(bar: SongBarInfo): boolean {
  return bar.num === 4 && bar.den === 4 && !bar.triplet
}

/** Bars where a section starts: bar 0, every `section` marker, or every 8 bars when the song has no markers. */
export function sectionStarts(song: SongBarInfo[]): Set<number> {
  const marked: number[] = []
  song.forEach((bar, i) => {
    if (bar.section) marked.push(i)
  })
  const list =
    marked.length > 0
      ? marked
      : Array.from({ length: Math.ceil(song.length / PHRASE_BARS) }, (_, k) => k * PHRASE_BARS)
  return new Set([0, ...list].filter((i) => i < song.length))
}

/** The last bar of every section: the fill bar. */
export function fillBarIndices(song: SongBarInfo[], starts: Set<number>): Set<number> {
  const sorted = [...starts].sort((a, b) => a - b)
  const fills = new Set<number>()
  sorted.forEach((start, k) => {
    const next = sorted[k + 1] ?? song.length
    if (next - 1 >= start) fills.add(next - 1)
  })
  return fills
}

/**
 * Splits bars [from, to] into model windows of 1–2 bars. Runs of model-eligible
 * bars are cut at section starts (so windows line up with sections) and at
 * bars that are skipped (fills, non-4/4, triplets).
 */
export function planWindows(
  song: SongBarInfo[],
  from: number,
  to: number,
  starts: Set<number>,
  skip: (index: number) => boolean,
): number[][] {
  const windows: number[][] = []
  let run: number[] = []
  const flush = () => {
    for (let k = 0; k < run.length; k += WINDOW_BARS) windows.push(run.slice(k, k + WINDOW_BARS))
    run = []
  }
  for (let i = Math.max(0, from); i <= Math.min(to, song.length - 1); i++) {
    if (!isModelBar(song[i]) || skip(i)) {
      flush()
      continue
    }
    if (starts.has(i)) flush()
    run.push(i)
  }
  flush()
  return windows
}

/** Onsets quantized to sixteenths inside one 4/4 bar, one entry per step (loudest velocity wins). */
export function quantizeOnsets(bar: SongBarInfo): Array<{ step: number; vel: number }> {
  const byStep = new Map<number, number>()
  for (const onset of bar.onsets) {
    const step = Math.round(onset.at * STEPS_PER_QUARTER)
    if (step < 0 || step >= STEPS_PER_BAR) continue
    byStep.set(step, Math.max(byStep.get(step) ?? 0, onset.vel))
  }
  return [...byStep.entries()].sort((a, b) => a[0] - b[0]).map(([step, vel]) => ({ step, vel }))
}

/** Cache key for the latent: identical guide rhythms at the same tempo share one encoding. */
export function windowSignature(bars: SongBarInfo[], qpm: number): string {
  return `${qpm}|` + bars.map((b) => quantizeOnsets(b).map((o) => `${o.step}:${o.vel}`).join(',')).join('/')
}

/** Guide onsets of a window as a NoteSequence, always WINDOW_BARS long (the model expects 2 bars). */
export function windowToNoteSequence(bars: SongBarInfo[], qpm: number): NoteSequenceLike {
  const sixteenth = 60 / qpm / STEPS_PER_QUARTER
  const notes: SequenceNote[] = []
  bars.forEach((bar, k) => {
    for (const { step, vel } of quantizeOnsets(bar)) {
      const start = (k * STEPS_PER_BAR + step) * sixteenth
      notes.push({ pitch: 42, startTime: start, endTime: start + sixteenth * 0.5, velocity: Math.max(1, Math.min(127, vel)) })
    }
  })
  return {
    notes,
    tempos: [{ time: 0, qpm }],
    totalTime: WINDOW_BARS * STEPS_PER_BAR * sixteenth,
    timeSignatures: [{ time: 0, numerator: 4, denominator: 4 }],
  }
}

export function pieceForPitch(pitch: number): DrumPiece | null {
  return DRUM_PIECES.find((p) => p.midi === pitch || p.alsoMidi.includes(pitch))?.id ?? null
}

export function velocityLevel(velocity: number): DrumVelocity {
  if (velocity < 50) return 1
  if (velocity > 105) return 3
  return 2
}

export function sortHits(hits: DrumHit[]): DrumHit[] {
  const order = (piece: DrumPiece) => DRUM_PIECES.findIndex((p) => p.id === piece)
  return [...hits].sort((a, b) => a.step - b.step || order(a.piece) - order(b.piece))
}

export function emptyBar(num = 4, den = 4): DrumBar {
  return { num, den, stepsPerQuarter: STEPS_PER_QUARTER, hits: [] }
}

/**
 * Model output → one DrumBar per window bar. `hasOnset[k]` says whether the
 * guide had onsets in bar k; bars without guide onsets stay empty (a guide rest
 * is a drum rest). Notes are placed on the sixteenth grid of `qpm`.
 */
export function notesToBars(notes: Note[], qpm: number, hasOnset: boolean[]): DrumBar[] {
  const bars = hasOnset.map(() => emptyBar())
  const sixteenth = 60 / qpm / STEPS_PER_QUARTER
  for (const note of notes) {
    const piece = pieceForPitch(note.pitch)
    if (!piece) continue
    const step = Math.round(note.startTime / sixteenth)
    const barIndex = Math.floor(step / STEPS_PER_BAR)
    if (barIndex < 0 || barIndex >= bars.length || !hasOnset[barIndex]) continue
    const within = step - barIndex * STEPS_PER_BAR
    const vel = velocityLevel(note.velocity)
    const hits = bars[barIndex].hits
    const existing = hits.find((h) => h.step === within && h.piece === piece)
    if (existing) {
      if (vel > existing.vel) existing.vel = vel
    } else {
      hits.push({ step: within, piece, vel })
    }
  }
  return bars.map((bar) => ({ ...bar, hits: sortHits(bar.hits) }))
}

/** Accent crash on step 0 at a section start. */
export function withCrash(bar: DrumBar): DrumBar {
  const hits = bar.hits.filter((h) => !(h.step === 0 && h.piece === 'crash'))
  hits.push({ step: 0, piece: 'crash', vel: 3 })
  return { ...bar, hits: sortHits(hits) }
}

// ---------------------------------------------------------------------------
// generation
// ---------------------------------------------------------------------------

async function runDrumify(song: SongBarInfo[], opts: DrumifyOptions): Promise<DrumifyResult> {
  const n = song.length
  if (n === 0) return { bars: [], first: 0, style: opts.style }
  const from = opts.range ? Math.max(0, Math.min(n - 1, opts.range[0])) : 0
  const to = opts.range ? Math.max(0, Math.min(n - 1, opts.range[1])) : n - 1
  if (to < from) return { bars: [], first: from, style: opts.style }
  const temperature = Math.min(MAX_TEMPERATURE, Math.max(MIN_TEMPERATURE, opts.temperature))

  const starts = sectionStarts(song)
  const fills = fillBarIndices(song, starts)
  // The whole song is generated once so the fill bars and the style come from one consistent pass.
  const whole = generateFromTemplates(song, opts.lib, { style: opts.style, seed: opts.seed })
  const style = whole.style
  const out = new Map<number, DrumBar>()

  for (const i of fills) {
    if (i >= from && i <= to) out.set(i, whole.bars[i - whole.first] ?? emptyBar(song[i].num, song[i].den))
  }

  // Non-4/4 and triplet bars: template engine, one call per contiguous run.
  const runs: Array<[number, number]> = []
  for (let i = from; i <= to; i++) {
    if (isModelBar(song[i]) || fills.has(i)) continue
    const last = runs[runs.length - 1]
    if (last && last[1] === i - 1) last[1] = i
    else runs.push([i, i])
  }
  for (const [a, b] of runs) {
    const part = generateFromTemplates(song, opts.lib, { style, seed: opts.seed, range: [a, b] })
    for (let i = a; i <= b; i++) {
      out.set(i, part.bars[i - part.first] ?? whole.bars[i - whole.first] ?? emptyBar(song[i].num, song[i].den))
    }
  }

  // Model windows.
  const windows = planWindows(song, from, to, starts, (i) => fills.has(i))
  if (windows.length > 0) {
    const model = await getModel()
    const latents = new Map<string, { dispose(): void }>()
    try {
      for (const window of windows) {
        const bars = window.map((i) => song[i])
        if (bars.every((b) => b.onsets.length === 0)) {
          window.forEach((i) => out.set(i, emptyBar()))
          continue
        }
        const qpm = bars[0].bpm
        const key = windowSignature(bars, qpm)
        let z = latents.get(key)
        if (!z) {
          z = await model.encode([windowToNoteSequence(bars, qpm)])
          latents.set(key, z)
        }
        const decoded = await model.decode(z, temperature, undefined, STEPS_PER_QUARTER, qpm)
        const built = notesToBars(decoded[0]?.notes ?? [], qpm, bars.map((b) => b.onsets.length > 0))
        window.forEach((i, k) => out.set(i, built[k]))
      }
    } finally {
      for (const z of latents.values()) z.dispose()
    }
  }

  const bars: DrumBar[] = []
  for (let i = from; i <= to; i++) {
    const bar = out.get(i) ?? emptyBar(song[i].num, song[i].den)
    bars.push(starts.has(i) ? withCrash(bar) : bar)
  }
  return { bars, first: from, style }
}

/**
 * Generates a drum part for the song with Drumify (see the module comment).
 * Calls are queued: the model runs one generation at a time.
 */
export function drumify(song: SongBarInfo[], opts: DrumifyOptions): Promise<DrumifyResult> {
  return serialize(() => runDrumify(song, opts))
}
