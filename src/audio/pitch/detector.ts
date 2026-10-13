import * as Tone from 'tone'
import { rms, yin } from './yin'
import { inputManager, MicError } from '@/audio/input/inputManager'
import type { PitchFrame } from './analysis'

/**
 * Microphone pitch detector. Runs YIN on an AnalyserNode buffer about 40
 * times a second on the main thread, which is plenty on a desktop CPU and
 * keeps everything on the same AudioContext clock as playback.
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
  gate = DEFAULT_GATE

  get running(): boolean {
    return this.timer !== null
  }

  async start(preset: DetectorPreset = 'voice'): Promise<void> {
    this.preset = PRESETS[preset]
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
    this.analyser.fftSize = this.preset.fftSize
    this.analyser.smoothingTimeConstant = 0
    this.buf = new Float32Array(new ArrayBuffer(this.preset.fftSize * 4))
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
