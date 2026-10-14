import { describe, expect, it } from 'vitest'
import { Pressure4 as Fx } from '@/audio/fx/airwindows/Pressure4'

const DEFAULTS = [0, 0.2, 1, 1]
const COMPRESS = [0.8, 0.2, 1, 1]
const NEUTRAL = [0, 0.2, 1, 1]

function lcg(seed = 12345) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

function run(sr: number, params: number[], input: Float32Array) {
  const fx = Fx.create(sr)
  fx.setParams(params)
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  const block = 512
  for (let i = 0; i < l.length; i += block) {
    const n = Math.min(block, l.length - i)
    fx.process(l.subarray(i, i + n), r.subarray(i, i + n), n)
  }
  return l
}

const sine = (sr: number, secs: number, amp: number, f = 220) =>
  Float32Array.from(
    { length: Math.round(sr * secs) },
    (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr),
  )
const noise = (sr: number, secs: number) => {
  const rnd = lcg()
  return Float32Array.from({ length: Math.round(sr * secs) }, () => rnd() * 2 - 1)
}
const rms = (a: Float32Array, from = 0, to = a.length) => {
  let s = 0
  for (let i = from; i < to; i++) s += a[i] * a[i]
  return Math.sqrt(s / (to - from))
}
const peak = (a: Float32Array) => a.reduce((m, x) => Math.max(m, Math.abs(x)), 0)

describe(Fx.name, () => {
  it('has the plugin defaults and non-empty displays', () => {
    expect(Fx.params.map((p) => p.default)).toEqual(DEFAULTS)
    for (const p of Fx.params) {
      expect(p.name.length).toBeGreaterThan(0)
      for (const v of [0, 0.3, 1]) expect(p.display(v).length).toBeGreaterThan(0)
    }
  })

  it('stays silent on silence', () => {
    expect(peak(run(44100, DEFAULTS, new Float32Array(44100)))).toBeLessThan(1e-6)
    expect(peak(run(44100, COMPRESS, new Float32Array(44100)))).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`is finite and bounded at ${sr} Hz`, () => {
      for (const params of [DEFAULTS, COMPRESS]) {
        for (const input of [noise(sr, 2), sine(sr, 2, 1)]) {
          const out = run(sr, params, input)
          expect(out.every(Number.isFinite)).toBe(true)
          expect(peak(out)).toBeLessThan(4)
        }
      }
    })
  }

  it('reduces the loud/quiet level ratio when compressing', () => {
    const sr = 44100
    const input = new Float32Array(sr * 4)
    input.set(sine(sr, 2, 0.1), 0) // 2 s settling on the quiet level
    input.set(sine(sr, 1, 0.1), sr * 2)
    input.set(sine(sr, 1, 0.8), sr * 3)
    const ratioIn = rms(input, sr * 3, sr * 4) / rms(input, sr * 2, sr * 3)
    const out = run(sr, COMPRESS, input)
    const ratioOut = rms(out, sr * 3, sr * 4) / rms(out, sr * 2, sr * 3)
    expect(ratioOut).toBeLessThan(ratioIn)
  })

  it('is close to transparent at neutral settings', () => {
    const sr = 44100
    const input = sine(sr, 2, 0.5)
    const out = run(sr, NEUTRAL, input)
    const diff = 20 * Math.log10(rms(out, sr, 2 * sr) / rms(input, sr, 2 * sr))
    expect(Math.abs(diff)).toBeLessThan(3)
  })
})
