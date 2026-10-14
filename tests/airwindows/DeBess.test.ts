import { describe, expect, it } from 'vitest'
import { DeBess } from '@/audio/fx/airwindows/DeBess'

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

function run(sr: number, input: Float32Array, p?: number[]) {
  const fx = DeBess.create(sr)
  if (p) fx.setParams(p)
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  fx.process(l, r, l.length)
  return l
}

describe('DeBess', () => {
  it('has the plugin defaults and non-empty displays', () => {
    expect(DeBess.params.map((p) => p.name)).toEqual([
      'Intense',
      'Sharp',
      'Depth',
      'Filter',
      'Sense',
    ])
    expect(DeBess.params.map((p) => p.default)).toEqual([0, 0.5, 0.5, 0.5, 0])
    for (const p of DeBess.params) {
      expect(p.display(p.default).length).toBeGreaterThan(0)
      expect(p.display(1).length).toBeGreaterThan(0)
    }
  })

  it('keeps silence silent', () => {
    const out = run(44100, new Float32Array(44100), [0.6, 0.5, 0.1, 0.5, 0])
    expect(peak(out)).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`stays finite and bounded on noise and sine at ${sr} Hz`, () => {
      for (const input of [lcgNoise(sr * 2), sine(sr * 2, 220, sr, 1)]) {
        for (const p of [undefined, [0.6, 0.5, 0.1, 0.5, 0]]) {
          const out = run(sr, input, p)
          expect(out.every(Number.isFinite)).toBe(true)
          expect(peak(out)).toBeLessThan(4)
        }
      }
    })
  }

  it('reduces a 7 kHz burst more than a 300 Hz tone', () => {
    const sr = 44100
    const p = [0.6, 0.5, 0.1, 0.5, 0]
    const hi = sine(sr, 7000, sr, 0.3)
    const lo = sine(sr, 300, sr, 0.3)
    const reductionHi = rms(run(sr, hi, p), sr / 2) / rms(hi, sr / 2)
    const reductionLo = rms(run(sr, lo, p), sr / 2) / rms(lo, sr / 2)
    expect(reductionHi).toBeLessThan(reductionLo)
    expect(reductionHi).toBeLessThan(0.9)
  })
})
