/**
 * Airwindows effects (0.28.0): ports of Chris Johnson's Airwindows plugins
 * (MIT, https://github.com/airwindows/airwindows) to TypeScript. Each effect
 * is a plain class with the plugin's own normalised 0–1 parameters, processing
 * stereo blocks in place — pure, so it runs in an AudioWorklet (live and
 * offline renders alike) and in unit tests.
 *
 * Porting rules (all ports follow them):
 * - The float `processReplacing` path of the LinuxVST source, line for line,
 *   in double precision (JS numbers), with `overallscale = sampleRate / 44100`
 *   exactly as the plugin computes it.
 * - The 32-bit dither (fpd) and the denormal-guard noise (≤ 1e-15) are left
 *   out — they are inaudible. Where the plugin uses its random source for an
 *   audible purpose (flutter, modulation), a 32-bit xorshift (`xorshift32`)
 *   replaces it, with unsigned arithmetic (`>>> 0`).
 * - C integer overflow / modulo semantics are reproduced with Math.imul and
 *   `| 0` where the plugin relies on them.
 */

export interface AirwindowsParam {
  /** The plugin's own name for the parameter (e.g. "Compress"). */
  name: string
  /** Default 0–1 (the plugin constructor's value). */
  default: number
  /** Value shown to the user, as the plugin displays it (e.g. "-6.0 dB", "50%"). */
  display: (v: number) => string
}

export interface AirwindowsEffect {
  /** Set the 0–1 parameters, in the plugin's order (A, B, C…). Missing ones keep their value. */
  setParams(values: readonly number[]): void
  /** Process `n` frames of left / right in place. */
  process(left: Float32Array, right: Float32Array, n: number): void
  /** Clear all internal state (delay lines, envelopes). */
  reset(): void
}

export interface AirwindowsInfo {
  /** Plugin name, e.g. "ButterComp2". */
  name: string
  params: AirwindowsParam[]
  create(sampleRate: number): AirwindowsEffect
}

/** Unsigned 32-bit xorshift (the plugins' fpd generator, deterministic seed). */
export function xorshift32(seed = 2463534242): () => number {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s >>>= 0
    s ^= s >>> 17
    s ^= s << 5
    s >>>= 0
    return s
  }
}

/** Helpers shared by the parameter displays. */
export const pct = (v: number) => `${Math.round(v * 100)}%`
export const db = (x: number) => (x <= 0 ? '-∞ dB' : `${(20 * Math.log10(x)).toFixed(1)} dB`)
