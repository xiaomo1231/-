/**
 * 跟唱 (pure): the original singer's pitch line from a vocals stem, split
 * into phrases, and the student's take scored against it.
 *
 * Scoring is note-level (方案-跟唱2.0 §三): the singer's line becomes notes, any octave counts (one shift per phrase),
 * and each sung moment is compared with the reference within ±100 ms so a
 * slightly late or early entry is not marked as wrong pitch. Results are
 * estimates from one take, never a verdict.
 */
import { yin, rms } from '@/audio/pitch/yin'

/** Bump when extraction changes: cached curves are recomputed. */
export const CURVE_VERSION = 1
/** Seconds per frame. */
export const HOP = 0.02
/** Analysis sample rate (vocals need nothing above ~1 kHz fundamentals). */
export const ANALYSIS_RATE = 16000

const WINDOW = 640 // 40 ms at 16 kHz
const GATE = 0.01
const MIN_CLARITY = 0.75

export interface PitchCurve {
  hop: number
  /** Fractional MIDI per frame, NaN = unvoiced. */
  midi: Float32Array
}

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/**
 * YIN over a mono 16 kHz signal, one frame per HOP. Quiet frames are skipped
 * (vocal stems are mostly silence between phrases). Yields to the caller
 * every chunk so the page stays responsive.
 */
export async function extractCurve(samples: Float32Array, onProgress?: (done: number) => void, sampleRate = ANALYSIS_RATE): Promise<PitchCurve> {
  const hopN = Math.round(sampleRate * HOP)
  const frames = Math.max(0, Math.floor((samples.length - WINDOW) / hopN) + 1)
  const midi = new Float32Array(frames).fill(NaN)
  const CHUNK = 400
  for (let f = 0; f < frames; f++) {
    const buf = samples.subarray(f * hopN, f * hopN + WINDOW)
    if (rms(buf) >= GATE) {
      const r = yin(buf, { sampleRate, minFreq: 70, maxFreq: 1100, threshold: 0.15 })
      if (r.freq && r.clarity >= MIN_CLARITY) midi[f] = hzToMidi(r.freq)
    }
    if (f % CHUNK === CHUNK - 1) {
      onProgress?.(f / frames)
      await new Promise((res) => setTimeout(res, 0))
    }
  }
  onProgress?.(1)
  return { hop: HOP, midi: cleanCurve(midi) }
}

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Voiced runs as [start, end) frame indices. */
export function voicedRuns(midi: Float32Array): Array<[number, number]> {
  const runs: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= midi.length; i++) {
    const v = i < midi.length && !Number.isNaN(midi[i]!)
    if (v && start < 0) start = i
    if (!v && start >= 0) {
      runs.push([start, i])
      start = -1
    }
  }
  return runs
}

/**
 * Remove blips shorter than 80 ms, fold octave errors back to the run's
 * median and smooth with a 5-frame median. Pure (returns a new array).
 */
export function cleanCurve(input: Float32Array): Float32Array {
  const midi = Float32Array.from(input)
  for (const [a, b] of voicedRuns(midi)) {
    if (b - a < 4) {
      midi.fill(NaN, a, b)
      continue
    }
    const run = Array.from(midi.subarray(a, b))
    const med = medianOf(run)
    for (let i = a; i < b; i++) {
      const d = midi[i]! - med
      if (Math.abs(d) > 9) midi[i] = midi[i]! - Math.round(d / 12) * 12
    }
    const fixed = Array.from(midi.subarray(a, b))
    for (let i = a; i < b; i++) {
      const lo = Math.max(a, i - 2)
      const hi = Math.min(b, i + 3)
      midi[i] = medianOf(fixed.slice(lo - a, hi - a))
    }
  }
  return midi
}

export interface Phrase {
  index: number
  startMs: number
  endMs: number
  /** Median pitch of the phrase (for the display range). */
  medianMidi: number
  /** The lyric line this phrase was cut from (phrases that follow the lyrics). */
  lyric?: string
}

