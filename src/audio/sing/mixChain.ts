/**
 * The post-production chain (后期), built in any BaseAudioContext so live
 * preview and offline export sound the same:
 *
 *   voice: low cut → 4-band EQ → compressor → de-esser → gain → pan ─┬─ dry ─┐
 *                                                                    ├─ reverb send ─┤
 *                                                                    └─ delay send ──┤
 *   backing: 3-band EQ → gain ──────────────────────────────────────────────────────┤
 *                                                           master gain → limiter → out
 *
 * Every module can be bypassed (its parameters go neutral). The de-esser is a
 * simplified static one: a narrow cut around the sibilance frequency.
 */
import type { MixSettings } from '@/songs/singTypes'
import { dbToGain, delayMs } from '@/songs/mixPresets'

export interface MixGraph {
  update(m: MixSettings, bpm?: number): void
  /** Meters: voice after processing, backing, master. */
  meters: { voice: AnalyserNode; backing: AnalyserNode; master: AnalyserNode }
  /** Current gain reduction of the voice compressor, dB (≤ 0). */
  reduction(): number
  dispose(): void
}

/** A synthetic room: decaying stereo noise, denser and wider for bigger rooms. Deterministic. */
export function reverbImpulse(ctx: BaseAudioContext, size: number, decay: number): AudioBuffer {
  const len = Math.max(1, Math.round(ctx.sampleRate * Math.min(8, Math.max(0.2, decay))))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const width = 0.3 + 0.7 * size
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2 + (1 - size) * 2)
    const a = rnd()
    const b = rnd()
    buf.getChannelData(0)[i] = (a + (b - a) * (1 - width) * 0.5) * env
    buf.getChannelData(1)[i] = (b + (a - b) * (1 - width) * 0.5) * env
  }
  return buf
}

export function buildMixGraph(ctx: BaseAudioContext, voiceIn: AudioNode, backingIn: AudioNode, out: AudioNode, initial: MixSettings, bpm = 100): MixGraph {
  const lowCut = ctx.createBiquadFilter()
  lowCut.type = 'highpass'
  lowCut.Q.value = Math.SQRT1_2
  const eq = [0, 1, 2, 3].map(() => ctx.createBiquadFilter())
  const comp = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  const deEss = ctx.createBiquadFilter()
  deEss.type = 'peaking'
  deEss.Q.value = 4
  const voiceGain = ctx.createGain()
  const pan = ctx.createStereoPanner()
  const voiceMeter = ctx.createAnalyser()
  const reverbSend = ctx.createGain()
  const preDelay = ctx.createDelay(0.5)
  const convolver = ctx.createConvolver()
  const delaySend = ctx.createGain()
  const delay = ctx.createDelay(2.5)
  const feedback = ctx.createGain()
  const bLow = ctx.createBiquadFilter()
  bLow.type = 'lowshelf'
  bLow.frequency.value = 120
  const bMid = ctx.createBiquadFilter()
  bMid.type = 'peaking'
  bMid.frequency.value = 1000
  bMid.Q.value = 0.8
  const bHigh = ctx.createBiquadFilter()
  bHigh.type = 'highshelf'
  bHigh.frequency.value = 8000
  const backingGain = ctx.createGain()
  const backingMeter = ctx.createAnalyser()
  const bus = ctx.createGain()
  const master = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  const masterMeter = ctx.createAnalyser()
  for (const a of [voiceMeter, backingMeter, masterMeter]) a.fftSize = 2048

  // Voice path.
  let node: AudioNode = voiceIn
  for (const n of [lowCut, ...eq, comp, makeup, deEss, voiceGain, pan]) {
    node.connect(n)
    node = n
  }
  pan.connect(voiceMeter)
  pan.connect(bus)
  pan.connect(reverbSend).connect(preDelay).connect(convolver).connect(bus)
  pan.connect(delaySend).connect(delay).connect(bus)
  delay.connect(feedback).connect(delay)
  // Backing path.
  backingIn.connect(bLow).connect(bMid).connect(bHigh).connect(backingGain)
  backingGain.connect(backingMeter)
  backingGain.connect(bus)
  // Master.
  bus.connect(master).connect(limiter).connect(masterMeter)
  limiter.connect(out)

  let irKey = ''
  const update = (m: MixSettings, tempo = bpm) => {
    const v = m.vocal
    lowCut.frequency.value = v.lowCut.on ? v.lowCut.freq : 10
    // Exactly four slots: a missing band is a neutral peaking filter (a fresh BiquadFilter would be a 350 Hz low-pass).
    eq.forEach((f, i) => {
      const b = v.eq.bands[i] ?? { type: 'peaking' as const, freq: 1000, gainDb: 0, q: 1 }
      f.type = b.type
      f.frequency.value = b.freq
      f.Q.value = b.q
      f.gain.value = v.eq.on ? b.gainDb : 0
    })
    comp.threshold.value = v.comp.on ? v.comp.thresholdDb : 0
    comp.ratio.value = v.comp.on ? v.comp.ratio : 1
    comp.attack.value = v.comp.attackMs / 1000
    comp.release.value = v.comp.releaseMs / 1000
    comp.knee.value = 6
    makeup.gain.value = v.comp.on ? dbToGain(v.comp.makeupDb) : 1
    deEss.frequency.value = v.deEss.freq
    deEss.gain.value = v.deEss.on ? -v.deEss.amountDb : 0
    voiceGain.gain.value = dbToGain(v.gainDb)
    pan.pan.value = v.pan
    reverbSend.gain.value = v.reverb.on ? v.reverb.mix : 0
    preDelay.delayTime.value = v.reverb.preDelayMs / 1000
    const key = `${v.reverb.size.toFixed(2)}|${v.reverb.decay.toFixed(2)}`
    if (key !== irKey) {
      convolver.buffer = reverbImpulse(ctx, v.reverb.size, v.reverb.decay)
      irKey = key
    }
    delaySend.gain.value = v.delay.on ? v.delay.mix : 0
    delay.delayTime.value = (v.delay.sync ? delayMs(tempo, v.delay.division) : v.delay.timeMs) / 1000
    feedback.gain.value = v.delay.on ? v.delay.feedback : 0
    const be = m.backing.eq
    bLow.gain.value = be.on ? be.lowDb : 0
    bMid.gain.value = be.on ? be.midDb : 0
    bHigh.gain.value = be.on ? be.highDb : 0
    backingGain.gain.value = dbToGain(m.backing.gainDb)
    master.gain.value = dbToGain(m.master.gainDb)
    limiter.threshold.value = m.master.limiter ? -1 : 0
    limiter.ratio.value = m.master.limiter ? 20 : 1
    limiter.attack.value = 0.003
    limiter.release.value = 0.1
    limiter.knee.value = 0
  }
  update(initial, bpm)

  const all: AudioNode[] = [lowCut, ...eq, comp, makeup, deEss, voiceGain, pan, voiceMeter, reverbSend, preDelay, convolver, delaySend, delay, feedback, bLow, bMid, bHigh, backingGain, backingMeter, bus, master, limiter, masterMeter]
  return {
    update,
    meters: { voice: voiceMeter, backing: backingMeter, master: masterMeter },
    reduction: () => comp.reduction,
    dispose: () => all.forEach((n) => n.disconnect()),
  }
}

