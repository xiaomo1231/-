/**
 * Mixed-radix complex FFT (radices 4, 2, 3, 5 and a generic one) for any
 * length, used by the vocals separator (n = 7680 = 4⁴·2·3·5). Forward
 * transform, unnormalised: X[k] = Σ x[n]·e^(−2πikn/N). Not thread-safe: one
 * instance per worker.
 */
export class FFT {
  readonly n: number
  private readonly factors: number[] = []
  private readonly twRe: Float64Array
  private readonly twIm: Float64Array
  private readonly outRe: Float64Array
  private readonly outIm: Float64Array
  private readonly scrRe: Float64Array
  private readonly scrIm: Float64Array

  constructor(n: number) {
    this.n = n
    this.twRe = new Float64Array(n)
    this.twIm = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      const a = (-2 * Math.PI * i) / n
      this.twRe[i] = Math.cos(a)
      this.twIm[i] = Math.sin(a)
    }
    let m = n
    let p = 4
    while (m > 1) {
      while (m % p) {
        p = p === 4 ? 2 : p === 2 ? 3 : p + 2
        if (p * p > m) p = m
      }
      m /= p
      this.factors.push(p, m)
    }
    this.outRe = new Float64Array(n)
    this.outIm = new Float64Array(n)
    const maxP = Math.max(...this.factors.filter((_, i) => i % 2 === 0))
    this.scrRe = new Float64Array(maxP)
    this.scrIm = new Float64Array(maxP)
  }

  /** In-place forward FFT of (re, im). */
  forward(re: Float64Array, im: Float64Array): void {
    this.work(0, re, im, 0, 1, 0)
    re.set(this.outRe)
    im.set(this.outIm)
  }

  private work(out: number, re: Float64Array, im: Float64Array, inp: number, fstride: number, fi: number): void {
    const p = this.factors[fi]!
    const m = this.factors[fi + 1]!
    const oRe = this.outRe
    const oIm = this.outIm
    if (m === 1) {
      for (let k = 0; k < p; k++) {
        oRe[out + k] = re[inp + k * fstride]!
        oIm[out + k] = im[inp + k * fstride]!
      }
    } else {
      for (let q = 0; q < p; q++) this.work(out + q * m, re, im, inp + q * fstride, fstride * p, fi + 2)
    }
    if (p === 2) this.bfly2(out, fstride, m)
    else if (p === 4) this.bfly4(out, fstride, m)
    else if (p === 3) this.bfly3(out, fstride, m)
    else if (p === 5) this.bfly5(out, fstride, m)
    else this.bflyGeneric(out, fstride, m, p)
  }

  private bfly2(o: number, fs: number, m: number): void {
    const R = this.outRe
    const I = this.outIm
    for (let k = 0; k < m; k++) {
      const a = o + k
      const b = a + m
      const wr = this.twRe[k * fs]!
      const wi = this.twIm[k * fs]!
      const tr = R[b]! * wr - I[b]! * wi
      const ti = R[b]! * wi + I[b]! * wr
      R[b] = R[a]! - tr
      I[b] = I[a]! - ti
      R[a] = R[a]! + tr
      I[a] = I[a]! + ti
    }
  }

  private bfly4(o: number, fs: number, m: number): void {
    const R = this.outRe
    const I = this.outIm
    const TR = this.twRe
    const TI = this.twIm
    for (let k = 0; k < m; k++) {
      const i0 = o + k
      const i1 = i0 + m
      const i2 = i1 + m
      const i3 = i2 + m
      const w1r = TR[k * fs]!, w1i = TI[k * fs]!
      const w2r = TR[2 * k * fs]!, w2i = TI[2 * k * fs]!
      const w3r = TR[3 * k * fs]!, w3i = TI[3 * k * fs]!
      const s0r = R[i1]! * w1r - I[i1]! * w1i, s0i = R[i1]! * w1i + I[i1]! * w1r
      const s1r = R[i2]! * w2r - I[i2]! * w2i, s1i = R[i2]! * w2i + I[i2]! * w2r
      const s2r = R[i3]! * w3r - I[i3]! * w3i, s2i = R[i3]! * w3i + I[i3]! * w3r
      const s5r = R[i0]! - s1r, s5i = I[i0]! - s1i
      const ar = R[i0]! + s1r, ai = I[i0]! + s1i
      const s3r = s0r + s2r, s3i = s0i + s2i
      const s4r = s0r - s2r, s4i = s0i - s2i
      R[i2] = ar - s3r
      I[i2] = ai - s3i
      R[i0] = ar + s3r
      I[i0] = ai + s3i
      // forward: multiply s4 by −i
      R[i1] = s5r + s4i
      I[i1] = s5i - s4r
      R[i3] = s5r - s4i
      I[i3] = s5i + s4r
    }
  }

  private bfly3(o: number, fs: number, m: number): void {
    const R = this.outRe
    const I = this.outIm
    const epi = this.twIm[fs * m]! // sin(−2π/3)
    for (let k = 0; k < m; k++) {
      const i0 = o + k
      const i1 = i0 + m
      const i2 = i1 + m
      const w1r = this.twRe[k * fs]!, w1i = this.twIm[k * fs]!
      const w2r = this.twRe[2 * k * fs]!, w2i = this.twIm[2 * k * fs]!
      const s1r = R[i1]! * w1r - I[i1]! * w1i, s1i = R[i1]! * w1i + I[i1]! * w1r
      const s2r = R[i2]! * w2r - I[i2]! * w2i, s2i = R[i2]! * w2i + I[i2]! * w2r
      const s3r = s1r + s2r, s3i = s1i + s2i
      const s0r = s1r - s2r, s0i = s1i - s2i
      const br = R[i0]! - s3r * 0.5, bi = I[i0]! - s3i * 0.5
      const tr = s0r * epi, ti = s0i * epi
      R[i0] = R[i0]! + s3r
      I[i0] = I[i0]! + s3i
      R[i2] = br + ti
      I[i2] = bi - tr
      R[i1] = br - ti
      I[i1] = bi + tr
    }
  }

  private bfly5(o: number, fs: number, m: number): void {
    const R = this.outRe
    const I = this.outIm
    const TR = this.twRe
    const TI = this.twIm
    const yar = TR[fs * m]!, yai = TI[fs * m]!
    const ybr = TR[2 * fs * m]!, ybi = TI[2 * fs * m]!
    for (let u = 0; u < m; u++) {
      const i0 = o + u, i1 = i0 + m, i2 = i1 + m, i3 = i2 + m, i4 = i3 + m
      const z0r = R[i0]!, z0i = I[i0]!
      const mul = (idx: number, t: number): [number, number] => [R[idx]! * TR[t]! - I[idx]! * TI[t]!, R[idx]! * TI[t]! + I[idx]! * TR[t]!]
      const [z1r, z1i] = mul(i1, u * fs)
      const [z2r, z2i] = mul(i2, 2 * u * fs)
      const [z3r, z3i] = mul(i3, 3 * u * fs)
      const [z4r, z4i] = mul(i4, 4 * u * fs)
      const s7r = z1r + z4r, s7i = z1i + z4i
      const s10r = z1r - z4r, s10i = z1i - z4i
      const s8r = z2r + z3r, s8i = z2i + z3i
      const s9r = z2r - z3r, s9i = z2i - z3i
      R[i0] = z0r + s7r + s8r
      I[i0] = z0i + s7i + s8i
      const s5r = z0r + s7r * yar + s8r * ybr
      const s5i = z0i + s7i * yar + s8i * ybr
      const s6r = s10i * yai + s9i * ybi
      const s6i = -(s10r * yai) - s9r * ybi
      R[i1] = s5r - s6r
      I[i1] = s5i - s6i
      R[i4] = s5r + s6r
      I[i4] = s5i + s6i
      const s11r = z0r + s7r * ybr + s8r * yar
      const s11i = z0i + s7i * ybr + s8i * yar
      const s12r = -(s10i * ybi) + s9i * yai
      const s12i = s10r * ybi - s9r * yai
      R[i2] = s11r + s12r
      I[i2] = s11i + s12i
      R[i3] = s11r - s12r
      I[i3] = s11i - s12i
    }
  }

  private bflyGeneric(o: number, fs: number, m: number, p: number): void {
    const R = this.outRe
    const I = this.outIm
    const n = this.n
    for (let u = 0; u < m; u++) {
      for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
        this.scrRe[q1] = R[o + k]!
        this.scrIm[q1] = I[o + k]!
      }
      for (let q1 = 0, k = u; q1 < p; q1++, k += m) {
        let tw = 0
        let ar = this.scrRe[0]!
        let ai = this.scrIm[0]!
        for (let q = 1; q < p; q++) {
          tw += fs * k
          if (tw >= n) tw -= n
          ar += this.scrRe[q]! * this.twRe[tw]! - this.scrIm[q]! * this.twIm[tw]!
          ai += this.scrRe[q]! * this.twIm[tw]! + this.scrIm[q]! * this.twRe[tw]!
        }
        R[o + k] = ar
        I[o + k] = ai
      }
    }
  }
}
