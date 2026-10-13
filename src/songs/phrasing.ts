/**
 * 分句 (pure): how the song is cut into phrases for 跟唱.
 *
 *  1. The student's own phrase cuts (merged / split by hand) win.
 *  2. Else, lyrics whose timing is trusted (LRC, a confirmed alignment, tapping):
 *     one phrase per lyric line, snapped to where the singer actually sings.
 *  3. Else, the singer's pauses — a short breath inside a line no longer
 *     splits it.
 *
 * Also: lining up pasted plain lyrics with the singer (alignLyrics) and
 * finding which phrase a take belongs to by time, so takes survive a change of
 * cuts. All times are ms in the recording.
 */
import { notesOf, voicedRuns, type Phrase, type PitchCurve, type RefNote } from './singAlong'
import type { LyricLine } from './singTypes'

export interface PhraseRange {
  startMs: number
  endMs: number
}

export type PhraseSource = 'manual' | 'lyrics' | 'auto'

/** Breaths shorter than this inside a run of singing never end a phrase. */
const BREATH_MS = 300
/** Pieces split by a pause shorter than this are joined while the phrase stays ≤ PHRASE_MAX_MS. */
const JOIN_GAP_MS = 550
const PHRASE_MAX_MS = 8000
/** A piece shorter than this is joined to its closer neighbour (pause ≤ SHORT_JOIN_GAP_MS). */
const SHORT_PIECE_MS = 1500
const SHORT_JOIN_GAP_MS = 1200
const SHORT_JOIN_MAX_MS = 10000
const MIN_PHRASE_MS = 600
/** A lyric phrase may start this much before its line (the singer comes in early). */
const LYRIC_LEAD_MS = 300

function medianOf(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function median(curve: PitchCurve, startMs: number, endMs: number): number {
  const hopMs = curve.hop * 1000
  const a = Math.max(0, Math.floor(startMs / hopMs))
  const b = Math.min(curve.midi.length, Math.ceil(endMs / hopMs))
  const v: number[] = []
  for (let i = a; i < b; i++) if (!Number.isNaN(curve.midi[i]!)) v.push(curve.midi[i]!)
  return v.length ? medianOf(v) : 60
}

function toPhrases(curve: PitchCurve, ranges: PhraseRange[], lyrics?: string[]): Phrase[] {
  return ranges.map((r, index) => {
    const p: Phrase = { index, startMs: Math.round(r.startMs), endMs: Math.round(r.endMs), medianMidi: median(curve, r.startMs, r.endMs) }
    const text = lyrics?.[index]
    if (text) p.lyric = text
    return p
  })
}

/** Phrases from explicit ranges (sorted, overlaps trimmed, empty ones dropped). */
export function phrasesFromRanges(curve: PitchCurve, ranges: readonly PhraseRange[]): Phrase[] {
  const sorted = [...ranges].sort((a, b) => a.startMs - b.startMs)
  const out: PhraseRange[] = []
  for (const r of sorted) {
    const start = Math.max(r.startMs, out[out.length - 1]?.endMs ?? 0)
    if (r.endMs - start >= 100) out.push({ startMs: start, endMs: r.endMs })
  }
  return toPhrases(curve, out)
}

/** Singing runs (frames → ms) joined across breaths shorter than `gapMs`. */
function pieces(curve: PitchCurve, gapMs: number): PhraseRange[] {
  const hopMs = curve.hop * 1000
  const out: PhraseRange[] = []
  for (const [a, b] of voicedRuns(curve.midi)) {
    const last = out[out.length - 1]
    if (last && a * hopMs - last.endMs < gapMs) last.endMs = b * hopMs
    else out.push({ startMs: a * hopMs, endMs: b * hopMs })
  }
  return out
}

/**
 * Phrases from the singer's pauses alone. Short breaths stay inside a phrase,
 * pieces split by a short pause are joined (up to ~8 s), and a short piece is
 * joined to its closer neighbour.
 */
export function autoPhraseRanges(curve: PitchCurve): PhraseRange[] {
  let ps = pieces(curve, BREATH_MS)
  const join = (xs: PhraseRange[], ok: (a: PhraseRange, b: PhraseRange) => boolean) => {
    const out: PhraseRange[] = []
    for (const p of xs) {
      const last = out[out.length - 1]
      if (last && ok(last, p)) last.endMs = p.endMs
      else out.push({ ...p })
    }
    return out
  }
  ps = join(ps, (a, b) => b.startMs - a.endMs < JOIN_GAP_MS && b.endMs - a.startMs <= PHRASE_MAX_MS)
  // Short pieces: join to the closer neighbour when the pause is not long.
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i]!
      if (p.endMs - p.startMs >= SHORT_PIECE_MS) continue
      const prev = ps[i - 1]
      const next = ps[i + 1]
      const gp = prev ? p.startMs - prev.endMs : Infinity
      const gn = next ? next.startMs - p.endMs : Infinity
      const toPrev = prev && gp <= gn && gp <= SHORT_JOIN_GAP_MS && p.endMs - prev.startMs <= SHORT_JOIN_MAX_MS
      const toNext = !toPrev && next && gn <= SHORT_JOIN_GAP_MS && next.endMs - p.startMs <= SHORT_JOIN_MAX_MS
      if (toPrev) {
        prev.endMs = p.endMs
        ps.splice(i, 1)
        changed = true
        break
      }
      if (toNext) {
        next.startMs = p.startMs
        ps.splice(i, 1)
        changed = true
        break
      }
    }
  }
  return ps.filter((p) => p.endMs - p.startMs >= MIN_PHRASE_MS).map((p) => ({ startMs: Math.round(p.startMs), endMs: Math.round(p.endMs) }))
}

