/**
 * Turning any score (library song or import) into guitar practice (pure):
 * a strumming chart for the practice desk and a tab for the lead player.
 */
import type { RomanId } from '@/music/keys'
import { chordAt, type Score } from '@/music/score'
import { fingerMelody, type Tuning } from '@/music/fretboard'
import type { TabNote } from '@/guitar/scales'

/** Minor roman → the same chord in the relative major (the practice desk works in major keys). */
export const RELATIVE_MAJOR: Partial<Record<RomanId, RomanId>> = { i: 'vi', 'ii°': 'vii°', III: 'I', iv: 'ii', v: 'iii', V: 'III', VI: 'IV', VII: 'V' }

export interface StrumChart {
  /** Major-key tonic for the practice desk. */
  tonic: number
  /** One chord per bar (the chord sounding on beat 1). */
  romans: RomanId[]
  /** Bars without a chord were filled with the previous chord. */
  filled: number
}

/** One chord per bar from `fromBar`, `bars` long. Null when the score has no chords. */
export function strumChart(score: Score, fromBar = 0, bars = score.bars): StrumChart | null {
  if (!score.chords.length) return null
  const minor = score.mode === 'minor'
  const tonic = minor ? score.keyTonic + 3 : score.keyTonic
  const romans: RomanId[] = []
  let filled = 0
  let prev: RomanId | null = null
  for (let b = fromBar; b < Math.min(score.bars, fromBar + bars); b++) {
    const slot = chordAt(score, b * score.beatsPerBar) ?? score.chords.find((c) => c.start >= b * 4 && c.start < b * 4 + 4)
    let roman: RomanId | null = slot ? (minor ? (RELATIVE_MAJOR[slot.roman] ?? null) : slot.roman) : null
    if (!roman) {
      roman = prev
      filled++
    }
    if (roman) {
      romans.push(roman)
      prev = roman
    }
  }
  return romans.length ? { tonic, romans, filled } : null
}

/**
 * Melody of bars [fromBar, fromBar + bars) as guitar tab: shifted by octaves
 * into the guitar's comfortable range, then fingered in one hand position
 * where possible. Rests become part of the previous note's length.
 */
export function melodyTab(score: Score, tuning: Tuning, fromBar = 0, bars = 8): { notes: TabNote[]; shift: number } {
  const from = fromBar * score.beatsPerBar
  const to = from + bars * score.beatsPerBar
  const notes = score.melody.filter((n) => n.start >= from && n.start < to).sort((a, b) => a.start - b.start)
  if (!notes.length) return { notes: [], shift: 0 }
  const avg = notes.reduce((s, n) => s + n.midi, 0) / notes.length
  // Aim the average at about G4 (67) and keep everything above the low string.
  let shift = Math.round((67 - avg) / 12) * 12
  const low = Math.min(...notes.map((n) => n.midi))
  while (low + shift < tuning.strings[0]!) shift += 12
  const positions = fingerMelody(
    notes.map((n) => n.midi + shift),
    tuning,
    15,
  )
  const out: TabNote[] = []
  notes.forEach((n, i) => {
    const p = positions[i]
    if (!p) return
    const next = notes[i + 1]
    const beats = (next ? Math.min(next.start, to) : Math.min(n.start + n.beats, to)) - n.start
    out.push({ string: p.string, fret: p.fret, beats: Math.max(0.25, Math.round(beats * 4) / 4) })
  })
  return { notes: out, shift }
}
