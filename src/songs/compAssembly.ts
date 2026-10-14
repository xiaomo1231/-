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

export function assembleVoice(
  pieces: readonly VoicePiece[],
  totalMs: number,
  rate = 44100,
  fadeMs = 30,
): Float32Array {
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
export function sliceMs(
  samples: Float32Array,
  sampleRate: number,
  fromMs: number,
  toMs: number,
): Float32Array {
  const a = Math.max(0, Math.round((fromMs / 1000) * sampleRate))
  const b = Math.min(samples.length, Math.round((toMs / 1000) * sampleRate))
  return samples.slice(a, Math.max(a, b))
}

// ---- 拼最好的几句：每句只留自己那一段 (0.26.6) ----------------------------------------

/** A phrase's chosen recording, placed in the song, with the phrase it was sung for. */
export interface CompPiece extends VoicePiece {
  phraseStartMs: number
  phraseEndMs: number
}

const ENV_MS = 10

/** 10 ms RMS envelope (dB) of a piece, indexed from the piece's own start. */
function envelopeDb(x: Float32Array, rate: number): Float32Array {
  const hop = Math.max(1, Math.round((rate * ENV_MS) / 1000))
  const n = Math.floor(x.length / hop)
  const out = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    for (let i = f * hop; i < (f + 1) * hop; i++) s += x[i]! * x[i]!
    out[f] = s > 0 ? 10 * Math.log10(s / hop) : -120
  }
  return out
}

/**
 * Where the singing in a piece actually is (song ms): from the first to the
 * last 10 ms frame within 30 dB of its loud part and clearly above its noise.
 * Null when it holds no singing.
 */
export function voicedSpan(p: VoicePiece): { fromMs: number; toMs: number } | null {
  const env = envelopeDb(p.samples, p.sampleRate)
  if (!env.length) return null
  const sorted = Array.from(env).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]!
  const loud = sorted[Math.floor(sorted.length * 0.95)]!
  const thr = Math.max(loud - 30, floor + 10)
  if (loud < floor + 10) return null
  let a = -1
  let b = -1
  for (let i = 0; i < env.length; i++) {
    if (env[i]! >= thr) {
      if (a < 0) a = i
      b = i
    }
  }
  if (a < 0) return null
  return { fromMs: p.startMs + a * ENV_MS, toMs: p.startMs + (b + 1) * ENV_MS }
}

/** Stretches of singing in a piece (song ms), joined across pauses shorter than 150 ms. */
export function voicedSegments(p: VoicePiece): Array<[number, number]> {
  const env = envelopeDb(p.samples, p.sampleRate)
  if (!env.length) return []
  const sorted = Array.from(env).sort((a, b) => a - b)
  const floor = sorted[Math.floor(sorted.length * 0.1)]!
  const loud = sorted[Math.floor(sorted.length * 0.95)]!
  if (loud < floor + 10) return []
  const thr = Math.max(loud - 30, floor + 10)
  const out: Array<[number, number]> = []
  for (let i = 0; i < env.length; i++) {
    if (env[i]! < thr) continue
    const ms = p.startMs + i * ENV_MS
    const last = out[out.length - 1]
    if (last && ms - last[1] < 150) last[1] = ms + ENV_MS
    else out.push([ms, ms + ENV_MS])
  }
  return out
}

/** Margin around a phrase within which singing still counts as that phrase's, ms. */
const OWN_MS = 150

export interface CompWindow {
  /** The part of the piece kept, song ms (fades centred on these edges). */
  fromMs: number
  toMs: number
  fadeInMs: number
  fadeOutMs: number
}

/**
 * Cut points between neighbouring pieces (in phrase order) so each phrase
 * keeps only its own singing: in a gap, the quietest moment of the gap; where
 * the two recordings' singing overlaps (a word carried over into the next
 * take's lead-in, or a late tail), the quietest moment of both together,
 * with a longer crossfade. Never cuts into a phrase's own span of the song.
 */
