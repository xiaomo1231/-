/**
 * 跟唱录音延迟检测 (0.24.1): how late the recording is against the song —
 * headphones (Bluetooth adds 150–250 ms), the sound card, the microphone.
 * The app plays short beeps at known times and records the microphone:
 *
 * - 'loopback': hold an earphone to the microphone; the beeps themselves are
 *   recorded (exact, no reaction involved).
 * - 'sing': sing "da" with each beep, as you would sing with the song (the
 *   habit of singing on the beat is part of what is measured — which is what
 *   aligning takes needs).
 *
 * The delay is the median time from each beep to the sound arriving.
 */
import * as Tone from 'tone'
import { inputManager } from '@/audio/input/inputManager'
import { VoiceRecorder } from '@/audio/sing/voiceRecorder'

export type ProbeMode = 'loopback' | 'sing'

export interface ProbeResult {
  /** Median delay, ms (null when too few beeps were found). */
  ms: number | null
  /** Beeps found / played. */
  found: number
  total: number
  /** Spread of the found delays (interquartile range), ms. */
  spreadMs: number
}

/** Envelope: max |x| over blocks of `block` samples. */
export function envelope(x: Float32Array, block: number): Float32Array {
  const out = new Float32Array(Math.ceil(x.length / block))
  for (let i = 0; i < x.length; i++) {
    const v = Math.abs(x[i]!)
    const b = Math.floor(i / block)
    if (v > out[b]!) out[b] = v
  }
  return out
}

/**
 * Where each beep's sound starts in a recording (seconds from the recording's
 * start), searching from `minLag` to `maxLag` after each beep: the first block
 * rising well above the noise just before it. Null for a beep with no clear onset.
 */
export function findOnsets(
  rec: Float32Array,
  rate: number,
  beeps: readonly number[],
  minLag: number,
  maxLag: number,
): Array<number | null> {
  const block = Math.max(1, Math.round(rate * 0.002))
  const env = envelope(rec, block)
  const at = (s: number) => Math.max(0, Math.min(env.length, Math.round((s * rate) / block)))
  return beeps.map((b) => {
    const from = at(b + minLag)
    const to = at(b + maxLag)
    if (to - from < 4) return null
    // Noise: the quietest stretch of the search window's first 60 ms, before anything can arrive.
    const lead = env.subarray(Math.max(0, from - at(0.06)), from + 1)
    const sorted = Array.from(lead).sort((p, q) => p - q)
    const floor = sorted[Math.floor(sorted.length / 2)] ?? 0
    let peak = 0
    for (let i = from; i < to; i++) peak = Math.max(peak, env[i]!)
    if (peak < Math.max(0.01, floor * 4)) return null
    const thresh = Math.max(floor * 3, peak * 0.3)
    for (let i = from; i < to; i++) if (env[i]! >= thresh) return (i * block) / rate - b
    return null
  })
}

/** Median and spread of the delays (seconds) → result in ms. */
export function summarize(delays: ReadonlyArray<number | null>, minFound: number): ProbeResult {
  const ok = delays.filter((d): d is number => d !== null).sort((a, b) => a - b)
  const q = (p: number) => ok[Math.min(ok.length - 1, Math.floor(p * ok.length))]!
  return {
    ms: ok.length >= minFound ? Math.round(q(0.5) * 1000) : null,
    found: ok.length,
    total: delays.length,
    spreadMs: ok.length ? Math.round((q(0.75) - q(0.25)) * 1000) : 0,
  }
}

const BEEPS = 10

/**
 * Play the beeps and measure. `onBeat(i)` fires as each beep sounds
 * (count-in beeps have negative i in 'sing' mode).
 */
export async function probeLatency(
  mode: ProbeMode,
  onBeat?: (i: number) => void,
  signal?: AbortSignal,
): Promise<ProbeResult> {
  await Tone.start()
  const ctx = Tone.getContext().rawContext as AudioContext
  const release = await inputManager.acquire('voice')
  const rec = new VoiceRecorder(30)
  try {
    if (!(await rec.start())) throw new Error('这台电脑不能录音（音频模块没能加载）。')
    // Let the microphone settle.
    await new Promise((r) => setTimeout(r, 400))
    const gap = mode === 'sing' ? 60 / 90 : 0.6
    const countIn = mode === 'sing' ? 4 : 0
    const start = ctx.currentTime + 0.3
    const times = Array.from({ length: countIn + BEEPS }, (_, i) => start + i * gap)
    for (const [i, t] of times.entries()) {
      const osc = ctx.createOscillator()
      const g = ctx.createGain()
      osc.frequency.value = i < countIn ? 880 : 1320
      g.gain.setValueAtTime(0, t)
      g.gain.linearRampToValueAtTime(mode === 'loopback' ? 0.9 : 0.5, t + 0.002)
      g.gain.exponentialRampToValueAtTime(0.001, t + (mode === 'loopback' ? 0.04 : 0.08))
      osc.connect(g).connect(ctx.destination)
      osc.start(t)
      osc.stop(t + 0.1)
      const wait = (t - ctx.currentTime) * 1000
      setTimeout(() => onBeat?.(i - countIn), Math.max(0, wait))
    }
    const end = times[times.length - 1]! + 0.8
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(resolve, (end - ctx.currentTime) * 1000)
      signal?.addEventListener('abort', () => {
        clearTimeout(timer)
        reject(new DOMException('cancelled', 'AbortError'))
      })
    })
    const from = start - 0.2
    const audio = rec.clip(from, end)
    const beeps = times.slice(countIn).map((t) => t - from)
    // Singing can come a little early; the sound path is never faster than ~0.
    const onsets = findOnsets(
      audio,
      rec.sampleRate,
      beeps,
      mode === 'sing' ? -0.12 : 0.002,
      mode === 'sing' ? 0.55 : 0.5,
    )
    return summarize(onsets, mode === 'sing' ? 6 : 7)
  } finally {
    rec.stop()
    release()
  }
}
