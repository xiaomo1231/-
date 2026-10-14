/**
 * The original singer's pitch line from a vocals stem (0.24.0): RMVPE in the
 * app (best with backing leftovers and reverb), else
 * SwiftF0, else YIN. Returns frames of the usual curve hop (20 ms).
 */
import { desktop } from '@/app/desktop'
import { HOP, cleanCurve, extractCurve, type PitchCurve } from '@/songs/singAlong'
import {
  RMVPE_HOP,
  RMVPE_RATE,
  RMVPE_SALIENCE,
  rmvpeDecode,
  rmvpeFrames,
  rmvpeMel,
  rmvpePieces,
} from './rmvpe'
import { SWIFT_HOP, SWIFT_RATE, swiftSession, swiftWhole, to16k } from './swiftF0'

export type CurveMethod = 'rmvpe' | 'swiftf0' | 'yin'

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** Hz per source frame → MIDI per curve frame (NaN = unvoiced), by the source frame nearest each curve time; voiced neighbours fill a single gap. */
/**
 * Which pitch counts as the singer (0.27.0), tuned on four songs against a
 * cleaner separation (BS-RoFormer): RMVPE confidence above 0.5 (not 0.03 as in
 * voice conversion, which reported pitch for ~11 % of each song where nobody
 * sings: leftover instruments, harmonies, reverb tails), and the vocals stem
 * within 30 dB of its loud singing at that moment. Wrong frames -84 %, singing
 * kept 96 %.
 */
export const VOICE_CONFIDENCE = 0.5
export const VOICE_BELOW_LOUD_DB = 30

/** Silence `hz` where the stem is far below its loud singing (per source frame of `hop` samples). */
export function gateByLevel(
  hz: Float32Array,
  x16: Float32Array,
  hop: number,
  belowDb = VOICE_BELOW_LOUD_DB,
): Float32Array {
  const db = new Float32Array(hz.length)
  for (let f = 0; f < hz.length; f++) {
    let s = 0
    const a = f * hop
    const b = Math.min(x16.length, a + hop)
    for (let i = a; i < b; i++) s += x16[i]! * x16[i]!
    db[f] = s > 0 ? 10 * Math.log10(s / Math.max(1, b - a)) : -120
  }
  const sorted = Array.from(db).sort((u, v) => u - v)
  const loud = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? -120
  const out = Float32Array.from(hz)
  for (let f = 0; f < out.length; f++) if (db[f]! < loud - belowDb) out[f] = 0
  return out
}

/**
 * Breaks the pitch at syllable boundaries (0.27.0): where the stem's level dips
 * at least 7 dB below the louder side within 80 ms on both sides (deeper than
 * vibrato's swell), the pitch is cleared for 30 ms, so the same note sung on
 * several words ("啦啦啦") becomes several notes instead of one long bar.
 */
export function splitAtSyllables(
  hz: Float32Array,
  x16: Float32Array,
  hop: number,
  dipDb = 7,
): Float32Array {
  const n = hz.length
  const db = new Float32Array(n)
  for (let f = 0; f < n; f++) {
    let s = 0
    const a = f * hop
    const b = Math.min(x16.length, a + hop)
    for (let i = a; i < b; i++) s += x16[i]! * x16[i]!
    db[f] = s > 0 ? 10 * Math.log10(s / Math.max(1, b - a)) : -120
  }
  const reach = Math.max(2, Math.round((0.08 * RMVPE_RATE) / hop))
  const out = Float32Array.from(hz)
  for (let f = 1; f < n - 1; f++) {
    if (!(hz[f - 1]! > 0 && hz[f + 1]! > 0)) continue
    if (db[f]! > db[f - 1]! || db[f]! > db[f + 1]!) continue
    let left = -120
    let right = -120
    for (let k = 1; k <= reach; k++) {
      if (f - k >= 0) left = Math.max(left, db[f - k]!)
      if (f + k < n) right = Math.max(right, db[f + k]!)
    }
    if (Math.min(left, right) - db[f]! >= dipDb)
      for (let k = -1; k <= 1; k++) if (f + k >= 0 && f + k < n) out[f + k] = 0
  }
  return out
}

