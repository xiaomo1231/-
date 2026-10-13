/**
 * Pure state machines for the pitch-based guitar checks:
 *  - chord check: pluck each string of a chord shape, low to high;
 *  - chord changes: alternate two chords, plucking the root after each change.
 * Both consume stable notes (MIDI, already smoothed), so they can be tested
 * without audio.
 */
import type { PitchFrame } from '@/audio/pitch/analysis'
import { frequencyToMidi } from '@/music/pitch'

/** Turns pitch frames into "a note was held" events (≥ `minFrames` frames within ±0.4 semitone). */
export class StableNoteTracker {
  private run: number[] = []
  private lastEmitted: number | null = null
  private silent = 0
  constructor(private minFrames = 4) {}

  /** Returns the MIDI note (rounded) when a new stable note starts, otherwise null. */
  push(frame: Pick<PitchFrame, 'hz'>): number | null {
    if (frame.hz === null) {
      this.silent++
      if (this.silent >= 3) {
        this.run = []
        this.lastEmitted = null
      }
      return null
    }
    this.silent = 0
    const m = frequencyToMidi(frame.hz)
    if (this.run.length && Math.abs(m - this.run[this.run.length - 1]!) > 0.6) this.run = []
    this.run.push(m)
    if (this.run.length < this.minFrames) return null
    const avg = this.run.slice(-this.minFrames).reduce((a, b) => a + b, 0) / this.minFrames
    const note = Math.round(avg)
    if (Math.abs(avg - note) > 0.4 || note === this.lastEmitted) return null
    this.lastEmitted = note
    return note
  }

  reset(): void {
    this.run = []
    this.lastEmitted = null
    this.silent = 0
  }
}

// ---------------------------------------------------------------------------

export type StringState = 'pending' | 'ok' | 'retry' | 'skipped'

export interface ChordCheckState {
  /** Expected MIDI per played string, low to high (muted strings removed). */
  targets: Array<{ string: number; midi: number }>
  index: number
  states: StringState[]
  /** Wrong notes heard on each string. */
  wrong: Array<number | null>
  firstTry: number
}

export function startChordCheck(targets: ChordCheckState['targets']): ChordCheckState {
  return { targets, index: 0, states: targets.map(() => 'pending'), wrong: targets.map(() => null), firstTry: 0 }
}

/**
 * A stable note arrived. If it is the current string's note, move on.
 * A note that belongs to an earlier string (still ringing) is ignored;
 * anything else is recorded as wrong and the string must be retried.
 */
export function chordCheckNote(s: ChordCheckState, midi: number): ChordCheckState {
  if (s.index >= s.targets.length) return s
  const t = s.targets[s.index]!
  if (midi === t.midi) {
    const states = [...s.states]
    const first = states[s.index] === 'pending'
    states[s.index] = 'ok'
    return { ...s, states, index: s.index + 1, firstTry: s.firstTry + (first ? 1 : 0) }
  }
  if (s.targets.slice(0, s.index).some((x) => x.midi === midi)) return s
  const states = [...s.states]
  const wrong = [...s.wrong]
  states[s.index] = 'retry'
  wrong[s.index] = midi
  return { ...s, states, wrong }
}

export function chordCheckSkip(s: ChordCheckState): ChordCheckState {
  if (s.index >= s.targets.length) return s
  const states = [...s.states]
  states[s.index] = 'skipped'
  return { ...s, states, index: s.index + 1 }
}

export function chordCheckDone(s: ChordCheckState): boolean {
  return s.index >= s.targets.length
}

/** Passed when every string sounded right (retries allowed, skips not). */
export function chordCheckPassed(s: ChordCheckState): boolean {
  return chordCheckDone(s) && s.states.every((x) => x === 'ok')
}

// ---------------------------------------------------------------------------

export interface ChangeCounterState {
  /** Root MIDI notes of the two chords (pitch classes are compared). */
  roots: [number, number]
  /** Which root was heard last (0 / 1), null before the first. */
  last: 0 | 1 | null
  changes: number
}

export function startChangeCounter(roots: [number, number]): ChangeCounterState {
  return { roots, last: null, changes: 0 }
}

const pc = (m: number) => ((m % 12) + 12) % 12

/** A stable bass note: count a change when it switches from one chord's root to the other's. */
export function changeCounterNote(s: ChangeCounterState, midi: number): ChangeCounterState {
  const which = pc(midi) === pc(s.roots[0]) ? 0 : pc(midi) === pc(s.roots[1]) ? 1 : null
  if (which === null) return s
  if (s.last === null) return { ...s, last: which }
  if (which === s.last) return s
  return { ...s, last: which, changes: s.changes + 1 }
}
