/**
 * Combined band score (组合乐队谱): copies tracks from other versions (GP files) of the same
 * song onto one base version's bars, and finds how far each version is shifted against the base.
 *
 * Everything here is a pure function over loaded alphaTab Score objects; reading bytes is the
 * caller's job. Inputs are never mutated: every copy goes through alphaTab's own JSON converter
 * (JsonConverter.scoreToJsObject / jsObjectToScore), which rebuilds the model with fresh ids.
 *
 * Runtime alphaTab classes come from the `at` namespace the caller passes in (same as drumScore.ts).
 *
 * alphaTab facts this relies on (verified against 1.8.4):
 * - Repeats play through MidiPlaybackController (alphaTab.core.mjs); `unrollRepeats` mirrors its
 *   repeat-count and alternate-ending logic. D.C./D.S./coda jumps are NOT expanded.
 * - Note.fret / Note.string: string 1 is the highest string; open pitch = staff.capo + tuning[n - string].
 * - Piano-like notes: sounding pitch = octave * 12 + tone.
 * - Beat.playbackStart is relative to the bar, in MIDI ticks (960 per quarter note).
 */
import type * as AlphaTab from '@coderline/alphatab'
import type { model } from '@coderline/alphatab'

/** The alphaTab module namespace (pass the `import * as at from '@coderline/alphatab'` namespace). */
export type AT = typeof AlphaTab

type JsMap = Map<string, unknown>

const DRUM_CHANNEL = 9
const CHANNEL_COUNT = 16
const FRET_MAX = 24
/** Onset slots per bar in a fingerprint (each bar is cut into this many equal parts). */
const FINGERPRINT_SLOTS = 8
/** Two candidate offsets whose scores differ by less than this count as tied (section tie-breaker). */
const TIE_EPSILON = 0.02

/** Guitar Pro duration values (alphaTab Duration enum) keyed by length in sixteenths. */
const REST_PIECES: Array<{ sixteenths: number; duration: number }> = [
  { sixteenths: 16, duration: 1 },
  { sixteenths: 8, duration: 2 },
  { sixteenths: 4, duration: 4 },
  { sixteenths: 2, duration: 8 },
  { sixteenths: 1, duration: 16 },
]

// ---------------------------------------------------------------------------
// JSON helpers
// ---------------------------------------------------------------------------

