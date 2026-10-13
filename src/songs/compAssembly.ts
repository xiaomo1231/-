/**
 * Putting the full version together (pure): pieces of recorded voice placed
 * at their song positions, resampled to one rate, with short fades so joins
 * do not click. Overlapping pieces simply add (their fades cross).
 */

export interface VoicePiece {
  samples: Float32Array
  sampleRate: number
  /** Where the piece starts in the song, ms. */
  startMs: number
}

/** Linear resampling (good enough for speech-band voice takes). */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return x
  const n = Math.max(0, Math.round((x.length * to) / from))
  const out = new Float32Array(n)
  const step = from / to
  for (let i = 0; i < n; i++) {
    const p = i * step
    const a = Math.floor(p)
    const f = p - a
    out[i] = (x[a] ?? 0) * (1 - f) + (x[a + 1] ?? x[a] ?? 0) * f
  }
  return out
}

export function assembleVoice(pieces: readonly VoicePiece[], totalMs: number, rate = 44100, fadeMs = 30): Float32Array {
  const out = new Float32Array(Math.max(1, Math.round((totalMs / 1000) * rate)))
  const fade = Math.round((fadeMs / 1000) * rate)
  for (const p of pieces) {
    const x = resample(p.samples, p.sampleRate, rate)
    const at = Math.round((p.startMs / 1000) * rate)
    for (let i = 0; i < x.length; i++) {
      const j = at + i
      if (j < 0 || j >= out.length) continue
      const g = Math.min(1, fade ? i / fade : 1, fade ? (x.length - 1 - i) / fade : 1)
      out[j]! += x[i]! * Math.max(0, g)
    }
  }
  return out
}

/** A slice of a longer recording by song time (for the 'guide' fill and full-song takes). */
export function sliceMs(samples: Float32Array, sampleRate: number, fromMs: number, toMs: number): Float32Array {
  const a = Math.max(0, Math.round((fromMs / 1000) * sampleRate))
  const b = Math.min(samples.length, Math.round((toMs / 1000) * sampleRate))
  return samples.slice(a, Math.max(a, b))
}
