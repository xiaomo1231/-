import { describe, expect, it } from 'vitest'
import {
  type Biquad,
  gainToTarget,
  integratedLufs,
  kWeight,
  kWeightingCoefficients,
  levelMatchGain,
  loudnessRange,
  maxShortTerm,
  momentaryLufs,
  samplePeakDb,
  shortTermLufs,
  truePeakDb,
} from '@/audio/fx/loudness'

const FS = 48000

function sine(freq: number, amp: number, seconds: number, fs = FS, phase = 0): Float32Array {
  const out = new Float32Array(Math.round(seconds * fs))
  for (let i = 0; i < out.length; i++) out[i] = amp * Math.sin((2 * Math.PI * freq * i) / fs + phase)
  return out
}

/** |H(e^jw)| of a biquad at `freq`. */
function magnitude(c: Biquad, freq: number, fs: number): number {
  const w = (2 * Math.PI * freq) / fs
  const re = (b0: number, b1: number, b2: number) => b0 + b1 * Math.cos(w) + b2 * Math.cos(2 * w)
  const im = (b1: number, b2: number) => -(b1 * Math.sin(w) + b2 * Math.sin(2 * w))
  const num = Math.hypot(re(c.b0, c.b1, c.b2), im(c.b1, c.b2))
  const den = Math.hypot(re(1, c.a1, c.a2), im(c.a1, c.a2))
  return num / den
}

/** K-weighting gain in dB at `freq`, computed from the filter's own coefficients. */
function kGainDb(freq: number, fs: number): number {
  const { shelf, highPass } = kWeightingCoefficients(fs)
  return 20 * Math.log10(magnitude(shelf, freq, fs) * magnitude(highPass, freq, fs))
}

/**
 * Expected integrated loudness of a mono sine of amplitude `amp`:
 * mean square = amp^2 / 2 (-3.01 dB), scaled by the K-weighting power gain,
 * then the BS.1770 offset of -0.691.
 */
function expectedSineLufs(freq: number, amp: number, fs: number): number {
  return 20 * Math.log10(amp) - 10 * Math.log10(2) + kGainDb(freq, fs) - 0.691
}

describe('kWeightingCoefficients', () => {
  it('matches the BS.1770 table at 48 kHz', () => {
    const { shelf, highPass } = kWeightingCoefficients(48000)
    expect(shelf.b0).toBeCloseTo(1.53512485958697, 6)
    expect(shelf.b1).toBeCloseTo(-2.69169618940638, 6)
    expect(shelf.b2).toBeCloseTo(1.19839281085285, 6)
    expect(shelf.a1).toBeCloseTo(-1.69065929318241, 6)
    expect(shelf.a2).toBeCloseTo(0.73248077421585, 6)
    expect([highPass.b0, highPass.b1, highPass.b2]).toEqual([1, -2, 1])
    expect(highPass.a1).toBeCloseTo(-1.99004745483398, 6)
    expect(highPass.a2).toBeCloseTo(0.99007225036621, 6)
  })

  it('has ~+0.7 dB gain at 1 kHz and ~+4 dB high up', () => {
    expect(kGainDb(1000, FS)).toBeGreaterThan(0.6)
    expect(kGainDb(1000, FS)).toBeLessThan(0.8)
    expect(kGainDb(10000, FS)).toBeCloseTo(4, 0)
    expect(kGainDb(1000, 44100)).toBeCloseTo(kGainDb(1000, FS), 2)
  })

  it('kWeight output has the expected steady-state gain', () => {
    const y = kWeight(sine(1000, 0.5, 1), FS)
    let sq = 0
    for (let i = FS / 2; i < y.length; i++) sq += (y[i] as number) ** 2
    const rmsDb = 10 * Math.log10(sq / (y.length - FS / 2))
    expect(rmsDb).toBeCloseTo(20 * Math.log10(0.5) - 10 * Math.log10(2) + kGainDb(1000, FS), 2)
  })
})

