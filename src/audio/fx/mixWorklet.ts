/**
 * The mix desk's own audio-thread processor, 'groove-dyn': the dynamics Web
 * Audio does not have built in, in one place.
 *
 *  - mode 'comp':  downward compression of the whole signal; the detector can
 *                  listen to a band (freq > 0) or to a second input (sidechain,
 *                  used for ducking the backing under the voice).
 *  - mode 'gate':  downward expander / noise gate below the threshold.
 *  - mode 'split': dynamic band cut (dynamic EQ, de-esser): only the band
 *                  around `freq` is turned down, and only when it is loud.
 *
 * Stereo-linked (one gain for all channels). Parameters come in through
 * processorOptions (offline rendering) and port messages (live changes); the
 * current gain reduction is posted back about 20 times a second.
 */
import * as Tone from 'tone'

export interface DynParams {
  mode: 'comp' | 'gate' | 'split'
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  /** Most it may turn down, dB (gate: how far down it goes). */
  rangeDb: number
  makeupDb: number
  /** Detector / split band centre, Hz (0 = full band). */
  freq: number
  q: number
  /** Listen to input 1 instead of input 0. */
  sidechain: boolean
  /** Bypass (unity). */
  off: boolean
}

export const DYN_DEFAULTS: DynParams = { mode: 'comp', thresholdDb: 0, ratio: 1, attackMs: 10, releaseMs: 100, rangeDb: 60, makeupDb: 0, freq: 0, q: 1, sidechain: false, off: true }

export const MIX_WORKLET_SOURCE = `
class GrooveDyn extends AudioWorkletProcessor {
  constructor(options) {
    super()
    this.p = Object.assign({}, options.processorOptions || {})
    this.env = 0
    this.gain = 1
    this.hold = 0
    this.det = [0, 0, 0, 0]
    this.band = [[0, 0, 0, 0], [0, 0, 0, 0]]
    this.count = 0
    this.minGain = 1
    this.coef()
    this.port.onmessage = (e) => { Object.assign(this.p, e.data); this.coef() }
  }
  coef() {
    const p = this.p
    const fs = sampleRate
    this.att = Math.exp(-1 / (Math.max(0.05, p.attackMs) * 0.001 * fs))
    this.rel = Math.exp(-1 / (Math.max(1, p.releaseMs) * 0.001 * fs))
    this.gsm = Math.exp(-1 / (0.002 * fs))
    if (p.freq > 0) {
      const w0 = 2 * Math.PI * Math.min(p.freq, fs * 0.45) / fs
      const alpha = Math.sin(w0) / (2 * Math.max(0.1, p.q))
      const a0 = 1 + alpha
      this.b0 = alpha / a0; this.b2 = -alpha / a0
      this.a1 = -2 * Math.cos(w0) / a0; this.a2 = (1 - alpha) / a0
    }
  }
  bp(x, s) {
    const y = this.b0 * x + this.b2 * s[1] - this.a1 * s[2] - this.a2 * s[3]
    s[1] = s[0]; s[0] = x; s[3] = s[2]; s[2] = y
    return y
  }
  process(inputs, outputs) {
    const p = this.p
    const input = inputs[0] || []
    const output = outputs[0]
    const side = p.sidechain ? (inputs[1] || []) : input
    const n = output[0] ? output[0].length : 128
    const chans = output.length
    if (p.off || !input.length) {
      for (let c = 0; c < chans; c++) {
        const src = input[c] || input[0]
        if (src) output[c].set(src); else output[c].fill(0)
      }
      return true
    }
    const makeup = Math.pow(10, p.makeupDb / 20)
    const floorGain = Math.pow(10, -p.rangeDb / 20)
    const filtered = p.freq > 0
    for (let i = 0; i < n; i++) {
      // detector: linked peak of all channels (optionally band-passed)
      let lvl = 0
      for (let c = 0; c < side.length; c++) {
        let x = side[c][i]
        if (filtered) x = this.bp(x, c === 0 ? this.det : (this.det2 || (this.det2 = [0, 0, 0, 0])))
        const a = x < 0 ? -x : x
        if (a > lvl) lvl = a
      }
      this.env = lvl > this.env ? this.att * this.env + (1 - this.att) * lvl : this.rel * this.env + (1 - this.rel) * lvl
      const envDb = 20 * Math.log10(this.env + 1e-9)
      let grDb = 0
      if (p.mode === 'gate') {
        const under = p.thresholdDb - envDb
        if (under > 0) grDb = Math.min(p.rangeDb, under * Math.max(1, p.ratio - 1))
      } else {
        const over = envDb - p.thresholdDb
        const knee = 6
        if (over > knee / 2) grDb = over * (1 - 1 / p.ratio)
        else if (over > -knee / 2) grDb = ((over + knee / 2) * (over + knee / 2) / (2 * knee)) * (1 - 1 / p.ratio)
        grDb = Math.min(grDb, p.rangeDb)
      }
      const target = Math.max(floorGain, Math.pow(10, -grDb / 20))
      this.gain = this.gsm * this.gain + (1 - this.gsm) * target
      if (this.gain < this.minGain) this.minGain = this.gain
      const g = this.gain
      for (let c = 0; c < chans; c++) {
        const src = input[c] || input[0]
        const x = src ? src[i] : 0
        if (p.mode === 'split') {
          const b = this.bp(x, this.band[c] || (this.band[c] = [0, 0, 0, 0]))
          output[c][i] = (x - (1 - g) * b) * makeup
        } else {
          output[c][i] = x * g * makeup
        }
      }
    }
    this.count += n
    if (this.count >= 2048) {
      this.port.postMessage(20 * Math.log10(this.minGain + 1e-9))
      this.count = 0
      this.minGain = 1
    }
    return true
  }
}
registerProcessor('groove-dyn', GrooveDyn)
`

const loaded = new WeakMap<BaseAudioContext, Promise<boolean>>()

/** Register 'groove-dyn' in a context (live or offline) once. False when the browser cannot. */
export function ensureMixWorklet(ctx: BaseAudioContext): Promise<boolean> {
  let p = loaded.get(ctx)
  if (!p) {
    p = (async () => {
      if (!ctx.audioWorklet) return false
      const url = URL.createObjectURL(new Blob([MIX_WORKLET_SOURCE], { type: 'text/javascript' }))
      try {
        await ctx.audioWorklet.addModule(url)
        return true
      } catch {
        return false
      } finally {
        URL.revokeObjectURL(url)
      }
    })()
    loaded.set(ctx, p)
  }
  return p
}

/**
 * A 'groove-dyn' node in `ctx`. Tone's live context is a wrapper, so its own
 * factory is used there; a plain OfflineAudioContext takes the native constructor.
 */
export function makeDynNode(ctx: BaseAudioContext, params: DynParams, inputs = 1): AudioWorkletNode {
  const options: AudioWorkletNodeOptions = { numberOfInputs: inputs, numberOfOutputs: 1, outputChannelCount: [2], channelCount: 2, channelCountMode: 'explicit', processorOptions: params }
  const tone = Tone.getContext()
  if ((tone.rawContext as unknown) === ctx) return tone.createAudioWorkletNode('groove-dyn', options)
  return new AudioWorkletNode(ctx, 'groove-dyn', options)
}