/** Split where the singer pauses ≥ 300 ms; drop fragments under 0.6 s that cannot be merged. */
export function phrasesOf(curve: PitchCurve, gapMs = 300, minMs = 600): Phrase[] {
  const hopMs = curve.hop * 1000
  const runs = voicedRuns(curve.midi)
  const groups: Array<[number, number]> = []
  for (const [a, b] of runs) {
    const last = groups[groups.length - 1]
    if (last && (a - last[1]) * hopMs < gapMs) last[1] = b
    else groups.push([a, b])
  }
  const kept = groups.filter(([a, b]) => (b - a) * hopMs >= minMs)
  return kept.map(([a, b], index) => {
    const voiced = Array.from(curve.midi.subarray(a, b)).filter((x) => !Number.isNaN(x))
    return { index, startMs: Math.round(a * hopMs), endMs: Math.round(b * hopMs), medianMidi: voiced.length ? medianOf(voiced) : 60 }
  })
}

/** Reference pitch at a time (nearest frame), or NaN. */
export function refAt(curve: PitchCurve, ms: number): number {
  const i = Math.round(ms / (curve.hop * 1000))
  return i >= 0 && i < curve.midi.length ? curve.midi[i]! : NaN
}

export interface SungSample {
  /** Position in the recording, ms. */
  ms: number
  midi: number
}


// ---------------------------------------------------------------------------
// Scoring 2.0: notes, not frames
// ---------------------------------------------------------------------------

/** Bump when scoring changes (saved bests are dropped when they differ). */
export const SCORE_VERSION = 2

/** A stable note of the original singer (vibrato averaged away). */
export interface RefNote {
  startMs: number
  endMs: number
  midi: number
}

/** Median filter over a run of values, window `k` (odd). */
function medianFilter(xs: readonly number[], k: number): number[] {
  const h = k >> 1
  return xs.map((_, i) => medianOf(xs.slice(Math.max(0, i - h), Math.min(xs.length, i + h + 1))))
}

const VIBRATO_WINDOW = 7 // frames ≈ 140 ms
const NOTE_SPREAD = 0.6 // semitones a note may wander
const MIN_NOTE_MS = 120

/**
 * The singer's line as notes: each voiced run is median-filtered over ~140 ms
 * (vibrato and small wobble vanish), then cut where the pitch moves more than
 * 60 cents from the current note. Pieces under 120 ms are glides, turns or
 * ornaments and are not scored. Pure.
 */
export function notesOf(curve: PitchCurve): RefNote[] {
  const hopMs = curve.hop * 1000
  const notes: RefNote[] = []
  for (const [a, b] of voicedRuns(curve.midi)) {
    const smooth = medianFilter(Array.from(curve.midi.subarray(a, b)), VIBRATO_WINDOW)
    let start = 0
    let seg: number[] = []
    const flush = (end: number) => {
      if ((end - start) * hopMs >= MIN_NOTE_MS && seg.length) notes.push({ startMs: Math.round((a + start) * hopMs), endMs: Math.round((a + end) * hopMs), midi: medianOf(seg) })
    }
    for (let i = 0; i < smooth.length; i++) {
      const m = smooth[i]!
      if (seg.length && Math.abs(m - medianOf(seg)) > NOTE_SPREAD) {
        flush(i)
        start = i
        seg = []
      }
      seg.push(m)
    }
    flush(smooth.length)
  }
  return notes
}

/** A phrase is scored when it has two notes or more, or one sustained note (≥ 0.6 s). */
export function isScorable(notes: readonly RefNote[]): boolean {
  return notes.length >= 2 || (notes.length === 1 && notes[0]!.endMs - notes[0]!.startMs >= 600)
}

export function notesIn(notes: readonly RefNote[], phrase: Pick<Phrase, 'startMs' | 'endMs'>): RefNote[] {
  return notes.filter((n) => n.startMs >= phrase.startMs - 50 && n.endMs <= phrase.endMs + 50)
}

