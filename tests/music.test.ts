import { describe, expect, it } from 'vitest'
import { centsBetween, foldIntoRange, midiToFrequency, midiToName, nameToMidi, pitchClass } from '@/music/pitch'
import { INTERVALS, intervalById, intervalFromSemitones } from '@/music/intervals'
import { SCALES, degreeFromSemitone, scaleNotes, semitoneFromDegree } from '@/music/scales'
import { CHORD_TYPES, chordNotes } from '@/music/chords'
import { PROGRESSIONS, majorKeySignature, romanChord, voiceRoman } from '@/music/keys'
import { RHYTHM_PATTERNS } from '@/music/rhythm'
import { createRng } from '@/music/random'

describe('pitch', () => {
  it('maps A4 to 440 Hz and names notes', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440)
    expect(midiToName(60, { octave: true })).toBe('C4')
    expect(midiToName(61, { octave: true })).toBe('C♯4')
    expect(midiToName(61, { octave: true, flats: true })).toBe('D♭4')
  })
  it('parses names', () => {
    expect(nameToMidi('C4')).toBe(60)
    expect(nameToMidi('F#3')).toBe(54)
    expect(nameToMidi('Bb2')).toBe(46)
    expect(nameToMidi('E♭5')).toBe(75)
    expect(nameToMidi('H4')).toBeNull()
  })
  it('computes cents', () => {
    expect(centsBetween(440, 440 * Math.pow(2, 1 / 12))).toBeCloseTo(100)
    expect(centsBetween(440, 430)).toBeLessThan(0)
  })
  it('folds into range by octaves', () => {
    expect(pitchClass(foldIntoRange(40, 60, 72))).toBe(pitchClass(40))
    expect(foldIntoRange(40, 60, 72)).toBeGreaterThanOrEqual(60)
  })
})

describe('intervals', () => {
  it('has 13 intervals with increasing semitones', () => {
    expect(INTERVALS.map((i) => i.semitones)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(intervalById('P5').semitones).toBe(7)
    expect(intervalFromSemitones(-4).id).toBe('M3')
    expect(intervalFromSemitones(12).id).toBe('P8')
  })
})

describe('scales', () => {
  it('builds scale notes', () => {
    expect(scaleNotes(60, 'major')).toEqual([60, 62, 64, 65, 67, 69, 71, 72])
    expect(scaleNotes(57, 'pentatonic_minor', false)).toEqual([57, 60, 62, 64, 67])
  })
  it('all scales start at 0 and are strictly increasing within an octave', () => {
    for (const s of SCALES) {
      expect(s.steps[0]).toBe(0)
      for (let i = 1; i < s.steps.length; i++) expect(s.steps[i]!).toBeGreaterThan(s.steps[i - 1]!)
      expect(s.steps[s.steps.length - 1]!).toBeLessThan(12)
    }
  })
  it('degree round trip', () => {
    expect(degreeFromSemitone(7)).toBe('5')
    expect(degreeFromSemitone(10)).toBe('b7')
    expect(semitoneFromDegree('#4')).toBe(6)
  })
})

describe('chords', () => {
  it('voices inversions ascending', () => {
    expect(chordNotes(60, 'maj')).toEqual([60, 64, 67])
    expect(chordNotes(60, 'maj', 1)).toEqual([64, 67, 72])
    expect(chordNotes(60, 'maj', 2)).toEqual([67, 72, 76])
    expect(chordNotes(60, 'power')).toEqual([60, 67])
  })
  it('every chord type has a root and unique intervals', () => {
    for (const c of CHORD_TYPES) {
      expect(c.intervals[0]).toBe(0)
      expect(new Set(c.intervals).size).toBe(c.intervals.length)
    }
  })
})

describe('keys', () => {
  it('voices roman chords within the octave above tonic', () => {
    const v = voiceRoman(60, 'V', 'major')
    expect(v.length).toBe(3)
    for (const n of v) expect(n).toBeLessThanOrEqual(76)
    expect(romanChord('bVII', 'major').offset).toBe(10)
  })
  it('key signatures', () => {
    expect(majorKeySignature(0)).toBe(0)
    expect(majorKeySignature(7)).toBe(1)
    expect(majorKeySignature(5)).toBe(-1)
  })
  it('progressions only reference known romans', () => {
    for (const p of PROGRESSIONS) for (const r of p.romans) expect(() => romanChord(r, p.mode)).not.toThrow()
  })
})

describe('rhythm patterns', () => {
  it('onsets are increasing and within the bar', () => {
    for (const p of RHYTHM_PATTERNS) {
      expect(p.onsets[0]).toBeGreaterThanOrEqual(0)
      for (let i = 1; i < p.onsets.length; i++) expect(p.onsets[i]!).toBeGreaterThan(p.onsets[i - 1]!)
      expect(p.onsets[p.onsets.length - 1]!).toBeLessThan(p.beats)
    }
  })
})

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = createRng(42)
    const b = createRng(42)
    expect([a.next(), a.int(1, 10), a.pick(['x', 'y', 'z'])]).toEqual([b.next(), b.int(1, 10), b.pick(['x', 'y', 'z'])])
  })
  it('shuffle keeps elements', () => {
    expect(createRng(7).shuffle([1, 2, 3, 4]).sort()).toEqual([1, 2, 3, 4])
  })
})
