/**
 * RMVPE (0.24.0), the signal part (pure, no ONNX): the singer's pitch in a
 * vocals stem, robust to leftover backing and reverb from separation, where
 * YIN finds nothing. Same input as RVC's RMVPE: 16 kHz mono → 1024-point STFT
 * (hop 160 = 10 ms, periodic Hann, reflection-padded, magnitude) → 128 HTK mel
 * bands 30–8000 Hz (Slaney-normalised, as librosa) → log(max(x, 1e-5)). The
 * model returns a 360-bin salience per frame (20 cents apart), decoded as a
 * weighted average of the 9 bins around the peak; a peak ≤ 0.03 is unvoiced.
 *
 * Model input [1, 128, frames padded to a multiple of 32] → output [1, frames, 360].
 */
import { FFT } from '@/audio/separation/fft'

export const RMVPE_RATE = 16000
export const RMVPE_HOP = 160
const N_FFT = 1024
const N_MELS = 128
const BINS = N_FFT / 2 + 1
export const RMVPE_SALIENCE = 360
const THRESHOLD = 0.03

const hzToMel = (f: number) => 2595 * Math.log10(1 + f / 700)
const melToHz = (m: number) => 700 * (10 ** (m / 2595) - 1)

/** librosa.filters.mel(sr=16000, n_fft=1024, n_mels=128, fmin=30, fmax=8000, htk=True): [mel][bin]. */
export const melBasis: Float32Array[] = (() => {
  const mels = Array.from({ length: N_MELS + 2 }, (_, i) =>
    melToHz(hzToMel(30) + ((hzToMel(8000) - hzToMel(30)) * i) / (N_MELS + 1)),
  )
  const freqs = Array.from({ length: BINS }, (_, k) => (k * RMVPE_RATE) / N_FFT)
  return Array.from({ length: N_MELS }, (_, m) => {
    const row = new Float32Array(BINS)
    const lo = mels[m]!
    const mid = mels[m + 1]!
    const hi = mels[m + 2]!
    const norm = 2 / (hi - lo)
    for (let k = 0; k < BINS; k++) {
      const f = freqs[k]!
      const w = Math.max(0, Math.min((f - lo) / (mid - lo), (hi - f) / (hi - mid)))
      row[k] = w * norm
    }
    return row
  })
})()

const window = (() => {
  const w = new Float64Array(N_FFT)
  for (let n = 0; n < N_FFT; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)
  return w
})()

/** Number of frames for `n` samples (centred STFT). */
export const rmvpeFrames = (n: number) => Math.floor(n / RMVPE_HOP) + 1

/**
 * Log-mel spectrogram, [mel][frame] row-major, frames padded with zeros to
 * `padTo` (a multiple of 32 for the model).
 */
export function rmvpeMel(x: Float32Array, padTo = rmvpeFrames(x.length)): Float32Array {
  const frames = rmvpeFrames(x.length)
  const out = new Float32Array(N_MELS * padTo)
  const fft = new FFT(N_FFT)
  const re = new Float64Array(N_FFT)
  const im = new Float64Array(N_FFT)
  const mag = new Float64Array(BINS)
  const half = N_FFT / 2
  const n = x.length
  // Reflection padding as numpy / torch "reflect" (edge not repeated).
  const at = (i: number) => {
    if (n === 1) return x[0]!
    let j = i
    while (j < 0 || j >= n) j = j < 0 ? -j : 2 * (n - 1) - j
    return x[j]!
  }
  for (let f = 0; f < frames; f++) {
    const start = f * RMVPE_HOP - half
    for (let i = 0; i < N_FFT; i++) {
      re[i] = at(start + i) * window[i]!
      im[i] = 0
    }
    fft.forward(re, im)
    for (let k = 0; k < BINS; k++) mag[k] = Math.hypot(re[k]!, im[k]!)
    for (let m = 0; m < N_MELS; m++) {
      const row = melBasis[m]!
      let s = 0
      for (let k = 0; k < BINS; k++) s += row[k]! * mag[k]!
      out[m * padTo + f] = Math.log(Math.max(s, 1e-5))
    }
  }
  // Padded frames: log(1e-5) like zero energy? RVC pads the mel with 0 (constant), so do the same.
  return out
}

const CENTS = (() => {
  const c = new Float64Array(RMVPE_SALIENCE + 8)
  for (let i = 0; i < RMVPE_SALIENCE; i++) c[i + 4] = 20 * i + 1997.3794084376191
  return c
})()

/** Salience [frames][360] → fundamental per frame in Hz (0 = unvoiced). */
export function rmvpeDecode(
  hidden: Float32Array,
  frames: number,
  threshold = THRESHOLD,
): Float32Array {
  const f0 = new Float32Array(frames)
  for (let t = 0; t < frames; t++) {
    const base = t * RMVPE_SALIENCE
    let best = 0
    let peak = -Infinity
    for (let i = 0; i < RMVPE_SALIENCE; i++) {
      const v = hidden[base + i]!
      if (v > peak) {
        peak = v
        best = i
      }
    }
    if (peak <= threshold) continue
    let num = 0
    let den = 0
    for (let i = best - 4; i <= best + 4; i++) {
      if (i < 0 || i >= RMVPE_SALIENCE) continue
      const v = hidden[base + i]!
      num += v * CENTS[i + 4]!
      den += v
    }
    if (den > 0) f0[t] = 10 * 2 ** (num / den / 1200)
  }
  return f0
}

/** Long songs go through the model in pieces of this many frames, overlapping by CONTEXT on each side. */
export const RMVPE_PIECE = 4096
export const RMVPE_CONTEXT = 128

/** Frame ranges to run: [start, end) with context, and the part of each to keep. */
export function rmvpePieces(
  frames: number,
): Array<{ from: number; to: number; keepFrom: number; keepTo: number }> {
  if (frames <= RMVPE_PIECE + 2 * RMVPE_CONTEXT)
    return [{ from: 0, to: frames, keepFrom: 0, keepTo: frames }]
  const out: Array<{ from: number; to: number; keepFrom: number; keepTo: number }> = []
  for (let k = 0; k < frames; k += RMVPE_PIECE) {
    const keepTo = Math.min(frames, k + RMVPE_PIECE)
    out.push({
      from: Math.max(0, k - RMVPE_CONTEXT),
      to: Math.min(frames, keepTo + RMVPE_CONTEXT),
      keepFrom: k,
      keepTo,
    })
  }
  return out
}