/** Student samples smoothed like the reference (their vibrato does not count either). */
export function smoothSung(sung: readonly SungSample[]): SungSample[] {
  const s = [...sung].filter((x) => Number.isFinite(x.midi)).sort((a, b) => a.ms - b.ms)
  const out: SungSample[] = []
  for (let i = 0; i < s.length; i++) {
    const win: number[] = []
    for (let j = i; j >= 0 && s[i]!.ms - s[j]!.ms <= 70; j--) win.push(s[j]!.midi)
    for (let j = i + 1; j < s.length && s[j]!.ms - s[i]!.ms <= 70; j++) win.push(s[j]!.midi)
    out.push({ ms: s[i]!.ms, midi: medianOf(win) })
  }
  return out
}

/** Fold a semitone difference into −6…+6 (octave-free). */
const fold = (d: number) => d - Math.round(d / 12) * 12

function samplesIn(sung: readonly SungSample[], from: number, to: number): SungSample[] {
  return sung.filter((s) => s.ms >= from && s.ms < to)
}

/** Fraction of a window's 20 ms bins that have at least one sample. */
function voicedShare(sung: readonly SungSample[], from: number, to: number): number {
  const bins = Math.max(1, Math.round((to - from) / 20))
  const hit = new Set<number>()
  for (const s of sung) if (s.ms >= from && s.ms < to) hit.add(Math.floor((s.ms - from) / 20))
  return Math.min(1, hit.size / bins)
}

export const MAX_LAG_MS = 300

/**
 * The student's overall timing offset for a phrase: the lag (−300…+300 ms,
 * 20 ms steps) at which the most sung moments land within a semitone of the
 * note they overlap (any octave). Ties go to the smaller lag.
 */
export function findLag(notes: readonly RefNote[], sung: readonly SungSample[]): number {
  let best = 0
  let bestHits = -1
  for (let lag = -MAX_LAG_MS; lag <= MAX_LAG_MS; lag += 20) {
    let hits = 0
    for (const n of notes) for (const s of samplesIn(sung, n.startMs + lag, n.endMs + lag)) if (Math.abs(fold(s.midi - n.midi)) <= 1) hits++
    if (hits > bestHits || (hits === bestHits && Math.abs(lag) < Math.abs(best))) {
      best = lag
      bestHits = hits
    }
  }
  return best
}

/** Points for one note from its deviation: full within 25 cents, nothing from 100 cents. */
export function notePoints(cents: number): number {
  const c = Math.abs(cents)
  if (c <= 25) return 1
  if (c >= 100) return 0
  return 1 - (c - 25) / 75
}

export interface NoteResult {
  note: RefNote
  /** Signed deviation in cents after the octave shift, null = not sung. */
  cents: number | null
  points: number
}

export interface NoteScore {
  /** Duration-weighted mean of note points (unsung notes count 0), 0–1. */
  score: number
  notes: NoteResult[]
  notesSung: number
  meanAbsCents: number
  biasCents: number
  lagMs: number
  octaveShift: number
}

/** Share of a note's length the student must sing for it to count as sung. */
const SUNG_SHARE = 0.4

/**
 * Score a phrase note by note (see module doc and 方案-跟唱2.0 §三). Null when
 * the phrase is not scorable (see isScorable) or nothing was sung.
 */
