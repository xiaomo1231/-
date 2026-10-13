/**
 * Loudness and peak measurement after ITU-R BS.1770-4 / EBU R128 / EBU Tech 3342.
 *
 * Pure functions over Float32Array channels (no Web Audio), so they run in
 * Node/Vitest as well as in the browser. Channel weights are all 1.0 (mono or
 * stereo L/R); surround weighting is out of scope.
 */

/** Biquad coefficients, normalised so that a0 = 1. */
export interface Biquad {
  b0: number
  b1: number
  b2: number
  a1: number
  a2: number
}

/** The two K-weighting stages for a given sample rate. */
export interface KWeightingCoefficients {
  /** Stage 1: high-shelf "pre-filter" (~+4 dB above ~1.5 kHz, head effects). */
  shelf: Biquad
  /** Stage 2: RLB high-pass (~38 Hz). */
  highPass: Biquad
}

const ABSOLUTE_GATE_LUFS = -70
const RELATIVE_GATE_LU = -10
const LRA_RELATIVE_GATE_LU = -20
const LUFS_OFFSET = -0.691

/**
 * K-weighting coefficients for any sample rate, derived by bilinear transform
 * of the analogue prototypes (same formulation as libebur128). At 48 kHz they
 * reproduce the BS.1770 coefficient table.
 */
export function kWeightingCoefficients(sampleRate: number): KWeightingCoefficients {
  // Stage 1: high shelf.
  let f0 = 1681.974450955533
  const gainDb = 3.999843853973347
  let q = 0.7071752369554196
  let k = Math.tan((Math.PI * f0) / sampleRate)
  const vh = Math.pow(10, gainDb / 20)
  const vb = Math.pow(vh, 0.4996667741545416)
  let a0 = 1 + k / q + k * k
  const shelf: Biquad = {
    b0: (vh + (vb * k) / q + k * k) / a0,
    b1: (2 * (k * k - vh)) / a0,
    b2: (vh - (vb * k) / q + k * k) / a0,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  // Stage 2: RLB high-pass. The numerator is fixed at [1, -2, 1] as in the standard.
  f0 = 38.13547087602444
  q = 0.5003270373238773
  k = Math.tan((Math.PI * f0) / sampleRate)
  a0 = 1 + k / q + k * k
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / a0,
    a2: (1 - k / q + k * k) / a0,
  }
  return { shelf, highPass }
}

/**
 * Runs the K-weighting cascade over channel[from, to), carrying filter state in
 * `st` (6 values) between calls. Writes the output to `out` when given and
 * returns the sum of squared outputs.
 */
function kFilterRange(
  channel: Float32Array,
  from: number,
  to: number,
  c: KWeightingCoefficients,
  st: Float64Array,
  out: Float32Array | null,
): number {
  const { b0, b1, b2, a1, a2 } = c.shelf
  const ha1 = c.highPass.a1
  const ha2 = c.highPass.a2
  let sx1 = st[0] as number, sx2 = st[1] as number, sy1 = st[2] as number
  let sy2 = st[3] as number, hy1 = st[4] as number, hy2 = st[5] as number
  let energy = 0
  for (let i = from; i < to; i++) {
    const x = channel[i] as number
    const y1 = b0 * x + b1 * sx1 + b2 * sx2 - a1 * sy1 - a2 * sy2
    // The high-pass input history is the shelf output history (sy1/sy2) itself.
    const y2 = y1 - 2 * sy1 + sy2 - ha1 * hy1 - ha2 * hy2
    sx2 = sx1
    sx1 = x
    sy2 = sy1
    sy1 = y1
    hy2 = hy1
    hy1 = y2
    energy += y2 * y2
    if (out) out[i] = y2
  }
  st[0] = sx1; st[1] = sx2; st[2] = sy1; st[3] = sy2; st[4] = hy1; st[5] = hy2
  return energy
}

/** Applies the BS.1770 K-weighting filter (shelf + RLB high-pass) to one channel. */
export function kWeight(channel: Float32Array, sampleRate: number): Float32Array {
  const out = new Float32Array(channel.length)
  kFilterRange(channel, 0, channel.length, kWeightingCoefficients(sampleRate), new Float64Array(6), out)
  return out
}

/**
 * Sum over channels of the K-weighted energy in consecutive 100 ms hops.
 * Any trailing partial hop is dropped. Every loudness window is a whole number
 * of hops, so all measurements reuse these sums.
 */
function hopEnergies(channels: Float32Array[], sampleRate: number): { sums: Float64Array; hop: number } {
  const hop = Math.max(1, Math.round(sampleRate / 10))
  const length = channels.reduce((m, c) => Math.min(m, c.length), Infinity)
  const count = channels.length === 0 || !Number.isFinite(length) ? 0 : Math.floor(length / hop)
  const sums = new Float64Array(count)
  const coeffs = kWeightingCoefficients(sampleRate)
  for (const channel of channels) {
    const st = new Float64Array(6)
    for (let k = 0; k < count; k++) {
      sums[k] = (sums[k] as number) + kFilterRange(channel, k * hop, (k + 1) * hop, coeffs, st, null)
    }
  }
  return { sums, hop }
}

