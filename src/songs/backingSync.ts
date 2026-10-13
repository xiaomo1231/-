/**
 * 原曲伴奏 (pure): an imported recording (or its separated stems) played in
 * time with a sheet.
 *
 * Time model: the sheet's own clock is alphaTab's tick position. Each bar
 * gets a start time in "score ms" (from the written tempo). A SyncMap maps
 * score time to audio time: a constant offset, refined by tapped bar starts
 * (sync points) where the recording speeds up or slows down. Between points
 * the mapping is linear; outside them it extends with the nearest segment's
 * ratio.
 */
import type { model } from '@coderline/alphatab'

type AtScore = model.Score

const QUARTER = 960

export interface BarTime {
  startTick: number
  ticks: number
  startMs: number
  ms: number
}

/** Bar start ticks and times from the written tempo (tempo changes inside a bar are honoured). */
export function barTimeline(score: AtScore): BarTime[] {
  let bpm = score.tempo || 120
  let ms = 0
  return score.masterBars.map((mb) => {
    const ticks = mb.calculateDuration()
    const changes = [...mb.tempoAutomations].filter((a) => a.value > 0).sort((a, b) => a.ratioPosition - b.ratioPosition)
    const startMs = ms
    let pos = 0
    for (const c of changes) {
      const at = Math.max(0, Math.min(1, c.ratioPosition))
      ms += (((at - pos) * ticks) / QUARTER) * (60000 / bpm)
      pos = at
      bpm = c.value
    }
    ms += (((1 - pos) * ticks) / QUARTER) * (60000 / bpm)
    return { startTick: mb.start, ticks, startMs, ms: ms - startMs }
  })
}

/** Bar index and fraction for a tick. */
export function barPosition(timeline: readonly BarTime[], tick: number): { bar: number; frac: number } {
  if (!timeline.length) return { bar: 0, frac: 0 }
  let lo = 0
  let hi = timeline.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (timeline[mid]!.startTick <= tick) lo = mid
    else hi = mid - 1
  }
  const b = timeline[lo]!
  return { bar: lo, frac: b.ticks ? Math.max(0, (tick - b.startTick) / b.ticks) : 0 }
}

export function scoreMsAt(timeline: readonly BarTime[], tick: number): number {
  if (!timeline.length) return 0
  const { bar, frac } = barPosition(timeline, tick)
  const b = timeline[bar]!
  return b.startMs + frac * b.ms
}

/** Score time of a bar start (bars past the end extend at the last bar's length). */
export function barStartMs(timeline: readonly BarTime[], bar: number): number {
  if (!timeline.length) return 0
  if (bar < timeline.length) return timeline[Math.max(0, bar)]!.startMs
  const last = timeline[timeline.length - 1]!
  return last.startMs + last.ms * (bar - timeline.length + 1)
}

export interface SyncPoint {
  bar: number
  /** Where that bar starts in the recording, ms. */
  audioMs: number
}

export interface SyncMap {
  /** Audio ms at score time 0 when there are no sync points. */
  offsetMs: number
  points: SyncPoint[]
}

export const EMPTY_SYNC: SyncMap = { offsetMs: 0, points: [] }

/** Recording time for a score time (see module doc). */
export function audioMsForScoreMs(timeline: readonly BarTime[], sync: SyncMap, scoreMs: number): number {
  const pts = [...sync.points].sort((a, b) => a.bar - b.bar).map((p) => ({ s: barStartMs(timeline, p.bar), a: p.audioMs }))
  if (pts.length === 0) return sync.offsetMs + scoreMs
  if (pts.length === 1) return pts[0]!.a + (scoreMs - pts[0]!.s)
  const ratio = (i: number) => {
    const p = pts[i]!
    const q = pts[i + 1]!
    return q.s === p.s ? 1 : (q.a - p.a) / (q.s - p.s)
  }
  if (scoreMs <= pts[0]!.s) return pts[0]!.a - (pts[0]!.s - scoreMs) * ratio(0)
  for (let i = 0; i < pts.length - 1; i++) {
    if (scoreMs <= pts[i + 1]!.s) return pts[i]!.a + (scoreMs - pts[i]!.s) * ratio(i)
  }
  const last = pts.length - 1
  return pts[last]!.a + (scoreMs - pts[last]!.s) * ratio(last - 1)
}

export function audioMsAt(timeline: readonly BarTime[], sync: SyncMap, tick: number): number {
  return audioMsForScoreMs(timeline, sync, scoreMsAt(timeline, tick))
}