export function compWindows(pieces: readonly CompPiece[]): CompWindow[] {
  const order = pieces
    .map((_, i) => i)
    .sort((a, b) => pieces[a]!.phraseStartMs - pieces[b]!.phraseStartMs)
  const envs = pieces.map((p) => envelopeDb(p.samples, p.sampleRate))
  const segs = pieces.map(voicedSegments)
  // A take's own singing: not words carried over from the phrase before (in its lead-in),
  // nor the next phrase started in its tail.
  const ownStart = (k: number) =>
    segs[k]!.find(([, b]) => b > pieces[k]!.phraseStartMs - OWN_MS)?.[0]
  const ownEnd = (k: number) =>
    [...segs[k]!].reverse().find(([a]) => a < pieces[k]!.phraseEndMs + OWN_MS)?.[1]
  const level = (k: number, ms: number) => {
    const p = pieces[k]!
    const f = Math.floor((ms - p.startMs) / ENV_MS)
    const e = envs[k]!
    return f >= 0 && f < e.length ? 10 ** (e[f]! / 10) : 0
  }
  const windows: CompWindow[] = pieces.map((p) => ({
    fromMs: p.startMs,
    toMs: p.startMs + (p.samples.length / p.sampleRate) * 1000,
    fadeInMs: 10,
    fadeOutMs: 10,
  }))
  for (let j = 0; j + 1 < order.length; j++) {
    const a = order[j]!
    const b = order[j + 1]!
    const A = pieces[a]!
    const B = pieces[b]!
    const aEnd = ownEnd(a) ?? A.phraseEndMs
    const bStart = ownStart(b) ?? B.phraseStartMs
    // Stay out of each phrase's own part of the song (A's phrase, B's phrase).
    const lo = Math.max(
      A.phraseStartMs + (A.phraseEndMs - A.phraseStartMs) * 0.8,
      Math.min(aEnd, bStart) - 60,
    )
    const hi = Math.min(
      B.phraseEndMs - (B.phraseEndMs - B.phraseStartMs) * 0.8,
      Math.max(aEnd, bStart) + 60,
    )
    let cut = (aEnd + bStart) / 2
    if (hi > lo) {
      let best = Infinity
      for (let t = lo; t <= hi; t += ENV_MS) {
        const e = level(a, t) + level(b, t)
        // Prefer the middle of the quiet stretch when it is flat.
        const bias = 1e-9 * Math.abs(t - (aEnd + bStart) / 2)
        if (e + bias < best) {
          best = e + bias
          cut = t
        }
      }
    }
    cut = Math.max(lo, Math.min(hi > lo ? hi : cut, cut))
    const xf = aEnd > bStart ? 80 : 30
    windows[a]!.toMs = Math.min(windows[a]!.toMs, cut + xf / 2)
    windows[a]!.fadeOutMs = xf
    windows[b]!.fromMs = Math.max(windows[b]!.fromMs, cut - xf / 2)
    windows[b]!.fadeInMs = xf
  }
  return windows
}

/** The full version from per-phrase pieces: each keeps only its own window, joins crossfade. */
export function assembleComp(
  pieces: readonly CompPiece[],
  totalMs: number,
  rate = 44100,
): Float32Array {
  const out = new Float32Array(Math.max(1, Math.round((totalMs / 1000) * rate)))
  const windows = compWindows(pieces)
  pieces.forEach((p, k) => {
    const w = windows[k]!
    const x = resample(p.samples, p.sampleRate, rate)
    const at = Math.round((p.startMs / 1000) * rate)
    for (let i = 0; i < x.length; i++) {
      const j = at + i
      if (j < 0 || j >= out.length) continue
      const ms = p.startMs + (i / rate) * 1000
      if (ms < w.fromMs || ms > w.toMs) continue
      const gIn = Math.min(1, (ms - w.fromMs) / Math.max(1, w.fadeInMs))
      const gOut = Math.min(1, (w.toMs - ms) / Math.max(1, w.fadeOutMs))
      out[j]! += x[i]! * Math.max(0, Math.min(gIn, gOut))
    }
  })
  return out
}
