/**
 * Pure DSP helpers for the guitar monitor (no Web Audio objects), so the
 * shapes can be unit-tested. Every curve, filter setting and impulse
 * response is generated here: no external sound files.
 */
import type { AmpType } from './rigSettings'

export const dbToGain = (db: number) => Math.pow(10, db / 20)
export const gainToDb = (g: number) => (g <= 0 ? -Infinity : 20 * Math.log10(g))

export type CurveKind = 'soft' | 'hard' | 'amp-clean' | 'amp-crunch' | 'amp-high'

/**
 * Waveshaper transfer curve over [-1, 1]. `soft` is a tanh overdrive,
 * `hard` an asymmetric clipper with a rounded knee (distortion pedal), the
 * amp curves are progressively more saturated. The curve is normalised so
 * that full-scale input maps to ±1 at most.
 */
export function shaperCurve(kind: CurveKind, n = 2048): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(n * 4))
  const f = (x: number): number => {
    switch (kind) {
      case 'soft':
        return Math.tanh(1.5 * x)
      case 'hard': {
        // Asymmetric: the negative half clips earlier, adding even harmonics.
        const k = x >= 0 ? 0.75 : 0.6
        const y = x / k
        return Math.abs(y) < 1 ? y - (y * y * y) / 3 : Math.sign(y) * (2 / 3)
      }
      case 'amp-clean':
        return Math.tanh(0.9 * x) + 0.05 * Math.tanh(3 * x)
      case 'amp-crunch':
        return Math.tanh(2.2 * x + 0.12 * x * x)
      case 'amp-high':
        return Math.tanh(4 * x) * 0.85 + Math.tanh(9 * x) * 0.15
    }
  }
  let peak = 0
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    curve[i] = f(x)
    peak = Math.max(peak, Math.abs(curve[i]!))
  }
  if (peak > 0) for (let i = 0; i < n; i++) curve[i] = curve[i]! / peak
  return curve
}

/** Gain into a pedal's clipper for a 0–1 knob (logarithmic, like a real pot). */
export function pedalDrive(kind: 'soft' | 'hard', knob: number): number {
  const [lo, hi] = kind === 'soft' ? [2, 40] : [6, 300]
  return lo * Math.pow(hi / lo, Math.max(0, Math.min(1, knob)))
}

export interface AmpVoicing {
  curve: CurveKind
  /** Pre-gain range for the gain knob. */
  preGain: [number, number]
  /** Output trim to keep the three types at similar loudness. */
  trim: number
  /** Extra mid push (dB) before the clipper, which voices the amp. */
  midPush: number
}

export const AMP_VOICING: Record<AmpType, AmpVoicing> = {
  clean: { curve: 'amp-clean', preGain: [0.6, 3], trim: 0.9, midPush: 0 },
  crunch: { curve: 'amp-crunch', preGain: [2, 18], trim: 0.6, midPush: 3 },
  high: { curve: 'amp-high', preGain: [8, 90], trim: 0.45, midPush: 6 },
}

export function ampPreGain(type: AmpType, knob: number): number {
  const [lo, hi] = AMP_VOICING[type].preGain
  return lo * Math.pow(hi / lo, Math.max(0, Math.min(1, knob)))
}

/** Tone knob → low-pass cutoff (Hz), logarithmic from 1.2 kHz to 9 kHz. */
export function toneCutoff(knob: number): number {
  return 1200 * Math.pow(9000 / 1200, Math.max(0, Math.min(1, knob)))
}

/** Bass / mid / treble knob (0.5 = flat) → shelf / peak gain in dB. */
export function eqDb(knob: number, range = 12): number {
  return (Math.max(0, Math.min(1, knob)) - 0.5) * 2 * range
}

/** Output level knob → linear gain (0.5 ≈ unity, quadratic taper). */
export function levelGain(knob: number): number {
  const k = Math.max(0, Math.min(1, knob))
  return 4 * k * k
}

/** Master volume knob → linear gain, gentle taper so low settings stay usable. */
export function masterGain(knob: number): number {
  const k = Math.max(0, Math.min(1, knob))
  return k <= 0 ? 0 : dbToGain(-40 + 40 * k)
}

/** Fixed speaker-cabinet voicing (4×12-style): filters applied in order. */
export const CAB_FILTERS: ReadonlyArray<{ type: BiquadFilterType; frequency: number; Q: number; gain: number }> = [
  { type: 'highpass', frequency: 85, Q: 0.7, gain: 0 },
  { type: 'peaking', frequency: 110, Q: 1.2, gain: 3 },
  { type: 'peaking', frequency: 2400, Q: 1.4, gain: 3.5 },
  { type: 'lowpass', frequency: 5200, Q: 0.9, gain: 0 },
  { type: 'lowpass', frequency: 7000, Q: 0.7, gain: 0 },
]

/** Compressor amount (0–1) → threshold (dB) and ratio. */
export function compressorParams(amount: number): { threshold: number; ratio: number } {
  const a = Math.max(0, Math.min(1, amount))
  return { threshold: -12 - 30 * a, ratio: 2 + 8 * a }
}