export function autoPhrases(curve: PitchCurve): Phrase[] {
  return toPhrases(curve, autoPhraseRanges(curve))
}

/**
 * One phrase per lyric line: from the line's start to the next line's start
 * (or its own end), tightened to where the singer actually sings in there.
 * A line with no singing keeps its own times (it simply has nothing to score).
 */
export function phrasesFromLyrics(curve: PitchCurve, lines: readonly LyricLine[], songMs?: number): Phrase[] {
  const hopMs = curve.hop * 1000
  const sorted = [...lines].filter((l) => l.text.trim()).sort((a, b) => a.startMs - b.startMs)
  const curveEnd = songMs ?? curve.midi.length * hopMs
  const ranges: PhraseRange[] = []
  const texts: string[] = []
  sorted.forEach((line, i) => {
    const nextStart = sorted[i + 1]?.startMs ?? curveEnd
    const hardEnd = Math.min(nextStart, line.endMs !== undefined && line.endMs > line.startMs ? line.endMs + 400 : nextStart, line.startMs + 15000)
    const from = Math.max(ranges[ranges.length - 1]?.endMs ?? 0, line.startMs - LYRIC_LEAD_MS)
    let first = -1
    let last = -1
    const a = Math.max(0, Math.floor(from / hopMs))
    const b = Math.min(curve.midi.length, Math.ceil(hardEnd / hopMs))
    for (let f = a; f < b; f++) {
      if (Number.isNaN(curve.midi[f]!)) continue
      if (first < 0) first = f
      last = f + 1
    }
    const range = first >= 0 ? { startMs: first * hopMs, endMs: last * hopMs } : { startMs: Math.max(from, line.startMs), endMs: Math.min(hardEnd, line.startMs + 4000) }
    if (range.endMs - range.startMs < 100) return
    ranges.push(range)
    texts.push(line.text)
  })
  return toPhrases(curve, ranges, texts)
}

/** Every lyric line that starts inside the phrase (a little early counts), joined. */
export function lyricsInPhrase(lines: readonly LyricLine[], phrase: Pick<Phrase, 'startMs' | 'endMs' | 'lyric'>): string {
  if (phrase.lyric) return phrase.lyric
  return [...lines]
    .sort((a, b) => a.startMs - b.startMs)
    .filter((l) => l.startMs >= phrase.startMs - 500 && l.startMs < phrase.endMs - 200)
    .map((l) => l.text)
    .join(' ')
}