function arrayOf(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

/**
 * Deep copy of a serialized bar subtree without its `id` keys, so alphaTab assigns fresh ids.
 * Links between notes by id (tie / slur / hammer-on / slide origin and destination) are dropped
 * too: they would point at ids that no longer exist. Ties are found again from the notes'
 * tie flags and positions when the score is finished.
 */
function freshCopy(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(freshCopy)
  if (v instanceof Map) {
    const out: JsMap = new Map()
    for (const [k, val] of v as JsMap)
      if (k !== 'id' && !/noteid$/i.test(k)) out.set(k, freshCopy(val))
    return out
  }
  return v
}

function toJs(at: AT, score: model.Score): JsMap {
  const js = at.model.JsonConverter.scoreToJsObject(score)
  if (!js) throw new Error('乐谱无法序列化。')
  return js
}

function fromJs(at: AT, js: JsMap): model.Score {
  return at.model.JsonConverter.jsObjectToScore(js, new at.Settings())
}

// ---------------------------------------------------------------------------
// 1. Repeat unrolling
// ---------------------------------------------------------------------------

interface RepeatState {
  group: model.MasterBar['repeatGroup']
  /** Index of the opening master bar. */
  opening: number
  closings: model.MasterBar[]
  iterations: number[]
  closingIndex: number
}

/**
 * Playback order of the master bars, as indices into score.masterBars (repeats and alternate
 * endings expanded). Mirrors alphaTab's MidiPlaybackController for repeat signs; jumps
 * (D.C., D.S., coda) are ignored.
 */
export function playbackOrder(score: model.Score): number[] {
  const mbs = score.masterBars
  const order: number[] = []
  const stack: RepeatState[] = []
  const onStack = new Set<unknown>()
  let previousAlternateEndings = 0
  let index = 0
  let guard = 0

  while (index < mbs.length) {
    if (++guard > 1_000_000) throw new Error('重复记号无法展开，请检查谱子的反复记号。')
    const mb = mbs[index]
    const group = mb.repeatGroup
    let alternate = mb.alternateEndings
    if (alternate === 0) alternate = previousAlternateEndings

    if (mb === group.opening && group.isClosed && !onStack.has(group)) {
      stack.push({
        group,
        opening: index,
        closings: [...group.closings].sort((a, b) => a.index - b.index),
        iterations: group.closings.map(() => 0),
        closingIndex: 0,
      })
      onStack.add(group)
      previousAlternateEndings = 0
      alternate = mb.alternateEndings
    }

    let play = true
    if (stack.length > 0 && alternate !== 0) {
      const top = stack[stack.length - 1]
      const iteration = top.iterations[top.closingIndex]
      previousAlternateEndings = alternate
      play = (alternate & (1 << iteration)) !== 0
    }
    if (play) order.push(index)

    const remaining = mb.repeatCount - 1
    if (stack.length > 0 && remaining > 0) {
      const top = stack[stack.length - 1]
      if (top.iterations[top.closingIndex] < remaining) {
        index = top.opening
        top.iterations[top.closingIndex]++
        for (let i = 0; i < top.closingIndex; i++) top.iterations[i] = 0
        top.closingIndex = 0
        previousAlternateEndings = 0
      } else if (top.closingIndex < top.closings.length - 1) {
        top.closingIndex++
        index++
      } else {
        stack.pop()
        onStack.delete(top.group)
        index++
      }
    } else {
      index++
    }
  }
  return order
}

/** Direction values that move playback elsewhere; they are dropped from an unrolled score. */
function isJumpDirection(at: AT, value: number): boolean {
  const name = (at.model.Direction as unknown as Record<number, string | undefined>)[value]
  return !!name && (name.startsWith('Jump') || name.startsWith('Target'))
}

/**
 * The score with repeats expanded: its master bars are the playback order, every track's bars are
 * copied accordingly, and no repeat signs remain. `originalBar[newIndex]` gives the source bar.
 */
export function unrollRepeatsWithMap(at: AT, score: model.Score): { score: model.Score; originalBar: number[] } {
  const originalBar = playbackOrder(score)
  const js = toJs(at, score)
  const masterBars = arrayOf(js.get('masterbars')) as JsMap[]
  const tracks = arrayOf(js.get('tracks')) as JsMap[]

  const newMasterBars = originalBar.map((i) => {
    const mb: JsMap = new Map(masterBars[i])
    mb.set('isrepeatstart', false)
    mb.set('repeatcount', 0)
    mb.set('alternateendings', 0)
    const directions = mb.get('directions')
    if (Array.isArray(directions)) {
      mb.set('directions', directions.filter((d) => !isJumpDirection(at, Number(d))))
    }
    return mb
  })

  const newTracks = tracks.map((track) => {
    const t: JsMap = new Map(track)
    t.set('staves', arrayOf(track.get('staves')).map((s) => {
      const staff = s as JsMap
      const bars = arrayOf(staff.get('bars'))
      const st: JsMap = new Map(staff)
      st.set('bars', originalBar.map((i) => freshCopy(bars[i])))
      return st
    }))
    return t
  })

  const out: JsMap = new Map(js)
  out.set('masterbars', newMasterBars)
  out.set('tracks', newTracks)
  return { score: fromJs(at, out), originalBar }
}

/** The score with repeats expanded (see unrollRepeatsWithMap for the bar map). */
export function unrollRepeats(at: AT, score: model.Score): model.Score {
  return unrollRepeatsWithMap(at, score).score
}

// ---------------------------------------------------------------------------
// 2. Fingerprints and offset estimation
// ---------------------------------------------------------------------------

/** Raw onset counts of one track per master bar, in FINGERPRINT_SLOTS slots of the bar. */
function rawOnsets(score: model.Score, trackIndex: number): number[][] {
  const track = score.tracks[trackIndex]
  if (!track) throw new Error(`没有第 ${trackIndex} 条轨道。`)
  return score.masterBars.map((mb, i) => {
    const counts = new Array<number>(FINGERPRINT_SLOTS).fill(0)
    const duration = mb.calculateDuration()
    for (const staff of track.staves) {
      const bar = staff.bars[i]
      if (!bar) continue
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          if (beat.isRest || beat.notes.length === 0) continue
          const slot = duration > 0
            ? Math.min(FINGERPRINT_SLOTS - 1, Math.max(0, Math.floor((beat.playbackStart / duration) * FINGERPRINT_SLOTS)))
            : 0
          counts[slot]++
        }
      }
    }
    return counts
  })
}

