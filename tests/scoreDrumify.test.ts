// @vitest-environment node
import { describe, expect, it } from 'vitest'
import drumTemplates from '../src/songs/drumTemplates.json' with { type: 'json' }
import type { DrumTemplateLibrary, SongBarInfo } from '../src/songs/drumTypes'
import {
  drumify,
  drumifyAvailable,
  fillBarIndices,
  notesToBars,
  planWindows,
  sectionStarts,
  velocityLevel,
  windowSignature,
  windowToNoteSequence,
  withCrash,
} from '../server/drumify'

function bar(over: Partial<SongBarInfo> = {}): SongBarInfo {
  return { num: 4, den: 4, bpm: 120, section: null, onsets: [], triplet: false, ...over }
}

/** Eighth-note guitar rhythm: 8 onsets per bar. */
function eighthBar(over: Partial<SongBarInfo> = {}): SongBarInfo {
  return bar({ onsets: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5].map((at) => ({ at, vel: 90 })), ...over })
}

describe('Drumify window planning', () => {
  it('starts sections at markers, or every 8 bars without markers', () => {
    const marked = [bar({ section: 'Verse' }), bar(), bar({ section: 'Chorus' }), bar()]
    expect([...sectionStarts(marked)].sort((a, b) => a - b)).toEqual([0, 2])
    const plain = Array.from({ length: 20 }, () => bar())
    expect([...sectionStarts(plain)].sort((a, b) => a - b)).toEqual([0, 8, 16])
  })

  it('marks the last bar of every section as a fill bar', () => {
    const starts = new Set([0, 4, 8])
    expect([...fillBarIndices(Array.from({ length: 10 }, () => bar()), starts)].sort((a, b) => a - b)).toEqual([3, 7, 9])
  })

  it('pairs bars into 2-bar windows that line up with sections', () => {
    const song = Array.from({ length: 10 }, () => bar())
    const starts = new Set([0, 4, 8])
    expect(planWindows(song, 0, 9, starts, () => false)).toEqual([[0, 1], [2, 3], [4, 5], [6, 7], [8, 9]])
  })

  it('skips fill bars, non-4/4 and triplet bars, and clips to the range', () => {
    const song = [bar(), bar(), bar({ num: 3 }), bar(), bar({ triplet: true }), bar(), bar()]
    const starts = new Set([0])
    expect(planWindows(song, 0, 6, starts, (i) => i === 5)).toEqual([[0, 1], [3], [6]])
    expect(planWindows(song, 1, 3, starts, () => false)).toEqual([[1], [3]])
  })
})

describe('Drumify conversions', () => {
  it('builds a 2-bar NoteSequence from the guide onsets at the window tempo', () => {
    const seq = windowToNoteSequence([bar(), bar({ onsets: [{ at: 0.5, vel: 90 }] })], 120)
    expect(seq.totalTime).toBeCloseTo(4)
    expect(seq.tempos).toEqual([{ time: 0, qpm: 120 }])
    expect(seq.notes).toHaveLength(1)
    expect(seq.notes[0].startTime).toBeCloseTo(18 * 0.125)
    expect(seq.notes[0].velocity).toBe(90)
  })

  it('converts model notes to drum hits on the sixteenth grid, bar by bar', () => {
    const bars = notesToBars(
      [
        { pitch: 36, startTime: 0, velocity: 100 },
        { pitch: 35, startTime: 0.01, velocity: 120 }, // alternate kick key, merged into one hit
        { pitch: 42, startTime: 0.5, velocity: 60 },
        { pitch: 60, startTime: 0.25, velocity: 100 }, // not a drum key: dropped
        { pitch: 38, startTime: 18 * 0.125 + 0.002, velocity: 40 }, // bar 2, step 2, ghost snare
      ],
      120,
      [true, true],
    )
    expect(bars).toHaveLength(2)
    expect(bars[0].hits).toEqual([
      { step: 0, piece: 'kick', vel: 3 },
      { step: 4, piece: 'hihatClosed', vel: 2 },
    ])
    expect(bars[1].hits).toEqual([{ step: 2, piece: 'snare', vel: 1 }])
    expect(notesToBars([{ pitch: 36, startTime: 2.25, velocity: 100 }], 120, [true, false])[1].hits).toEqual([])
  })

  it('maps velocities to ghost, normal and accent', () => {
    expect([velocityLevel(49), velocityLevel(50), velocityLevel(105), velocityLevel(106)]).toEqual([1, 2, 2, 3])
  })

  it('adds one accent crash on step 0 without duplicating it', () => {
    const once = withCrash({ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 0, piece: 'crash', vel: 1 }] })
    expect(once.hits).toEqual([{ step: 0, piece: 'crash', vel: 3 }])
  })

  it('gives identical guide rhythms the same latent key', () => {
    expect(windowSignature([eighthBar(), bar()], 120)).toBe(windowSignature([eighthBar(), bar()], 120))
    expect(windowSignature([eighthBar(), bar()], 120)).not.toBe(windowSignature([eighthBar(), bar()], 100))
  })
})

describe('Drumify model run', () => {
  it('reports whether the checkpoint is present', () => {
    expect(typeof drumifyAvailable()).toBe('boolean')
  })

  it.skipIf(!drumifyAvailable())(
    'generates a 4-bar guitar rhythm with kick, snare and hi-hat, and a 50-bar song',
    async () => {
      const lib = drumTemplates as unknown as DrumTemplateLibrary
      const song = Array.from({ length: 4 }, () => eighthBar())
      const t0 = performance.now()
      const result = await drumify(song, { temperature: 0.5, range: null, lib, style: null, seed: 1 })
      console.log(`[drumify] 4 bars: ${Math.round(performance.now() - t0)} ms`)
      expect(result.first).toBe(0)
      expect(result.bars).toHaveLength(4)
      const pieces = new Set(result.bars.flatMap((b) => b.hits.map((h) => h.piece)))
      expect(pieces.has('kick')).toBe(true)
      expect(pieces.has('snare')).toBe(true)
      expect(pieces.has('hihatClosed') || pieces.has('hihatOpen')).toBe(true)

      const long = Array.from({ length: 50 }, (_, i) => eighthBar({ section: i % 16 === 0 ? 'Verse' : null }))
      const t1 = performance.now()
      const longResult = await drumify(long, { temperature: 0.5, range: null, lib, style: null, seed: 1 })
      console.log(`[drumify] 50 bars: ${Math.round(performance.now() - t1)} ms`)
      expect(longResult.bars).toHaveLength(50)
    },
    180_000,
  )
})
