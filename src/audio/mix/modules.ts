/**
 * 后期模块 (0.25.0): every processor of the post-production desk as a
 * self-contained module — inputs, an output, and `update(mix)` reading its
 * own part of a MixSettings. The quick desk (audio/sing/mixChain) wires them
 * in its fixed order; the modular workspace (audio/mix/modularGraph) wires
 * them as the student connected them. Same code, same sound.
 */
import type { MixSettings } from '@/songs/singTypes'
import { dbToGain, delayMs } from '@/songs/mixPresets'
import { DYN_DEFAULTS, makeDynNode, type DynParams } from '@/audio/fx/mixWorklet'

export interface Module {
  /** Input 0 is the signal; a sidechain module has input 1 too. */
  inputs: AudioNode[]
  output: AudioNode
  update(m: MixSettings, tempo: number): void
  nodes: AudioNode[]
  /** Gain reduction now, dB (≤ 0), for modules that compress. */
  reduction?(): number
}

export const dyn = (p: Partial<DynParams>): DynParams => ({ ...DYN_DEFAULTS, ...p })

/** Building blocks shared by the modules of one graph (all nodes are tracked for dispose). */
export interface Kit {
  ctx: BaseAudioContext
  all: AudioNode[]
  oscillators: OscillatorNode[]
  worklets: boolean
  track<T extends AudioNode>(n: T): T
  gain(v?: number): GainNode
  biquad(type: BiquadFilterType, freq: number, q?: number): BiquadFilterNode
  dynNode(
    p: DynParams,
    inputs?: number,
    onReduction?: (db: number) => void,
  ): AudioWorkletNode | null
  lfo(rate: number): OscillatorNode
}

export function makeKit(ctx: BaseAudioContext, worklets: boolean): Kit {
  const all: AudioNode[] = []
  const oscillators: OscillatorNode[] = []
  const track = <T extends AudioNode>(n: T): T => {
    all.push(n)
    return n
  }
  return {
    ctx,
    all,
    oscillators,
    worklets,
    track,
    gain: (v = 1) => {
      const g = track(ctx.createGain())
      g.gain.value = v
      return g
    },
    biquad: (type, freq, q = Math.SQRT1_2) => {
      const f = track(ctx.createBiquadFilter())
      f.type = type
      f.frequency.value = freq
      f.Q.value = q
      return f
    },
    dynNode: (p, inputs = 1, onReduction) => {
      if (!worklets) return null
      try {
        const n = track(makeDynNode(ctx, p, inputs))
        n.port.onmessage = (e: MessageEvent<number>) => onReduction?.(e.data)
        return n
      } catch {
        return null
      }
    },
    lfo: (rate) => {
      const o = track(ctx.createOscillator())
      o.frequency.value = rate
      o.start()
      oscillators.push(o)
      return o
    },
  }
}

export function disposeKit(kit: Kit): void {
  for (const o of kit.oscillators) {
    try {
      o.stop()
    } catch {
      // already stopped
    }
  }
  for (const n of kit.all) n.disconnect()
}

const setDyn = (n: AudioWorkletNode | null, p: DynParams) => n?.port.postMessage(p)

function passthrough(k: Kit): Module {
  const g = k.gain()
  return { inputs: [g], output: g, update: () => undefined, nodes: [g] }
}

/** A worklet dynamics module; null-safe (passes through when the worklet is unavailable). */
function dynModule(k: Kit, params: (m: MixSettings) => DynParams, first: MixSettings): Module {
  let red = 0
  const n = k.dynNode(params(first), 1, (db) => (red = db))
  if (!n) return passthrough(k)
  return {
    inputs: [n],
    output: n,
    update: (m) => setDyn(n, params(m)),
    nodes: [n],
    reduction: () => red,
  }
}

