/**
 * Chord symbols ("Am7", "G/B", "Bbsus4") → the score's roman-numeral slots
 * relative to a key (pure). Any chord whose root is a supported scale step
 * maps to that roman, with a colour override when its quality differs
 * (an A major in C major becomes vi + quality maj).
 */
import type { ChordTypeId } from '@/music/chords'
import { MAJOR_BORROWED, MAJOR_DIATONIC, MAJOR_SECONDARY, MINOR_DIATONIC, type Mode, type RomanChord, type RomanId } from '@/music/keys'

export interface ParsedChord {
  symbol: string
  rootPc: number
  quality: ChordTypeId
  /** Bass pitch class for slash chords. */
  bassPc?: number
}

const LETTER: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

export const CHORD_TOKEN = /^([A-G])([#b♯♭]?)((?:maj7|maj9|M7|m7b5|m7|m9|m6|mM7|min|m|dim7|dim|°|ø|aug|\+|sus2|sus4|sus|add9|add2|7sus4|13|11|9|7|6|5)?)(?:\/([A-G])([#b♯♭]?))?$/

const QUALITY: Record<string, ChordTypeId> = {
  '': 'maj',
  maj7: 'maj7',
  maj9: 'maj7',
  M7: 'maj7',
  m7b5: 'm7b5',
  ø: 'm7b5',
  m7: 'min7',
  m9: 'min7',
  m6: 'min',
  mM7: 'min',
  min: 'min',
  m: 'min',
  dim7: 'dim7',
  dim: 'dim',
  '°': 'dim',
  aug: 'aug',
  '+': 'aug',
  sus2: 'sus2',
  add2: 'add9',
  sus4: 'sus4',
  sus: 'sus4',
  '7sus4': 'sus4',
  add9: 'add9',
  '13': 'dom7',
  '11': 'dom7',
  '9': 'dom7',
  '7': 'dom7',
  '6': 'maj',
  '5': 'power',
}

const accidental = (a: string | undefined) => (a === '#' || a === '♯' ? 1 : a === 'b' || a === '♭' ? -1 : 0)

export function parseChord(token: string): ParsedChord | null {
  const m = CHORD_TOKEN.exec(token.trim())
  if (!m) return null
  const rootPc = (LETTER[m[1]!]! + accidental(m[2]) + 12) % 12
  const quality = QUALITY[m[3] ?? ''] ?? 'maj'
  return { symbol: token.trim(), rootPc, quality, ...(m[4] ? { bassPc: (LETTER[m[4]]! + accidental(m[5]) + 12) % 12 } : {}) }
}

const FAMILY: Record<ChordTypeId, 'maj' | 'min' | 'dim' | 'other'> = {
  maj: 'maj',
  maj7: 'maj',
  dom7: 'maj',
  add9: 'maj',
  aug: 'other',
  power: 'other',
  sus2: 'other',
  sus4: 'other',
  min: 'min',
  min7: 'min',
  dim: 'dim',
  dim7: 'dim',
  m7b5: 'dim',
}

/** Chord tones relative to the root, for slash-chord bass detection. */
const THIRD: Partial<Record<ChordTypeId, number>> = { maj: 4, maj7: 4, dom7: 4, add9: 4, aug: 4, min: 3, min7: 3, dim: 3, dim7: 3, m7b5: 3 }
const FIFTH: Partial<Record<ChordTypeId, number>> = { maj: 7, maj7: 7, dom7: 7, add9: 7, min: 7, min7: 7, power: 7, sus2: 7, sus4: 7, dim: 6, dim7: 6, m7b5: 6, aug: 8 }

export interface RomanSlotSpec {
  roman: RomanId
  quality?: ChordTypeId
  bass?: 1 | 2
}

/** Map a chord to a roman numeral in a key, or null when its root is not a supported step. */
export function chordToRoman(c: ParsedChord, tonicPc: number, mode: Mode): RomanSlotSpec | null {
  const offset = (((c.rootPc - tonicPc) % 12) + 12) % 12
  const pool: readonly RomanChord[] = mode === 'major' ? [...MAJOR_DIATONIC, ...MAJOR_BORROWED, ...MAJOR_SECONDARY] : MINOR_DIATONIC
  const candidates = pool.filter((r) => r.offset === offset)
  if (!candidates.length) return null
  const fam = FAMILY[c.quality]
  const best = candidates.find((r) => FAMILY[r.type] === fam) ?? candidates[0]!
  const spec: RomanSlotSpec = { roman: best.roman }
  if (c.quality !== best.type) spec.quality = c.quality
  if (c.bassPc !== undefined) {
    const iv = (((c.bassPc - c.rootPc) % 12) + 12) % 12
    if (iv === THIRD[c.quality]) spec.bass = 1
    else if (iv === FIFTH[c.quality]) spec.bass = 2
  }
  return spec
}

/**
 * Guess the key of a chord sequence: the key (major or minor) in which most
 * chords are diatonic with the right quality; ties go to the first chord.
 */
export function guessKey(chords: readonly ParsedChord[]): { tonicPc: number; mode: Mode } {
  if (!chords.length) return { tonicPc: 0, mode: 'major' }
  let best = { tonicPc: chords[0]!.rootPc, mode: (FAMILY[chords[0]!.quality] === 'min' ? 'minor' : 'major') as Mode, score: -Infinity }
  for (let t = 0; t < 12; t++) {
    for (const mode of ['major', 'minor'] as const) {
      const diatonic = mode === 'major' ? MAJOR_DIATONIC : MINOR_DIATONIC
      let score = 0
      chords.forEach((c, i) => {
        const off = (((c.rootPc - t) % 12) + 12) % 12
        const hit = diatonic.find((r) => r.offset === off)
        if (hit) score += FAMILY[hit.type] === FAMILY[c.quality] || FAMILY[c.quality] === 'other' ? 2 : 0.5
        if (i === 0 && off === 0) score += 1.5
        if (i === chords.length - 1 && off === 0) score += 1
      })
      if (score > best.score) best = { tonicPc: t, mode, score }
    }
  }
  return { tonicPc: best.tonicPc, mode: best.mode }
}
