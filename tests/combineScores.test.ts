import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { DrumPart } from '@/songs/drumTypes'
import { buildDrumTrack } from '@/songs/drumScore'
import {
  barFingerprint,
  combine,
  compareVersions,
  estimateOffset,
  estimateOffsetForScores,
  exportCombined,
  playbackOrder,
  sectionAlign,
  songFingerprint,
  unrollRepeats,
  unrollRepeatsWithMap,
} from '@/songs/combineScores'

const HEADER = String.raw`\title "Combo test" \tempo 120 \ts 4 4
\track "Guitar"
\tuning (E4 B3 G3 D3 A2 E2)
`

/** Eight distinct 4/4 bars (rhythm differs per bar so offsets are identifiable). */
const MELODY = [
  '3.3.4 3.3.4 3.3.4 3.3.4',
  '3.3.2 3.3.2',
  '3.3.8 3.3.8 3.3.8 3.3.8 3.3.8 3.3.8 3.3.8 3.3.8',
  '3.3.4 r.4 3.3.4 r.4',
  '3.3.2 r.2',
  'r.4 3.5.4 3.5.4 3.5.4',
  '3.3.1',
  '3.5.4 3.5.8 3.5.8 3.5.2',
]

function tex(bars: string[], header = HEADER): string {
  return `${header}${bars.join(' |')}|`
}

function load(source: string): at.model.Score {
  return at.importer.ScoreLoader.loadAlphaTex(source)
}

