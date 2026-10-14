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
import { SWIFT_HOP, SWIFT_RATE, swiftSession, swiftWhole } from './swiftF0'

export type CurveMethod = 'rmvpe' | 'swiftf0' | 'yin'

const hzToMidi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

/** Hz per source frame → MIDI per curve frame (NaN = unvoiced), by the source frame nearest each curve time; voiced neighbours fill a single gap. */
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
    const part = rmvpeDecode(hidden, n)
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
        curve: { hop: HOP, midi: cleanCurve(toCurve(f0, RMVPE_HOP / RMVPE_RATE, duration)) },
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
        curve: { hop: HOP, midi: cleanCurve(toCurve(hz, SWIFT_HOP / SWIFT_RATE, duration)) },
        method: 'swiftf0',
      }
    } catch (e) {
      console.warn('SwiftF0 failed, using YIN', e)
    }
  }
  return { curve: await extractCurve(x16, onProgress, RMVPE_RATE), method: 'yin' }
}
