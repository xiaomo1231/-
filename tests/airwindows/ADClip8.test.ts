import { describe, expect, it } from 'vitest'
import { ADClip8 } from '@/audio/fx/airwindows/ADClip8'

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
  const fx = ADClip8.create(sr)
  if (p) fx.setParams(p)
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  fx.process(l, r, l.length)
  return l
}

// the clip stage tops out at 1.618, scaled by the ceiling: (1 + B * 0.23594733) * 0.5
const ceilingPeak = (b: number) => 1.618033988749894 * (1 + b * 0.23594733) * 0.5

describe('ADClip8', () => {
  it('has the plugin defaults and non-empty displays', () => {
    expect(ADClip8.params.map((p) => p.name)).toEqual(['Boost', 'Ceiling', 'Mode'])
    expect(ADClip8.params.map((p) => p.default)).toEqual([0, 0.883, 0])
    for (const p of ADClip8.params) {
      expect(p.display(p.default).length).toBeGreaterThan(0)
      expect(p.display(1).length).toBeGreaterThan(0)
    }
    expect(ADClip8.params[2].display(0)).toBe('Normal')
    expect(ADClip8.params[2].display(1)).toBe('Apothes')
  })

  it('keeps silence silent', () => {
    expect(peak(run(44100, new Float32Array(44100), [0.5, 0.883, 0.5]))).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`stays finite and bounded on noise and sine at ${sr} Hz`, () => {
      for (const input of [lcgNoise(sr * 2), sine(sr * 2, 220, sr, 1)]) {
        for (const p of [undefined, [1, 1, 1], [0.5, 0.883, 0.3]]) {
          const out = run(sr, input, p)
          expect(out.every(Number.isFinite)).toBe(true)
          expect(peak(out)).toBeLessThan(4)
        }
      }
    })
  }

  it('limits a loud sine to the ceiling', () => {
    const out = run(44100, sine(44100, 220, 44100, 2))
    expect(peak(out)).toBeLessThanOrEqual(ceilingPeak(0.883) + 1e-6)
    const boosted = run(44100, sine(44100, 220, 44100, 2), [1, 1, 0])
    expect(peak(boosted)).toBeLessThanOrEqual(1.0 + 1e-6)
  })

  it('passes a quiet sine nearly unchanged', () => {
    const input = sine(44100, 220, 44100, 0.3)
    const out = run(44100, input)
    const dbDiff = 20 * Math.log10(rms(out, 2000) / rms(input, 2000))
    expect(Math.abs(dbDiff)).toBeLessThan(0.5)
  })
})
