/**
 * Plain-text chord charts → a score with one chord track (pure).
 *
 * Accepted:
 *   | C | G | Am F | G |        bars with "|", two chords share a bar
 *   C G Am F                     one chord per bar
 *   [C]我们的[G]歌词…             chords in brackets inside lyrics (one per bar)
 * Section labels like "主歌:" or "[Verse]" are skipped; anything that is not a
 * chord is ignored and reported.
 */
import { emptyScore, type ChordSlot, type Score } from '@/music/score'
import type { Mode } from '@/music/keys'
import { chordToRoman, guessKey, parseChord, type ParsedChord } from './chordSymbols'

export interface ChordChartResult {
  score: Score
  /** Chords that could not be placed (root not a supported step in this key). */
  unsupported: string[]
  /** Tokens that were not chords (lyrics, labels). */
  ignored: number
  key: { tonicPc: number; mode: Mode }
}

const SECTION = /^(\[?(verse|chorus|bridge|intro|outro|pre-?chorus|主歌|副歌|桥段|前奏|尾奏|间奏)\]?[:：]?)$/i

/** Bars of chords: each bar is a list of chord tokens. */
export function chartBars(text: string): { bars: string[][]; ignored: number } {
  const bars: string[][] = []
  let ignored = 0
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line || SECTION.test(line)) continue
    const bracketed = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.trim())
    if (bracketed.length && bracketed.some((t) => parseChord(t))) {
      for (const t of bracketed) {
        if (parseChord(t)) bars.push([t])
        else ignored++
      }
      continue
    }
    const segments = line.includes('|') ? line.split('|') : line.split(/\s+/).map((t) => t)
    for (const seg of segments) {
      const tokens = seg.trim().split(/\s+/).filter(Boolean)
      if (!tokens.length) continue
      const chords = tokens.filter((t) => parseChord(t))
      ignored += tokens.length - chords.length
      if (!chords.length) continue
      if (line.includes('|')) bars.push(chords.slice(0, 4))
      else for (const c of chords) bars.push([c])
    }
  }
  return { bars, ignored }
}

export function chordChartToScore(text: string, opts: { key?: { tonicPc: number; mode: Mode }; bpm?: number; maxBars?: number } = {}): ChordChartResult {
  const { bars, ignored } = chartBars(text)
  const limited = bars.slice(0, opts.maxBars ?? 80)
  const parsed = limited.map((b) => b.map((t) => parseChord(t)!))
  const key = opts.key ?? guessKey(parsed.flat())
  // Tonic between F3 and E4, where chords voice comfortably.
  const tonic = 53 + ((key.tonicPc - 5 + 12) % 12)
  const chords: ChordSlot[] = []
  const unsupported: string[] = []
  parsed.forEach((bar, b) => {
    // 1, 2 or 4 chords share the bar evenly; 3 chords get 2 + 1 + 1 beats.
    const lens = bar.length === 3 ? [2, 1, 1] : bar.map(() => 4 / bar.length)
    const starts = lens.map((_, i) => lens.slice(0, i).reduce((x, y) => x + y, 0))
    bar.forEach((c: ParsedChord, i) => {
      const len = lens[i]!
      const spec = chordToRoman(c, key.tonicPc, key.mode)
      if (!spec) {
        unsupported.push(c.symbol)
        return
      }
      chords.push({ start: b * 4 + starts[i]!, beats: len, roman: spec.roman, ...(spec.quality ? { quality: spec.quality } : {}), ...(spec.bass ? { bass: spec.bass } : {}) })
    })
  })
  const score = emptyScore({ keyTonic: tonic, mode: key.mode, bpm: opts.bpm ?? 90, bars: Math.max(1, limited.length), chords, accompaniment: { comp: 'strum', bass: 'roots', drums: 'pop' } })
  return { score, unsupported: Array.from(new Set(unsupported)), ignored, key }
}