/** NoteOn events of one track's MIDI channel as [tick, key, velocity], sorted. */
function noteOnsOf(score: at.model.Score, trackIndex: number): Array<[number, number, number]> {
  const channel = score.tracks[trackIndex].playbackInfo.primaryChannel
  const midi = new at.midi.MidiFile()
  const handler = new at.midi.AlphaSynthMidiFileHandler(midi)
  new at.midi.MidiFileGenerator(score, new at.Settings(), handler).generate()
  return midi.events
    .filter((e) => e.constructor.name === 'NoteOnEvent' && (e as unknown as { channel: number }).channel === channel)
    .map((e) => {
      const n = e as unknown as { tick: number; noteKey: number; noteVelocity: number }
      return [n.tick, n.noteKey, n.noteVelocity] as [number, number, number]
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

const BAR_TICKS = 960 * 4

describe('unrollRepeats', () => {
  // Bars 0-3 repeated twice (\ro on bar 0, \rc 2 on bar 3).
  const REPEATED = MELODY.map((b, i) => (i === 0 ? `\\ro ${b}` : i === 3 ? `\\rc 2 ${b}` : b))

  it('expands a simple repeat into the playback order', () => {
    const score = load(tex(REPEATED))
    expect(playbackOrder(score)).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7])

    const unrolled = unrollRepeatsWithMap(at, score)
    expect(unrolled.score.masterBars.length).toBe(12)
    expect(unrolled.originalBar).toEqual([0, 1, 2, 3, 0, 1, 2, 3, 4, 5, 6, 7])
    expect(unrolled.score.masterBars.every((mb) => !mb.isRepeatStart && mb.repeatCount === 0)).toBe(true)
    expect(unrolled.score.tracks[0].staves[0].bars.length).toBe(12)
  })

  it('plays the same notes at the same ticks as alphaTab does with repeats', () => {
    const score = load(tex(REPEATED))
    const unrolled = unrollRepeats(at, score)
    expect(noteOnsOf(unrolled, 0)).toEqual(noteOnsOf(score, 0))
  })

  it('resolves alternate endings like alphaTab', () => {
    // Bars 0-2 repeat twice; bar 2 is ending 1, bar 3 is ending 2.
    const bars = MELODY.slice(0, 6).map((b, i) => {
      if (i === 0) return `\\ro ${b}`
      if (i === 2) return `\\rc 2 \\ae 1 ${b}`
      if (i === 3) return `\\ae 2 ${b}`
      return b
    })
    const score = load(tex(bars))
    expect(playbackOrder(score)).toEqual([0, 1, 2, 0, 1, 3, 4, 5])
    const unrolled = unrollRepeats(at, score)
    expect(noteOnsOf(unrolled, 0)).toEqual(noteOnsOf(score, 0))
  })

  it('does not change the input score', () => {
    const score = load(tex(REPEATED))
    unrollRepeats(at, score)
    expect(score.masterBars.length).toBe(8)
    expect(score.masterBars[0].isRepeatStart).toBe(true)
  })
})

describe('fingerprints and offsets', () => {
  const base = load(tex(MELODY))
  // The part starts at base bar 2: part bar j is base bar j + 2, so base bar i takes part bar i - 2.
  const part = load(tex(MELODY.slice(2)))

  it('gives unit vectors per bar, zero for silent bars', () => {
    const fp = barFingerprint(base, 0)
    expect(fp.length).toBe(8)
    expect(Math.hypot(...fp[0])).toBeCloseTo(1, 6)
    const silent = load(tex(['r.1', '3.3.4 3.3.4 3.3.4 3.3.4']))
    expect(barFingerprint(silent, 0)[0].every((x) => x === 0)).toBe(true)
  })

  it('songFingerprint sums the non-percussion tracks', () => {
    expect(songFingerprint(base).length).toBe(8)
  })

  it('estimateOffset finds the shift of a part that starts later', () => {
    const r = estimateOffset(songFingerprint(base), songFingerprint(part))
    expect(r.offsetBars).toBe(2)
    expect(r.score).toBeGreaterThan(0.99)
  })

  it('estimateOffsetForScores finds the same shift', () => {
    expect(estimateOffsetForScores(base, part).offsetBars).toBe(2)
  })

  it('prefers zero for identical versions', () => {
    expect(estimateOffsetForScores(base, load(tex(MELODY))).offsetBars).toBe(0)
  })

  it('sectionAlign uses matching section names', () => {
    const sectioned = (bars: string[], names: Record<number, string>) =>
      load(tex(bars.map((b, i) => (names[i] ? `\\section "${names[i]}" ${b}` : b))))
    const a = sectioned(MELODY, { 4: '副歌' })
    const b = sectioned(MELODY.slice(2), { 2: 'Chorus' })
    expect(sectionAlign(a, b)).toBe(2)
    expect(sectionAlign(base, part)).toBeNull()
  })
})

describe('compareVersions', () => {
  it('reports bar counts, tempo, meter mismatches and repeats', () => {
    const base = load(tex(MELODY))
    const partBars = [...MELODY.slice(0, 3), '\\ts 3 4 3.3.4 3.3.4 3.3.4', '\\ts 4 4 ' + MELODY[3], ...MELODY.slice(4)]
    const part = load(tex(partBars, HEADER.replace('\\tempo 120', '\\tempo 100')))
    const cmp = compareVersions(base, part)
    expect(cmp.bars).toEqual([8, 9])
    expect(cmp.tempo).toEqual([120, 100])
    expect(cmp.timeSignatureMismatches).toEqual([3])
    expect(cmp.hasRepeats).toEqual([false, false])
    expect(compareVersions(base, load(tex(['\\ro ' + MELODY[0], ...MELODY.slice(1)]))).hasRepeats).toEqual([false, true])
  })
})

describe('combine', () => {
  const base = load(tex(MELODY))
  const bassSource = tex(MELODY.slice(2)).replace('"Guitar"', '"Bass"')

  it('places the part on the base bars with rests outside it and transposes it', () => {
    const part = load(bassSource)
    const plain = combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 2, transpose: 0 }], { keepBaseTracks: [0] })
    const up = combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 2, transpose: 2 }], { keepBaseTracks: [0] })
    const score = up.score

    expect(score.masterBars.length).toBe(8)
    expect(score.tracks.map((t) => t.name)).toEqual(['Guitar', '贝斯'])
    expect(up.warnings).toEqual([])

    const partNotes = noteOnsOf(plain.score, 1)
    expect(partNotes.length).toBeGreaterThan(0)
    expect(partNotes.every(([tick]) => tick >= 2 * BAR_TICKS)).toBe(true)
    // Transposed by +2 semitones and not moved in time.
    expect(noteOnsOf(score, 1)).toEqual(partNotes.map(([t, k, v]) => [t, k + 2, v]))
  })

  it('keeps the base bars and tempo and gives each track its own channel', () => {
    const part = load(bassSource)
    const { score } = combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 2, transpose: 0 }], { keepBaseTracks: [0] })
    expect(score.tempo).toBe(120)
    const channels = score.tracks.map((t) => t.playbackInfo.primaryChannel)
    expect(new Set(channels).size).toBe(channels.length)
    expect(channels).not.toContain(9)
    expect(noteOnsOf(score, 0)).toEqual(noteOnsOf(base, 0))
  })

  it('leaves a whole-bar rest and a warning where the time signature differs', () => {
    const part = load(tex(['\\ts 3 4 3.3.4 3.3.4 3.3.4', '\\ts 4 4 ' + MELODY[1], ...MELODY.slice(2)]).replace('"Guitar"', '"Bass"'))
    const { score, warnings } = combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 0, transpose: 0 }], { keepBaseTracks: [] })
    expect(warnings).toEqual(['贝斯第 1 小节拍号不同，已留空'])
    const notes = noteOnsOf(score, 0)
    expect(notes.some(([tick]) => tick < BAR_TICKS)).toBe(false)
  })

  it('does not transpose percussion', () => {
    const drumPart: DrumPart = {
      version: 1,
      path: 'test.gp',
      title: 'Combo test',
      artist: 'Tester',
      source: 'hand',
      edited: true,
      style: null,
      updatedAt: 0,
      updatedBy: 'tester',
      bars: MELODY.map(() => ({ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 0, piece: 'kick' as const, vel: 2 as const }, { step: 4, piece: 'snare' as const, vel: 2 as const }] })),
    }
    const host = load(tex(MELODY))
    buildDrumTrack(at, host, drumPart)
    const drumIndex = host.tracks.length - 1
    const drumNotes = noteOnsOf(host, drumIndex)
    expect(drumNotes.length).toBeGreaterThan(0)
    const { score, warnings } = combine(at, base, [{ score: host, track: drumIndex, name: '鼓', offsetBars: 0, transpose: 5 }], { keepBaseTracks: [0] })
    expect(warnings).toEqual([])
    expect(score.tracks[1].isPercussion).toBe(true)
    expect(score.tracks[1].playbackInfo.primaryChannel).toBe(9)
    expect(noteOnsOf(score, 1)).toEqual(drumNotes)
  })

  it('exports bytes that reload with the same tracks', () => {
    const part = load(bassSource)
    const { score } = combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 2, transpose: 2 }], { keepBaseTracks: [0] })
    const bytes = exportCombined(at, score)
    const reloaded = at.importer.ScoreLoader.loadScoreFromBytes(bytes)
    expect(reloaded.tracks.map((t) => t.name)).toEqual(['Guitar', '贝斯'])
    expect(reloaded.masterBars.length).toBe(8)
  })

  it('does not mutate the inputs', () => {
    const part = load(bassSource)
    const before = noteOnsOf(part, 0)
    combine(at, base, [{ score: part, track: 0, name: '贝斯', offsetBars: 2, transpose: 3 }], { keepBaseTracks: [0] })
    expect(noteOnsOf(part, 0)).toEqual(before)
    expect(base.tracks.length).toBe(1)
  })
})

