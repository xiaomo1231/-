import { majorKeySignature } from './keys'
import { LETTERS, letterPitchClass, octaveOf, pitchClass, type Letter } from './pitch'

export type Accidental = '' | '#' | 'b'

export interface SpelledNote {
  letter: Letter
  accidental: Accidental
  octave: number
  midi: number
}

const SHARP_SPELL: Array<[Letter, Accidental]> = [
  ['C', ''], ['C', '#'], ['D', ''], ['D', '#'], ['E', ''], ['F', ''], ['F', '#'], ['G', ''], ['G', '#'], ['A', ''], ['A', '#'], ['B', ''],
]
const FLAT_SPELL: Array<[Letter, Accidental]> = [
  ['C', ''], ['D', 'b'], ['D', ''], ['E', 'b'], ['E', ''], ['F', ''], ['G', 'b'], ['G', ''], ['A', 'b'], ['A', ''], ['B', 'b'], ['B', ''],
]

/**
 * Spell a MIDI note. Keys with flats in their signature spell black keys as
 * flats, everything else as sharps. `keyTonic` is the major-key tonic (use
 * the relative major for minor keys).
 */
export function spell(midi: number, opts: { keyTonic?: number; preferFlats?: boolean } = {}): SpelledNote {
  const flats = opts.preferFlats ?? (opts.keyTonic !== undefined ? majorKeySignature(pitchClass(opts.keyTonic)) < 0 : false)
  const [letter, accidental] = (flats ? FLAT_SPELL : SHARP_SPELL)[pitchClass(midi)]!
  // Octave follows the letter (B#3 would be C4; we never produce B# or Cb).
  return { letter, accidental, octave: octaveOf(midi), midi }
}

/** VexFlow key string, e.g. `c#/4`. */
export function vexKey(n: SpelledNote): string {
  return `${n.letter.toLowerCase()}${n.accidental}/${n.octave}`
}

export function spelledName(n: SpelledNote, withOctave = false): string {
  const acc = n.accidental === '#' ? '♯' : n.accidental === 'b' ? '♭' : ''
  return `${n.letter}${acc}${withOctave ? n.octave : ''}`
}

/** MIDI from a spelling. */
export function spelledToMidi(letter: Letter, accidental: Accidental, octave: number): number {
  return (octave + 1) * 12 + letterPitchClass(letter) + (accidental === '#' ? 1 : accidental === 'b' ? -1 : 0)
}

/** Diatonic step distance between two letters/octaves (for staff positions). */
export function staffStep(n: SpelledNote): number {
  return n.octave * 7 + LETTERS.indexOf(n.letter)
}

/** Chinese solfège-style roll call used next to letter names. */
export const LETTER_SOLFEGE: Record<Letter, string> = { C: 'do', D: 're', E: 'mi', F: 'fa', G: 'sol', A: 'la', B: 'si' }

/** VexFlow key-signature name for a major tonic, e.g. 'Bb'. */
export function vexKeySignature(majorTonic: number): string {
  const n = spell(majorTonic, { keyTonic: majorTonic })
  // F# major is spelled with sharps; Gb would need flats — we keep sharps for 6#.
  return `${n.letter}${n.accidental}`
}
