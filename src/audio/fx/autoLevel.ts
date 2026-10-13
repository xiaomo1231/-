/**
 * 逐句音量平衡 (pure): "riding the fader" phrase by phrase. Each sung phrase's
 * loudness is measured and pulled toward the median phrase by `strength`
 * (0–1), plus the student's own per-phrase offset; gains change with short
 * ramps between phrases so nothing clicks. Applied to the voice before the
 * effect chain (like moving the vocal fader during a take).
 */

export interface PhraseSpan {
  startMs: number
  endMs: number
}

/** RMS of a stretch, dBFS (−Infinity when silent). */
function rmsDb(x: Float32Array, a: number, b: number): number {
  let s = 0
  let n = 0
  for (let i = Math.max(0, a); i < Math.min(x.length, b); i++) {
    s += x[i]! * x[i]!
    n++
  }
  return n && s > 0 ? 10 * Math.log10(s / n) : -Infinity
}

/**
 * Loudness of each phrase: RMS over its loudest 70 % of 50 ms windows (so
 * pauses and breaths inside the phrase do not drag it down), dBFS.
 */
export function phraseLevels(samples: Float32Array, sampleRate: number, phrases: readonly PhraseSpan[]): number[] {
  const win = Math.max(1, Math.round(sampleRate * 0.05))
  return phrases.map((p) => {
    const a = Math.round((p.startMs / 1000) * sampleRate)
    const b = Math.round((p.endMs / 1000) * sampleRate)
    const levels: number[] = []
    for (let i = a; i + win <= b; i += win) {
      const l = rmsDb(samples, i, i + win)
      if (Number.isFinite(l)) levels.push(l)
    }
    if (!levels.length) return -Infinity
    levels.sort((x, y) => y - x)
    const keep = levels.slice(0, Math.max(1, Math.ceil(levels.length * 0.7)))
    // power mean of the kept windows
    const pow = keep.reduce((t, l) => t + Math.pow(10, l / 10), 0) / keep.length
    return 10 * Math.log10(pow)
  })
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Gain in dB for each phrase: toward the median by `strength`, plus offsets, limited to ±12 dB. */
export function phraseGainsDb(levels: readonly number[], strength: number, offsets: Record<number, number> = {}): number[] {
  const finite = levels.filter((l) => Number.isFinite(l))
  const target = finite.length ? median(finite) : 0
  return levels.map((l, i) => {
    const ride = Number.isFinite(l) ? (target - l) * Math.max(0, Math.min(1, strength)) : 0
    return Math.max(-12, Math.min(12, ride + (offsets[i] ?? 0)))
  })
}

/**
 * Apply per-phrase gains (dB) to a copy of the voice. Outside phrases the
 * gain glides from one phrase's value to the next; each change is a 40 ms
 * ramp (or the whole gap, if shorter).
 */
export function applyPhraseGains(samples: Float32Array, sampleRate: number, phrases: readonly PhraseSpan[], gainsDb: readonly number[]): Float32Array {
  const out = new Float32Array(samples.length)
  if (!phrases.length) {
    out.set(samples)
    return out
  }
  const ramp = Math.round(sampleRate * 0.04)
  const at = (ms: number) => Math.round((ms / 1000) * sampleRate)
  // Breakpoints: (sample index, gain). Hold each phrase's gain from just before it starts to its end.
  const pts: Array<[number, number]> = []
  phrases.forEach((p, i) => {
    const g = Math.pow(10, (gainsDb[i] ?? 0) / 20)
    const s = at(p.startMs)
    const prevEnd = i > 0 ? at(phrases[i - 1]!.endMs) : -Infinity
    pts.push([Math.max(prevEnd, s - ramp), g], [at(p.endMs), g])
  })
  let k = 0
  for (let i = 0; i < samples.length; i++) {
    while (k < pts.length - 1 && pts[k + 1]![0] <= i) k++
    const [x0, g0] = pts[k]!
    let g = g0
    if (i < pts[0]![0]) g = pts[0]![1]
    else if (k < pts.length - 1) {
      const [x1, g1] = pts[k + 1]!
      g = x1 > x0 ? g0 + ((g1 - g0) * (i - x0)) / (x1 - x0) : g1
    }
    out[i] = samples[i]! * g
  }
  return out
}

/** Level-ride a voice: measure, compute and apply in one go. Returns the new samples and the gains used. */
export function rideLevels(samples: Float32Array, sampleRate: number, phrases: readonly PhraseSpan[], strength: number, offsets: Record<number, number> = {}): { samples: Float32Array; gainsDb: number[]; levels: number[] } {
  const levels = phraseLevels(samples, sampleRate, phrases)
  const gainsDb = phraseGainsDb(levels, strength, offsets)
  return { samples: applyPhraseGains(samples, sampleRate, phrases, gainsDb), gainsDb, levels }
}
