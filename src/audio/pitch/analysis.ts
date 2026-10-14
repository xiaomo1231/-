import { midiToFrequency } from '@/music/pitch'

/** One analysis frame from the detector. */
export interface PitchFrame {
  /** AudioContext time (s). */
  t: number
  hz: number | null
  clarity: number
  rms: number
  /** Largest absolute sample in the frame (clipping check). */
  peak?: number
}

/** What a sung or played note measured like. All cents are signed (+ = sharp). */
export interface NoteMeasure {
  /** Median offset from the target over the stable part, null when nothing usable was heard. */
  medianCents: number | null
  /** Fraction of the window that was voiced (0–1). */
  voicedRatio: number
  /** Spread of the stable part (p90 − p10), a stability measure. */
  driftCents: number | null
  /** Length of the longest stable stretch (ms). */
  stableMs: number
}

export const EMPTY_MEASURE: NoteMeasure = {
  medianCents: null,
  voicedRatio: 0,
  driftCents: null,
  stableMs: 0,
}

/** Signed cents from a target MIDI note; with octave equivalence folded into ±600. */
export function centsFromTarget(
  hz: number,
  targetMidi: number,
  octaveEquivalence: boolean,
): number {
  const cents = 1200 * Math.log2(hz / midiToFrequency(targetMidi))
  if (!octaveEquivalence) return cents
  let c = ((cents % 1200) + 1200) % 1200
  if (c >= 600) c -= 1200
  return c
}

export function median(xs: readonly number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

function percentile(xs: readonly number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b)
  const idx = Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * p)))
  return s[idx]!
}

/** Median-smooth the voiced pitch track (5-frame window, unvoiced frames kept). */
export function smoothFrames(frames: readonly PitchFrame[], k = 5): PitchFrame[] {
  const half = Math.floor(k / 2)
  return frames.map((f, i) => {
    if (f.hz === null) return f
    const neighbours: number[] = []
    for (let j = i - half; j <= i + half; j++) {
      const n = frames[j]
      if (n?.hz != null) neighbours.push(n.hz)
    }
    return { ...f, hz: median(neighbours) }
  })
}

/**
 * Longest run of consecutive voiced frames whose pitch stays within
 * `toleranceCents` of the run's running median. Returns frame indices.
 */
export function longestStableRun(
  frames: readonly PitchFrame[],
  toleranceCents = 60,
): { start: number; end: number } | null {
  let best: { start: number; end: number } | null = null
  let start = -1
  let anchor = 0
  for (let i = 0; i <= frames.length; i++) {
    const f = frames[i]
    const voiced = f?.hz != null
    if (voiced && start >= 0) {
      const c = 1200 * Math.log2(f!.hz! / anchor)
      if (Math.abs(c) > toleranceCents) {
        // Close the run, start a new one here.
        if (!best || i - 1 - start > best.end - best.start) best = { start, end: i - 1 }
        start = i
        anchor = f!.hz!
        continue
      }
      // Slowly follow the run so gentle drift does not break it.
      anchor = anchor * 0.9 + f!.hz! * 0.1
      continue
    }
    if (voiced && start < 0) {
      start = i
      anchor = f!.hz!
      continue
    }
    if (!voiced && start >= 0) {
      if (!best || i - 1 - start > best.end - best.start) best = { start, end: i - 1 }
      start = -1
    }
  }
  return best
}

/**
 * Measure the frames between t0 and t1 against a target. The first 20% of
 * the window is skipped as onset / scoop; the stable run inside the rest is
 * what gets scored.
 */
export function measureWindow(
  frames: readonly PitchFrame[],
  t0: number,
  t1: number,
  targetMidi: number,
  octaveEquivalence: boolean,
  opts: { skipOnset?: number } = {},
): NoteMeasure {
  const skip = opts.skipOnset ?? 0.2
  const from = t0 + (t1 - t0) * skip
  const inWindow = frames.filter((f) => f.t >= from && f.t <= t1)
  if (inWindow.length === 0) return EMPTY_MEASURE
  const voiced = inWindow.filter((f) => f.hz !== null)
  const voicedRatio = voiced.length / inWindow.length
  if (voiced.length < 3) return { ...EMPTY_MEASURE, voicedRatio }
  return measureFrames(inWindow, targetMidi, octaveEquivalence, voicedRatio)
}

/** Free-timing measurement: score the longest stable stretch anywhere in the take. */
export function measureBestStretch(
  frames: readonly PitchFrame[],
  targetMidi: number,
  octaveEquivalence: boolean,
): NoteMeasure {
  if (frames.length === 0) return EMPTY_MEASURE
  const voicedRatio = frames.filter((f) => f.hz !== null).length / frames.length
  return measureFrames(frames, targetMidi, octaveEquivalence, voicedRatio)
}

function measureFrames(
  frames: readonly PitchFrame[],
  targetMidi: number,
  octaveEquivalence: boolean,
  voicedRatio: number,
): NoteMeasure {
  const run = longestStableRun(frames)
  if (!run) return { ...EMPTY_MEASURE, voicedRatio }
  const stable = frames.slice(run.start, run.end + 1)
  const cents = stable.map((f) => centsFromTarget(f.hz!, targetMidi, octaveEquivalence))
  const stableMs = stable.length > 1 ? (stable[stable.length - 1]!.t - stable[0]!.t) * 1000 : 0
  return {
    medianCents: Math.round(median(cents)),
    voicedRatio,
    driftCents:
      cents.length >= 3 ? Math.round(percentile(cents, 0.9) - percentile(cents, 0.1)) : null,
    stableMs: Math.round(stableMs),
  }
}

/** Nearest MIDI note and cents offset for a frequency (tuner display). */
export function nearestNote(hz: number): { midi: number; cents: number } {
  const exact = 69 + 12 * Math.log2(hz / 440)
  const midi = Math.round(exact)
  return { midi, cents: Math.round((exact - midi) * 100) }
}