export function gateModule(k: Kit, first: MixSettings): Module {
  return dynModule(
    k,
    (m) =>
      dyn({
        mode: 'gate',
        off: !m.vocal.gate.on,
        thresholdDb: m.vocal.gate.thresholdDb,
        ratio: 4,
        rangeDb: m.vocal.gate.rangeDb,
        attackMs: 1,
        releaseMs: m.vocal.gate.releaseMs,
      }),
    first,
  )
}

export function lowCutModule(k: Kit): Module {
  const f = k.biquad('highpass', 10)
  return {
    inputs: [f],
    output: f,
    update: (m) => (f.frequency.value = m.vocal.lowCut.on ? m.vocal.lowCut.freq : 10),
    nodes: [f],
  }
}

export function eqModule(k: Kit): Module {
  const eq = [0, 1, 2, 3].map(() => k.biquad('peaking', 1000, 1))
  for (let i = 0; i < 3; i++) eq[i]!.connect(eq[i + 1]!)
  return {
    inputs: [eq[0]!],
    output: eq[3]!,
    // Exactly four slots: a missing band is a neutral peaking filter (a fresh BiquadFilter would be a 350 Hz low-pass).
    update: (m) =>
      eq.forEach((f, i) => {
        const b = m.vocal.eq.bands[i] ?? { type: 'peaking' as const, freq: 1000, gainDb: 0, q: 1 }
        f.type = b.type
        f.frequency.value = b.freq
        f.Q.value = b.q
        f.gain.value = m.vocal.eq.on ? b.gainDb : 0
      }),
    nodes: eq,
  }
}

export function dynEqModule(k: Kit, first: MixSettings): Module {
  return dynModule(
    k,
    (m) => {
      const d = m.vocal.dynEq
      return dyn({
        mode: 'split',
        off: !d.on,
        freq: d.freq,
        q: d.q,
        thresholdDb: d.thresholdDb,
        ratio: d.ratio,
        rangeDb: d.maxCutDb,
        attackMs: 5,
        releaseMs: 80,
      })
    },
    first,
  )
}

export function compModule(k: Kit, which: 'comp' | 'comp2' = 'comp'): Module {
  const comp = k.track(k.ctx.createDynamicsCompressor())
  const makeup = k.gain()
  comp.connect(makeup)
  return {
    inputs: [comp],
    output: makeup,
    update: (m) => {
      const c = m.vocal[which]
      comp.threshold.value = c.on ? c.thresholdDb : 0
      comp.ratio.value = c.on ? c.ratio : 1
      comp.attack.value = c.attackMs / 1000
      comp.release.value = c.releaseMs / 1000
      comp.knee.value = 6
      makeup.gain.value = c.on ? dbToGain(c.makeupDb) : 1
    },
    nodes: [comp, makeup],
    reduction: () => comp.reduction,
  }
}

export function parallelModule(k: Kit): Module {
  const input = k.gain()
  const output = k.gain()
  const crush = k.track(k.ctx.createDynamicsCompressor())
  const wet = k.gain(0)
  input.connect(output)
  input.connect(crush).connect(wet).connect(output)
  return {
    inputs: [input],
    output,
    update: (m) => {
      const p = m.vocal.parallel
      crush.threshold.value = p.thresholdDb
      crush.ratio.value = p.ratio
      crush.attack.value = 0.001
      crush.release.value = 0.08
      crush.knee.value = 0
      // Bring the squashed copy back up to about the level of the dry voice, then blend.
      const makeupDb = -p.thresholdDb * (1 - 1 / p.ratio) * 0.7
      wet.gain.value = p.on ? p.blend * dbToGain(makeupDb) : 0
    },
    nodes: [input, output, crush, wet],
    reduction: () => crush.reduction,
  }
}

