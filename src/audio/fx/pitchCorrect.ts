/**
 * Offline, experimental light pitch correction ("轻度音高修正") for a recorded
 * monophonic singing voice. Pure functions over Float32Array (no Web Audio).
 *
 * Pipeline:
 * 1. Pitch track — YIN (reused from `@/audio/pitch/yin`) on 40 ms frames with
 *    an 8 ms hop. To keep 30 s of 44.1 kHz audio fast, the tracker runs on a
 *    box-filtered decimated copy (~22 kHz). A frame is voiced only when YIN
 *    finds a clear period and the frame is not quiet. The f0 track (in MIDI)
 *    is median-smoothed over 5 frames and voiced islands shorter than 60 ms
 *    are dropped.
 * 2. Target — each frame's note *centre* is a slow median (~250 ms, longer
 *    than one vibrato cycle) of the voiced pitch within its run. The target is
 *    the nearest allowed semitone to that centre and the shift is
 *    `amount × (target − centre)`, clamped to ±100 cents. Because the same
 *    shift applies to the whole wobble, vibrato around the note survives. The
 *    shift curve is then smoothed with a zero-phase one-pole filter whose time
 *    constant is `speedMs`.
 * 3. Resynthesis — TD-PSOLA per voiced run. Analysis marks sit on signal peaks
 *    one period apart; synthesis marks are spaced period / ratio. Each
 *    synthesis mark overlap-adds a Hann-windowed two-period grain taken from
 *    the nearest analysis mark (fractional placement, linear interpolation),
 *    so time stays aligned and output length equals input length. The OLA is
 *    divided by the window sum to keep the level. Unvoiced audio is copied
 *    through, with ≥ 12 ms cross-fades at voiced/unvoiced boundaries.
 * 4. `amount = 0` (or no shift anywhere) returns an exact copy.
 */
import { median } from '@/audio/pitch/analysis'
import { rms, yin } from '@/audio/pitch/yin'

export interface TuneOptions {
  /** 0–1: how far each note is pulled toward the target (1 = fully). */
  amount: number
  /** Smoothing of the correction in ms (0 = instant, robotic; 50–150 = natural). */
  speedMs: number
  /** Allowed pitch classes 0–11 (C=0). Undefined = chromatic (all 12). */
  scale?: number[]
}

const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const MINOR = [0, 2, 3, 5, 7, 8, 10]

/** Pitch classes of a major or natural-minor scale on `tonic` (0–11, C=0), ascending from the tonic. */
export function scalePitchClasses(tonic: number, mode: 'major' | 'minor'): number[] {
  const t = ((Math.round(tonic) % 12) + 12) % 12
  return (mode === 'major' ? MAJOR : MINOR).map((s) => (t + s) % 12)
}

const FRAME_S = 0.04
const HOP_S = 0.008
const MIN_HZ = 70
const MAX_HZ = 1100
const MIN_ISLAND_S = 0.06
const CENTRE_S = 0.25
const FADE_S = 0.012
const MAX_SHIFT_SEMITONES = 1

/** Nearest allowed MIDI note to `midi` (fractional). */
function nearestAllowed(midi: number, allowed: boolean[]): number {
  const r = Math.round(midi)
  let best = r
  let bestD = Infinity
  for (let m = r - 6; m <= r + 6; m++) {
    if (!allowed[((m % 12) + 12) % 12]) continue
    const d = Math.abs(m - midi)
    if (d < bestD) {
      bestD = d
      best = m
    }
  }
  return best
}

interface Track {
  /** Smoothed pitch per frame in MIDI, NaN when unvoiced. */
  midi: Float64Array
  /** Sample index (original rate) of each frame's centre. */
  centre: Float64Array
  hop: number
}

