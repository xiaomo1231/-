import { describe, expect, it } from 'vitest'
import type { model } from '@coderline/alphatab'
import { hasFretboard, notesFromBeats, tuningLabels } from '../web/viewer/fretboardNotes'

// Minimal fakes shaped like alphaTab's Track / Staff / Beat / Note (only the fields the helpers read).
const STANDARD = [64, 59, 55, 50, 45, 40] // E4 B3 G3 D3 A2 E2, top line first (alphaTab Staff.tuning)

function makeTrack(index: number, tuning: number[] = STANDARD, opts: { percussion?: boolean } = {}) {
  const staff = { tuning, isStringed: tuning.length > 0, isPercussion: opts.percussion ?? false }
  return { index, isPercussion: opts.percussion ?? false, staves: [staff] }
}

function makeBeat(track: ReturnType<typeof makeTrack>, notes: unknown[], extra: Record<string, unknown> = {}) {
  return { isRest: false, notes, voice: { bar: { staff: { track } } }, ...extra }
}

function note(string: number, fret: number, extra: Record<string, unknown> = {}) {
  return { string, fret, isStringed: true, ...extra }
}

const guitar = makeTrack(0)
const bass = makeTrack(1, [43, 38, 33, 28])

const asBeats = (beats: unknown[]) => beats as unknown as readonly model.Beat[]
const asTrack = (t: unknown) => t as unknown as model.Track

describe('notesFromBeats', () => {
  it('maps string 1 to the bottom row and string 6 to the top row', () => {
    // alphaTab: string 1 = lowest string; row 0 = highest (tuning[0]).
    const beats = [makeBeat(guitar, [note(1, 0), note(6, 3)])]
    const got = notesFromBeats(asBeats(beats), 0)
    expect(got).toEqual([
      { row: 5, fret: 0 },
      { row: 0, fret: 3 },
    ])
  })

  it('keeps only beats of the requested track', () => {
    const beats = [makeBeat(guitar, [note(6, 1)]), makeBeat(bass, [note(4, 2)])]
    expect(notesFromBeats(asBeats(beats), 0)).toEqual([{ row: 0, fret: 1 }])
    expect(notesFromBeats(asBeats(beats), 1)).toEqual([{ row: 0, fret: 2 }])
  })

  it('skips rest beats and non-string notes', () => {
    const beats = [
      makeBeat(guitar, [note(6, 5)], { isRest: true }),
      makeBeat(guitar, [note(6, -1), note(5, 2, { isStringed: false })]),
      makeBeat(makeTrack(0, []), [note(6, 4)]),
    ]
    expect(notesFromBeats(asBeats(beats), 0)).toEqual([])
  })

  it('deduplicates the same row and fret and keeps tie destinations', () => {
    const beats = [
      makeBeat(guitar, [note(5, 2)]),
      makeBeat(guitar, [note(5, 2, { isTieDestination: true })]),
      makeBeat(guitar, [note(5, 3)]),
    ]
    expect(notesFromBeats(asBeats(beats), 0)).toEqual([
      { row: 1, fret: 2 },
      { row: 1, fret: 3 },
    ])
  })

  it('flags dead notes', () => {
    const beats = [makeBeat(guitar, [note(4, 0, { isDead: true }), note(3, 2)])]
    expect(notesFromBeats(asBeats(beats), 0)).toEqual([
      { row: 2, fret: 0, dead: true },
      { row: 3, fret: 2 },
    ])
  })

  it('ignores percussion or untuned tracks', () => {
    const drums = makeTrack(2, [], { percussion: true })
    const beats = [makeBeat(drums, [note(1, 0)])]
    expect(notesFromBeats(asBeats(beats), 2)).toEqual([])
  })
})

describe('tuningLabels', () => {
  it('returns top row first with sharps', () => {
    expect(tuningLabels(asTrack(guitar))).toEqual(['E', 'B', 'G', 'D', 'A', 'E'])
    expect(tuningLabels(asTrack(makeTrack(3, [63, 58, 54])))).toEqual(['D#', 'A#', 'F#'])
  })

  it('returns an empty array when there is no tuning', () => {
    expect(tuningLabels(asTrack(makeTrack(2, [], { percussion: true })))).toEqual([])
  })
})

describe('hasFretboard', () => {
  it('is true for a stringed, tuned, non-percussion track', () => {
    expect(hasFretboard(asTrack(guitar))).toBe(true)
    expect(hasFretboard(asTrack(bass))).toBe(true)
  })

  it('is false for percussion or untuned tracks', () => {
    expect(hasFretboard(asTrack(makeTrack(2, [], { percussion: true })))).toBe(false)
    expect(hasFretboard(asTrack(makeTrack(2, [])))).toBe(false)
    expect(hasFretboard(asTrack(makeTrack(2, STANDARD, { percussion: true })))).toBe(false)
  })
})
