import { describe, expect, it } from 'vitest'
import type { DrumBar, DrumPiece, DrumTemplateLibrary, SongBarInfo } from '@/songs/drumTypes'
import { generateFromTemplates } from '@/songs/drumGenerate'

function bar(num: number, den: number, spq: 3 | 4 | 6, hits: Array<[number, DrumPiece, (1 | 2 | 3)?]>): DrumBar {
  return { num, den, stepsPerQuarter: spq, hits: hits.map(([step, piece, vel = 2]) => ({ step, piece, vel })) }
}

/** Tiny library: 4/4 rock (sparse, slow), 4/4 funk (16ths, fast), 12/8 shuffle (triplets). */
const LIB: DrumTemplateLibrary = {
  version: 1,
  source: 'test',
  license: 'test',
  styles: [
    {
      id: 'rock8',
      zh: '摇滚',
      meter: '4/4',
      minBpm: 60,
      maxBpm: 80,
      grooves: [{ bars: [bar(4, 4, 4, [[0, 'hihatClosed'], [4, 'hihatClosed'], [8, 'hihatClosed'], [12, 'hihatClosed'], [0, 'kick'], [8, 'kick'], [4, 'snare'], [12, 'snare']])], weight: 1 }],
      chorus: [{ bars: [bar(4, 4, 4, [[2, 'ride'], [6, 'ride'], [10, 'ride'], [14, 'ride'], [0, 'kick'], [4, 'snare'], [12, 'snare']])], weight: 1 }],
      fills: [{ bars: [bar(4, 4, 4, [[0, 'kick'], [8, 'snare'], [10, 'snare'], [12, 'tomFloor', 3], [14, 'tomFloor']])], weight: 1 }],
    },
    {
      id: 'funk16',
      zh: '放克',
      meter: '4/4',
      minBpm: 90,
      maxBpm: 120,
      grooves: [
        {
          bars: [
            bar(4, 4, 4, Array.from({ length: 16 }, (_, s): [number, DrumPiece] => [s, 'hihatClosed'])),
            bar(4, 4, 4, [[0, 'kick'], [6, 'kick'], [10, 'kick'], [14, 'kick'], [4, 'snare'], [12, 'snare']]),
          ],
          weight: 1,
        },
      ],
      chorus: [],
      fills: [{ bars: [bar(4, 4, 4, [[12, 'tomFloor', 2]])], weight: 1 }],
    },
    {
      id: 'shuffle12',
      zh: '摇摆 12/8',
      meter: '12/8',
      minBpm: 60,
      maxBpm: 80,
      grooves: [{ bars: [bar(12, 8, 3, [0, 3, 6, 9, 12, 15].map((s): [number, DrumPiece] => [s, 'hihatClosed']))], weight: 1 }],
      chorus: [],
      fills: [{ bars: [bar(12, 8, 3, [[16, 'snare']])], weight: 1 }],
    },
  ],
}

function mk(num = 4, den = 4, over: Partial<SongBarInfo> = {}): SongBarInfo {
  return { num, den, bpm: 70, section: null, onsets: [{ at: 0, vel: 100 }, { at: 1, vel: 100 }], triplet: false, ...over }
}

function songOf(n: number, f: (i: number) => Partial<SongBarInfo> = () => ({})): SongBarInfo[] {
  return Array.from({ length: n }, (_, i) => mk(4, 4, f(i)))
}

const has = (b: DrumBar, step: number, piece: DrumPiece) => b.hits.some(h => h.step === step && h.piece === piece)

describe('drumGenerate: style choice', () => {
  it('picks a style by meter and tempo, triplet feel and busyness', () => {
    expect(generateFromTemplates(songOf(4), LIB, { style: null, seed: 1 }).style).toBe('rock8')
    expect(generateFromTemplates(songOf(4, () => ({ bpm: 100, onsets: Array.from({ length: 12 }, (_, k) => ({ at: k / 4, vel: 90 })) })), LIB, { style: null, seed: 1 }).style).toBe('funk16')
    const shuffle = songOf(4, () => ({ num: 12, den: 8, triplet: true }))
    expect(generateFromTemplates(shuffle, LIB, { style: null, seed: 1 }).style).toBe('shuffle12')
  })

  it('uses the requested style id and rejects an unknown one', () => {
    expect(generateFromTemplates(songOf(4), LIB, { style: 'funk16', seed: 1 }).style).toBe('funk16')
    expect(() => generateFromTemplates(songOf(4), LIB, { style: 'nope', seed: 1 })).toThrow(/nope/)
  })
})