/** First folder under the guitar library holding exactly two Guitar Pro files, or null. */
function findTwoVersionFolder(root: string, budget = { dirs: 4000 }): string[] | null {
  if (budget.dirs-- <= 0) return null
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return null
  }
  const gp = entries.filter((e) => /\.(gp5|gp|gp4|gpx)$/i.test(e))
  if (gp.length === 2) return gp.map((e) => join(root, e))
  for (const e of entries) {
    const full = join(root, e)
    try {
      if (!statSync(full).isDirectory()) continue
    } catch {
      continue
    }
    const found = findTwoVersionFolder(full, budget)
    if (found) return found
  }
  return null
}

describe('real versions (skipped when the library is absent)', () => {
  const LIBRARY = 'F:\\吉他谱\\吉他谱库\\1-华语'
  it('estimates the offset between two real versions of one song', () => {
    if (!existsSync(LIBRARY)) return
    const pair = findTwoVersionFolder(LIBRARY)
    if (!pair) return
    const load2 = (p: string) => at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(p)))
    let a: at.model.Score
    let b: at.model.Score
    try {
      a = load2(pair[0])
      b = load2(pair[1])
    } catch {
      return
    }
    const r = estimateOffsetForScores(a, b)
    console.log(`[combineScores] ${pair[0]} vs ${pair[1]}: offsetBars=${r.offsetBars} score=${r.score.toFixed(3)}`)
    expect(Number.isFinite(r.offsetBars)).toBe(true)
  })
})
