/**
 * MDX-Net vocals separation, the signal part (pure, no ONNX): the same STFT,
 * chunking and overlap-add as UVR / audio-separator, so the model sees exactly
 * what it was trained on.
 *
 * Model UVR-MDX-NET-Voc_FT: input / output [batch, 4, 3072, 256] — per chunk
 * the left and right spectra (real, imaginary) of 256 frames, bins 0–3071 of a
 * 7680-point STFT (hop 1024, periodic Hann, centred with reflection). The
 * output is the vocals spectrum; the backing is the mix minus the vocals.
 */
import { FFT } from './fft'

export const MDX_RATE = 44100
export const N_FFT = 7680
export const HOP = 1024
export const DIM_F = 3072
export const DIM_T = 256
/** Samples per chunk: 261 120 (5.9 s). */
export const CHUNK = HOP * (DIM_T - 1)
export const TRIM = N_FFT / 2
/** UVR's output gain for this model. */
export const COMPENSATE = 1.021
/** Values per chunk in the model tensor. */
export const CHUNK_VALUES = 4 * DIM_F * DIM_T


/** Periodic Hann window of the STFT. */
const stftWindow = (() => {
  const w = new Float64Array(N_FFT)
  for (let n = 0; n < N_FFT; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / N_FFT)
  return w
})()

/** Sum of squared windows over the chunk (istft normalisation), for samples 0…CHUNK−1. */
const envelope = (() => {
  const full = new Float64Array(N_FFT + HOP * (DIM_T - 1))
  for (let t = 0; t < DIM_T; t++) for (let n = 0; n < N_FFT; n++) full[t * HOP + n]! += stftWindow[n]! * stftWindow[n]!
  return full.subarray(N_FFT / 2, N_FFT / 2 + CHUNK).slice()
})()

/**
 * Reusable buffers for one worker. `fft` is shared by forward and inverse
 * transforms (L and R go through one complex FFT together).
 */
export class MdxDsp {
  private readonly fft = new FFT(N_FFT)
  private readonly re = new Float64Array(N_FFT)
  private readonly im = new Float64Array(N_FFT)
  private readonly olaL = new Float64Array(N_FFT + HOP * (DIM_T - 1))
  private readonly olaR = new Float64Array(N_FFT + HOP * (DIM_T - 1))

  /**
   * Spectrum of one chunk (CHUNK samples of left / right, zero beyond `length`)
   * into `out` at item `b` of a batch tensor.
   */
  stft(left: Float32Array, right: Float32Array, out: Float32Array, b: number): void {
    const { re, im } = this
    const L = CHUNK
    const half = N_FFT / 2
    const base = b * CHUNK_VALUES
    const plane = DIM_F * DIM_T
    for (let t = 0; t < DIM_T; t++) {
      const c = t * HOP - half
      for (let n = 0; n < N_FFT; n++) {
        let i = c + n
        // torch.stft(center=True) pads by reflection
        if (i < 0) i = -i
        else if (i >= L) i = 2 * (L - 1) - i
        const w = stftWindow[n]!
        re[n] = left[i]! * w
        im[n] = right[i]! * w
      }
      this.fft.forward(re, im)
      for (let k = 0; k < DIM_F; k++) {
        const j = k === 0 ? 0 : N_FFT - k
        const o = k * DIM_T + t
        out[base + o] = (re[k]! + re[j]!) / 2 // L re
        out[base + plane + o] = (im[k]! - im[j]!) / 2 // L im
        out[base + 2 * plane + o] = (im[k]! + im[j]!) / 2 // R re
        out[base + 3 * plane + o] = -(re[k]! - re[j]!) / 2 // R im
      }
    }
  }

  /** Waveform of item `b` of a model output (CHUNK samples per channel) into outL / outR. */
  istft(spec: Float32Array, b: number, outL: Float32Array, outR: Float32Array): void {
    const { re, im, olaL, olaR } = this
    const base = b * CHUNK_VALUES
    const plane = DIM_F * DIM_T
    olaL.fill(0)
    olaR.fill(0)
    for (let t = 0; t < DIM_T; t++) {
      re.fill(0)
      im.fill(0)
      for (let k = 0; k < DIM_F; k++) {
        const o = k * DIM_T + t
        const lr = spec[base + o]!
        // the imaginary part of the DC bin is ignored (as irfft does)
        const li = k === 0 ? 0 : spec[base + plane + o]!
        const rr = spec[base + 2 * plane + o]!
        const ri = k === 0 ? 0 : spec[base + 3 * plane + o]!
        // Z = L + i·R, written conjugated for the inverse-by-forward trick
        re[k] = lr - ri
        im[k] = -(li + rr)
        if (k > 0) {
          // bin N−k: conj(L[k]) + i·conj(R[k])
          re[N_FFT - k] = lr + ri
          im[N_FFT - k] = -(-li + rr)
        }
      }
      this.fft.forward(re, im)
      // ifft = conj(fft(conj(Z))) / N → left = re / N, right = −im / N
      const at = t * HOP
      for (let n = 0; n < N_FFT; n++) {
        const w = stftWindow[n]! / N_FFT
        olaL[at + n]! += re[n]! * w
        olaR[at + n]! += -im[n]! * w
      }
    }
    const half = N_FFT / 2
    for (let i = 0; i < CHUNK; i++) {
      const e = envelope[i]! > 1e-11 ? envelope[i]! : 1
      outL[i] = olaL[half + i]! / e
      outR[i] = olaR[half + i]! / e
    }
  }
}

export interface MdxChunk {
  /** Start in the padded signal (TRIM zeros, the song, padding). */
  start: number
}

/** The padded length and chunk starts for a song of `total` samples (UVR's demix plan). */
export function mdxPlan(total: number, overlap: number): { padded: number; chunks: MdxChunk[] } {
  const gen = CHUNK - 2 * TRIM
  const pad = gen + TRIM - (total % gen)
  const padded = TRIM + total + pad
  const step = Math.max(1, Math.floor((1 - overlap) * CHUNK))
  const chunks: MdxChunk[] = []
  for (let i = 0; i < padded; i += step) chunks.push({ start: i })
  return { padded, chunks }
}

/** Symmetric Hann (numpy.hanning) used to blend chunks. */
export const blendWindow = (() => {
  const w = new Float32Array(CHUNK)
  for (let n = 0; n < CHUNK; n++) w[n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (CHUNK - 1))
  return w
})()

/** Copy chunk input (zero beyond the padded signal) from the padded song. */
export function readChunk(src: Float32Array, start: number, out: Float32Array): void {
  // src is the unpadded song; padded index p maps to song index p − TRIM.
  for (let i = 0; i < CHUNK; i++) {
    const s = start + i - TRIM
    out[i] = s >= 0 && s < src.length ? src[s]! : 0
  }
}