describe('drumGenerate: sections', () => {
  it('puts a crash on step 0 at section starts, except the first bar of an intro', () => {
    const song = songOf(6, i => (i === 0 ? { section: 'Intro' } : i === 2 ? { section: '副歌' } : {}))
    const { bars } = generateFromTemplates(song, LIB, { style: 'rock8', seed: 3 })
    expect(has(bars[0]!, 0, 'crash')).toBe(false)
    expect(has(bars[2]!, 0, 'crash')).toBe(true)
    expect(bars[2]!.hits.find(h => h.step === 0 && h.piece === 'crash')?.vel).toBe(3)
    expect(has(bars[2]!, 0, 'hihatClosed')).toBe(false)
  })

  it('uses the chorus variant in chorus sections', () => {
    const song = songOf(6, i => (i === 2 ? { section: '副歌' } : {}))
    const { bars } = generateFromTemplates(song, LIB, { style: 'rock8', seed: 3 })
    expect(has(bars[3]!, 2, 'ride')).toBe(true)
    expect(has(bars[0]!, 2, 'ride')).toBe(false)
  })

  it('crashes the first bar of an unnamed song and puts a fill on the last bar of an 8-bar phrase', () => {
    const { bars } = generateFromTemplates(songOf(8), LIB, { style: 'rock8', seed: 5 })
    expect(has(bars[0]!, 0, 'crash')).toBe(true)
    expect(has(bars[7]!, 12, 'tomFloor')).toBe(true)
    expect(has(bars[6]!, 12, 'tomFloor')).toBe(false)
  })

  it('does not put a fill on sections of only 1-2 bars', () => {
    const { bars } = generateFromTemplates(songOf(2), LIB, { style: 'rock8', seed: 5 })
    expect(bars[1]!.hits.some(h => h.piece === 'tomFloor')).toBe(false)
  })

  it('thins the first half of an intro section', () => {
    // a groove with eighth-note hi-hats, so thinning is visible
    const eighths = LIB.styles[0]!
    const eighthLib: DrumTemplateLibrary = {
      ...LIB,
      styles: [
        {
          ...eighths,
          grooves: [
            {
              bars: [
                bar(4, 4, 4, [
                  ...Array.from({ length: 8 }, (_, k): [number, DrumPiece] => [2 * k, 'hihatClosed']),
                  [0, 'kick'],
                  [4, 'snare'],
                  [12, 'snare'],
                ]),
              ],
              weight: 1,
            },
          ],
        },
        ...LIB.styles.slice(1),
      ],
    }
    const song = songOf(4, i => (i === 0 ? { section: 'Intro' } : i === 2 ? { section: 'Verse' } : {}))
    const { bars } = generateFromTemplates(song, eighthLib, { style: 'rock8', seed: 1 })
    // first half of the intro (bar 0): quarter notes only; second half (bar 1) and the verse keep eighths
    expect(bars[0]!.hits.some(h => h.step % 4 !== 0)).toBe(false)
    expect(has(bars[0]!, 0, 'kick')).toBe(true)
    expect(has(bars[1]!, 2, 'hihatClosed')).toBe(true)
    expect(has(bars[2]!, 2, 'hihatClosed')).toBe(true)
  })
})

describe('drumGenerate: meter, breaks, range, determinism', () => {
  it('builds a fitting bar where the song meter differs from the style', () => {
    const song = songOf(8, i => (i === 3 ? { num: 12, den: 8 } : {}))
    const { bars } = generateFromTemplates(song, LIB, { style: 'rock8', seed: 2 })
    const b = bars[3]!
    expect(b.num).toBe(12)
    expect(b.den).toBe(8)
    expect(has(b, 0, 'kick')).toBe(true)
    expect(has(b, 0, 'hihatClosed')).toBe(true)
    expect(b.hits.some(h => h.piece === 'snare')).toBe(true)
  })

  it('makes empty bars for guide breaks and a crash on the first bar after the break', () => {
    const song = songOf(8, i => (i === 1 || i === 2 ? { onsets: [] } : {}))
    const { bars } = generateFromTemplates(song, LIB, { style: 'rock8', seed: 4 })
    expect(bars[1]!.hits).toEqual([])
    expect(bars[2]!.hits).toEqual([])
    expect(has(bars[3]!, 0, 'crash')).toBe(true)
  })

  it('generates only the range but gives the same bars as the whole song', () => {
    const song = songOf(10, i => (i === 4 ? { section: 'Chorus' } : i === 7 ? { onsets: [] } : {}))
    const whole = generateFromTemplates(song, LIB, { style: null, seed: 9 })
    const part = generateFromTemplates(song, LIB, { style: null, seed: 9, range: [3, 6] })
    expect(part.first).toBe(3)
    expect(part.style).toBe(whole.style)
    expect(part.bars).toEqual(whole.bars.slice(3, 7))
  })

  it('is deterministic for the same seed', () => {
    const song = songOf(16, i => (i % 8 === 4 ? { section: 'Verse' } : {}))
    const a = generateFromTemplates(song, LIB, { style: 'rock8', seed: 42 })
    const b = generateFromTemplates(song, LIB, { style: 'rock8', seed: 42 })
    expect(a).toEqual(b)
  })

  it('returns no bars for an empty song or an empty range', () => {
    expect(generateFromTemplates([], LIB, { style: null, seed: 1 }).bars).toEqual([])
    expect(generateFromTemplates(songOf(4), LIB, { style: null, seed: 1, range: [3, 1] }).bars).toEqual([])
  })
})