export function deEssModule(k: Kit, first: MixSettings): Module {
  const params = (m: MixSettings) => {
    const d = m.vocal.deEss
    return dyn({
      mode: 'split',
      off: !d.on,
      freq: d.freq,
      q: 1.4,
      thresholdDb: d.thresholdDb,
      ratio: 6,
      rangeDb: d.amountDb,
      attackMs: 1,
      releaseMs: 60,
    })
  }
  let red = 0
  const n = k.dynNode(params(first), 1, (db) => (red = db))
  if (n)
    return {
      inputs: [n],
      output: n,
      update: (m) => setDyn(n, params(m)),
      nodes: [n],
      reduction: () => red,
    }
  // Fallback: a static cut around the sibilance (the pre-0.21 behaviour).
  const f = k.biquad('peaking', 6500, 4)
  return {
    inputs: [f],
    output: f,
    update: (m) => {
      f.frequency.value = m.vocal.deEss.freq
      f.gain.value = m.vocal.deEss.on ? -m.vocal.deEss.amountDb : 0
    },
    nodes: [f],
  }
}

/** Waveshaper curve for saturation: tape (soft, symmetric), tube (asymmetric, even harmonics), hard (clipping). */
export function saturationCurve(
  type: 'tape' | 'tube' | 'hard',
  drive: number,
  n = 2048,
): Float32Array {
  const k = 1 + drive * 9
  const curve = new Float32Array(n)
  const norm = Math.tanh(k)
  const bias = 0.15
  const tubeNorm = Math.tanh(k * (1 + bias)) - Math.tanh(k * bias)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    if (type === 'tape') curve[i] = Math.tanh(k * x) / norm
    else if (type === 'tube')
      curve[i] = (Math.tanh(k * (x + bias)) - Math.tanh(k * bias)) / tubeNorm
    else curve[i] = Math.max(-1, Math.min(1, x * k * 0.6))
  }
  return curve
}

export function saturationModule(k: Kit): Module {
  const input = k.gain()
  const output = k.gain()
  const dry = k.gain(1)
  const drive = k.gain(1)
  const shaper = k.track(k.ctx.createWaveShaper())
  shaper.oversample = '4x'
  const comp = k.gain(1)
  const wet = k.gain(0)
  input.connect(dry).connect(output)
  input.connect(drive).connect(shaper).connect(comp).connect(wet).connect(output)
  let key = ''
  return {
    inputs: [input],
    output,
    update: (m) => {
      const s = m.vocal.saturation
      const kk = `${s.type}|${s.drive.toFixed(2)}`
      if (kk !== key) {
        shaper.curve = saturationCurve(s.type, s.drive) as Float32Array<ArrayBuffer>
        key = kk
      }
      drive.gain.value = 1
      comp.gain.value = s.type === 'hard' ? 0.7 : 0.85
      dry.gain.value = s.on ? 1 - s.mix : 1
      wet.gain.value = s.on ? s.mix : 0
    },
    nodes: [input, output, dry, drive, shaper, comp, wet],
  }
}