/** Step 1: voiced f0 track (MIDI), median-smoothed, short islands removed. */
function trackPitch(x: Float32Array, sr: number): Track {
  const D = Math.max(1, Math.round(sr / 22050))
  const dsr = sr / D
  const dec = new Float32Array(Math.floor(x.length / D))
  for (let i = 0; i < dec.length; i++) {
    let s = 0
    for (let j = 0; j < D; j++) s += x[i * D + j]!
    dec[i] = s / D
  }
  const nd = Math.round(FRAME_S * dsr)
  const hop = Math.round(HOP_S * sr)
  const count = x.length >= nd * D ? Math.floor((x.length - nd * D) / hop) + 1 : 0
  const raw = new Float64Array(count).fill(NaN)
  const levels = new Float64Array(count)
  const centre = new Float64Array(count)
  let maxLevel = 0
  for (let k = 0; k < count; k++) {
    const start = Math.round((k * hop) / D)
    const frame = dec.subarray(start, start + nd)
    levels[k] = rms(frame)
    maxLevel = Math.max(maxLevel, levels[k]!)
    centre[k] = k * hop + (nd * D) / 2
  }
  const floor = Math.max(1e-3, maxLevel * 0.01)
  for (let k = 0; k < count; k++) {
    if (levels[k]! < floor) continue
    const start = Math.round((k * hop) / D)
    const r = yin(dec.subarray(start, start + nd), { sampleRate: dsr, minFreq: MIN_HZ, maxFreq: MAX_HZ, threshold: 0.15 })
    if (r.freq !== null && r.clarity >= 0.8 && Number.isFinite(r.freq)) raw[k] = 69 + 12 * Math.log2(r.freq / 440)
  }
  // 5-frame median over voiced neighbours.
  const midi = new Float64Array(count).fill(NaN)
  for (let k = 0; k < count; k++) {
    if (Number.isNaN(raw[k]!)) continue
    const nb: number[] = []
    for (let j = k - 2; j <= k + 2; j++) if (j >= 0 && j < count && !Number.isNaN(raw[j]!)) nb.push(raw[j]!)
    midi[k] = median(nb)
  }
  // Drop voiced islands shorter than MIN_ISLAND_S.
  const minFrames = Math.ceil((MIN_ISLAND_S * sr) / hop)
  for (const [a, b] of runs(midi)) if (b - a + 1 < minFrames) for (let k = a; k <= b; k++) midi[k] = NaN
  return { midi, centre, hop }
}

/** Contiguous voiced frame ranges [first, last]. */
function runs(midi: Float64Array): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let a = -1
  for (let k = 0; k <= midi.length; k++) {
    const voiced = k < midi.length && !Number.isNaN(midi[k]!)
    if (voiced && a < 0) a = k
    else if (!voiced && a >= 0) {
      out.push([a, k - 1])
      a = -1
    }
  }
  return out
}

/** Step 2: per-frame shift in semitones for one run (frames a..b), smoothed. */
function shiftCurve(midi: Float64Array, a: number, b: number, hop: number, sr: number, opts: TuneOptions, allowed: boolean[]): Float64Array {
  const n = b - a + 1
  const half = Math.max(1, Math.round((CENTRE_S * sr) / hop / 2))
  const amount = Math.min(1, Math.max(0, opts.amount))
  const shift = new Float64Array(n)
  for (let i = 0; i < n; i++) {
    const nb: number[] = []
    for (let j = Math.max(0, i - half); j <= Math.min(n - 1, i + half); j++) nb.push(midi[a + j]!)
    const c = median(nb)
    const s = amount * (nearestAllowed(c, allowed) - c)
    shift[i] = Math.max(-MAX_SHIFT_SEMITONES, Math.min(MAX_SHIFT_SEMITONES, s))
  }
  if (opts.speedMs > 0) {
    // Zero-phase one-pole (forward then backward), starting from the run's own ends.
    const g = Math.exp(-hop / ((opts.speedMs / 1000) * sr))
    for (let i = 1; i < n; i++) shift[i] = g * shift[i - 1]! + (1 - g) * shift[i]!
    for (let i = n - 2; i >= 0; i--) shift[i] = g * shift[i + 1]! + (1 - g) * shift[i]!
  }
  return shift
}

/** Linear interpolation of per-frame values at sample time t (clamped to the run). */
function frameInterp(values: Float64Array, centre: Float64Array, a: number, t: number, hop: number): number {
  const n = values.length
  const pos = (t - centre[a]!) / hop
  if (pos <= 0) return values[0]!
  if (pos >= n - 1) return values[n - 1]!
  const i = Math.floor(pos)
  const f = pos - i
  return values[i]! * (1 - f) + values[i + 1]! * f
}

