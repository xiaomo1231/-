import { describe, expect, it } from 'vitest'
import { Verbity2 } from '@/audio/fx/airwindows/Verbity2'

function lcg(seed = 12345) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 2147483648 - 1
  }
}

function run(sr: number, params: number[], input: Float32Array) {
  const fx = Verbity2.create(sr)
  fx.setParams(params)
  const l = Float32Array.from(input)
  const r = Float32Array.from(input)
  const t0 = performance.now()
  for (let i = 0; i < l.length; i += 512) {
    const n = Math.min(512, l.length - i)
    fx.process(l.subarray(i, i + n), r.subarray(i, i + n), n)
  }
  return { l, r, ms: performance.now() - t0 }
}

const energy = (x: Float32Array, sr: number, t0: number, t1: number) => {
  let e = 0
  for (let i = Math.floor(t0 * sr); i < Math.floor(t1 * sr); i++) e += x[i] * x[i]
  return e
}

function burst(sr: number, seconds: number) {
  const x = new Float32Array(Math.floor(sr * seconds))
  const rnd = lcg(7)
  for (let i = 0; i < Math.floor(sr * 0.01); i++) x[i] = rnd() * 0.5
  return x
}

describe('Verbity2', () => {
  it('defaults match the plugin and displays are non-empty', () => {
    expect(Verbity2.params.map((p) => p.name)).toEqual(['RmSize', 'Sustain', 'Mulch', 'Wetness'])
    expect(Verbity2.params.map((p) => p.default)).toEqual([0.5, 0.5, 0.5, 1.0])
    for (const p of Verbity2.params) expect(p.display(p.default).length).toBeGreaterThan(0)
  })

  it('silence in gives silence out', () => {
    const { l, r } = run(
      44100,
      Verbity2.params.map((p) => p.default),
      new Float32Array(44100),
    )
    expect(Math.max(...l.map(Math.abs), ...r.map(Math.abs))).toBeLessThan(1e-6)
  })

  for (const sr of [44100, 48000]) {
    it(`stays finite and bounded at ${sr} Hz`, () => {
      const n = sr * 2
      const rnd = lcg(99)
      const noise = new Float32Array(n).map(() => rnd())
      const sine = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 220 * i) / sr))
      for (const input of [noise, sine]) {
        const { l, r, ms } = run(
          sr,
          Verbity2.params.map((p) => p.default),
          input,
        )
        let peak = 0
        for (let i = 0; i < n; i++) {
          expect(Number.isFinite(l[i]) && Number.isFinite(r[i])).toBe(true)
          peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
        }
        expect(peak).toBeLessThan(4)
        console.log(`Verbity2 ${sr} Hz: ${(ms / 2).toFixed(1)} ms CPU per second of stereo`)
      }
    })
  }

  it('makes a decaying tail, longer with more Sustain, and is transparent when dry', () => {
    const sr = 44100
    const x = burst(sr, 3)
    const long = run(sr, [0.5, 1, 0.5, 1], x).l
    expect(energy(long, sr, 0.3, 0.8)).toBeGreaterThan(1e-6)
    expect(energy(long, sr, 2.0, 2.5)).toBeLessThan(energy(long, sr, 0.3, 0.8))
    const short = run(sr, [0.5, 0.1, 0.5, 1], x).l
    expect(energy(long, sr, 1.0, 2.0)).toBeGreaterThan(energy(short, sr, 1.0, 2.0))
    const dry = run(sr, [0.5, 0.5, 0.5, 0], x).l
    // dry = 1 and wet = 0 at Wetness 0, but the highpass-less dry path is the untouched input
    for (let i = 0; i < x.length; i++) expect(Math.abs(dry[i] - x[i])).toBeLessThan(1e-6)
  })
})
