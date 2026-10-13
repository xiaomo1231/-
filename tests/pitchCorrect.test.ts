import { describe, expect, it } from 'vitest'
import { correctPitch, scalePitchClasses } from '@/audio/fx/pitchCorrect'
import { median } from '@/audio/pitch/analysis'
import { rms, yin } from '@/audio/pitch/yin'

const SR = 16000

/** Harmonics 1–6 with decreasing amplitude, slow amplitude wobble, 20 ms fades; optional vibrato. */
function voice(f0: number, seconds: number, sr = SR, vibCents = 0, vibHz = 5.5): Float32Array {
  const n = Math.round(seconds * sr)
  const out = new Float32Array(n)
  const fade = Math.round(0.02 * sr)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / sr
    const f = f0 * 2 ** ((vibCents * Math.sin(2 * Math.PI * vibHz * t)) / 1200)
    phase += (2 * Math.PI * f) / sr
    let s = 0
    for (let h = 1; h <= 6; h++) s += Math.sin(h * phase) / h
    const env = (0.8 + 0.1 * Math.sin(2 * Math.PI * 1.3 * t)) * Math.min(1, i / fade, (n - 1 - i) / fade)
    out[i] = 0.3 * env * s
  }
  return out
}

/** Per-frame f0 (Hz) over the middle of a buffer, 30 ms frames. */
function f0Track(x: Float32Array, sr = SR): number[] {
  const len = Math.round(0.03 * sr)
  const hop = Math.round(0.005 * sr)
  const out: number[] = []
  for (let s = Math.round(0.15 * sr); s + len < x.length - 0.15 * sr; s += hop) {
    const r = yin(x.subarray(s, s + len), { sampleRate: sr, minFreq: 70, maxFreq: 1100 })
    if (r.freq !== null) out.push(r.freq)
  }
  return out
}

const centsFrom = (hz: number, ref: number): number => 1200 * Math.log2(hz / ref)
const maxJump = (x: Float32Array): number => {
  let m = 0
  for (let i = 1; i < x.length; i++) m = Math.max(m, Math.abs(x[i]! - x[i - 1]!))
  return m
}

describe('scalePitchClasses', () => {
  it('builds major and natural minor scales', () => {
    expect(scalePitchClasses(0, 'major')).toEqual([0, 2, 4, 5, 7, 9, 11])
    expect(scalePitchClasses(9, 'minor')).toEqual([9, 11, 0, 2, 4, 5, 7])
  })
})

describe('correctPitch', () => {
  const sharp = 440 * 2 ** (0.4 / 12)

  it('pulls a 40-cent-sharp note to A4 (amount 1) and halfway (amount 0.5)', () => {
    const x = voice(sharp, 1)
    expect(Math.abs(centsFrom(median(f0Track(x)), 440) - 40)).toBeLessThan(3)
    const full = correctPitch(x, SR, { amount: 1, speedMs: 20 })
    expect(Math.abs(centsFrom(median(f0Track(full)), 440))).toBeLessThanOrEqual(8)
    const half = correctPitch(x, SR, { amount: 0.5, speedMs: 20 })
    expect(Math.abs(centsFrom(median(f0Track(half)), 440) - 20)).toBeLessThanOrEqual(8)
  })

  it('amount 0 returns an exact copy', () => {
    const x = voice(sharp, 0.5)
    const y = correctPitch(x, SR, { amount: 0, speedMs: 50 })
    expect(y).not.toBe(x)
    expect(Array.from(y)).toEqual(Array.from(x))
  })

  it('snaps only to scale tones', () => {
    // C#4 + 10 cents: chromatic would keep C#; C major must give C or D.
    const csharp = 440 * 2 ** ((61.1 - 69) / 12)
    const x = voice(csharp, 1)
    const chrom = median(f0Track(correctPitch(x, SR, { amount: 1, speedMs: 20 })))
    expect(Math.abs(69 + 12 * Math.log2(chrom / 440) - 61)).toBeLessThan(0.1)
    const y = correctPitch(x, SR, { amount: 1, speedMs: 20, scale: scalePitchClasses(0, 'major') })
    const m = 69 + 12 * Math.log2(median(f0Track(y)) / 440)
    const distC = Math.abs(m - 60)
    const distD = Math.abs(m - 62)
    expect(Math.min(distC, distD)).toBeLessThan(0.2)
  })

  it('preserves vibrato around the corrected centre', () => {
    const x = voice(440 * 2 ** (0.25 / 12), 1.2, SR, 30)
    const y = correctPitch(x, SR, { amount: 1, speedMs: 50 })
    const cents = f0Track(y).map((f) => centsFrom(f, 440))
    expect(Math.abs(median(cents))).toBeLessThanOrEqual(10)
    expect(Math.max(...cents) - Math.min(...cents)).toBeGreaterThanOrEqual(30)
  })

  it('keeps length, level and continuity', () => {
    const x = voice(sharp, 1)
    const y = correctPitch(x, SR, { amount: 1, speedMs: 20 })
    expect(y.length).toBe(x.length)
    expect(y.every(Number.isFinite)).toBe(true)
    expect(Math.abs(20 * Math.log10(rms(y) / rms(x)))).toBeLessThanOrEqual(1)
    expect(maxJump(y)).toBeLessThanOrEqual(2 * maxJump(x))
  })

  it('passes silence and noise through', () => {
    const silence = new Float32Array(SR)
    const s = correctPitch(silence, SR, { amount: 1, speedMs: 20 })
    expect(s.length).toBe(SR)
    expect(s.every((v) => v === 0)).toBe(true)

    let seed = 12345
    const noise = new Float32Array(SR).map(() => {
      seed = (seed * 1664525 + 1013904223) >>> 0
      return (seed / 2 ** 32 - 0.5) * 0.4
    })
    const n = correctPitch(noise, SR, { amount: 1, speedMs: 20 })
    expect(n.length).toBe(noise.length)
    expect(n.every(Number.isFinite)).toBe(true)
    expect(Math.abs(20 * Math.log10(rms(n) / rms(noise)))).toBeLessThanOrEqual(1)
  })

  it('processes 30 s at 44.1 kHz in a few seconds', () => {
    const sr = 44100
    const x = voice(sharp, 30, sr, 20)
    const t0 = performance.now()
    const y = correctPitch(x, sr, { amount: 0.8, speedMs: 80 })
    const ms = performance.now() - t0
    expect(y.length).toBe(x.length)
    expect(ms).toBeLessThan(6000)
  }, 20000)
})