describe('integratedLufs', () => {
  it('reads a mono 1 kHz sine as 20log10(A) - 3.01 + Kgain - 0.691', () => {
    const amp = 0.25
    const l = integratedLufs([sine(1000, amp, 5)], FS)
    expect(Math.abs(l - expectedSineLufs(1000, amp, FS))).toBeLessThan(0.1)
  })

  it('sums stereo channels (identical L/R reads +3.01 LU over mono)', () => {
    const s = sine(1000, 0.25, 5)
    expect(integratedLufs([s, s], FS) - integratedLufs([s], FS)).toBeCloseTo(10 * Math.log10(2), 2)
  })

  it('doubling amplitude adds 6.02 LU', () => {
    const a = integratedLufs([sine(1000, 0.1, 5)], FS)
    const b = integratedLufs([sine(1000, 0.2, 5)], FS)
    expect(b - a).toBeCloseTo(20 * Math.log10(2), 2)
  })

  it('gating ignores a long silence appended', () => {
    // Only the 3 blocks straddling the tone/silence edge (75/50/25 % tone, i.e.
    // -1.25/-3/-6 dB) pass the gates, and they are legitimately counted. With a
    // 30 s tone (~297 full blocks) they pull the result down by ~0.015 LU.
    const tone = sine(1000, 0.25, 30)
    const padded = new Float32Array(tone.length + 20 * FS)
    padded.set(tone)
    expect(Math.abs(integratedLufs([padded], FS) - integratedLufs([tone], FS))).toBeLessThan(0.05)
  })

  it('relative gate drops a much quieter section', () => {
    // 30 s at A, then 30 s at A/100 (-40 dB): the quiet part falls below the
    // -10 LU relative gate (it would otherwise lower the mean by ~3 LU).
    const loud = sine(1000, 0.25, 30)
    const both = new Float32Array(loud.length * 2)
    both.set(loud)
    both.set(sine(1000, 0.0025, 30), loud.length)
    expect(Math.abs(integratedLufs([both], FS) - integratedLufs([loud], FS))).toBeLessThan(0.05)
  })

  it('returns -Infinity for silence and too-short input', () => {
    expect(integratedLufs([new Float32Array(FS * 2)], FS)).toBe(-Infinity)
    expect(integratedLufs([sine(1000, 0.5, 0.2)], FS)).toBe(-Infinity)
    expect(integratedLufs([], FS)).toBe(-Infinity)
  })

  it('works at 44100 Hz', () => {
    const fs = 44100
    const l = integratedLufs([sine(1000, 0.3, 4, fs)], fs)
    expect(Math.abs(l - expectedSineLufs(1000, 0.3, fs))).toBeLessThan(0.1)
  })
})

describe('momentary / short-term / LRA', () => {
  it('produces 100 ms hop series of the right length and level', () => {
    const s = sine(1000, 0.25, 5)
    const m = momentaryLufs([s], FS)
    const st = shortTermLufs([s], FS)
    expect(m.length).toBe(50 - 3)
    expect(st.length).toBe(50 - 29)
    const expected = expectedSineLufs(1000, 0.25, FS)
    expect(Math.abs((m[20] as number) - expected)).toBeLessThan(0.1)
    expect(Math.abs((st[10] as number) - expected)).toBeLessThan(0.1)
    expect(Math.abs(maxShortTerm([s], FS) - expected)).toBeLessThan(0.1)
  })

  it('LRA is ~0 for a steady tone and ~step size for two levels', () => {
    expect(loudnessRange([sine(1000, 0.25, 10)], FS)).toBeLessThan(0.1)
    // 10 s at A then 10 s at A/2 (-6.02 dB): 10th..95th percentile spans ~6 LU.
    const a = sine(1000, 0.25, 10)
    const two = new Float32Array(a.length * 2)
    two.set(a)
    two.set(sine(1000, 0.125, 10), a.length)
    expect(Math.abs(loudnessRange([two], FS) - 6.02)).toBeLessThan(0.2)
  })
})

describe('peaks', () => {
  it('true peak finds the inter-sample peak of an fs/4 sine at 45 degrees', () => {
    // Samples land at +/-0.707A; the waveform peaks halfway between samples.
    const amp = 0.5
    const s = sine(FS / 4, amp, 1, FS, Math.PI / 4)
    const sp = samplePeakDb([s])
    const tp = truePeakDb([s], FS)
    expect(sp).toBeCloseTo(20 * Math.log10(amp) - 3.01, 1)
    expect(Math.abs(tp - 20 * Math.log10(amp))).toBeLessThan(0.2)
  })

  it('returns -Infinity for silence', () => {
    expect(truePeakDb([new Float32Array(1000)], FS)).toBe(-Infinity)
    expect(samplePeakDb([new Float32Array(1000)])).toBe(-Infinity)
  })
})

describe('gain helpers', () => {
  it('gainToTarget', () => {
    expect(gainToTarget(-20, -14)).toBe(6)
    expect(gainToTarget(-Infinity, -14)).toBe(0)
  })

  it('levelMatchGain equalises loudness within 0.05 LU', () => {
    const a = [sine(440, 0.4, 4), sine(440, 0.3, 4)]
    const b = [sine(3000, 0.05, 4), sine(3000, 0.07, 4)]
    const g = levelMatchGain(a, b, FS)
    const scaled = b.map((c) => c.map((x) => x * g))
    expect(Math.abs(integratedLufs(scaled, FS) - integratedLufs(a, FS))).toBeLessThan(0.05)
    expect(levelMatchGain(a, [new Float32Array(FS)], FS)).toBe(1)
  })
})

describe('performance', () => {
  it('measures a 4-minute stereo track at 44.1 kHz quickly', () => {
    const fs = 44100
    const n = fs * 240
    const l = new Float32Array(n)
    const r = new Float32Array(n)
    let seed = 1
    for (let i = 0; i < n; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0
      const noise = seed / 2 ** 32 - 0.5
      l[i] = 0.3 * Math.sin((2 * Math.PI * 220 * i) / fs) + 0.1 * noise
      r[i] = 0.3 * Math.sin((2 * Math.PI * 330 * i) / fs) - 0.1 * noise
    }
    const t0 = performance.now()
    const lufs = integratedLufs([l, r], fs)
    const tp = truePeakDb([l, r], fs)
    const ms = performance.now() - t0
    expect(Number.isFinite(lufs)).toBe(true)
    expect(Number.isFinite(tp)).toBe(true)
    expect(ms).toBeLessThan(1000)
  })
})