/** Index of the largest sample in [lo, hi). */
function argMax(x: Float32Array, lo: number, hi: number): number {
  lo = Math.max(0, lo)
  hi = Math.min(x.length, hi)
  let best = lo
  for (let i = lo + 1; i < hi; i++) if (x[i]! > x[best]!) best = i
  return best
}

/**
 * Gently pull a recorded monophonic voice toward the nearest allowed semitone.
 * Returns a new buffer of the same length; unvoiced parts are copied through
 * and `amount = 0` returns an exact copy. Experimental and offline.
 */
export function correctPitch(samples: Float32Array, sampleRate: number, opts: TuneOptions): Float32Array {
  const out = Float32Array.from(samples)
  if (!(opts.amount > 0) || samples.length === 0 || !(sampleRate > 0)) return out
  const allowed = new Array<boolean>(12).fill(opts.scale === undefined || opts.scale.length === 0)
  for (const pc of opts.scale ?? []) allowed[((Math.round(pc) % 12) + 12) % 12] = true

  const { midi, centre, hop } = trackPitch(samples, sampleRate)
  const x = samples
  const len = x.length
  const fadeLen = Math.max(1, Math.round(FADE_S * sampleRate))

  for (const [a, b] of runs(midi)) {
    const shift = shiftCurve(midi, a, b, hop, sampleRate, opts, allowed)
    if (shift.every((s) => Math.abs(s) < 1e-6)) continue
    const pitch = midi.slice(a, b + 1)
    const periodAt = (t: number): number => sampleRate / (440 * 2 ** ((frameInterp(pitch, centre, a, t, hop) - 69) / 12))
    const ratioAt = (t: number): number => 2 ** (frameInterp(shift, centre, a, t, hop) / 12)

    const s0 = Math.max(0, Math.floor(centre[a]! - hop / 2))
    const e0 = Math.min(len - 1, Math.ceil(centre[b]! + hop / 2))

    // Analysis marks: signal peaks one period apart, covering the run plus a period each side.
    const marks: number[] = []
    const p0 = periodAt(s0)
    let m = argMax(x, Math.floor(s0 - p0), Math.floor(s0 - p0) + Math.ceil(p0))
    marks.push(m)
    for (;;) {
      const p = periodAt(m)
      const expect = m + p
      if (expect > e0 + 2 * p || expect >= len) break
      const tol = Math.max(1, Math.round(0.15 * p))
      const next = argMax(x, Math.round(expect) - tol, Math.round(expect) + tol + 1)
      m = next > m ? next : Math.round(expect)
      marks.push(m)
    }

    // Synthesis: OLA of Hann two-period grains at period/ratio spacing.
    const lo = Math.max(0, s0 - Math.ceil(2 * p0))
    const hi = Math.min(len, e0 + Math.ceil(2 * periodAt(e0)) + 1)
    const y = new Float64Array(hi - lo)
    const w = new Float64Array(hi - lo)
    let k = 0
    for (let ts = s0; ts <= e0 + periodAt(e0); ) {
      while (k + 1 < marks.length && Math.abs(marks[k + 1]! - ts) <= Math.abs(marks[k]! - ts)) k++
      const am = marks[k]!
      const L = periodAt(am)
      const i0 = Math.max(lo, Math.ceil(ts - L))
      const i1 = Math.min(hi - 1, Math.floor(ts + L))
      for (let i = i0; i <= i1; i++) {
        const u = (i - ts) / L
        const win = 0.5 * (1 + Math.cos(Math.PI * u))
        const src = am + (i - ts)
        const si = Math.floor(src)
        if (si < 0 || si + 1 >= len) continue
        const f = src - si
        y[i - lo]! += win * (x[si]! * (1 - f) + x[si + 1]! * f)
        w[i - lo]! += win
      }
      ts += periodAt(ts) / ratioAt(ts)
    }

    // Mix into the output with cross-fades inside the run boundaries.
    const span = e0 - s0 + 1
    const fade = Math.max(1, Math.min(fadeLen, Math.floor(span / 2)))
    for (let i = s0; i <= e0; i++) {
      const wi = w[i - lo]!
      if (wi < 0.1) continue
      const edge = Math.min(i - s0, e0 - i)
      const mix = edge >= fade ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * edge) / fade)
      out[i] = (1 - mix) * x[i]! + mix * (y[i - lo]! / wi)
    }
  }
  return out
}