function normalize(v: number[]): number[] {
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0))
  return norm === 0 ? v.map(() => 0) : v.map((x) => x / norm)
}

/** Per master bar a unit-length onset vector (8 slots) of one track; silent bars are all zeros. */
export function barFingerprint(score: model.Score, trackIndex: number): number[][] {
  return rawOnsets(score, trackIndex).map(normalize)
}

/** Per master bar a unit-length onset vector summed over all non-percussion tracks. */
export function songFingerprint(score: model.Score): number[][] {
  const perBar = score.masterBars.map(() => new Array<number>(FINGERPRINT_SLOTS).fill(0))
  score.tracks.forEach((track, t) => {
    if (track.isPercussion) return
    rawOnsets(score, t).forEach((counts, i) => {
      counts.forEach((c, k) => {
        perBar[i][k] += c
      })
    })
  })
  return perBar.map(normalize)
}

function cosine(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k]
    na += a[k] * a[k]
    nb += b[k] * b[k]
  }
  return na === 0 || nb === 0 ? 0 : dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/** Mean cosine over the bars that overlap at `offsetBars`, or null when the overlap is too small. */
function offsetScore(baseFp: number[][], partFp: number[][], offsetBars: number): { score: number; overlap: number } | null {
  const minOverlap = Math.max(1, Math.ceil(Math.min(baseFp.length, partFp.length) / 2))
  let sum = 0
  let n = 0
  for (let i = 0; i < baseFp.length; i++) {
    const j = i - offsetBars
    if (j < 0 || j >= partFp.length) continue
    sum += cosine(baseFp[i], partFp[j])
    n++
  }
  if (n < minOverlap) return null
  return { score: sum / n, overlap: n }
}

/**
 * Best shift in −maxShift..maxShift. Base bar i is paired with part bar (i − offsetBars), so the
 * value is the ComboPart.offsetBars that lines the part up with the base. Ties prefer the smaller shift.
 */
export function estimateOffset(
  baseFp: number[][],
  partFp: number[][],
  maxShift = 16,
): { offsetBars: number; score: number } {
  let best: { offsetBars: number; score: number } | null = null
  for (let s = -maxShift; s <= maxShift; s++) {
    const r = offsetScore(baseFp, partFp, s)
    if (!r) continue
    if (
      !best
      || r.score > best.score + 1e-9
      || (Math.abs(r.score - best.score) <= 1e-9 && Math.abs(s) < Math.abs(best.offsetBars))
    ) {
      best = { offsetBars: s, score: r.score }
    }
  }
  return best ?? { offsetBars: 0, score: 0 }
}