export function modModule(k: Kit, first: MixSettings): Module {
  // All four kinds are built; only the chosen one is heard.
  const input = k.gain()
  const output = k.gain()
  const dry = k.gain(1)
  input.connect(dry).connect(output)
  const merger = k.track(k.ctx.createChannelMerger(2))
  merger.connect(output)
  const osc = k.lfo(first.vocal.mod.rate)
  // chorus / doubler: two modulated delays, left and right, LFO in opposite phase
  const dl = k.track(k.ctx.createDelay(0.1))
  const dr = k.track(k.ctx.createDelay(0.1))
  const depthL = k.gain(0)
  const depthR = k.gain(0)
  osc.connect(depthL).connect(dl.delayTime)
  osc.connect(depthR).connect(dr.delayTime)
  const wetL = k.gain(0)
  const wetR = k.gain(0)
  input.connect(dl).connect(wetL).connect(merger, 0, 0)
  input.connect(dr).connect(wetR).connect(merger, 0, 1)
  // flanger: one short delay with feedback, both sides
  const fl = k.track(k.ctx.createDelay(0.05))
  const flDepth = k.gain(0)
  const flFb = k.gain(0)
  const flWet = k.gain(0)
  osc.connect(flDepth).connect(fl.delayTime)
  input.connect(fl)
  fl.connect(flFb).connect(fl)
  fl.connect(flWet)
  flWet.connect(merger, 0, 0)
  flWet.connect(merger, 0, 1)
  // phaser: four all-pass stages swept by the LFO
  const ap = [0, 1, 2, 3].map(() => k.biquad('allpass', 800, 0.7))
  const apDepth = k.gain(0)
  for (const f of ap) osc.connect(apDepth).connect(f.frequency)
  input.connect(ap[0]!)
  for (let i = 0; i < 3; i++) ap[i]!.connect(ap[i + 1]!)
  const apWet = k.gain(0)
  ap[3]!.connect(apWet)
  apWet.connect(merger, 0, 0)
  apWet.connect(merger, 0, 1)
  return {
    inputs: [input],
    output,
    update: (m) => {
      const md = m.vocal.mod
      osc.frequency.value = md.rate
      const on = md.on
      const t = md.type
      dry.gain.value = on ? 1 - md.mix * 0.5 : 1
      const w = on ? md.mix : 0
      // chorus 15–25 ms ± depth·4 ms; doubler 12 / 23 ms ± depth·1.5 ms
      const chorus = t === 'chorus' || t === 'doubler'
      dl.delayTime.value = t === 'doubler' ? 0.012 : 0.018
      dr.delayTime.value = t === 'doubler' ? 0.023 : 0.021
      const cd = (t === 'doubler' ? 0.0015 : 0.004) * md.depth
      depthL.gain.value = chorus ? cd : 0
      depthR.gain.value = chorus ? -cd : 0
      wetL.gain.value = chorus ? w : 0
      wetR.gain.value = chorus ? w : 0
      fl.delayTime.value = 0.003
      flDepth.gain.value = t === 'flanger' ? 0.0025 * md.depth : 0
      flFb.gain.value = t === 'flanger' ? 0.5 : 0
      flWet.gain.value = t === 'flanger' ? w : 0
      for (const f of ap) f.frequency.value = 900
      apDepth.gain.value = t === 'phaser' ? 700 * md.depth : 0
      apWet.gain.value = t === 'phaser' ? w : 0
    },
    nodes: [
      input,
      output,
      dry,
      merger,
      dl,
      dr,
      depthL,
      depthR,
      wetL,
      wetR,
      fl,
      flDepth,
      flFb,
      flWet,
      ...ap,
      apDepth,
      apWet,
    ],
  }
}

/**
 * A synthetic room: decaying stereo noise. Rooms add a few early reflections,
 * plates are dense and bright from the start, halls swell in more slowly.
 * Deterministic.
 */
export function reverbImpulse(
  ctx: BaseAudioContext,
  size: number,
  decay: number,
  type: 'room' | 'plate' | 'hall' = 'plate',
): AudioBuffer {
  const len = Math.max(1, Math.round(ctx.sampleRate * Math.min(8, Math.max(0.2, decay))))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const width = 0.3 + 0.7 * size
  const swell =
    type === 'hall'
      ? Math.round(ctx.sampleRate * 0.03)
      : type === 'room'
        ? Math.round(ctx.sampleRate * 0.004)
        : 1
  const L = buf.getChannelData(0)
  const R = buf.getChannelData(1)
  for (let i = 0; i < len; i++) {
    const env = Math.pow(1 - i / len, 2 + (1 - size) * 2) * Math.min(1, i / swell)
    const a = rnd()
    const b = rnd()
    L[i] = (a + (b - a) * (1 - width) * 0.5) * env
    R[i] = (b + (a - b) * (1 - width) * 0.5) * env
  }
  if (type === 'room') {
    // A few discrete early reflections (walls) in the first 40 ms.
    const taps = [7, 11, 17, 23, 31, 37].map((ms) =>
      Math.round((ms * (0.5 + size) * ctx.sampleRate) / 1000),
    )
    taps.forEach((t, k) => {
      if (t < len) {
        L[t]! += (k % 2 ? 0.35 : 0.5) / (k + 1)
        R[Math.min(len - 1, t + 13)]! += (k % 2 ? 0.5 : 0.35) / (k + 1)
      }
    })
  }
  return buf
}

