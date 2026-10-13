import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PIANO_SAMPLES, levelGain, nearestSample, sameSamplePlan } from '@/audio/piano'
import { WAKE_LEAD_SECONDS, chordStagger, currentTimbreName, overrideTimbre, sequenceLead, setTimbre, trainingTimbre } from '@/audio/engine'

describe('bundled piano', () => {
  it('ships 24 samples, C1 to A6, every minor third, all present in public/', () => {
    expect(PIANO_SAMPLES).toHaveLength(24)
    expect(PIANO_SAMPLES[0]).toMatchObject({ note: 'C1', midi: 24 })
    expect(PIANO_SAMPLES.at(-1)).toMatchObject({ note: 'A6', midi: 93 })
    PIANO_SAMPLES.slice(1).forEach((s, i) => expect(s.midi - PIANO_SAMPLES[i]!.midi).toBe(3))
    for (const s of PIANO_SAMPLES) expect(existsSync(path.resolve(__dirname, '../public/audio/piano', s.file)), s.file).toBe(true)
  })
  it('picks the nearest sample, ties to the lower one', () => {
    expect(nearestSample(60).note).toBe('C4')
    expect(nearestSample(61).note).toBe('C4')
    expect(nearestSample(62).note).toBe('D#4')
    expect(nearestSample(10).note).toBe('C1')
    expect(nearestSample(120).note).toBe('A6')
  })
  it('pitch comparison plays both notes from one sample with exact ratios', () => {
    // Straddles the C4 / D#4 boundary: both must still share a sample.
    const { sample, rates } = sameSamplePlan([
      { midi: 61, detuneCents: 0 },
      { midi: 61, detuneCents: 60 },
    ])
    expect(['C4', 'D#4']).toContain(sample.note)
    expect(rates[1]! / rates[0]!).toBeCloseTo(Math.pow(2, 60 / 1200), 10)
    const octave = sameSamplePlan([{ midi: 67 }, { midi: 55 }])
    expect(octave.rates[0]! / octave.rates[1]!).toBeCloseTo(2, 10)
  })
  it('levels samples toward one peak within ±6 dB', () => {
    expect(levelGain(0.25)).toBe(2)
    expect(levelGain(1)).toBe(0.5)
    expect(levelGain(0.5)).toBe(1)
    expect(levelGain(0)).toBe(1)
  })
})

describe('engine helpers', () => {
  it('training timbre is piano unless the student follows the instrument', () => {
    expect(trainingTimbre({ instrument: 'guitar' })).toBe('piano')
    expect(trainingTimbre({ instrument: 'guitar', trainingTimbre: 'instrument' })).toBe('guitar')
    expect(trainingTimbre({ instrument: 'none', trainingTimbre: 'instrument' })).toBe('piano')
  })
  it('scoped overrides return to the training timbre', () => {
    setTimbre('piano')
    const undo = overrideTimbre('guitar')
    expect(currentTimbreName()).toBe('guitar')
    setTimbre('bass') // settings change while the guitar page is open
    expect(currentTimbreName()).toBe('guitar')
    undo()
    undo()
    expect(currentTimbreName()).toBe('bass')
    setTimbre('piano')
  })
  it('chord notes spread over at most 10 ms', () => {
    expect(chordStagger(1)).toEqual([0])
    const s = chordStagger(6)
    expect(s[0]).toBe(0)
    expect(s.at(-1)!).toBeLessThanOrEqual(0.01 + 1e-9)
  })
  it('sequences start later after a silence so a waking output keeps the first note', () => {
    expect(sequenceLead(10, 9.5)).toBe(0.08)
    expect(sequenceLead(10, 5)).toBe(WAKE_LEAD_SECONDS)
    expect(sequenceLead(10, -Infinity)).toBe(WAKE_LEAD_SECONDS)
  })
})
