/**
 * Onset detection for plucks and strums (pure, fed with raw samples).
 *
 * The signal is cut into hops (256 samples ≈ 5 ms at 48 kHz). A pick or a
 * strum is bright: its high-frequency content (the sample-to-sample
 * difference) jumps even when the chord is still ringing. An onset is a hop
 * whose high-frequency peak jumps by riseDb over the loudest of the
 * previous few hops, while the overall level is above a floor, with a
 * refractory period so one strum is one onset. The time is refined to the
 * first sample whose brightness reaches a fraction of the attack, which
 * gives roughly millisecond precision.
 */

export type OnsetProfile = 'cable' | 'mic'

export interface OnsetConfig {
  sampleRate: number
  hop: number
  /** Jump of a hop's peak over the loudest of the previous hops, dB. */
  riseDb: number
  /** Ignore anything below this level, dBFS. */
  floorDb: number
  /** Minimum time between onsets, seconds. */
  refractory: number
}

export const ONSET_PROFILES: Record<OnsetProfile, Omit<OnsetConfig, 'sampleRate'>> = {
  // A direct cable is quiet between notes and has no room noise.
  cable: { hop: 256, riseDb: 6, floorDb: -54, refractory: 0.07 },
  // A microphone hears the room and the backing track: demand a clearer rise.
  mic: { hop: 256, riseDb: 9, floorDb: -42, refractory: 0.08 },
}

export interface Onset {
  /** Seconds on the AudioContext clock (from the frame counter). */
  time: number
  /** Peak level of the attack, dBFS. */
  levelDb: number
}

/** Hops of history an attack is compared with (≈ 20 ms). */
const HISTORY_HOPS = 4

const toDb = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180)

export class OnsetDetector {
  private cfg: OnsetConfig
  private pending = new Float32Array(0)
  /** Frame index of pending[0]. */
  private pendingFrame = 0
  private history: number[] = []
  private lastOnset = -Infinity
  private prevHop: Float32Array | null = null
  private lastSample = 0

  constructor(sampleRate: number, profile: OnsetProfile = 'cable', overrides: Partial<OnsetConfig> = {}) {
    this.cfg = { sampleRate, ...ONSET_PROFILES[profile], ...overrides }
  }

  /** Feed consecutive samples starting at absolute frame number frame; returns onsets found. */
  feed(samples: Float32Array, frame: number): Onset[] {
    if (this.pending.length === 0) this.pendingFrame = frame
    const merged = new Float32Array(this.pending.length + samples.length)
    merged.set(this.pending)
    merged.set(samples, this.pending.length)
    const out: Onset[] = []
    const { hop, sampleRate } = this.cfg
    let offset = 0
    while (offset + hop <= merged.length) {
      const block = merged.subarray(offset, offset + hop)
      let peak = 0
      let bright = 0
      let prev = this.lastSample
      for (let i = 0; i < block.length; i++) {
        const x = block[i]!
        peak = Math.max(peak, Math.abs(x))
        bright = Math.max(bright, Math.abs(x - prev))
        prev = x
      }
      this.lastSample = prev
      const db = toDb(peak)
      const hf = toDb(bright)
      // Rise against the loudest of the previous hops: attacks jump, decays never do.
      const before = this.history.length ? Math.max(...this.history) : -180
      const start = this.pendingFrame + offset
      const t = start / sampleRate
      if (db > this.cfg.floorDb && hf - before >= this.cfg.riseDb && t - this.lastOnset >= this.cfg.refractory) {
        const refined = this.refine(block, start, bright)
        out.push({ time: refined, levelDb: db })
        this.lastOnset = refined
      }
      this.history.push(hf)
      if (this.history.length > HISTORY_HOPS) this.history.shift()
      this.prevHop = block.slice()
      offset += hop
    }
    this.pending = merged.slice(offset)
    this.pendingFrame += offset
    return out
  }

  /** First sample (in the second half of the previous hop or in this one) whose brightness reaches 30 % of the attack's. */
  private refine(block: Float32Array, start: number, bright: number): number {
    const thr = bright * 0.3
    const prev = this.prevHop
    if (prev) {
      for (let i = Math.floor(prev.length / 2) + 1; i < prev.length; i++) {
        if (Math.abs(prev[i]! - prev[i - 1]!) >= thr) return (start - prev.length + i) / this.cfg.sampleRate
      }
      if (Math.abs(block[0]! - prev[prev.length - 1]!) >= thr) return start / this.cfg.sampleRate
    }
    for (let i = 1; i < block.length; i++) {
      if (Math.abs(block[i]! - block[i - 1]!) >= thr) return (start + i) / this.cfg.sampleRate
    }
    return start / this.cfg.sampleRate
  }

  reset(): void {
    this.pending = new Float32Array(0)
    this.history = []
    this.lastSample = 0
    this.lastOnset = -Infinity
    this.prevHop = null
  }
}
