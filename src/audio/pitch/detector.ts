import * as Tone from 'tone'
import { rms, yin } from './yin'
import { inputManager, MicError } from '@/audio/input/inputManager'
import type { PitchFrame } from './analysis'
import { SWIFT_HOP, SWIFT_RATE, swiftRun, swiftSession, to16k } from './swiftF0'

/**
 * Microphone pitch detector. Runs on an AnalyserNode buffer about 40 times a
 * second on the main thread, on the same AudioContext clock as playback. The
 * voice uses SwiftF0 (a small model: far fewer octave slips and dropouts,
 * 0.24.0) once it has loaded; instruments, and the voice until then, use YIN.
 *
 * The microphone signal is never connected to the speakers and never
 * recorded or uploaded — only per-frame pitch numbers leave this module.
 */
export type DetectorPreset = 'voice' | 'guitar' | 'bass' | 'piano'

interface PresetConfig {
  minFreq: number
  maxFreq: number
  fftSize: number
  /** YIN aperiodicity threshold. */
  threshold: number
  /** Minimum clarity to count as voiced. */
  minClarity: number
}

export const PRESETS: Record<DetectorPreset, PresetConfig> = {
  voice: { minFreq: 70, maxFreq: 1100, fftSize: 2048, threshold: 0.15, minClarity: 0.8 },
  guitar: { minFreq: 75, maxFreq: 1400, fftSize: 2048, threshold: 0.15, minClarity: 0.75 },
  bass: { minFreq: 30, maxFreq: 420, fftSize: 4096, threshold: 0.2, minClarity: 0.7 },
  piano: { minFreq: 50, maxFreq: 2100, fftSize: 4096, threshold: 0.15, minClarity: 0.75 },
}

/** Below this RMS the input is treated as silence (noise gate). */
export const DEFAULT_GATE = 0.012

export { MicError }

export class PitchDetector {
  private release: (() => void) | null = null
  private analyser: AnalyserNode | null = null
  private buf: Float32Array<ArrayBuffer> | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  private listeners = new Set<(f: PitchFrame) => void>()
  private preset: PresetConfig = PRESETS.voice
  private presetName: DetectorPreset = 'voice'
  private swift: Awaited<ReturnType<typeof swiftSession>> = null
  private swiftBusy = false
  gate = DEFAULT_GATE

  get running(): boolean {
    return this.timer !== null
  }

  async start(preset: DetectorPreset = 'voice'): Promise<void> {
    this.preset = PRESETS[preset]
    this.presetName = preset
    if (preset === 'voice' && !this.swift)
      void swiftSession().then((s) => {
        this.swift = s
        this.configureAnalyser()
      })
    if (this.running) {
      this.configureAnalyser()
      return
    }
    // Singing uses a microphone; instruments use the selected input (a guitar cable when there is one).
    this.release = await inputManager.acquire(preset === 'voice' ? 'voice' : 'instrument')
    const ctx = Tone.getContext().rawContext as AudioContext
    this.analyser = ctx.createAnalyser()
    this.configureAnalyser()
    inputManager.bus.connect(this.analyser)
    this.timer = setInterval(() => this.tick(), 25)
  }

  private configureAnalyser(): void {
    if (!this.analyser) return
    // SwiftF0 wants ~170 ms of context (about ten 16 ms frames).
    this.analyser.fftSize = this.useSwift() ? 8192 : this.preset.fftSize
    this.analyser.smoothingTimeConstant = 0
    this.buf = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
  }

  private useSwift(): boolean {
    return this.presetName === 'voice' && this.swift !== null
  }

  /** SwiftF0 on the latest audio; reports the frame two hops before the end (it needs a little audio after a frame). */
  private tickSwift(t: number, level: number, peak: number): void {
    if (this.swiftBusy || !this.swift || !this.buf || !this.analyser) return
    this.swiftBusy = true
    const rate = this.analyser.context.sampleRate
    const x = to16k(this.buf, rate)
    void swiftRun(this.swift, x, this.preset.minFreq, this.preset.maxFreq)
      .then(({ hz, conf }) => {
        const i = Math.max(0, hz.length - 3)
        const c = conf[i] ?? 0
        const f = hz[i] ?? 0
        // Time of that frame's centre.
        const ft = t - (x.length - (i + 0.5) * SWIFT_HOP) / SWIFT_RATE
        const frame: PitchFrame = {
          t: ft,
          hz: f > 0 ? f : null,
          clarity: f > 0 ? Math.max(0.8, c) : Math.min(0.5, c),
          rms: level,
          peak,
        }
        this.listeners.forEach((l) => l(frame))
      })
      .catch(() => {
        // a failed run: YIN from the next tick on
        this.swift = null
        this.configureAnalyser()
      })
      .finally(() => {
        this.swiftBusy = false
      })
  }

  private tick(): void {
    if (!this.analyser || !this.buf) return
    this.analyser.getFloatTimeDomainData(this.buf)
    const level = rms(this.buf)
    let peak = 0
    for (let i = 0; i < this.buf.length; i++) peak = Math.max(peak, Math.abs(this.buf[i]!))
    const t = Tone.getContext().rawContext.currentTime
    let frame: PitchFrame
    if (level < this.gate) {
      frame = { t, hz: null, clarity: 0, rms: level, peak }
    } else if (this.useSwift()) {
      this.tickSwift(t, level, peak)
      return
    } else {
      const r = yin(this.buf, {
        sampleRate: this.analyser.context.sampleRate,
        minFreq: this.preset.minFreq,
        maxFreq: this.preset.maxFreq,
        threshold: this.preset.threshold,
      })
      const voiced = r.freq !== null && r.clarity >= this.preset.minClarity
      frame = { t, hz: voiced ? r.freq : null, clarity: r.clarity, rms: level, peak }
    }
    this.listeners.forEach((l) => l(frame))
  }

  onFrame(cb: (f: PitchFrame) => void): () => void {
    this.listeners.add(cb)
    return () => this.listeners.delete(cb)
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    if (this.analyser) {
      try {
        inputManager.bus.disconnect(this.analyser)
      } catch {
        // already disconnected
      }
    }
    this.release?.()
    this.release = null
    this.analyser = null
  }
}

/** One shared detector; pages start / stop it as they mount. */
export const detector = new PitchDetector()
