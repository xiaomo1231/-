import { describe, expect, it } from 'vitest'
import { ClipOnly2 } from '@/audio/fx/airwindows/ClipOnly2'

function lcgNoise(n: number, seed = 12345): Float32Array {
  const out = new Float32Array(n)
  let s = seed >>> 0
  for (let i = 0; i < n; i++) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    out[i] = (s / 0xffffffff) * 2 - 1
  }
  return out
}
const sine = (n: number, hz: number, sr: number, amp: number) => {
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr)
  return out
}
const rms = (x: Float32Array, from = 0) => {
  let s = 0
  for (let i = from; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / (x.length - from))
}
const peak = (x: Float32Array) => x.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

function run(sr: number, input: Float32Array) {
  const fx = ClipOnly2.create(sr)
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  fx.process(l, r, l.length)
  return l
}

describe('ClipOnly2', () => {
  it('has no parameters', () => {
    expect(ClipOnly2.params).toEqual([])
  })

  it('keeps silence silent', () => {
    expect(peak(run(44100, new Float32Array(44100)))).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`stays finite and bounded on noise and sine at ${sr} Hz`, () => {
      for (const input of [lcgNoise(sr * 2), sine(sr * 2, 220, sr, 1)]) {
        const out = run(sr, input)
        expect(out.every(Number.isFinite)).toBe(true)
        expect(peak(out)).toBeLessThan(4)
      }
    })
  }

  it('clips a loud sine at the ceiling', () => {
    const out = run(44100, sine(44100, 220, 44100, 2))
    expect(peak(out)).toBeLessThanOrEqual(1.0)
  })

  it('passes a quiet sine nearly unchanged', () => {
    const input = sine(44100, 220, 44100, 0.3)
    const out = run(44100, input)
    const dbDiff = 20 * Math.log10(rms(out, 2000) / rms(input, 2000))
    expect(Math.abs(dbDiff)).toBeLessThan(0.5)
  })
})