/**
 * Reverb: `send` = the wet sound only (a send / return: the quick desk, or a
 * 发送 bus in the workspace); otherwise dry + wet at `mix` (an insert).
 */
export function reverbModule(k: Kit, send: () => boolean): Module {
  const input = k.gain()
  const output = k.gain()
  const dry = k.gain(0)
  const wetIn = k.gain(0)
  const preDelay = k.track(k.ctx.createDelay(0.5))
  const convolver = k.track(k.ctx.createConvolver())
  const revLow = k.biquad('highpass', 200)
  const revHigh = k.biquad('lowpass', 8000)
  input.connect(dry).connect(output)
  input
    .connect(wetIn)
    .connect(preDelay)
    .connect(convolver)
    .connect(revLow)
    .connect(revHigh)
    .connect(output)
  let irKey = ''
  return {
    inputs: [input],
    output,
    update: (m) => {
      const r = m.vocal.reverb
      const isSend = send()
      dry.gain.value = isSend ? 0 : 1
      wetIn.gain.value = r.on ? r.mix : 0
      preDelay.delayTime.value = r.preDelayMs / 1000
      revLow.frequency.value = r.lowCut
      revHigh.frequency.value = r.highCut
      const key = `${r.type}|${r.size.toFixed(2)}|${r.decay.toFixed(2)}`
      if (key !== irKey) {
        convolver.buffer = reverbImpulse(k.ctx, r.size, r.decay, r.type)
        irKey = key
      }
    },
    nodes: [input, output, dry, wetIn, preDelay, convolver, revLow, revHigh],
  }
}

/** Delay (echo), straight or ping-pong, tempo-synced or in ms; `send` as for the reverb. */
export function delayModule(k: Kit, send: () => boolean): Module {
  const input = k.gain()
  const output = k.gain()
  const dry = k.gain(0)
  const delaySend = k.gain(0)
  const delayL = k.track(k.ctx.createDelay(2.5))
  const delayR = k.track(k.ctx.createDelay(2.5))
  const delayTone = k.biquad('lowpass', 6000)
  const feedback = k.gain(0)
  const cross = k.gain(0)
  const straight = k.gain(1)
  const delayMerge = k.track(k.ctx.createChannelMerger(2))
  const delayDown = k.gain(1)
  delayDown.channelCount = 1
  delayDown.channelCountMode = 'explicit'
  input.connect(dry).connect(output)
  input.connect(delaySend).connect(delayDown).connect(delayL)
  delayL.connect(delayTone)
  // straight: L feeds back into itself and plays both sides; ping-pong: L → R → L
  delayTone.connect(feedback).connect(delayL)
  delayTone.connect(straight)
  straight.connect(delayMerge, 0, 0)
  straight.connect(delayMerge, 0, 1)
  delayTone.connect(cross).connect(delayR)
  const pingL = k.gain(0)
  const pingR = k.gain(0)
  delayTone.connect(pingL).connect(delayMerge, 0, 0)
  delayR.connect(pingR).connect(delayMerge, 0, 1)
  const pingBack = k.gain(0)
  delayR.connect(pingBack).connect(delayL)
  delayMerge.connect(output)
  return {
    inputs: [input],
    output,
    update: (m, tempo) => {
      const d = m.vocal.delay
      dry.gain.value = send() ? 0 : 1
      const time = (d.sync ? delayMs(tempo, d.division) : d.timeMs) / 1000
      delaySend.gain.value = d.on ? d.mix : 0
      delayL.delayTime.value = time
      delayR.delayTime.value = time
      delayTone.frequency.value = d.highCut
      const fb = d.on ? d.feedback : 0
      feedback.gain.value = d.pingPong ? 0 : fb
      straight.gain.value = d.pingPong ? 0 : 1
      cross.gain.value = d.pingPong ? 1 : 0
      pingL.gain.value = d.pingPong ? 1 : 0
      pingR.gain.value = d.pingPong ? 1 : 0
      pingBack.gain.value = d.pingPong ? fb : 0
    },
    nodes: [
      input,
      output,
      dry,
      delaySend,
      delayL,
      delayR,
      delayTone,
      feedback,
      cross,
      straight,
      delayMerge,
      delayDown,
      pingL,
      pingR,
      pingBack,
    ],
  }
}

