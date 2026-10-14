import { describe, expect, it } from 'vitest'
import { kPlateD } from '@/audio/fx/airwindows/kPlateD'

function lcg(seed = 12345) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return (s / 4294967296) * 2 - 1
  }
}

function run(sr: number, secs: number, params: number[], gen: (i: number) => number) {
  const n = Math.floor(sr * secs)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) l[i] = r[i] = gen(i)
  const fx = kPlateD.create(sr)
  fx.setParams(params)
  const inL = Float32Array.from(l)
  for (let o = 0; o < n; o += 128) {
    const m = Math.min(128, n - o)
    fx.process(l.subarray(o, o + m), r.subarray(o, o + m), m)
  }
  return { l, r, inL }
}

const energy = (x: Float32Array, sr: number, a: number, b: number) => {
  let e = 0
  for (let i = Math.floor(a * sr); i < Math.floor(b * sr); i++) e += x[i] * x[i]
  return e
}

const burst = (sr: number) => {
  const rnd = lcg(7)
  return (i: number) => (i < sr * 0.01 ? rnd() * 0.5 : 0)
}

describe('kPlateD', () => {
  it('defaults match the constructor and displays are non-empty', () => {
    expect(kPlateD.params.map((p) => p.name)).toEqual([
      'InputPad',
      'Damping',
      'Low Cut',
      'Predelay',
      'Wetness',
    ])
    expect(kPlateD.params.map((p) => p.default)).toEqual([1, 0.5, 1, 0, 0.25])
    for (const p of kPlateD.params)
      for (const v of [0, 0.5, 1]) expect(p.display(v).length).toBeGreaterThan(0)
  })

  it('silence in gives silence out', () => {
    const { l, r } = run(44100, 1, [1, 0.5, 1, 0, 1], () => 0)
    expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`stays finite and bounded at ${sr} Hz`, () => {
      const rnd = lcg(99)
      for (const gen of [() => rnd(), (i: number) => Math.sin((2 * Math.PI * 220 * i) / sr)]) {
        const { l, r } = run(sr, 2, [1, 0.5, 1, 0, 1], gen)
        let peak = 0
        for (let i = 0; i < l.length; i++) {
          expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true)
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
        }
        expect(peak).toBeLessThan(4)
      }
    })
  }

  it('has a decaying tail', () => {
    const sr = 44100
    const { l } = run(sr, 3, [1, 0.5, 1, 0, 1], burst(sr))
    const early = energy(l, sr, 0.3, 0.8)
    expect(energy(l, sr, 0.3, 0.8)).toBeGreaterThan(1e-8)
    expect(energy(l, sr, 2.0, 2.5)).toBeLessThan(early)
  })

  it('larger Damping parameter gives a longer tail', () => {
    const sr = 44100
    const small = run(sr, 4, [1, 0, 1, 0, 1], burst(sr)).l
    const large = run(sr, 4, [1, 1, 1, 0, 1], burst(sr)).l
    const ratio = (x: Float32Array) => energy(x, sr, 2.5, 3.5) / energy(x, sr, 0.3, 0.8)
    expect(ratio(large)).toBeGreaterThan(ratio(small))
  })

  it('fully dry passes the input through', () => {
    const sr = 48000
    const rnd = lcg(5)
    const { l, inL } = run(sr, 0.5, [1, 0.5, 1, 0, 0], () => rnd() * 0.5)
    // regenerate the same input for comparison
    const rnd2 = lcg(5)
    for (let i = 0; i < l.length; i++) {
      expect(Math.abs(l[i] - Math.fround(rnd2() * 0.5))).toBeLessThan(1e-6)
    }
    void inL
  })
})
