import { describe, expect, it } from 'vitest'
import { referenceTarget } from '@/audio/fx/voicePrep'
import { correctPitch, emptyStats } from '@/audio/fx/pitchCorrect'

const notes = [
  { startMs: 1000, endMs: 2000, midi: 69 }, // A4
  { startMs: 2000, endMs: 3000, midi: 72 }, // C5
]

describe('按原唱音高对齐: targets', () => {
  it('uses the original note, in the singer’s own octave, a little early or late', () => {
    const t = referenceTarget(notes, 'keep')
    expect(t(1500, 69.4)).toBe(69)
    expect(t(1500, 57.3)).toBe(57) // an octave lower
    expect(t(950, 69.2)).toBe(69) // came in 50 ms early
    expect(t(2050, 71.8)).toBe(72) // the closer of the two near the change
    expect(t(5000, 64.3)).toBeNull() // no note in the original
    expect(referenceTarget(notes, 'nearest')(5000, 64.3)).toBe(64)
  })
})

/** A sung-like tone (harmonics) at a fixed MIDI pitch, 16 kHz. */
function tone(midi: number, seconds: number, sr = 16000): Float32Array {
  const f = 440 * Math.pow(2, (midi - 69) / 12)
  const n = Math.round(seconds * sr)
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    let s = 0
    for (let h = 1; h <= 5; h++) s += Math.sin((2 * Math.PI * f * h * i) / sr) / h
    x[i] = 0.3 * s * Math.min(1, i / 320, (n - i) / 320)
  }
  return x
}

describe('按原唱音高对齐: correction', () => {
  it('pulls toward the original, and leaves far-off notes alone', () => {
    const sr = 16000
    const near = new Float32Array(sr * 3)
    near.set(tone(69.4, 2), sr) // 1–3 s, 40 cents sharp of the original's A4 / C5 boundary region
    const stats = emptyStats()
    correctPitch(near, sr, { amount: 1, speedMs: 20, target: referenceTarget([{ startMs: 0, endMs: 3000, midi: 69 }], 'keep'), maxShift: 2, stats })
    expect(stats.corrected).toBeGreaterThan(stats.frames * 0.8)
    expect(stats.centsAfter / stats.corrected).toBeLessThan(10)
    expect(stats.centsBefore / stats.corrected).toBeGreaterThan(30)

    const far = new Float32Array(sr * 3)
    far.set(tone(72.5, 2), sr) // 3.5 semitones above the original: sung on purpose
    const st2 = emptyStats()
    const out = correctPitch(far, sr, { amount: 1, speedMs: 20, target: referenceTarget([{ startMs: 0, endMs: 3000, midi: 69 }], 'keep'), maxShift: 2, stats: st2 })
    expect(st2.corrected).toBe(0)
    expect(Array.from(out.slice(0, 2000))).toEqual(Array.from(far.slice(0, 2000)))
  })
})
