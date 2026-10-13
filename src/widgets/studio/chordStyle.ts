import { MAJOR_BORROWED, MAJOR_DIATONIC, MAJOR_SECONDARY, MINOR_DIATONIC, type RomanChord, type RomanId } from '@/music/keys'
import { diatonicSeventh, type Mode } from '@/music/keys'
import type { ChordTypeId } from '@/music/chords'

export type ChordColour = 'triad' | 'seventh' | 'dom7' | 'sus2' | 'sus4' | 'add9' | 'power'

export const COLOUR_LABEL: Record<ChordColour, string> = {
  triad: '三和弦',
  seventh: '七和弦',
  dom7: '属七',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'add9',
  power: '强力 5',
}

/** Palette button classes by harmonic function. */
export const FUNC_BUTTON: Record<RomanChord['func'], string> = {
  主: 'border-amber/60 bg-amber-soft/40',
  下属: 'border-cyan/50 bg-cyan-soft/30',
  属: 'border-destructive/50 bg-destructive/10',
  借用: 'border-border bg-accent',
  副属: 'border-border bg-accent',
}

/** SVG fill / stroke classes for chord blocks in the piano-roll lane. */
export const FUNC_BLOCK: Record<RomanChord['func'], string> = {
  主: 'fill-[hsl(var(--amber-soft))] stroke-[hsl(var(--amber)/0.7)]',
  下属: 'fill-[hsl(var(--cyan-soft))] stroke-[hsl(var(--cyan)/0.6)]',
  属: 'fill-[hsl(var(--destructive)/0.15)] stroke-[hsl(var(--destructive)/0.6)]',
  借用: 'fill-[hsl(var(--accent))] stroke-[hsl(var(--border))]',
  副属: 'fill-[hsl(var(--accent))] stroke-[hsl(var(--border))]',
}

export function chordFunc(mode: Mode, roman: RomanId): RomanChord['func'] {
  const pool = mode === 'major' ? [...MAJOR_DIATONIC, ...MAJOR_BORROWED, ...MAJOR_SECONDARY] : MINOR_DIATONIC
  return pool.find((c) => c.roman === roman)?.func ?? '借用'
}

/** Chord quality for a palette colour on a roman numeral; undefined keeps the diatonic triad. */
export function colourQuality(colour: ChordColour, roman: RomanId, mode: Mode): ChordTypeId | undefined {
  switch (colour) {
    case 'triad':
      return undefined
    case 'seventh':
      return diatonicSeventh(roman, mode)
    default:
      return colour
  }
}