/** Section name → canonical key (Chinese and English names; a trailing number is kept). */
function sectionKey(mb: model.MasterBar): string | null {
  const raw = (mb.section?.text || mb.section?.marker || '').trim().toLowerCase()
  if (!raw) return null
  const digits = raw.match(/\d+/)?.[0] ?? ''
  const canon: Array<[RegExp, string]> = [
    [/副歌|chorus|refrain/, 'chorus'],
    [/主歌|verse/, 'verse'],
    [/前奏|引子|intro/, 'intro'],
    [/间奏|interlude/, 'interlude'],
    [/桥|bridge|过渡/, 'bridge'],
    [/尾奏|结尾|outro|coda|ending/, 'outro'],
  ]
  const hit = canon.find(([re]) => re.test(raw))
  return (hit ? hit[1] : raw.replace(/\s+/g, '')) + digits
}

/**
 * Candidate offset from matching section markers: the most common difference of bar indices
 * between sections both versions name the same (first occurrence of each name), or null.
 */
export function sectionAlign(base: model.Score, part: model.Score): number | null {
  const firstByKey = (score: model.Score): Map<string, number> => {
    const map = new Map<string, number>()
    score.masterBars.forEach((mb, i) => {
      const key = sectionKey(mb)
      if (key && !map.has(key)) map.set(key, i)
    })
    return map
  }
  const bm = firstByKey(base)
  const pm = firstByKey(part)
  const votes = new Map<number, number>()
  for (const [key, bi] of bm) {
    const pi = pm.get(key)
    if (pi === undefined) continue
    const offset = bi - pi
    votes.set(offset, (votes.get(offset) ?? 0) + 1)
  }
  let best: number | null = null
  let bestVotes = 0
  for (const [offset, count] of votes) {
    if (count > bestVotes || (count === bestVotes && best !== null && Math.abs(offset) < Math.abs(best))) {
      best = offset
      bestVotes = count
    }
  }
  return best
}

/**
 * offsetBars for a part against the base, using songFingerprint. When a section-based candidate
 * scores within TIE_EPSILON of the best, it wins (section markers break near-ties).
 */
export function estimateOffsetForScores(
  base: model.Score,
  part: model.Score,
  maxShift = 16,
): { offsetBars: number; score: number } {
  const baseFp = songFingerprint(base)
  const partFp = songFingerprint(part)
  const best = estimateOffset(baseFp, partFp, maxShift)
  const section = sectionAlign(base, part)
  if (section !== null && section !== best.offsetBars && Math.abs(section) <= maxShift) {
    const r = offsetScore(baseFp, partFp, section)
    if (r && r.score >= best.score - TIE_EPSILON) return { offsetBars: section, score: r.score }
  }
  return best
}

// ---------------------------------------------------------------------------
// 3. Version comparison (UI warnings)
// ---------------------------------------------------------------------------

export interface VersionComparison {
  bars: [number, number]
  tempo: [number, number]
  /** Base bar indices whose time signature differs from the part bar they would receive. */
  timeSignatureMismatches: number[]
  hasRepeats: [boolean, boolean]
}

function hasRepeatSigns(score: model.Score): boolean {
  return score.masterBars.some((mb) => mb.isRepeatStart || mb.repeatCount > 0)
}

function sameMeter(a: model.MasterBar, b: model.MasterBar): boolean {
  return a.timeSignatureNumerator === b.timeSignatureNumerator && a.timeSignatureDenominator === b.timeSignatureDenominator
}

/** Compares two versions; `offsetBars` is the alignment (base bar i is compared with part bar i − offsetBars). */
export function compareVersions(base: model.Score, part: model.Score, offsetBars = 0): VersionComparison {
  const mismatches: number[] = []
  base.masterBars.forEach((mb, i) => {
    const j = i - offsetBars
    if (j < 0 || j >= part.masterBars.length) return
    if (!sameMeter(mb, part.masterBars[j])) mismatches.push(i)
  })
  return {
    bars: [base.masterBars.length, part.masterBars.length],
    tempo: [base.tempo, part.tempo],
    timeSignatureMismatches: mismatches,
    hasRepeats: [hasRepeatSigns(base), hasRepeatSigns(part)],
  }
}