// ---------------------------------------------------------------------------
// Cutting by hand
// ---------------------------------------------------------------------------

export function rangesOf(phrases: readonly Phrase[]): PhraseRange[] {
  return phrases.map((p) => ({ startMs: p.startMs, endMs: p.endMs }))
}

/** Phrase i joined with the one before it. */
export function mergeWithPrevious(phrases: readonly Phrase[], i: number): PhraseRange[] {
  const r = rangesOf(phrases)
  if (i <= 0 || i >= r.length) return r
  r[i - 1] = { startMs: r[i - 1]!.startMs, endMs: r[i]!.endMs }
  r.splice(i, 1)
  return r
}

/**
 * Where phrase i would best be cut in two: the longest pause inside it that
 * leaves at least 0.6 s of singing on both sides (null when there is none).
 */
export function splitPoint(curve: PitchCurve, phrase: PhraseRange): number | null {
  const hopMs = curve.hop * 1000
  const a = Math.max(0, Math.ceil(phrase.startMs / hopMs))
  const b = Math.min(curve.midi.length, Math.floor(phrase.endMs / hopMs))
  let lastVoiced = -1
  let best: { at: number; gap: number } | null = null
  for (let f = a; f < b; f++) {
    if (Number.isNaN(curve.midi[f]!)) continue
    if (lastVoiced >= 0 && f - lastVoiced > 1) {
      const gapStart = (lastVoiced + 1) * hopMs
      const gapEnd = f * hopMs
      const gap = gapEnd - gapStart
      if (gap >= 80 && gapStart - phrase.startMs >= MIN_PHRASE_MS && phrase.endMs - gapEnd >= MIN_PHRASE_MS && (!best || gap > best.gap)) best = { at: Math.round((gapStart + gapEnd) / 2), gap }
    }
    lastVoiced = f
  }
  return best ? best.at : null
}

export function splitAt(phrases: readonly Phrase[], i: number, atMs: number): PhraseRange[] {
  const r = rangesOf(phrases)
  const p = r[i]
  if (!p || atMs <= p.startMs || atMs >= p.endMs) return r
  r.splice(i, 1, { startMs: p.startMs, endMs: atMs }, { startMs: atMs, endMs: p.endMs })
  return r
}

// ---------------------------------------------------------------------------
// Lining up pasted lyrics with the singer
// ---------------------------------------------------------------------------

