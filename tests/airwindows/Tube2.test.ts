import { describe, expect, it } from 'vitest'
import { Tube2 } from '@/audio/fx/airwindows/Tube2'

function lcg(seed = 12345) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return (s / 4294967296) * 2 - 1
  }
}

function run(sr: number, params: number[], gen: (i: number) => number, seconds: number) {
  const fx = Tube2.create(sr)
  fx.setParams(params)
  const n = Math.floor(sr * seconds)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) l[i] = r[i] = gen(i)
  const block = 512
  for (let o = 0; o < n; o += block) {
    const m = Math.min(block, n - o)
    fx.process(l.subarray(o, o + m), r.subarray(o, o + m), m)
  }
  return l
}

function goertzel(x: Float32Array, sr: number, f: number) {
  const w = (2 * Math.PI * f) / sr
  let re = 0
  let im = 0
  for (let i = 0; i < x.length; i++) {
    re += x[i] * Math.cos(w * i)
    im += x[i] * Math.sin(w * i)
  }
  return Math.sqrt(re * re + im * im) / x.length
}

function rms(x: Float32Array, from = 0) {
  let s = 0
  for (let i = from; i < x.length; i++) s += x[i] * x[i]
  return Math.sqrt(s / (x.length - from))
}

const DEFAULTS = Tube2.params.map((p) => p.default)
const HI = [1, 0.9]
const LO = [1, 0]
const NEUTRAL = [0.5, 0] // input -6 dB cancels the tube stage's ~+6 dB small-signal gain

describe('Tube2', () => {
  it('has the constructor defaults and displays', () => {
    expect(DEFAULTS).toEqual([0.5, 0.5])
    for (const p of Tube2.params) {
      for (const v of [0, p.default, 1]) expect(p.display(v).length).toBeGreaterThan(0)
    }
  })

  it('stays silent on silence', () => {
    const out = run(44100, DEFAULTS, () => 0, 1)
    expect(Math.max(...Array.from(out, Math.abs))).toBeLessThan(1e-5)
  })

  for (const sr of [44100, 48000]) {
    it(`is finite and bounded at ${sr} Hz`, () => {
      const rnd = lcg()
      for (const params of [DEFAULTS, HI]) {
        for (const gen of [() => rnd(), (i: number) => Math.sin((2 * Math.PI * 220 * i) / sr)]) {
          const out = run(sr, params, gen, 2)
          let peak = 0
          for (const v of out) {
            expect(Number.isFinite(v)).toBe(true)
            peak = Math.max(peak, Math.abs(v))
          }
          expect(peak).toBeLessThan(4)
        }
      }
    })
  }

  it('adds harmonics when driven harder', () => {
    const sr = 44100
    const sine = (i: number) => 0.5 * Math.sin((2 * Math.PI * 220 * i) / sr)
    const ratio = (params: number[]) => {
      const o = run(sr, params, sine, 1).subarray(sr / 2)
      return (goertzel(o, sr, 440) + goertzel(o, sr, 660)) / goertzel(o, sr, 220)
    }
    expect(ratio(HI)).toBeGreaterThan(ratio(LO))
  })

  it('keeps level within 3 dB at neutral settings', () => {
    const sr = 44100
    const o = run(sr, NEUTRAL, (i) => 0.2 * Math.sin((2 * Math.PI * 1000 * i) / sr), 1)
    const db = 20 * Math.log10(rms(o, sr / 2) / (0.2 / Math.SQRT2))
    expect(db).toBeGreaterThan(-3)
    expect(db).toBeLessThan(3)
  })
})
