/**
 * SwiftF0 (0.24.0; MIT, github.com/lars76/swift-f0): a small model (135 KB)
 * for the pitch of one voice, far fewer octave slips and dropouts than YIN.
 * Used for the live microphone while singing, and for the original singer's
 * line when RMVPE (graphics card, app only) is not available.
 *
 * Model: audio [1, n] at 16 kHz, fmin / fmax scalars → pitch (Hz) and
 * confidence per 256-sample frame (16 ms); confidence ≥ 0.5 = voiced.
 * In the app it runs in the app's pitch process (onnxruntime-node); in the
 * browser with onnxruntime-web where its build has every op the model uses.
 */
import type * as Ort from 'onnxruntime-web'
import { desktop } from '@/app/desktop'

export const SWIFT_RATE = 16000
export const SWIFT_HOP = 256
const FMIN = 46.875
const FMAX = 2093.75
/** Frames whose audio peaks below this are silence (the model guesses there). */
const SILENCE_PEAK = 1e-3
const WINDOW_FRAMES = 1875
const LEFT_FRAMES = 11
const LOOKAHEAD_FRAMES = 10
export const SWIFT_MODEL_PATH = 'models/pitch-swiftf0.onnx'

/** Runs the model once: 16 kHz audio → pitch (Hz) and confidence per frame. */
export interface SwiftRunner {
  run(
    audio: Float32Array,
    fmin: number,
    fmax: number,
  ): Promise<{ pitch: Float32Array; conf: Float32Array }>
}
let loading: Promise<SwiftRunner | null> | null = null

const base = () =>
  new URL((import.meta.env?.BASE_URL as string | undefined) ?? '/', window.location.href).href

async function webRunner(): Promise<SwiftRunner | null> {
  const ort = (await import(/* @vite-ignore */ `${base()}ort/ort.webgpu.min.mjs`)) as typeof Ort
  ort.env.wasm.wasmPaths = `${base()}ort/`
  ort.env.wasm.numThreads = 1
  const res = await fetch(`${base()}${SWIFT_MODEL_PATH}`)
  if (!res.ok || (res.headers.get('content-type') ?? '').includes('text/html')) return null
  const session = await ort.InferenceSession.create(new Uint8Array(await res.arrayBuffer()), {
    executionProviders: ['wasm'],
  })
  return {
    async run(audio, fmin, fmax) {
      const out = await session.run({
        audio: new ort.Tensor('float32', audio, [1, audio.length]),
        fmin: new ort.Tensor('float32', new Float32Array([fmin]), []),
        fmax: new ort.Tensor('float32', new Float32Array([fmax]), []),
      })
      return {
        pitch: out.pitch!.data as Float32Array,
        conf: Float32Array.from(out.confidence!.data as Float32Array),
      }
    },
  }
}

/** The model, loaded once (null when it cannot run here: callers fall back to YIN). */
export function swiftSession(): Promise<SwiftRunner | null> {
  loading ??= (async () => {
    try {
      const app = desktop()
      if (app) {
        if (!(await app.pitch.available()).swift) return null
        const runner: SwiftRunner = {
          run: (audio, fmin, fmax) => app.pitch.swift(audio, fmin, fmax),
        }
        await runner.run(new Float32Array(SWIFT_HOP * 4), FMIN, FMAX)
        return runner
      }
      return await webRunner()
    } catch (e) {
      console.warn('SwiftF0 unavailable, using YIN', e)
      return null
    }
  })()
  return loading
}

/** Pitch (Hz, 0 = unvoiced) and confidence per frame of a 16 kHz signal. */
export async function swiftRun(
  s: SwiftRunner,
  audio: Float32Array,
  fmin = FMIN,
  fmax = FMAX,
): Promise<{ hz: Float32Array; conf: Float32Array }> {
  const { pitch, conf } = await s.run(audio, Math.max(FMIN, fmin), Math.min(FMAX, fmax))
  const n = conf.length
  for (let f = 0; f < n; f++) {
    let peak = 0
    for (let i = f * SWIFT_HOP; i < Math.min(audio.length, (f + 1) * SWIFT_HOP); i++)
      peak = Math.max(peak, Math.abs(audio[i]!))
    if (peak < SILENCE_PEAK) conf[f] = 0
  }
  const hz = new Float32Array(n)
  for (let f = 0; f < n; f++) hz[f] = conf[f]! >= 0.5 ? pitch[f]! : 0
  return { hz, conf }
}

/** A whole recording, in windows with context on both sides (as the reference implementation). */
export async function swiftWhole(
  s: SwiftRunner,
  signal: Float32Array,
  onProgress?: (r: number) => void,
): Promise<{ hz: Float32Array; conf: Float32Array }> {
  const n = Math.max(1, Math.floor(signal.length / SWIFT_HOP))
  const hz = new Float32Array(n)
  const conf = new Float32Array(n)
  for (let start = 0; start < n; start += WINDOW_FRAMES) {
    const end = Math.min(start + WINDOW_FRAMES, n)
    const left = Math.max(0, start - LEFT_FRAMES)
    const win =
      end < n
        ? signal.subarray(left * SWIFT_HOP, (end + LOOKAHEAD_FRAMES) * SWIFT_HOP)
        : signal.subarray(left * SWIFT_HOP)
    const r = await swiftRun(s, win)
    for (let f = start; f < end; f++) {
      hz[f] = r.hz[f - left] ?? 0
      conf[f] = r.conf[f - left] ?? 0
    }
    onProgress?.(end / n)
    await new Promise((res) => setTimeout(res, 0))
  }
  return { hz, conf }
}

/** Any rate → 16 kHz: a short moving average (enough below a voice's fundamentals) then linear interpolation. */
export function to16k(x: Float32Array, rate: number): Float32Array {
  if (rate === SWIFT_RATE) return x
  const ratio = rate / SWIFT_RATE
  const taps = Math.max(1, Math.round(ratio))
  const smooth = new Float32Array(x.length)
  let acc = 0
  for (let i = 0; i < x.length; i++) {
    acc += x[i]!
    if (i >= taps) acc -= x[i - taps]!
    smooth[i] = acc / Math.min(i + 1, taps)
  }
  // The moving average delays by (taps − 1) / 2 samples: read that much later.
  const shift = (taps - 1) / 2
  const out = new Float32Array(Math.floor(x.length / ratio))
  for (let j = 0; j < out.length; j++) {
    const p = Math.min(x.length - 1, j * ratio + shift)
    const a = Math.floor(p)
    const f = p - a
    out[j] = smooth[a]! * (1 - f) + (smooth[Math.min(a + 1, x.length - 1)] ?? 0) * f
  }
  return out
}