/** Mono samples → AudioBuffer in a context. */
export function toBuffer(ctx: BaseAudioContext, channels: Float32Array[], sampleRate: number): AudioBuffer {
  const len = Math.max(1, ...channels.map((c) => c.length))
  const buf = ctx.createBuffer(channels.length, len, sampleRate)
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  return buf
}

/**
 * Render the finished mix offline: the assembled voice plus the backing
 * stems (each with its own level), through the same chain. Returns stereo
 * channels at `sampleRate`.
 */
export async function renderMix(input: {
  voice: AudioBuffer | null
  backing: AudioBuffer[]
  mix: MixSettings
  bpm?: number
  /** Which part to render: everything, or the processed voice / the backing alone. */
  part?: 'all' | 'voice' | 'backing'
  sampleRate?: number
}): Promise<Float32Array[]> {
  const sampleRate = input.sampleRate ?? 44100
  const length = Math.ceil(Math.max(input.voice?.duration ?? 0, ...input.backing.map((b) => b.duration)) * sampleRate) + Math.round(sampleRate * Math.min(4, input.mix.vocal.reverb.decay))
  const ctx = new OfflineAudioContext(2, Math.max(1, length), sampleRate)
  const voiceIn = ctx.createGain()
  const backingIn = ctx.createGain()
  const part = input.part ?? 'all'
  voiceIn.gain.value = part === 'backing' ? 0 : 1
  backingIn.gain.value = part === 'voice' ? 0 : 1
  buildMixGraph(ctx, voiceIn, backingIn, ctx.destination, input.mix, input.bpm)
  if (input.voice) {
    const s = ctx.createBufferSource()
    s.buffer = input.voice
    s.connect(voiceIn)
    s.start(0)
  }
  for (const b of input.backing) {
    const s = ctx.createBufferSource()
    s.buffer = b
    s.connect(backingIn)
    s.start(0)
  }
  const out = await ctx.startRendering()
  return [out.getChannelData(0), out.getChannelData(1)]
}
