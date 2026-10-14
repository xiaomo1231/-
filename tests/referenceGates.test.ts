import { describe, expect, it } from 'vitest'
import { gateByLevel, splitAtSyllables } from '@/audio/pitch/referenceCurve'

const HOP = 160

/** A 16 kHz signal from per-frame amplitudes (160 samples a frame). */
function signal(amps: number[]): Float32Array {
  const x = new Float32Array(amps.length * HOP)
  amps.forEach((a, f) => {
    for (let i = 0; i < HOP; i++)
      x[f * HOP + i] = a * Math.sin((2 * Math.PI * 220 * (f * HOP + i)) / 16000)
  })
  return x
}

describe('reference pitch gates', () => {
  it('drops pitch where the vocals stem is far below its loud singing', () => {
    const amps = [...Array(50).fill(0.3), ...Array(50).fill(0.003)] // second half 40 dB down (leftovers)
    const hz = new Float32Array(100).fill(220)
    const out = gateByLevel(hz, signal(amps), HOP)
    expect(out.slice(0, 50).every((v) => v === 220)).toBe(true)
    expect(out.slice(50).every((v) => v === 0)).toBe(true)
  })

  it('keeps quieter singing within 30 dB', () => {
    const amps = [...Array(50).fill(0.3), ...Array(50).fill(0.03)] // 20 dB down: still singing
    const out = gateByLevel(new Float32Array(100).fill(220), signal(amps), HOP)
    expect(out.slice(50).every((v) => v === 220)).toBe(true)
  })

  it('breaks the same note at a syllable dip, not at a vibrato swell', () => {
    // Two "啦" on one pitch: a 12 dB dip between them.
    const syll = [...Array(20).fill(0.3), 0.075, ...Array(20).fill(0.3)]
    const split = splitAtSyllables(new Float32Array(syll.length).fill(220), signal(syll), HOP)
    expect(split[20]).toBe(0)
    expect(split.filter((v) => v === 0).length).toBe(3)
    // Vibrato: the level swells by ~4 dB, never a break.
    const vib = Array.from(
      { length: 60 },
      (_, f) => 0.3 * (1 + 0.25 * Math.sin((2 * Math.PI * f) / 18)),
    )
    const kept = splitAtSyllables(new Float32Array(60).fill(220), signal(vib), HOP)
    expect(kept.every((v) => v === 220)).toBe(true)
  })
})