/** Mean-square power of each sliding window of `hopsPerWindow` hops (hop = 100 ms). */
function windowPowers(channels: Float32Array[], sampleRate: number, hopsPerWindow: number): Float64Array {
  const { sums, hop } = hopEnergies(channels, sampleRate)
  const count = Math.max(0, sums.length - hopsPerWindow + 1)
  const out = new Float64Array(count)
  const norm = 1 / (hop * hopsPerWindow)
  let acc = 0
  for (let i = 0; i < sums.length; i++) {
    acc += sums[i] as number
    if (i >= hopsPerWindow) acc -= sums[i - hopsPerWindow] as number
    if (i >= hopsPerWindow - 1) out[i - hopsPerWindow + 1] = Math.max(0, acc) * norm
  }
  return out
}

function powerToLufs(z: number): number {
  return z > 0 ? LUFS_OFFSET + 10 * Math.log10(z) : -Infinity
}

function lufsToPower(l: number): number {
  return Math.pow(10, (l - LUFS_OFFSET) / 10)
}

function toLufsSeries(powers: Float64Array): Float32Array {
  const out = new Float32Array(powers.length)
  for (let i = 0; i < powers.length; i++) out[i] = powerToLufs(powers[i] as number)
  return out
}

/** Momentary loudness (400 ms window), one value per 100 ms hop, in LUFS. */
export function momentaryLufs(channels: Float32Array[], sampleRate: number): Float32Array {
  return toLufsSeries(windowPowers(channels, sampleRate, 4))
}

/** Short-term loudness (3 s window), one value per 100 ms hop, in LUFS. */
export function shortTermLufs(channels: Float32Array[], sampleRate: number): Float32Array {
  return toLufsSeries(windowPowers(channels, sampleRate, 30))
}

/** Maximum short-term loudness in LUFS; -Infinity if shorter than 3 s or silent. */
export function maxShortTerm(channels: Float32Array[], sampleRate: number): number {
  let max = -Infinity
  for (const v of shortTermLufs(channels, sampleRate)) if (v > max) max = v
  return max
}

/**
 * Integrated (programme) loudness in LUFS: 400 ms blocks with 75 % overlap,
 * absolute gate at -70 LUFS, relative gate at -10 LU. -Infinity for silence or
 * input shorter than one block.
 */
export function integratedLufs(channels: Float32Array[], sampleRate: number): number {
  const blocks = windowPowers(channels, sampleRate, 4)
  const absPower = lufsToPower(ABSOLUTE_GATE_LUFS)
  let sum = 0
  let n = 0
  for (const z of blocks) {
    if (z > absPower) {
      sum += z
      n++
    }
  }
  if (n === 0) return -Infinity
  const relPower = lufsToPower(powerToLufs(sum / n) + RELATIVE_GATE_LU)
  sum = 0
  n = 0
  for (const z of blocks) {
    if (z > absPower && z > relPower) {
      sum += z
      n++
    }
  }
  return n === 0 ? -Infinity : powerToLufs(sum / n)
}

/**
 * Loudness range in LU (EBU Tech 3342): short-term values, -70 LUFS absolute
 * gate, -20 LU relative gate, spread between the 10th and 95th percentiles.
 * 0 when nothing passes the gates.
 */
export function loudnessRange(channels: Float32Array[], sampleRate: number): number {
  const powers = windowPowers(channels, sampleRate, 30)
  const absPower = lufsToPower(ABSOLUTE_GATE_LUFS)
  const gated: number[] = []
  let sum = 0
  for (const z of powers) {
    if (z > absPower) {
      gated.push(z)
      sum += z
    }
  }
  if (gated.length === 0) return 0
  const relPower = lufsToPower(powerToLufs(sum / gated.length) + LRA_RELATIVE_GATE_LU)
  const values = gated.filter((z) => z > relPower).map(powerToLufs)
  if (values.length === 0) return 0
  values.sort((a, b) => a - b)
  const pick = (p: number) => values[Math.floor((values.length - 1) * p + 0.5)] as number
  return pick(0.95) - pick(0.1)
}

/** Sample peak over all channels in dBFS; -Infinity for silence. */
export function samplePeakDb(channels: Float32Array[]): number {
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] as number)
      if (a > peak) peak = a
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

const OVERSAMPLE = 4
const HALF_TAPS = 6 // taps per phase = 2 * HALF_TAPS = 12 (48 over the 4 phases)
const TAPS = 2 * HALF_TAPS
const NPHASE = OVERSAMPLE - 1

/**
 * Polyphase interpolation filters for the fractional phases 1/4, 2/4, 3/4
 * (phase 0 is the original sample). Hann-windowed sinc, each phase normalised
 * to unity DC gain. Stored phase-major; tap j multiplies x[i + j - HALF_TAPS + 1]
 * for a point between x[i] and x[i + 1].
 */