/** Backing 3-band EQ. */
export function backingEqModule(k: Kit): Module {
  const bLow = k.biquad('lowshelf', 120)
  const bMid = k.biquad('peaking', 1000, 0.8)
  const bHigh = k.biquad('highshelf', 8000)
  bLow.connect(bMid).connect(bHigh)
  return {
    inputs: [bLow],
    output: bHigh,
    update: (m) => {
      const be = m.backing.eq
      bLow.gain.value = be.on ? be.lowDb : 0
      bMid.gain.value = be.on ? be.midDb : 0
      bHigh.gain.value = be.on ? be.highDb : 0
    },
    nodes: [bLow, bMid, bHigh],
  }
}

/** A dip where the voice is clearest ("vocal pocket"). */
export function pocketModule(k: Kit): Module {
  const pocket = k.biquad('peaking', 3000, 1)
  return {
    inputs: [pocket],
    output: pocket,
    update: (m) => {
      pocket.frequency.value = m.backing.pocket.freq
      pocket.gain.value = m.backing.pocket.on ? -m.backing.pocket.amountDb : 0
    },
    nodes: [pocket],
  }
}

/** Sidechain ducking: input 0 dips while input 1 (the voice) is loud. */
export function duckModule(k: Kit, first: MixSettings): Module {
  const params = (m: MixSettings) =>
    dyn({
      mode: 'comp',
      off: !m.backing.duck.on,
      sidechain: true,
      thresholdDb: -40,
      ratio: 20,
      rangeDb: m.backing.duck.amountDb,
      attackMs: 15,
      releaseMs: m.backing.duck.releaseMs,
    })
  let red = 0
  const n = k.dynNode(params(first), 2, (db) => (red = db))
  if (!n) {
    const g = k.gain()
    const sink = k.gain(0)
    return { inputs: [g, sink], output: g, update: () => undefined, nodes: [g, sink] }
  }
  // Separate entry gains so each input can be connected to the right port.
  const main = k.gain()
  const side = k.gain()
  main.connect(n, 0, 0)
  side.connect(n, 0, 1)
  return {
    inputs: [main, side],
    output: n,
    update: (m) => setDyn(n, params(m)),
    nodes: [main, side, n],
    reduction: () => red,
  }
}

/** Level (dB) read from the mix by `db`. */
export function gainModule(k: Kit, db: (m: MixSettings) => number): Module {
  const g = k.gain()
  return { inputs: [g], output: g, update: (m) => (g.gain.value = dbToGain(db(m))), nodes: [g] }
}

export function panModule(k: Kit, pan: (m: MixSettings) => number): Module {
  const p = k.track(k.ctx.createStereoPanner())
  return { inputs: [p], output: p, update: (m) => (p.pan.value = pan(m)), nodes: [p] }
}

/** Sums whatever is connected (a bus). */
export function mixerModule(k: Kit): Module {
  const g = k.gain()
  return { inputs: [g], output: g, update: () => undefined, nodes: [g] }
}