/** Taps on consecutive downbeats from `firstBar` → sync points (replacing points of those bars). */
export function tapsToPoints(existing: readonly SyncPoint[], firstBar: number, tapsMs: readonly number[]): SyncPoint[] {
  const tapped = tapsMs.map((audioMs, k) => ({ bar: firstBar + k, audioMs: Math.round(audioMs) }))
  const bars = new Set(tapped.map((p) => p.bar))
  return [...existing.filter((p) => !bars.has(p.bar)), ...tapped].sort((a, b) => a.bar - b.bar)
}

/** Score time of the first written note in any pitched or drum track (the first sound of the song). */
export function firstNoteScoreMs(score: AtScore, timeline: readonly BarTime[]): number {
  let best = Infinity
  for (const track of score.tracks) {
    for (const staff of track.staves) {
      for (const bar of staff.bars) {
        const start = timeline[bar.index]?.startTick ?? 0
        for (const v of bar.voices) {
          for (const beat of v.beats) {
            if (beat.notes.length && !beat.isRest) {
              best = Math.min(best, start + beat.playbackStart)
              break
            }
          }
        }
        if (best <= start) break
      }
    }
  }
  return Number.isFinite(best) ? scoreMsAt(timeline, best) : 0
}

// ---------------------------------------------------------------------------
// Stems
// ---------------------------------------------------------------------------

export type StemKind = 'mix' | 'instrumental' | 'vocals' | 'drums' | 'bass' | 'guitar' | 'piano' | 'other'

export const STEM_LABEL: Record<StemKind, string> = {
  mix: '原曲（完整）',
  instrumental: '伴奏（去人声）',
  vocals: '人声',
  drums: '鼓',
  bass: '贝斯',
  guitar: '吉他',
  piano: '钢琴 / 键盘',
  other: '其它',
}

export const STEM_ORDER: readonly StemKind[] = ['mix', 'instrumental', 'vocals', 'drums', 'bass', 'guitar', 'piano', 'other']

/**
 * Which stem a file is, from its name (UVR: "song_(Vocals).wav",
 * "song_(Instrumental).wav"; Demucs: "drums.wav"; Chinese names too).
 * Anything unrecognised is the full mix.
 */
export function detectStem(fileName: string): StemKind {
  const n = fileName.toLowerCase().replace(/\.[a-z0-9]+$/, '')
  const has = (re: RegExp) => re.test(n)
  if (has(/no[_\s-]?vocals?|instrumental|karaoke|\binst\b|伴奏|去人声|消音/)) return 'instrumental'
  if (has(/vocals?|\bvox\b|voice|人声|歌声|干声/)) return 'vocals'
  if (has(/drums?|percussion|鼓/)) return 'drums'
  if (has(/bass|贝斯|低音/)) return 'bass'
  if (has(/guitars?|\bgtr\b|吉他/)) return 'guitar'
  if (has(/piano|keys|keyboard|钢琴|键盘/)) return 'piano'
  if (has(/other|其它|其他|rest/)) return 'other'
  return 'mix'
}

export interface StemMix {
  volume: number
  muted: boolean
}

export type PracticeRole = 'listen' | 'lead' | 'rhythm' | 'bass' | 'drums' | 'sing'

export const ROLE_LABEL: Record<PracticeRole, string> = {
  listen: '全部原声',
  lead: '练主音',
  rhythm: '练节奏吉他',
  bass: '练贝斯',
  drums: '练鼓',
  sing: '练唱',
}

/** The stem a role takes away. */
const ROLE_REMOVES: Record<PracticeRole, StemKind | null> = { listen: null, lead: 'guitar', rhythm: 'guitar', bass: 'bass', drums: 'drums', sing: 'vocals' }

/**
 * Mixer settings for a role, given the stems that exist. With separated
 * stems the role's stem is muted; with only a full mix (+ maybe an
 * instrumental) singers get the instrumental and everyone else the mix.
 * Returns whether the role's part is really removed.
 */
export function roleMix(role: PracticeRole, stems: readonly StemKind[]): { mix: Partial<Record<StemKind, StemMix>>; removed: boolean } {
  const target = ROLE_REMOVES[role]
  // A vocals + instrumental split (UVR two-stem) is not separated enough to remove instruments.
  const separated = stems.some((s) => s !== 'mix' && s !== 'instrumental' && s !== 'vocals')
  const mix: Partial<Record<StemKind, StemMix>> = {}
  if (separated) {
    for (const s of stems) mix[s] = { volume: 1, muted: s === 'mix' || s === 'instrumental' || s === target }
    return { mix, removed: target === null || stems.includes(target) }
  }
  const useInstrumental = role === 'sing' && stems.includes('instrumental')
  const hasMix = stems.includes('mix')
  // With a full mix, the vocals / instrumental stems would double it: play the mix alone.
  for (const s of stems) mix[s] = { volume: 1, muted: useInstrumental ? s !== 'instrumental' : hasMix && s !== 'mix' }
  return { mix, removed: target === null || useInstrumental }
}