export function scoreNotes(allNotes: readonly RefNote[], phrase: Pick<Phrase, 'startMs' | 'endMs'>, rawSung: readonly SungSample[]): NoteScore | null {
  const notes = notesIn(allNotes, phrase)
  if (!isScorable(notes)) return null
  const sung = smoothSung(samplesIn(rawSung, phrase.startMs - MAX_LAG_MS - 150, phrase.endMs + MAX_LAG_MS + 150))
  if (!sung.length) return null
  const lagMs = findLag(notes, sung)
  const medians = notes.map((n) => {
    const win = samplesIn(sung, n.startMs + lagMs, n.endMs + lagMs)
    return win.length && voicedShare(sung, n.startMs + lagMs, n.endMs + lagMs) >= SUNG_SHARE ? medianOf(win.map((s) => s.midi)) : null
  })
  // One octave shift for the phrase, by vote of the sung notes.
  const votes = new Map<number, number>()
  notes.forEach((n, i) => {
    const m = medians[i]
    if (m === null || m === undefined) return
    const k = Math.round((m - n.midi) / 12) * 12
    votes.set(k, (votes.get(k) ?? 0) + (n.endMs - n.startMs))
  })
  if (!votes.size) return null
  const octaveShift = [...votes].sort((x, y) => y[1] - x[1])[0]![0]
  const results: NoteResult[] = notes.map((n, i) => {
    const m = medians[i]
    if (m === null || m === undefined) return { note: n, cents: null, points: 0 }
    const cents = Math.round((m - octaveShift - n.midi) * 100)
    return { note: n, cents, points: notePoints(cents) }
  })
  const dur = (n: RefNote) => n.endMs - n.startMs
  const total = notes.reduce((s, n) => s + dur(n), 0)
  const sungR = results.filter((r) => r.cents !== null)
  const cents = sungR.map((r) => r.cents!)
  return {
    score: results.reduce((s, r) => s + r.points * dur(r.note), 0) / total,
    notes: results,
    notesSung: sungR.length,
    meanAbsCents: cents.length ? Math.round(cents.reduce((s, c) => s + Math.abs(c), 0) / cents.length) : 0,
    biasCents: cents.length ? Math.round(cents.reduce((s, c) => s + c, 0) / cents.length) : 0,
    lagMs,
    octaveShift,
  }
}

/** One-line feedback naming the notes to look at (an estimate from this take). */
export function noteFeedback(s: Pick<NoteScore, 'notesSung' | 'lagMs'> & { notes: ReadonlyArray<{ cents: number | null }> }): string {
  return feedbackFrom(s.notes.map((r) => r.cents), s.notesSung, s.lagMs)
}

/** The same feedback from a stored take (per-note cents, null = not sung). */
export function feedbackFrom(noteCents: ReadonlyArray<number | null>, notesSung: number, lagMs: number): string {
  const total = noteCents.length
  if (notesSung < total * 0.5) return `这一句唱到了 ${notesSung} / ${total} 个音，可以先跟着原唱多听几遍，或者把原唱调大一点跟着唱。`
  const off = noteCents.map((c, i) => ({ i: i + 1, c })).filter((x): x is { i: number; c: number } => x.c !== null && Math.abs(x.c) > 40)
  const lag = Math.abs(lagMs) >= 120 ? `整体可能比原唱${lagMs > 0 ? '晚' : '早'}约 ${Math.abs(lagMs)} 毫秒（已经按这个差来比较音高）。` : ''
  if (!off.length) return `${lag}每个音都在线，这一句的音准估计很不错。`
  const list = (xs: typeof off) => xs.slice(0, 4).map((x) => x.i).join('、')
  const low = off.filter((x) => x.c < 0)
  const high = off.filter((x) => x.c > 0)
  const parts: string[] = []
  if (low.length) parts.push(`第 ${list(low)} 个音可能偏低`)
  if (high.length) parts.push(`第 ${list(high)} 个音可能偏高`)
  return `${lag}${parts.join('，')}，其它的音都在线。可以循环这一句，留意这几个音。`
}

/** NoteScore → the stored TakeScore. */
export function toTakeScore(s: NoteScore): { score: number; notesSung: number; notesTotal: number; meanAbsCents: number; biasCents: number; lagMs: number; octaveShift: number; noteCents: Array<number | null> } {
  return { score: s.score, notesSung: s.notesSung, notesTotal: s.notes.length, meanAbsCents: s.meanAbsCents, biasCents: s.biasCents, lagMs: s.lagMs, octaveShift: s.octaveShift, noteCents: s.notes.map((r) => r.cents) }
}

/**
 * Steady timing habit: the last three scored phrases all late (or early) by a
 * similar amount ≥ 120 ms. Returns that amount, else null.
 */
export function steadyLag(lags: readonly number[]): number | null {
  const last = lags.slice(-3)
  if (last.length < 3) return null
  const same = last.every((l) => Math.sign(l) === Math.sign(last[0]!) && Math.abs(l) >= 120)
  if (!same) return null
  const spread = Math.max(...last) - Math.min(...last)
  return spread <= 100 ? Math.round(last.reduce((a, b) => a + b, 0) / 3) : null
}