/** Three-band compressor (Linkwitz–Riley-style splits). */
export function multibandModule(k: Kit): Module {
  const input = k.gain()
  const mbDry = k.gain(1)
  const mbSum = k.gain(1)
  input.connect(mbDry).connect(mbSum)
  const lp = (f: number) => [k.biquad('lowpass', f), k.biquad('lowpass', f)]
  const hp = (f: number) => [k.biquad('highpass', f), k.biquad('highpass', f)]
  const lowF = lp(200)
  const midH = hp(200)
  const midL = lp(3000)
  const highF = hp(3000)
  const chain = (src: AudioNode, fs: AudioNode[]) =>
    fs.reduce<AudioNode>((a, f) => a.connect(f), src)
  const mbComps = [0, 1, 2].map(() => k.track(k.ctx.createDynamicsCompressor()))
  const mbGains = [0, 1, 2].map(() => k.gain(0))
  chain(input, lowF).connect(mbComps[0]!).connect(mbGains[0]!).connect(mbSum)
  chain(chain(input, midH), midL).connect(mbComps[1]!).connect(mbGains[1]!).connect(mbSum)
  chain(input, highF).connect(mbComps[2]!).connect(mbGains[2]!).connect(mbSum)
  return {
    inputs: [input],
    output: mbSum,
    update: (m) => {
      const mb = m.master.multiband
      for (const f of [...lowF, ...midH]) f.frequency.value = mb.lowHz
      for (const f of [...midL, ...highF]) f.frequency.value = mb.highHz
      mbDry.gain.value = mb.on ? 0 : 1
      mbComps.forEach((c, i) => {
        const b = mb.bands[i]!
        c.threshold.value = b.thresholdDb
        c.ratio.value = b.ratio
        c.attack.value = i === 0 ? 0.03 : i === 1 ? 0.015 : 0.005
        c.release.value = i === 0 ? 0.25 : 0.15
        c.knee.value = 6
        mbGains[i]!.gain.value = mb.on ? dbToGain(b.gainDb) : 0
      })
    },
    nodes: [input, mbDry, mbSum, ...lowF, ...midH, ...midL, ...highF, ...mbComps, ...mbGains],
  }
}

/** Stereo width: L' = L·(1+w)/2 + R·(1−w)/2, R' = R·(1+w)/2 + L·(1−w)/2. */
export function widthModule(k: Kit): Module {
  const input = k.gain()
  const split = k.track(k.ctx.createChannelSplitter(2))
  const wMerge = k.track(k.ctx.createChannelMerger(2))
  const ll = k.gain(1)
  const rr = k.gain(1)
  const lr = k.gain(0)
  const rl = k.gain(0)
  input.connect(split)
  split.connect(ll, 0).connect(wMerge, 0, 0)
  split.connect(rl, 1).connect(wMerge, 0, 0)
  split.connect(rr, 1).connect(wMerge, 0, 1)
  split.connect(lr, 0).connect(wMerge, 0, 1)
  return {
    inputs: [input],
    output: wMerge,
    update: (m) => {
      const w = m.master.width.on ? m.master.width.amount : 1
      ll.gain.value = (1 + w) / 2
      rr.gain.value = (1 + w) / 2
      lr.gain.value = (1 - w) / 2
      rl.gain.value = (1 - w) / 2
    },
    nodes: [input, split, wMerge, ll, rr, lr, rl],
  }
}

/** Live limiter (the export also runs the true-peak limiter / loudness target). */
export function limiterModule(k: Kit): Module {
  const limiter = k.track(k.ctx.createDynamicsCompressor())
  return {
    inputs: [limiter],
    output: limiter,
    update: (m) => {
      const ms = m.master
      limiter.threshold.value = ms.limiter ? ms.ceilingDb - 0.5 : 0
      limiter.ratio.value = ms.limiter ? 20 : 1
      limiter.attack.value = 0.002
      limiter.release.value = 0.1
      limiter.knee.value = 0
    },
    nodes: [limiter],
    reduction: () => limiter.reduction,
  }
}