// ---------------------------------------------------------------------------
// 4. Combining
// ---------------------------------------------------------------------------

export interface CombinePart {
  /** A version of the same song (already unrolled by the caller when the recipe asks for it). */
  score: model.Score
  track: number
  name: string
  /** Base bar i takes part bar (i − offsetBars). +2 = the part starts 2 bars later. */
  offsetBars: number
  /** Semitones (−12…12). Percussion is never transposed. */
  transpose: number
}

export interface CombineResult {
  score: model.Score
  warnings: string[]
}

/** Whole-bar rest for one staff of a bar with the given meter (split into the fewest note values). */
function restBar(num: number, den: number): JsMap {
  const sixteenths = Math.max(1, Math.round((num * 16) / den))
  const beats: JsMap[] = []
  let rem = sixteenths
  while (rem > 0) {
    const piece = REST_PIECES.find((p) => p.sixteenths <= rem) ?? REST_PIECES[REST_PIECES.length - 1]
    beats.push(new Map<string, unknown>([
      ['notes', []],
      ['duration', piece.duration],
    ]))
    rem -= piece.sixteenths
  }
  return new Map<string, unknown>([['voices', [new Map<string, unknown>([['beats', beats]])]]])
}

/** Transposes one stringed note by `semitones`, keeping its string when possible. False if it had to be clamped. */
function transposeStringed(staff: model.Staff, note: model.Note, semitones: number): boolean {
  const tuning = staff.tuning
  const n = tuning.length
  if (n === 0) return true
  const open = (s: number): number => staff.capo + tuning[n - s]
  const sounding = note.fret + open(note.string) + semitones

  const valid: Array<{ s: number; f: number }> = []
  for (let s = 1; s <= n; s++) {
    const f = sounding - open(s)
    if (f >= 0 && f <= FRET_MAX) valid.push({ s, f })
  }
  if (valid.length > 0) {
    const pick = valid.find((c) => c.s === note.string)
      ?? valid.reduce((a, c) => {
        const da = Math.abs(a.s - note.string)
        const dc = Math.abs(c.s - note.string)
        return dc < da || (dc === da && c.f < a.f) ? c : a
      })
    note.string = pick.s
    note.fret = pick.f
    return true
  }

  // No string reaches this pitch within the fretboard: nearest clamped position.
  let best = { s: note.string, f: 0, err: Infinity }
  for (let s = 1; s <= n; s++) {
    const f = Math.min(FRET_MAX, Math.max(0, sounding - open(s)))
    const err = Math.abs(sounding - (open(s) + f))
    if (err < best.err) best = { s, f, err }
  }
  note.string = best.s
  note.fret = best.f
  return false
}

function transposeTrack(track: model.Track, semitones: number, warnings: string[], name: string): void {
  if (semitones === 0 || track.isPercussion) return
  let clamped = false
  for (const staff of track.staves) {
    for (const bar of staff.bars) {
      for (const voice of bar.voices) {
        for (const beat of voice.beats) {
          for (const note of beat.notes) {
            if (note.isPercussion) continue
            if (note.isStringed) {
              if (!transposeStringed(staff, note, semitones)) clamped = true
            } else if (note.isPiano) {
              const total = note.octave * 12 + note.tone + semitones
              note.octave = Math.floor(total / 12)
              note.tone = ((total % 12) + 12) % 12
            }
          }
        }
      }
    }
  }
  if (clamped) warnings.push(`${name}：部分音符超出指板范围，已取最近的音`)
}