const SYLLABLE_CHAR = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\d]/gu
const LATIN_WORD = /[A-Za-zÀ-ɏ']+/g

/** Sung syllables of a lyric line: one per Chinese / Japanese / Korean character, vowel groups for Latin words. */
export function syllableCount(text: string): number {
  let n = (text.match(SYLLABLE_CHAR) ?? []).length
  for (const w of text.match(LATIN_WORD) ?? []) {
    const groups = w.toLowerCase().replace(/e$/, '').match(/[aeiouyà-ÿ]+/g)
    n += Math.max(1, groups?.length ?? 0)
  }
  return n
}

/** A stretch of continuous singing (split at even short gaps) and how many sung units it holds. */
interface Segment {
  startMs: number
  endMs: number
  units: number
}

/** Gaps this short are consonants inside a word, not places to end a line. */
const CONSONANT_GAP_MS = 120

function segmentsOf(curve: PitchCurve, notes: readonly RefNote[]): Segment[] {
  const segs = pieces(curve, CONSONANT_GAP_MS).filter((p) => p.endMs - p.startMs >= 60)
  const hopMs = curve.hop * 1000
  const runs = voicedRuns(curve.midi).map(([a, b]) => ({ startMs: a * hopMs, endMs: b * hopMs }))
  return segs.map((s) => {
    const n = notes.filter((x) => x.startMs >= s.startMs - 1 && x.startMs < s.endMs).length
    const r = runs.filter((x) => x.startMs >= s.startMs - 1 && x.startMs < s.endMs && x.endMs - x.startMs >= 80).length
    return { ...s, units: Math.max(1, n, r) }
  })
}

const MAX_SPAN = 14
const MAX_SKIP = 4

/**
 * Times for pasted plain lyric lines, found from the singer's pitch line: the
 * song's stretches of singing are shared out among the lines in order so that
 * each line gets about as many sung notes as it has syllables, preferring to
 * change line at longer pauses. Stretches that fit no line (humming, ad-libs)
 * may be left out. Lines that do not fit at all go after the last one, 3 s apart.
 *
 * It is a best guess — the student checks it before it is used.
 */
export function alignLyrics(texts: readonly string[], curve: PitchCurve, notes: readonly RefNote[] = notesOf(curve)): LyricLine[] {
  const segs = segmentsOf(curve, notes)
  const L = texts.length
  const m = segs.length
  if (!L) return []
  const syl = texts.map((t) => Math.max(1, syllableCount(t)))
  if (m < L) {
    // Too little singing to share out: one stretch per line, the rest appended.
    const out: LyricLine[] = texts.map((text, i) => {
      const s = segs[i]
      const base = segs[m - 1]?.endMs ?? 0
      return s ? { startMs: Math.round(s.startMs), endMs: Math.round(s.endMs), text } : { startMs: Math.round(base + (i - m + 1) * 3000), text }
    })
    return out
  }
  const totalUnits = segs.reduce((a, s) => a + s.units, 0)
  const totalSyl = syl.reduce((a, b) => a + b, 0)
  const ratio = Math.min(3, Math.max(0.3, totalUnits / totalSyl))
  const gapAfter = segs.map((s, j) => (segs[j + 1] ? segs[j + 1]!.startMs - s.endMs : 3000))
  // prefix sums of units
  const pre = [0]
  for (const s of segs) pre.push(pre[pre.length - 1]! + s.units)
  const units = (a: number, b: number) => pre[b]! - pre[a]!

  const lineCost = (i: number, a: number, b: number) => {
    const want = ratio * syl[i]!
    const u = units(a, b)
    let c = ((u - want) * (u - want)) / (want + 2)
    // Prefer to end the line at a longer pause.
    c += 2.2 * Math.exp(-gapAfter[b - 1]! / 450)
    // A long silence inside one line is unlikely.
    for (let j = a; j < b - 1; j++) c += Math.max(0, gapAfter[j]! - 900) / 350
    // A line far longer than its syllables allow.
    const dur = segs[b - 1]!.endMs - segs[a]!.startMs
    c += Math.max(0, dur - syl[i]! * 700 - 2500) / 1500
    return c
  }
  const skipCost = (a: number, b: number) => (b - a) * 1.2 + units(a, b) * 0.6

  const INF = Number.POSITIVE_INFINITY
  // dp[i][j]: best cost with lines < i placed and segments < j used or skipped.
  const dp: Float64Array[] = Array.from({ length: L + 1 }, () => new Float64Array(m + 1).fill(INF))
  const from: Int32Array[] = Array.from({ length: L + 1 }, () => new Int32Array(m + 1).fill(-1))
  const startOf: Int32Array[] = Array.from({ length: L + 1 }, () => new Int32Array(m + 1).fill(-1))
  // Leading stretches (intro humming) are cheap to leave out.
  for (let j = 0; j <= m; j++) dp[0]![j] = units(0, j) * 0.25
  for (let i = 0; i < L; i++) {
    for (let j = 0; j <= m; j++) {
      const base = dp[i]![j]!
      if (base === INF) continue
      for (let q = 0; q <= (i === 0 ? 0 : MAX_SKIP) && j + q < m; q++) {
        const a = j + q
        const sk = q ? skipCost(j, a) : 0
        for (let k = 1; k <= MAX_SPAN && a + k <= m; k++) {
          // Leave at least one stretch for every line still to come.
          if (m - (a + k) < L - i - 1) break
          const c = base + sk + lineCost(i, a, a + k)
          if (c < dp[i + 1]![a + k]!) {
            dp[i + 1]![a + k] = c
            from[i + 1]![a + k] = j
            startOf[i + 1]![a + k] = a
          }
        }
      }
    }
  }
  let bestJ = -1
  let bestC = INF
  for (let j = L; j <= m; j++) {
    const c = dp[L]![j]! + units(j, m) * 0.25
    if (c < bestC) {
      bestC = c
      bestJ = j
    }
  }
  if (bestJ < 0) return texts.map((text, i) => ({ startMs: Math.round(segs[Math.min(i, m - 1)]!.startMs), text }))
  const spans: Array<[number, number]> = []
  let j = bestJ
  for (let i = L; i > 0; i--) {
    const a = startOf[i]![j]!
    spans.unshift([a, j])
    j = from[i]![j]!
  }
  return spans.map(([a, b], i) => ({ startMs: Math.round(segs[a]!.startMs), endMs: Math.round(segs[b - 1]!.endMs), text: texts[i]! }))
}

// ---------------------------------------------------------------------------
// Takes by time
// ---------------------------------------------------------------------------

interface TimedTake {
  phrase: number
  fromMs?: number
  toMs?: number
  sungMs: Float32Array
}

/** The stretch a take was sung over (its phrase when recorded; older takes: from the sung pitch). */
export function takeSpan(t: TimedTake): PhraseRange | null {
  if (t.fromMs !== undefined && t.toMs !== undefined) return { startMs: t.fromMs, endMs: t.toMs }
  if (!t.sungMs.length) return null
  let a = Infinity
  let b = -Infinity
  for (const x of t.sungMs) {
    if (x < a) a = x
    if (x > b) b = x
  }
  return { startMs: a, endMs: b }
}

function overlap(a: PhraseRange, b: PhraseRange): number {
  return Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs))
}