const PHASE_TAPS: Float64Array = (() => {
  const taps = new Float64Array(NPHASE * TAPS)
  for (let p = 0; p < NPHASE; p++) {
    const frac = (p + 1) / OVERSAMPLE
    let sum = 0
    for (let j = 0; j < TAPS; j++) {
      const t = frac - (j - HALF_TAPS + 1) // distance from the interpolated point
      const v = ((Math.sin(Math.PI * t) / (Math.PI * t)) * (1 + Math.cos((Math.PI * t) / HALF_TAPS))) / 2
      taps[p * TAPS + j] = v
      sum += v
    }
    for (let j = 0; j < TAPS; j++) taps[p * TAPS + j] = (taps[p * TAPS + j] as number) / sum
  }
  return taps
})()

/**
 * Bounds for skipping work: |y| <= C_NEAR * max(|x[i]|, |x[i+1]|) + C_FAR * (max of
 * the other taps' inputs), taking the worst phase for each term.
 */
const [C_NEAR, C_FAR] = (() => {
  let near = 0
  let far = 0
  for (let p = 0; p < NPHASE; p++) {
    let n = 0
    let f = 0
    for (let j = 0; j < TAPS; j++) {
      const a = Math.abs(PHASE_TAPS[p * TAPS + j] as number)
      if (j === HALF_TAPS - 1 || j === HALF_TAPS) n += a
      else f += a
    }
    near = Math.max(near, n)
    far = Math.max(far, f)
  }
  return [near, far]
})()

const TP_BLOCK = 256

/** Max |y| over the three interpolated phases between x[i] and x[i + 1]. */
function interpolatedPeak(ch: Float32Array, i: number): number {
  const base = i - HALF_TAPS + 1
  let y1 = 0
  let y2 = 0
  let y3 = 0
  if (base >= 0 && base + TAPS <= ch.length) {
    for (let j = 0; j < TAPS; j++) {
      const v = ch[base + j] as number
      y1 += (PHASE_TAPS[j] as number) * v
      y2 += (PHASE_TAPS[TAPS + j] as number) * v
      y3 += (PHASE_TAPS[2 * TAPS + j] as number) * v
    }
  } else {
    // Near the edges: samples outside the signal count as zero.
    for (let j = 0; j < TAPS; j++) {
      const idx = base + j
      if (idx < 0 || idx >= ch.length) continue
      const v = ch[idx] as number
      y1 += (PHASE_TAPS[j] as number) * v
      y2 += (PHASE_TAPS[TAPS + j] as number) * v
      y3 += (PHASE_TAPS[2 * TAPS + j] as number) * v
    }
  }
  return Math.max(Math.abs(y1), Math.abs(y2), Math.abs(y3))
}

/**
 * True peak over all channels in dBTP: 4x oversampling with a windowed-sinc
 * polyphase FIR (samples outside the signal are zero). Points whose bound
 * cannot beat the running peak are skipped, which is exact and keeps the scan
 * cheap. `sampleRate` is unused (the filter is rate-relative) but kept for a
 * uniform signature.
 */
export function truePeakDb(channels: Float32Array[], _sampleRate: number): number {
  let peak = 0
  for (const ch of channels) {
    for (let i = 0; i < ch.length; i++) {
      const a = Math.abs(ch[i] as number)
      if (a > peak) peak = a
    }
  }
  for (const ch of channels) {
    const n = ch.length
    for (let start = 0; start < n; start += TP_BLOCK) {
      const end = Math.min(n, start + TP_BLOCK)
      // Max |x| over every sample an interpolated point in this block can touch.
      let localMax = 0
      const to = Math.min(n, end + HALF_TAPS)
      for (let i = Math.max(0, start - HALF_TAPS); i < to; i++) {
        const a = Math.abs(ch[i] as number)
        if (a > localMax) localMax = a
      }
      if (localMax * (C_NEAR + C_FAR) <= peak) continue
      // Points between x[i] and x[i + 1]; i = -1 covers the lead-in before x[0].
      for (let i = start === 0 ? -1 : start; i < end; i++) {
        const near = Math.max(i >= 0 ? Math.abs(ch[i] as number) : 0, i + 1 < n ? Math.abs(ch[i + 1] as number) : 0)
        if (near * C_NEAR + localMax * C_FAR <= peak) continue
        const y = interpolatedPeak(ch, i)
        if (y > peak) peak = y
      }
    }
  }
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity
}

/** Gain in dB that moves `currentLufs` to `targetLufs`; 0 when either is not finite. */
export function gainToTarget(currentLufs: number, targetLufs: number): number {
  if (!Number.isFinite(currentLufs) || !Number.isFinite(targetLufs)) return 0
  return targetLufs - currentLufs
}

/**
 * Linear gain to apply to B so its integrated loudness equals A's, for
 * comparing two versions at equal loudness. 1 when either is silent.
 */
export function levelMatchGain(a: Float32Array[], b: Float32Array[], sampleRate: number): number {
  const la = integratedLufs(a, sampleRate)
  const lb = integratedLufs(b, sampleRate)
  if (!Number.isFinite(la) || !Number.isFinite(lb)) return 1
  return Math.pow(10, (la - lb) / 20)
}
