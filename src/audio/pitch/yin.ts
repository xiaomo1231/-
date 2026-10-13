/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002),
 * steps 2–5: difference function, cumulative mean normalisation, absolute
 * threshold, parabolic interpolation. Pure function so it can be unit-tested
 * with synthetic signals.
 */
export interface YinOptions {
  sampleRate: number
  /** Lowest frequency to search (Hz). Sets the largest lag. */
  minFreq: number
  /** Highest frequency to search (Hz). Sets the smallest lag. */
  maxFreq: number
  /** Aperiodicity threshold; 0.1–0.2 is typical. */
  threshold?: number
}

export interface YinResult {
  /** Estimated f0 in Hz, or null when unvoiced. */
  freq: number | null
  /** 1 − aperiodicity at the chosen lag (0–1, higher = more periodic). */
  clarity: number
}

export function yin(buf: Float32Array, opts: YinOptions): YinResult {
  const threshold = opts.threshold ?? 0.15
  const maxLag = Math.min(Math.floor(opts.sampleRate / opts.minFreq), Math.floor(buf.length / 2))
  const minLag = Math.max(2, Math.floor(opts.sampleRate / opts.maxFreq))
  if (maxLag <= minLag + 2) return { freq: null, clarity: 0 }
  const window = buf.length - maxLag
  const diff = new Float32Array(maxLag + 1)

  // Step 2: difference function.
  for (let tau = 1; tau <= maxLag; tau++) {
    let sum = 0
    for (let i = 0; i < window; i++) {
      const d = buf[i]! - buf[i + tau]!
      sum += d * d
    }
    diff[tau] = sum
  }

  // Step 3: cumulative mean normalised difference.
  const cmnd = new Float32Array(maxLag + 1)
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau <= maxLag; tau++) {
    running += diff[tau]!
    cmnd[tau] = running === 0 ? 1 : (diff[tau]! * tau) / running
  }

  // Step 4: first dip under the threshold, then walk to its local minimum.
  let tauEst = -1
  for (let tau = minLag; tau <= maxLag; tau++) {
    if (cmnd[tau]! < threshold) {
      while (tau + 1 <= maxLag && cmnd[tau + 1]! < cmnd[tau]!) tau++
      tauEst = tau
      break
    }
  }
  if (tauEst === -1) {
    // No dip under threshold: report the global minimum's clarity but unvoiced.
    let minVal = 1
    for (let tau = minLag; tau <= maxLag; tau++) minVal = Math.min(minVal, cmnd[tau]!)
    return { freq: null, clarity: Math.max(0, 1 - minVal) }
  }

  // Step 5: parabolic interpolation around the minimum.
  let better = tauEst
  if (tauEst > 1 && tauEst < maxLag) {
    const s0 = cmnd[tauEst - 1]!
    const s1 = cmnd[tauEst]!
    const s2 = cmnd[tauEst + 1]!
    const denom = 2 * (2 * s1 - s2 - s0)
    if (denom !== 0) better = tauEst + (s2 - s0) / denom
  }
  return { freq: opts.sampleRate / better, clarity: Math.max(0, Math.min(1, 1 - cmnd[tauEst]!)) }
}

/** Root-mean-square level of a buffer. */
export function rms(buf: Float32Array): number {
  let s = 0
  for (let i = 0; i < buf.length; i++) s += buf[i]! * buf[i]!
  return Math.sqrt(s / buf.length)
}