/** The phrase a take belongs to now: most time in common, else the nearest within 2 s (-1 = whole-song take, null = none). */
export function phraseOfTake(t: TimedTake, phrases: readonly PhraseRange[]): number | null {
  if (t.phrase < 0) return -1
  const s = takeSpan(t)
  if (!s) return null
  let best = -1
  let most = 0
  phrases.forEach((p, i) => {
    const o = overlap(s, p)
    if (o > most) {
      most = o
      best = i
    }
  })
  if (best >= 0) return best
  const mid = (s.startMs + s.endMs) / 2
  let near = -1
  let dist = 2000
  phrases.forEach((p, i) => {
    const d = Math.min(Math.abs(mid - p.startMs), Math.abs(mid - p.endMs))
    if (d < dist) {
      dist = d
      near = i
    }
  })
  return near >= 0 ? near : null
}

/** Takes grouped by the phrase they belong to now (order kept). */
export function groupTakes<T extends TimedTake>(takes: readonly T[], phrases: readonly PhraseRange[]): Record<number, T[]> {
  const out: Record<number, T[]> = {}
  for (const t of takes) {
    const i = phraseOfTake(t, phrases)
    if (i === null) continue
    ;(out[i] ??= []).push(t)
  }
  return out
}

/** The take was sung over (nearly) exactly this phrase, so its score is a score of this phrase. */
export function takeFitsPhrase(t: TimedTake, phrase: PhraseRange): boolean {
  const s = takeSpan(t)
  if (!s) return false
  const union = Math.max(s.endMs, phrase.endMs) - Math.min(s.startMs, phrase.startMs)
  return union > 0 && overlap(s, phrase) / union >= 0.75
}

/** Two takes cover mostly the same stretch (for keeping the store small). */
export function sameStretch(a: TimedTake, b: TimedTake): boolean {
  const x = takeSpan(a)
  const y = takeSpan(b)
  const shorter = x && y ? Math.min(x.endMs - x.startMs, y.endMs - y.startMs) : 0
  if (!x || !y || shorter <= 0) return a.phrase === b.phrase
  return overlap(x, y) / shorter >= 0.5
}
