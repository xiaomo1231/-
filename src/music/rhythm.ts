/**
 * Rhythm patterns for the tapping drills. A pattern is a list of onsets in
 * beats (quarter notes) within a bar, plus the bar length. Durations are
 * derived from the next onset so the notation renderer can draw them.
 */
export type RhythmFigure = 'quarter' | 'eighth' | 'dotted' | 'syncopation' | 'sixteenth' | 'triplet' | 'rest'

export interface RhythmPattern {
  id: string
  /** Onsets in beats from the bar start, strictly increasing, all < beats. */
  onsets: readonly number[]
  beats: number
  /** Figures the pattern exercises — these become skill ids. */
  figures: readonly RhythmFigure[]
  level: number
}

const Q = 1
const E = 0.5
const S = 0.25
const T = 1 / 3

function onsetsFromDurations(durations: readonly number[], rests: readonly boolean[] = []): number[] {
  const onsets: number[] = []
  let t = 0
  durations.forEach((d, i) => {
    if (!rests[i]) onsets.push(round(t))
    t += d
  })
  return onsets
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000
}

export const RHYTHM_PATTERNS: readonly RhythmPattern[] = [
  // Level 1 — quarters and eighths
  { id: 'q4', onsets: onsetsFromDurations([Q, Q, Q, Q]), beats: 4, figures: ['quarter'], level: 1 },
  { id: 'q2e2q', onsets: onsetsFromDurations([Q, Q, E, E, Q]), beats: 4, figures: ['quarter', 'eighth'], level: 1 },
  { id: 'e2q_e2q', onsets: onsetsFromDurations([E, E, Q, E, E, Q]), beats: 4, figures: ['eighth'], level: 1 },
  { id: 'q_e2_q_e2', onsets: onsetsFromDurations([Q, E, E, Q, E, E]), beats: 4, figures: ['eighth'], level: 1 },
  { id: 'e8', onsets: onsetsFromDurations([E, E, E, E, E, E, E, E]), beats: 4, figures: ['eighth'], level: 1 },
  // Level 2 — dotted and syncopation
  { id: 'dq_e_q_q', onsets: onsetsFromDurations([1.5, E, Q, Q]), beats: 4, figures: ['dotted'], level: 2 },
  { id: 'q_dq_e_q', onsets: onsetsFromDurations([Q, 1.5, E, Q]), beats: 4, figures: ['dotted'], level: 2 },
  { id: 'e_q_e_q_q', onsets: onsetsFromDurations([E, Q, E, Q, Q]), beats: 4, figures: ['syncopation'], level: 2 },
  { id: 'e_q_q_e_q', onsets: onsetsFromDurations([E, Q, Q, E, Q]), beats: 4, figures: ['syncopation'], level: 2 },
  { id: 'q_e_q_e_q', onsets: onsetsFromDurations([Q, E, Q, E, Q]), beats: 4, figures: ['syncopation'], level: 2 },
  // Level 3 — sixteenths
  { id: 's4_q_e2_q', onsets: onsetsFromDurations([S, S, S, S, Q, E, E, Q]), beats: 4, figures: ['sixteenth'], level: 3 },
  { id: 'e_s2_q_q_q', onsets: onsetsFromDurations([E, S, S, Q, Q, Q]), beats: 4, figures: ['sixteenth'], level: 3 },
  { id: 's2_e_q_s2_e_q', onsets: onsetsFromDurations([S, S, E, Q, S, S, E, Q]), beats: 4, figures: ['sixteenth'], level: 3 },
  { id: 'de_s_q_q_q', onsets: onsetsFromDurations([0.75, S, Q, Q, Q]), beats: 4, figures: ['sixteenth', 'dotted'], level: 3 },
  // Level 4 — triplets
  { id: 't3_q_q_q', onsets: onsetsFromDurations([T, T, T, Q, Q, Q]), beats: 4, figures: ['triplet'], level: 4 },
  { id: 'q_t3_q_t3', onsets: onsetsFromDurations([Q, T, T, T, Q, T, T, T]), beats: 4, figures: ['triplet'], level: 4 },
  { id: 'q_q_t3_q', onsets: onsetsFromDurations([Q, Q, T, T, T, Q]), beats: 4, figures: ['triplet'], level: 4 },
  // Level 5 — rests and pickups
  { id: 'r_q_q_q', onsets: onsetsFromDurations([Q, Q, Q, Q], [true, false, false, false]), beats: 4, figures: ['rest'], level: 5 },
  { id: 'q_r_e2_q', onsets: onsetsFromDurations([Q, Q, E, E, Q], [false, true, false, false, false]), beats: 4, figures: ['rest', 'eighth'], level: 5 },
  { id: 'e_r_e_q_q_q', onsets: onsetsFromDurations([E, E, Q, Q, Q], [false, true, false, false, false]), beats: 4, figures: ['rest', 'syncopation'], level: 5 },
  { id: 'q_q_r_e2', onsets: onsetsFromDurations([Q, Q, Q, E, E], [false, false, true, false, false]), beats: 4, figures: ['rest', 'eighth'], level: 5 },
]

export function rhythmPatternsForLevel(level: number): RhythmPattern[] {
  return RHYTHM_PATTERNS.filter((p) => p.level <= level)
}

export function rhythmPatternById(id: string): RhythmPattern {
  const found = RHYTHM_PATTERNS.find((p) => p.id === id)
  if (!found) throw new Error(`Unknown rhythm pattern ${id}`)
  return found
}

/** Convert beats to milliseconds at a tempo. */
export function beatsToMs(beats: number, bpm: number): number {
  return (beats * 60000) / bpm
}

export const FIGURE_LABEL: Record<RhythmFigure, string> = {
  quarter: '四分音符',
  eighth: '八分音符',
  dotted: '附点',
  syncopation: '切分',
  sixteenth: '十六分音符',
  triplet: '三连音',
  rest: '休止',
}