function toCurve(hz: Float32Array, srcHopS: number, durationS: number): Float32Array {
  const frames = Math.max(0, Math.floor(durationS / HOP))
  const midi = new Float32Array(frames).fill(NaN)
  for (let f = 0; f < frames; f++) {
    const i = Math.round((f * HOP) / srcHopS)
    const v = hz[i] || hz[i + 1] || hz[i - 1] || 0
    if (v > 0) midi[f] = hzToMidi(v)
  }
  return midi
}

async function viaRmvpe(
  x16: Float32Array,
  onProgress?: (r: number) => void,
): Promise<Float32Array> {
  const app = desktop()!
  const frames = rmvpeFrames(x16.length)
  const f0 = new Float32Array(frames)
  const pieces = rmvpePieces(frames)
  for (const [k, p] of pieces.entries()) {
    // The piece's own samples (with the STFT's half-window on each side handled by reflection inside the piece).
    const a = p.from * RMVPE_HOP
    const b = Math.min(x16.length, (p.to - 1) * RMVPE_HOP + 1)
    const n = p.to - p.from
    const padded = 32 * Math.ceil(n / 32)
    const mel = rmvpeMel(x16.subarray(a, b), padded)
    const hidden = await app.pitch.rmvpe(mel, padded)
    if (hidden.length < n * RMVPE_SALIENCE) throw new Error('音高模型的输出不完整')
    const part = rmvpeDecode(hidden, n, VOICE_CONFIDENCE)
    for (let t = p.keepFrom; t < p.keepTo; t++) f0[t] = part[t - p.from]!
    onProgress?.((k + 1) / pieces.length)
  }
  return f0
}

/** The pitch line and the method that made it. */
export async function analyzeReference(
  x16: Float32Array,
  onProgress?: (r: number) => void,
): Promise<{ curve: PitchCurve; method: CurveMethod }> {
  const duration = x16.length / RMVPE_RATE
  const app = desktop()
  if (app && (await app.pitch.available().catch(() => null))?.rmvpe) {
    try {
      const f0 = await viaRmvpe(x16, onProgress)
      return {
        curve: {
          hop: HOP,
          midi: cleanCurve(
            toCurve(
              splitAtSyllables(gateByLevel(f0, x16, RMVPE_HOP), x16, RMVPE_HOP),
              RMVPE_HOP / RMVPE_RATE,
              duration,
            ),
          ),
        },
        method: 'rmvpe',
      }
    } catch (e) {
      console.warn('RMVPE failed, trying SwiftF0', e)
    }
  }
  const swift = await swiftSession()
  if (swift) {
    try {
      const { hz } = await swiftWhole(swift, x16, onProgress)
      return {
        curve: {
          hop: HOP,
          midi: cleanCurve(
            toCurve(gateByLevel(hz, x16, SWIFT_HOP), SWIFT_HOP / SWIFT_RATE, duration),
          ),
        },
        method: 'swiftf0',
      }
    } catch (e) {
      console.warn('SwiftF0 failed, using YIN', e)
    }
  }
  return { curve: await extractCurve(x16, onProgress, RMVPE_RATE), method: 'yin' }
}

/**
 * 唱完重新分析 (0.27.0): the pitch of a just-recorded phrase, from the
 * recording itself with RMVPE (app only) — steadier than the live line, which
 * only sees a fraction of a second at a time. `startMs` is where the recording
 * starts in the song; `speed` the playback speed it was sung at. Samples every
 * 10 ms where the singer is voiced; null when RMVPE is not available.
 */
export async function analyzeTake(
  samples: Float32Array,
  sampleRate: number,
  startMs: number,
  speed = 1,
): Promise<Array<{ ms: number; midi: number }> | null> {
  const app = desktop()
  if (!app || !(await app.pitch.available().catch(() => null))?.rmvpe) return null
  const x16 = to16k(samples, sampleRate)
  if (x16.length < RMVPE_HOP * 8) return null
  const f0 = gateByLevel(await viaRmvpe(x16), x16, RMVPE_HOP)
  const out: Array<{ ms: number; midi: number }> = []
  const stepMs = (RMVPE_HOP / RMVPE_RATE) * 1000 * speed
  for (let i = 0; i < f0.length; i++)
    if (f0[i]! > 0) out.push({ ms: startMs + i * stepMs, midi: hzToMidi(f0[i]!) })
  return out
}
