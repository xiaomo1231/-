/**
 * Pitch primitives. Everything downstream (drills, audio, notation) talks in
 * MIDI numbers; names are only produced at the edge for display.
 */

export const A4_MIDI = 69
export const A4_HZ = 440

const SHARP_NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'] as const
const FLAT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'] as const

/** Natural letter names for the white keys, used by notation and the keyboard. */
export const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const
export type Letter = (typeof LETTERS)[number]

/** Pitch class 0–11 of a MIDI note. */
export function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12
}

/** Octave number in scientific pitch notation (C4 = 60). */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1
}

export function midiToFrequency(midi: number): number {
  return A4_HZ * Math.pow(2, (midi - A4_MIDI) / 12)
}

export function frequencyToMidi(hz: number): number {
  return A4_MIDI + 12 * Math.log2(hz / A4_HZ)
}

/** Signed cents from `target` to `actual` (positive = sharp). */
export function centsBetween(targetHz: number, actualHz: number): number {
  return 1200 * Math.log2(actualHz / targetHz)
}

export interface NoteNameOptions {
  /** Prefer flats for black keys (default sharps). */
  flats?: boolean
  /** Append the octave number (C4). */
  octave?: boolean
}

/** Display name of a MIDI note, e.g. `C♯4`. */
export function midiToName(midi: number, opts: NoteNameOptions = {}): string {
  const pc = pitchClass(midi)
  const base = opts.flats ? FLAT_NAMES[pc]! : SHARP_NAMES[pc]!
  return opts.octave ? `${base}${octaveOf(midi)}` : base
}

/** Parse names like `C4`, `F#3`, `Bb2`, `E♭5`. Returns null when invalid. */
export function nameToMidi(name: string): number | null {
  const m = /^([A-Ga-g])([#♯b♭]?)(-?\d)$/.exec(name.trim())
  if (!m) return null
  const letter = m[1]!.toUpperCase() as Letter
  const acc = m[2]!
  const octave = Number(m[3])
  const base = LETTER_PC[letter]
  const shift = acc === '#' || acc === '♯' ? 1 : acc === 'b' || acc === '♭' ? -1 : 0
  return (octave + 1) * 12 + base + shift
}

const LETTER_PC: Record<Letter, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export function letterPitchClass(letter: Letter): number {
  return LETTER_PC[letter]
}

export function isBlackKey(midi: number): boolean {
  return [1, 3, 6, 8, 10].includes(pitchClass(midi))
}

/**
 * Tone.js and VexFlow expect ASCII accidentals (`C#4`, `Eb3`). Keep this
 * conversion in one place so the rest of the app can use the pretty glyphs.
 */
export function midiToAsciiName(midi: number, flats = false): string {
  return midiToName(midi, { flats, octave: true }).replace('♯', '#').replace('♭', 'b')
}

/** Clamp a MIDI note into [low, high] by moving it in whole octaves. */
export function foldIntoRange(midi: number, low: number, high: number): number {
  let m = midi
  while (m < low) m += 12
  while (m > high) m -= 12
  return m
}