/** Chorus rate (0–1) → LFO Hz, depth (0–1) → delay swing in seconds. */
export function chorusParams(rate: number, depth: number): { hz: number; swing: number } {
  return { hz: 0.15 + 2.5 * Math.max(0, Math.min(1, rate)), swing: 0.0004 + 0.0036 * Math.max(0, Math.min(1, depth)) }
}

/** Deterministic noise so the generated reverb sounds the same every time. */
function rng(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return ((s >>> 0) / 0xffffffff) * 2 - 1
  }
}

/**
 * Stereo reverb impulse response: decorrelated noise with an exponential
 * decay and a darkening tail. `size` 0–1 maps to roughly 0.6–3.2 s.
 */
export function reverbImpulse(sampleRate: number, size: number, seed = 7): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const seconds = 0.6 + 2.6 * Math.max(0, Math.min(1, size))
  const len = Math.max(1, Math.floor(sampleRate * seconds))
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(new ArrayBuffer(len * 4)), new Float32Array(new ArrayBuffer(len * 4))]
  const pre = Math.floor(sampleRate * 0.012)
  for (let c = 0; c < 2; c++) {
    const r = rng(seed + c * 101)
    let lp = 0
    for (let i = 0; i < len; i++) {
      const t = i / len
      const env = i < pre ? 0 : Math.pow(1 - t, 2.2) * Math.exp(-3 * t)
      // One-pole low-pass whose cutoff falls over time: the tail gets darker.
      const a = 0.25 + 0.7 * t
      lp = lp + (1 - a) * (r() - lp)
      out[c][i] = lp * env
    }
  }
  // Normalise energy so size does not change loudness much.
  let energy = 0
  for (const ch of out) for (let i = 0; i < ch.length; i++) energy += ch[i]! * ch[i]!
  const norm = energy > 0 ? 1 / Math.sqrt(energy / 2) * 0.35 : 1
  for (const ch of out) for (let i = 0; i < ch.length; i++) ch[i] = ch[i]! * norm
  return out
}

// ---------------------------------------------------------------------------
// Noise gate (the algorithm the audio-thread worklet runs; kept here for tests)
// ---------------------------------------------------------------------------

export interface GateState {
  env: number
  gain: number
  /** Seconds the level has been below the threshold. */
  below: number
}

export const GATE_ATTACK = 0.002
export const GATE_HOLD = 0.05

/**
 * Process one block: follow the level, open fast above the threshold,
 * close smoothly after `release` once the level stays below it.
 */
export function gateBlock(samples: Float32Array, state: GateState, thresholdDb: number, release: number, sampleRate: number): GateState {
  const thr = dbToGain(thresholdDb)
  const envCoef = Math.exp(-1 / (sampleRate * 0.01))
  const openCoef = Math.exp(-1 / (sampleRate * GATE_ATTACK))
  const closeCoef = Math.exp(-1 / (sampleRate * Math.max(0.005, release)))
  let { env, gain, below } = state
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i]!
    env = Math.max(Math.abs(x), env * envCoef)
    if (env >= thr) below = 0
    else below += 1 / sampleRate
    const target = below > GATE_HOLD ? 0 : 1
    const coef = target > gain ? openCoef : closeCoef
    gain = target + (gain - target) * coef
    samples[i] = x * gain
  }
  return { env, gain, below }
}

/** Source of the audio-thread modules: the noise gate and a capture tap for onset analysis. */
export const WORKLET_SOURCE = `
const dbToGain = (db) => Math.pow(10, db / 20)
class GrooveGate extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'threshold', defaultValue: -58, minValue: -100, maxValue: 0, automationRate: 'k-rate' },
      { name: 'release', defaultValue: 0.12, minValue: 0.005, maxValue: 2, automationRate: 'k-rate' },
    ]
  }
  constructor() { super(); this.env = 0; this.gain = 0; this.below = 1 }
  process(inputs, outputs, params) {
    const input = inputs[0], output = outputs[0]
    if (!input || input.length === 0) return true
    const thr = dbToGain(params.threshold[0])
    const envCoef = Math.exp(-1 / (sampleRate * 0.01))
    const openCoef = Math.exp(-1 / (sampleRate * ${GATE_ATTACK}))
    const closeCoef = Math.exp(-1 / (sampleRate * Math.max(0.005, params.release[0])))
    const n = input[0].length
    for (let i = 0; i < n; i++) {
      let peak = 0
      for (let c = 0; c < input.length; c++) peak = Math.max(peak, Math.abs(input[c][i]))
      this.env = Math.max(peak, this.env * envCoef)
      if (this.env >= thr) this.below = 0; else this.below += 1 / sampleRate
      const target = this.below > ${GATE_HOLD} ? 0 : 1
      this.gain = target + (this.gain - target) * (target > this.gain ? openCoef : closeCoef)
      for (let c = 0; c < output.length; c++) output[c][i] = (input[c] || input[0])[i] * this.gain
    }
    return true
  }
}
registerProcessor('groove-gate', GrooveGate)

class GrooveTap extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0]
    if (input && input[0]) this.port.postMessage({ frame: currentFrame, samples: input[0].slice() })
    return true
  }
}
registerProcessor('groove-tap', GrooveTap)
`
