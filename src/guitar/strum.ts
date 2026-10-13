/**
 * Strumming patterns on an eighth- or sixteenth-note grid, and the rhythm
 * judge that compares detected strums with the pattern.
 *
 * Down / up direction cannot be heard reliably from the signal, so it is
 * shown in the notation but only the timing is judged.
 */

/** D = down, U = up, X = muted (percussive) strum, - = hand moves without hitting. */
export type StrumCell = 'D' | 'U' | 'X' | '-'

export interface StrumPattern {
  id: string
  name: string
  /** Cells per bar: 8 (eighths) or 16 (sixteenths). */
  grid: 8 | 16
  cells: StrumCell[]
  note: string
}

const p = (id: string, name: string, s: string, note: string): StrumPattern => {
  const cells = s.replace(/\s+/g, '').split('') as StrumCell[]
  return { id, name, grid: cells.length as 8 | 16, cells, note }
}

export const STRUM_PATTERNS: readonly StrumPattern[] = [
  p('quarters', '四分下扫', 'D-D-D-D-', '每拍扫一下，全部向下。先把拍子扫稳。'),
  p('eighths', '八分下上', 'DUDUDUDU', '手腕像钟摆一样一直上下摆，下拍向下、后半拍向上。'),
  p('pop', '流行万能型', 'D-DU-UDU', '“下 下上 上下上”。第三拍的下扫空过，制造切分感，几乎所有流行歌都能用。'),
  p('folk', '民谣型', 'D-DUD-DU', '“下 下上 下 下上”，比万能型更平稳。'),
  p('rock8', '摇滚八分', 'DDDDDDDD', '全部下扫的八分音，摇滚、朋克的强力和弦常用。'),
  p('push', '切分推进', 'D-DU-U-U', '后半小节全在反拍上，听起来往前推，副歌常用。'),
  p('island', '反拍', '-U-U-U-U', '只在每拍的后半拍上扫，雷鬼和斯卡的感觉。'),
  p('sixteen', '十六分放克', 'D-DUX-DU D-DUX-DU', '十六分音符的格子，X 是闷音扫弦，左手轻搭琴弦发出“恰”的一声。'),
]

export function strumPattern(id: string): StrumPattern {
  const found = STRUM_PATTERNS.find((x) => x.id === id)
  if (!found) throw new Error(`unknown strum pattern ${id}`)
  return found
}

/** Beat positions (0-based, in quarter notes) of the strums of one bar. */
export function patternBeats(pattern: StrumPattern): number[] {
  const step = 4 / pattern.grid
  return pattern.cells.flatMap((c, i) => (c === '-' ? [] : [i * step]))
}

/** Expected strum times (seconds) for `bars` bars starting at `startAt`. */
export function expectedTimes(pattern: StrumPattern, bars: number, startAt: number, beatSeconds: number): number[] {
  const beats = patternBeats(pattern)
  const out: number[] = []
  for (let b = 0; b < bars; b++) for (const x of beats) out.push(startAt + (b * 4 + x) * beatSeconds)
  return out
}

// ---------------------------------------------------------------------------
// Judge
// ---------------------------------------------------------------------------

export const PERFECT_MS = 35
export const GOOD_MS = 80
/** Strums further than this from any expected time do not match it. */
export const MATCH_MS = 130

export type HitGrade = 'perfect' | 'good' | 'miss'

export interface Hit {
  expected: number
  /** Signed deviation in ms (+ = late), null when missed. */
  offsetMs: number | null
  grade: HitGrade
}

export interface TakeResult {
  hits: Hit[]
  /** Strums that matched nothing (extra or wildly off). */
  extra: number
  perfect: number
  good: number
  miss: number
  meanAbsMs: number | null
  /** Average signed deviation: + means dragging, − means rushing. */
  meanSignedMs: number | null
  /** 0–1. */
  score: number
}

export function gradeOffset(ms: number): HitGrade {
  const a = Math.abs(ms)
  return a <= PERFECT_MS ? 'perfect' : a <= GOOD_MS ? 'good' : 'miss'
}

/**
 * Match detected strums (already latency-corrected) to expected times,
 * nearest-first so a single early strum cannot steal two slots.
 */
