import { describe, expect, it } from 'vitest'
import { FFT } from '@/audio/separation/fft'
import { CHUNK, CHUNK_VALUES, DIM_F, DIM_T, HOP, MdxDsp, N_FFT, TRIM, mdxPlan, readChunk } from '@/audio/separation/mdx'

function dft(re: number[], im: number[]): [number[], number[]] {
  const n = re.length
  const oR: number[] = []
  const oI: number[] = []
  for (let k = 0; k < n; k++) {
    let a = 0
    let b = 0
    for (let j = 0; j < n; j++) {
      const t = (-2 * Math.PI * k * j) / n
      a += re[j]! * Math.cos(t) - im[j]! * Math.sin(t)
      b += re[j]! * Math.sin(t) + im[j]! * Math.cos(t)
    }
    oR.push(a)
    oI.push(b)
  }
  return [oR, oI]
}

describe('mixed-radix FFT', () => {
  for (const n of [8, 60, 30, 49, 120, 7680 / 64]) {
    it(`matches the DFT for n = ${n}`, () => {
      const re = Array.from({ length: n }, (_, i) => Math.sin(i * 0.7) + (i % 3))
      const im = Array.from({ length: n }, (_, i) => Math.cos(i * 1.3) - (i % 5) * 0.2)
      const [er, ei] = dft(re, im)
      const r = Float64Array.from(re)
      const m = Float64Array.from(im)
      new FFT(n).forward(r, m)
      for (let k = 0; k < n; k++) {
        expect(r[k]).toBeCloseTo(er[k]!, 8)
        expect(m[k]).toBeCloseTo(ei[k]!, 8)
      }
    })
  }
})

describe('MDX STFT', () => {
  const left = new Float32Array(CHUNK)
  const right = new Float32Array(CHUNK)
  for (let i = 0; i < CHUNK; i++) {
    left[i] = 0.3 * Math.sin((2 * Math.PI * 440 * i) / 44100) + 0.1 * Math.sin((2 * Math.PI * 3000 * i) / 44100)
    right[i] = 0.2 * Math.sin((2 * Math.PI * 220 * i) / 44100 + 1) + 0.05 * Math.sin((2 * Math.PI * 9000 * i) / 44100)
  }
  const dsp = new MdxDsp()
  const spec = new Float32Array(CHUNK_VALUES)
  dsp.stft(left, right, spec, 0)

  it('gives the same values as a direct transform of the frame (window, reflection, layout)', () => {
    const plane = DIM_F * DIM_T
    for (const [t, k] of [
      [0, 10],
      [128, 100],
      [255, 41],
    ] as const) {
      let lr = 0, li = 0, rr = 0, ri = 0
      for (let n = 0; n < N_FFT; n++) {
        let i = t * HOP - N_FFT / 2 + n
        if (i < 0) i = -i
        else if (i >= CHUNK) i = 2 * (CHUNK - 1) - i
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)
        const a = (-2 * Math.PI * k * n) / N_FFT
        lr += left[i]! * w * Math.cos(a)
        li += left[i]! * w * Math.sin(a)
        rr += right[i]! * w * Math.cos(a)
        ri += right[i]! * w * Math.sin(a)
      }
      const o = k * DIM_T + t
      expect(spec[o]).toBeCloseTo(lr, 2)
      expect(spec[plane + o]).toBeCloseTo(li, 2)
      expect(spec[2 * plane + o]).toBeCloseTo(rr, 2)
      expect(spec[3 * plane + o]).toBeCloseTo(ri, 2)
    }
  })

  it('turns an unchanged spectrum back into the same sound', () => {
    const outL = new Float32Array(CHUNK)
    const outR = new Float32Array(CHUNK)
    dsp.istft(spec, 0, outL, outR)
    let err = 0
    let sig = 0
    for (let i = 0; i < CHUNK; i++) {
      err += (outL[i]! - left[i]!) ** 2 + (outR[i]! - right[i]!) ** 2
      sig += left[i]! ** 2 + right[i]! ** 2
    }
    expect(10 * Math.log10(sig / err)).toBeGreaterThan(60)
  }, 20000)
})

describe('MDX chunk plan', () => {
  it('covers the whole song with padding like UVR', () => {
    const total = 44100 * 20
    const { padded, chunks } = mdxPlan(total, 0.25)
    expect(padded).toBeGreaterThan(total + TRIM)
    expect(chunks[0]!.start).toBe(0)
    expect(chunks[chunks.length - 1]!.start).toBeLessThan(padded)
    expect(chunks[1]!.start).toBe(Math.floor(0.75 * CHUNK))
    const src = Float32Array.from({ length: 10 }, (_, i) => i + 1)
    const out = new Float32Array(CHUNK)
    readChunk(src, 0, out)
    expect(out[TRIM - 1]).toBe(0)
    expect(out[TRIM]).toBe(1)
  })
})