function assignChannels(score: model.Score, warnings: string[]): void {
  const used = new Set<number>()
  const setChannel = (track: model.Track, channel: number): void => {
    track.playbackInfo.primaryChannel = channel
    track.playbackInfo.secondaryChannel = channel
  }
  for (const track of score.tracks) {
    if (!track.isPercussion) continue
    setChannel(track, DRUM_CHANNEL)
    used.add(DRUM_CHANNEL)
  }
  let warned = false
  for (const track of score.tracks) {
    if (track.isPercussion) continue
    let channel = -1
    for (let c = 0; c < CHANNEL_COUNT; c++) {
      if (c !== DRUM_CHANNEL && !used.has(c)) {
        channel = c
        break
      }
    }
    if (channel < 0) {
      // More pitched tracks than free channels: share one (warned once).
      channel = track.index % CHANNEL_COUNT === DRUM_CHANNEL ? 0 : track.index % CHANNEL_COUNT
      if (!warned) {
        warnings.push('MIDI 通道不够用，部分轨道共用通道')
        warned = true
      }
    }
    used.add(channel)
    setChannel(track, channel)
  }
}

/**
 * A new score: the base's master bars (tempo, time signatures, sections, repeats) with the base
 * tracks listed in `keepBaseTracks`, plus each part's track copied bar by bar onto them.
 * Bars the part does not cover, or whose time signature differs, become whole-bar rests (the
 * latter with a warning). Parts are transposed, and MIDI channels are made unique.
 */
export function combine(
  at: AT,
  base: model.Score,
  parts: CombinePart[],
  opts: { keepBaseTracks: number[] },
): CombineResult {
  const warnings: string[] = []
  const baseJs = toJs(at, base)
  const baseMasterBars = arrayOf(baseJs.get('masterbars')) as JsMap[]
  const baseTracks = arrayOf(baseJs.get('tracks')) as JsMap[]

  const tracksOut: JsMap[] = []
  for (const i of opts.keepBaseTracks) {
    const track = baseTracks[i]
    if (!track) throw new Error(`基础版本没有第 ${i} 条轨道。`)
    tracksOut.push(freshCopy(track) as JsMap)
  }
  const keptCount = tracksOut.length

  for (const part of parts) {
    const srcModel = part.score.tracks[part.track]
    if (!srcModel) throw new Error(`「${part.name}」所在的版本没有第 ${part.track} 条轨道。`)
    const partJs = toJs(at, part.score)
    const srcTrack = (arrayOf(partJs.get('tracks')) as JsMap[])[part.track]
    const srcStaves = arrayOf(srcTrack.get('staves')) as JsMap[]

    const track: JsMap = new Map(srcTrack)
    track.set('name', part.name || srcModel.name)
    track.set('staves', srcStaves.map((staff, si) => {
      const srcBars = arrayOf(staff.get('bars')) as JsMap[]
      const bars = base.masterBars.map((bmb, i) => {
        const meterRest = () => restBar(bmb.timeSignatureNumerator, bmb.timeSignatureDenominator)
        const j = i - part.offsetBars
        if (j < 0 || j >= part.score.masterBars.length) return meterRest()
        if (!sameMeter(bmb, part.score.masterBars[j])) {
          if (si === 0) warnings.push(`${part.name}第 ${i + 1} 小节拍号不同，已留空`)
          return meterRest()
        }
        const src = srcBars[j]
        return src ? (freshCopy(src) as JsMap) : meterRest()
      })
      const st: JsMap = new Map(staff)
      st.set('bars', bars)
      return st
    }))
    tracksOut.push(track)
  }

  const out: JsMap = new Map(baseJs)
  out.set('masterbars', baseMasterBars.map((m) => new Map(m)))
  out.set('tracks', tracksOut)
  const score = fromJs(at, out)

  parts.forEach((part, k) => {
    transposeTrack(score.tracks[keptCount + k], part.transpose, warnings, part.name)
  })
  assignChannels(score, warnings)
  return { score, warnings }
}

// ---------------------------------------------------------------------------
// 5. Export
// ---------------------------------------------------------------------------

/** Guitar Pro 7 (.gp) bytes of a combined score, via alphaTab's Gp7Exporter. */
export function exportCombined(at: AT, score: model.Score): Uint8Array {
  return new at.exporter.Gp7Exporter().export(score)
}