export function judgeTake(expected: readonly number[], detected: readonly number[]): TakeResult {
  const pairs: Array<{ e: number; d: number; dist: number }> = []
  expected.forEach((e, ei) => detected.forEach((d, di) => {
    const dist = Math.abs(d - e)
    if (dist * 1000 <= MATCH_MS) pairs.push({ e: ei, d: di, dist })
  }))
  pairs.sort((a, b) => a.dist - b.dist)
  const eUsed = new Map<number, number>()
  const dUsed = new Set<number>()
  for (const pr of pairs) {
    if (eUsed.has(pr.e) || dUsed.has(pr.d)) continue
    eUsed.set(pr.e, pr.d)
    dUsed.add(pr.d)
  }
  const hits: Hit[] = expected.map((e, i) => {
    const di = eUsed.get(i)
    if (di === undefined) return { expected: e, offsetMs: null, grade: 'miss' }
    const ms = Math.round((detected[di]! - e) * 1000)
    return { expected: e, offsetMs: ms, grade: gradeOffset(ms) }
  })
  const timed = hits.filter((h) => h.offsetMs !== null)
  const perfect = hits.filter((h) => h.grade === 'perfect').length
  const good = hits.filter((h) => h.grade === 'good').length
  const miss = hits.length - perfect - good
  const extra = detected.length - dUsed.size
  const n = Math.max(1, expected.length)
  const score = Math.max(0, Math.min(1, (perfect + 0.6 * good) / n - Math.min(0.25, (extra / n) * 0.25)))
  return {
    hits,
    extra,
    perfect,
    good,
    miss,
    meanAbsMs: timed.length ? Math.round(timed.reduce((s, h) => s + Math.abs(h.offsetMs!), 0) / timed.length) : null,
    meanSignedMs: timed.length ? Math.round(timed.reduce((s, h) => s + h.offsetMs!, 0) / timed.length) : null,
    score,
  }
}

/** One sentence of feedback for a take. */
export function takeFeedback(r: TakeResult): string {
  if (r.perfect + r.good === 0) return '没有对上节拍。先听预备拍，在心里数 1 2 3 4 再开始扫。'
  if (r.miss > r.hits.length / 3) return `漏了 ${r.miss} 下。先放慢速度，让右手一直上下摆动，空过的地方手也要摆。`
  if (r.extra > r.hits.length / 4) return `多扫了 ${r.extra} 下。注意谱上的“-”：手照样摆，但不碰弦。`
  if (r.meanSignedMs !== null && r.meanSignedMs > 25) return `整体偏慢约 ${r.meanSignedMs} ms，有点拖。试着跟着军鼓或节拍器的重音扫。`
  if (r.meanSignedMs !== null && r.meanSignedMs < -25) return `整体偏快约 ${-r.meanSignedMs} ms，有点抢。放松右手，等拍子来。`
  if (r.score >= 0.9) return '很稳！可以提高速度，或者换下一个节奏型。'
  return '不错。再来一遍，争取更多“准”。'
}

// ---------------------------------------------------------------------------
// Songs: several sections, each with its own pattern and chords
// ---------------------------------------------------------------------------

export interface StrumSegment {
  /** Shown above the section, e.g. "主歌". */
  label?: string
  pattern: string
  /** One chord per bar, repeated to fill `bars`. */
  romans: string[]
  bars: number
}

export interface ExpectedStrum {
  time: number
  /** Position in the bar, quarter-note beats. */
  beatInBar: number
  /** Bar index across the whole song. */
  bar: number
  /** First strum of a bar where the chord changes. */
  change: boolean
}

/** Expected strums for a sequence of sections starting at `startAt`. */
export function songStrums(segments: readonly StrumSegment[], startAt: number, beatSeconds: number): ExpectedStrum[] {
  const out: ExpectedStrum[] = []
  let bar = 0
  let prevChord: string | null = null
  for (const seg of segments) {
    const beats = patternBeats(strumPattern(seg.pattern))
    for (let b = 0; b < seg.bars; b++) {
      const chord = seg.romans[b % seg.romans.length]!
      const changed = chord !== prevChord
      beats.forEach((x, i) => out.push({ time: startAt + (bar * 4 + x) * beatSeconds, beatInBar: x, bar, change: changed && i === 0 }))
      prevChord = chord
      bar++
    }
  }
  return out
}

export function totalBars(segments: readonly StrumSegment[]): number {
  return segments.reduce((s, x) => s + x.bars, 0)
}

export interface SubScore {
  /** Hits that were perfect or good, out of `total`. */
  hit: number
  total: number
  /** 0–1, same weighting as the main score (perfect 1, good 0.6). */
  score: number
}

/** Score a subset of the expected strums (by index). */
export function subScore(result: TakeResult, indices: readonly number[]): SubScore | null {
  if (!indices.length) return null
  const hits = indices.map((i) => result.hits[i]!).filter(Boolean)
  const perfect = hits.filter((h) => h.grade === 'perfect').length
  const good = hits.filter((h) => h.grade === 'good').length
  return { hit: perfect + good, total: hits.length, score: (perfect + 0.6 * good) / hits.length }
}

/** Off-beat strums (not on a quarter-note beat) and chord-change strums, scored separately. */
export function songSubScores(result: TakeResult, strums: readonly ExpectedStrum[]): { offbeat: SubScore | null; changes: SubScore | null } {
  const off: number[] = []
  const ch: number[] = []
  strums.forEach((s, i) => {
    if (Math.abs(s.beatInBar - Math.round(s.beatInBar)) > 1e-6) off.push(i)
    if (s.change) ch.push(i)
  })
  return { offbeat: subScore(result, off), changes: subScore(result, ch) }
}
