import { describe, expect, it } from 'vitest'
import { REVEAL_STEP_MS, revealLabels, revealNote, revealOrder, revealSchedule } from '@/widgets/drill/options'
import { markLabelMap } from '@/widgets/instrument/markLabels'
import type { DrillQuestion } from '@/drills/types'

const pitchCompare = (a: number, b: number) =>
  ({
    id: 'q',
    kind: 'pitch_compare',
    module: 'E1',
    prompt: '',
    a: { midi: a, detuneCents: 0 },
    b: { midi: b, detuneCents: 0 },
    answer: 'lower',
    options: ['higher', 'lower', 'same'],
  }) as DrillQuestion

const interval = (root: number, second: number) =>
  ({
    id: 'q',
    kind: 'interval',
    module: 'E2',
    prompt: '',
    root,
    second,
    direction: 'up',
    answer: 'P8',
    options: ['P8', 'P5'],
  }) as DrillQuestion

describe('revealLabels', () => {
  it('numbers the two notes of a pitch comparison with octave names', () => {
    // G4 = 67, G3 = 55
    expect(revealLabels(pitchCompare(67, 55))).toEqual(['G4', 'G3'])
    expect(revealOrder(pitchCompare(67, 55))).toEqual(['1', '2'])
  })

  it('numbers the notes of an interval question', () => {
    // C4 = 60, G4 = 67
    expect(revealLabels(interval(60, 67))).toEqual(['C4', 'G4'])
    expect(revealOrder(interval(60, 67))).toEqual(['1', '2'])
  })

  it('returns undefined when there are no reveal notes', () => {
    const q = { id: 'q', kind: 'rhythm_choice', module: 'R1', prompt: '' } as unknown as DrillQuestion
    expect(revealLabels(q)).toBeUndefined()
  })
})

describe('revealNote', () => {
  it('explains same pitch class one octave lower', () => {
    expect(revealNote(pitchCompare(67, 55))).toBe('两个都是 G，第二个低一个八度')
  })

  it('explains same pitch class one octave higher', () => {
    expect(revealNote(pitchCompare(55, 67))).toBe('两个都是 G，第二个高一个八度')
  })

  it('explains a two-octave gap', () => {
    expect(revealNote(interval(72, 48))).toBe('两个都是 C，第二个低两个八度')
  })

  it('returns null for different pitch classes or identical pitches', () => {
    expect(revealNote(pitchCompare(60, 67))).toBeNull()
    expect(revealNote(pitchCompare(60, 60))).toBeNull()
  })
})

describe('revealSchedule', () => {
  it('steps through notes at the playback spacing and clears at the end', () => {
    const { steps, endMs } = revealSchedule(2)
    expect(steps).toEqual([
      { index: 0, atMs: 0 },
      { index: 1, atMs: REVEAL_STEP_MS },
    ])
    expect(endMs).toBe(2 * REVEAL_STEP_MS)
  })

  it('is empty for no notes', () => {
    expect(revealSchedule(0).steps).toEqual([])
  })
})

describe('markLabelMap', () => {
  it('maps each note to its label and skips empty labels', () => {
    expect(markLabelMap([67, 55], ['① G4', ''])).toEqual({ 67: '① G4' })
  })

  it('is empty without labels', () => {
    expect(markLabelMap([67, 55])).toEqual({})
  })
})
