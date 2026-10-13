import type { Rng } from './random'
import { scaleNotes, type ScaleId } from './scales'

/** A note in a short exercise melody. Durations are in beats (quarter = 1). */
export interface MelodyNote {
  midi: number
  beats: number
}

export interface MelodySpec {
  tonic: number
  scale: ScaleId
  /** Total length in beats (multiple of 4). */
  beats: number
  /** Largest leap in scale steps. 1 = stepwise only. */
  maxLeap: number
  /** Allow eighth-note pairs. */
  eighths: boolean
  /** Allow one chromatic neighbour note. */
  chromatic?: boolean
  /** Start on the tonic (dictation gives the first note). */
  startOnTonic?: boolean
  /** Force a fixed number of notes (each one beat); overrides `beats` rhythm. */
  noteCount?: number
}

/**
 * Generate a singable diatonic melody: starts on 1, 3 or 5, moves mostly by
 * step with limited leaps, stays within an octave above the tonic (plus the
 * leading tone below) and ends on the tonic. Deterministic for a seeded rng.
 */
export function generateMelody(spec: MelodySpec, rng: Rng): MelodyNote[] {
  // Degrees from the 7th below the tonic up to the octave + 2nd.
  const up = scaleNotes(spec.tonic, spec.scale, false)
  const ladder = [up[up.length - 1]! - 12, ...up, spec.tonic + 12, up[1]! + 12]
  const tonicIdx = 1
  const clampIdx = (i: number) => Math.max(0, Math.min(ladder.length - 1, i))

  const rhythm = spec.noteCount
    ? Array.from({ length: spec.noteCount }, () => 1)
    : buildRhythm(spec.beats, spec.eighths, rng)

  const starts = spec.startOnTonic ? [tonicIdx] : [tonicIdx, tonicIdx + 2, tonicIdx + 4]
  let idx = rng.pick(starts)
  const out: MelodyNote[] = []
  rhythm.forEach((beats, i) => {
    const last = i === rhythm.length - 1
    if (i > 0) {
      if (last) {
        // Resolve to the tonic (or its octave), whichever is closer.
        idx = Math.abs(idx - tonicIdx) <= Math.abs(idx - (tonicIdx + up.length)) ? tonicIdx : tonicIdx + up.length
      } else {
        const leap = rng.chance(0.3) ? rng.int(2, Math.max(2, spec.maxLeap)) : 1
        const step = spec.maxLeap <= 1 ? 1 : leap
        let dir = rng.chance(0.5) ? 1 : -1
        // Gravity toward the middle of the range keeps the melody singable.
        if (idx <= 1) dir = 1
        if (idx >= ladder.length - 2) dir = -1
        idx = clampIdx(idx + dir * step)
      }
    }
    out.push({ midi: ladder[idx]!, beats })
  })

  if (spec.chromatic && out.length >= 4) {
    // Turn one inner note into a chromatic lower neighbour of the next note.
    const i = rng.int(1, out.length - 3)
    const next = out[i + 1]!
    out[i] = { midi: next.midi - 1, beats: out[i]!.beats }
  }
  return out
}

function buildRhythm(beats: number, eighths: boolean, rng: Rng): number[] {
  const out: number[] = []
  // Everything but the last two beats: quarters, sometimes an eighth pair.
  for (let b = 0; b < beats - 2; b++) {
    if (eighths && rng.chance(0.3)) out.push(0.5, 0.5)
    else out.push(1)
  }
  // A half note at the end sounds conclusive.
  out.push(beats >= 2 ? 2 : 1)
  return out
}

/** Onsets (in beats) of a melody, for paced singing and rhythm display. */
export function melodyOnsets(notes: readonly MelodyNote[]): number[] {
  const out: number[] = []
  let t = 0
  for (const n of notes) {
    out.push(t)
    t += n.beats
  }
  return out
}

export function melodyLength(notes: readonly MelodyNote[]): number {
  return notes.reduce((s, n) => s + n.beats, 0)
}

/** Shift a melody by octaves so its range sits inside [low, high] when possible. */
export function fitMelodyToRange(notes: readonly MelodyNote[], low: number, high: number): MelodyNote[] {
  const min = Math.min(...notes.map((n) => n.midi))
  const max = Math.max(...notes.map((n) => n.midi))
  let shift = 0
  while (min + shift < low && max + shift + 12 <= high + 2) shift += 12
  while (max + shift > high && min + shift - 12 >= low - 2) shift -= 12
  return notes.map((n) => ({ ...n, midi: n.midi + shift }))
}
