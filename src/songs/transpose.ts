/**
 * 变调 (pure): move a song up or down by semitones.
 *
 * Scores: the key, the melody and hand-written parts move; chords are roman
 * numerals, so they follow the key by themselves; drums never move.
 * Tabs: for guitarists there are two ways to play a transposed song —
 * keep the shapes and put a capo on (up), or move every fret (any direction).
 */
import type { Score } from '@/music/score'
import type { TabNote } from '@/guitar/scales'
import { keyName } from '@/music/keys'

export const TRANSPOSE_MIN = -6
export const TRANSPOSE_MAX = 6
/** Highest fret a moved note may land on before it is folded down an octave. */
export const MAX_FRET = 22

export function clampTranspose(n: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, Math.round(n) || 0))
}

export function transposeScore(score: Score, n: number): Score {
  if (!n) return score
  return {
    ...score,
    keyTonic: score.keyTonic + n,
    melody: score.melody.map((x) => ({ ...x, midi: x.midi + n })),
    ...(score.tracks ? { tracks: score.tracks.map((t) => (t.kind === 'drums' ? t : { ...t, notes: t.notes.map((x) => ({ ...x, midi: x.midi + n })) })) } : {}),
  }
}

/** Every fret moved by n; a note that would fall off the neck moves an octave (same pitch class). */
export function transposeTab(notes: readonly TabNote[], n: number): TabNote[] {
  if (!n) return [...notes]
  return notes.map((x) => {
    let fret = x.fret + n
    while (fret < 0) fret += 12
    while (fret > MAX_FRET) fret -= 12
    return { ...x, fret }
  })
}

/** "+2" / "−3" / "原调". */
export function transposeLabel(n: number): string {
  return n === 0 ? '原调' : n > 0 ? `升 ${n} 个半音` : `降 ${-n} 个半音`
}

/** Key name after transposing, e.g. "C 大调" → "D 大调". */
export function transposedKey(tonic: number, mode: 'major' | 'minor', n: number): string {
  return keyName(tonic + n, mode)
}

export type GuitarWay = 'capo' | 'frets'

/** The natural way to play it: up with a capo when it fits on the neck, otherwise move the frets. */
export function defaultWay(n: number, sheetCapo = 0): GuitarWay {
  return n > 0 && sheetCapo + n <= 9 ? 'capo' : 'frets'
}
