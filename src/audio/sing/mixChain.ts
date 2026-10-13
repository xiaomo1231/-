/**
 * The post-production chain (后期), built in any BaseAudioContext so live
 * preview and offline export sound the same:
 *
 *   voice: [inserts in the student's order: gate, low cut, EQ, dynamic EQ,
 *           compressor, 2nd compressor, parallel compression, de-esser,
 *           saturation, modulation] → gain → pan ─┬─ dry ─────────────────┐
 *                                                 ├─ reverb send → return ┤
 *                                                 └─ delay send → return ─┤
 *   backing (per stem gain) → 3-band EQ → pocket → ducking ← voice → gain ┤
 *        bus → master gain → multiband → width → limiter → out
 *
 * Every module can be bypassed (its parameters go neutral). Gate, dynamic EQ,
 * de-esser and ducking need the 'groove-dyn' worklet (audio/fx/mixWorklet);
 * where it cannot load, the de-esser falls back to a static cut and the
 * others pass the signal through. A change of insert order needs a new graph
 * (`structureKey`).
 */
import type { InsertId, MixSettings } from '@/songs/singTypes'
import { clampMix, dbToGain, delayMs } from '@/songs/mixPresets'
import { DYN_DEFAULTS, ensureMixWorklet, makeDynNode, type DynParams } from '@/audio/fx/mixWorklet'
import { limitPeaks, normalizeLoudness } from '@/audio/fx/limiter'

export interface MixMeters {
  voice: AnalyserNode
  backing: AnalyserNode
  master: AnalyserNode
  masterL: AnalyserNode
  masterR: AnalyserNode
  /** Master after a K-weighting approximation (for a live loudness readout). */
  loudness: AnalyserNode
}

export interface MixGraph {
  update(m: MixSettings, bpm?: number): void
  meters: MixMeters
  /** Current gain reduction of the main voice compressor, dB (≤ 0). */
  reduction(): number
  /** Gain reduction of the worklet dynamics, dB (≤ 0). */
  dynReduction(): { gate: number; dynEq: number; deEss: number; duck: number; comp2: number; limiter: number }
  /** Per-stem input gains (one per backing buffer, in order). */
  stemGains: GainNode[]
  dispose(): void
}

/** What makes a graph need rebuilding (rather than a parameter update). */
export function structureKey(m: MixSettings): string {
  return m.vocal.order.join(',')
}

/**
 * A synthetic room: decaying stereo noise. Rooms add a few early reflections,
 * plates are dense and bright from the start, halls swell in more slowly.
 * Deterministic.
 */
export function reverbImpulse(ctx: BaseAudioContext, size: number, decay: number, type: 'room' | 'plate' | 'hall' = 'plate'): AudioBuffer {
  const len = Math.max(1, Math.round(ctx.sampleRate * Math.min(8, Math.max(0.2, decay))))
  const buf = ctx.createBuffer(2, len, ctx.sampleRate)
  let seed = 12345
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296 - 0.5
  }
  const width = 0.3 + 0.7 * size
  const swell = type === 'hall' ? Math.round(ctx.sampleRate * 0.03) : type === 'room' ? Math.round(ctx.sampleRate * 0.004) : 1
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
    const taps = [7, 11, 17, 23, 31, 37].map((ms) => Math.round((ms * (0.5 + size)) * ctx.sampleRate / 1000))
    taps.forEach((t, k) => {
      if (t < len) {
        L[t]! += (k % 2 ? 0.35 : 0.5) / (k + 1)
        R[Math.min(len - 1, t + 13)]! += (k % 2 ? 0.5 : 0.35) / (k + 1)
      }
    })
  }
  return buf
}

/** Waveshaper curve for saturation: tape (soft, symmetric), tube (asymmetric, even harmonics), hard (clipping). */
export function saturationCurve(type: 'tape' | 'tube' | 'hard', drive: number, n = 2048): Float32Array {
  const k = 1 + drive * 9
  const curve = new Float32Array(n)
  const norm = Math.tanh(k)
  const bias = 0.15
  const tubeNorm = Math.tanh(k * (1 + bias)) - Math.tanh(k * bias)
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1
    if (type === 'tape') curve[i] = Math.tanh(k * x) / norm
    else if (type === 'tube') curve[i] = (Math.tanh(k * (x + bias)) - Math.tanh(k * bias)) / tubeNorm
    else curve[i] = Math.max(-1, Math.min(1, x * k * 0.6))
  }
  return curve
}

interface Insert {
  input: AudioNode
  output: AudioNode
  update(m: MixSettings, bpm: number): void
  nodes: AudioNode[]
  stop?: () => void
}

const dyn = (p: Partial<DynParams>): DynParams => ({ ...DYN_DEFAULTS, ...p })

export function buildMixGraph(ctx: BaseAudioContext, voiceIn: AudioNode, backingIn: AudioNode, out: AudioNode, initial: MixSettings, bpm = 100, opts: { worklets?: boolean; stems?: number } = {}): MixGraph {
  const first = clampMix(initial)
  const worklets = opts.worklets ?? false
  const all: AudioNode[] = []
  const track = <T extends AudioNode>(n: T): T => {
    all.push(n)
    return n
  }
  const gain = (v = 1) => {
    const g = track(ctx.createGain())
    g.gain.value = v
    return g
  }
  const biquad = (type: BiquadFilterType, freq: number, q = Math.SQRT1_2) => {
    const f = track(ctx.createBiquadFilter())
    f.type = type
    f.frequency.value = freq
    f.Q.value = q
    return f
  }
  const gr: Record<string, number> = { gate: 0, dynEq: 0, deEss: 0, duck: 0 }
  const dynNode = (name: string, p: DynParams, inputs = 1): AudioWorkletNode | null => {
    if (!worklets) return null
    try {
      const n = track(makeDynNode(ctx, p, inputs))
      n.port.onmessage = (e: MessageEvent<number>) => {
        gr[name] = e.data
      }
      return n
    } catch {
      return null
    }
  }
  const setDyn = (n: AudioWorkletNode | null, p: DynParams) => n?.port.postMessage(p)
  const oscillators: OscillatorNode[] = []
  const lfo = (rate: number) => {
    const o = track(ctx.createOscillator())
    o.frequency.value = rate
    o.start()
    oscillators.push(o)
    return o
  }

  // ---- voice inserts ----------------------------------------------------------
  const v0 = first.vocal
  const passthrough = (): Insert => {
    const g = gain()
    return { input: g, output: g, update: () => undefined, nodes: [g] }
  }

  const makeGate = (): Insert => {
    const p = (m: MixSettings) => dyn({ mode: 'gate', off: !m.vocal.gate.on, thresholdDb: m.vocal.gate.thresholdDb, ratio: 4, rangeDb: m.vocal.gate.rangeDb, attackMs: 1, releaseMs: m.vocal.gate.releaseMs })
    const n = dynNode('gate', p(first))
    if (!n) return passthrough()
    return { input: n, output: n, update: (m) => setDyn(n, p(m)), nodes: [n] }
  }
  const makeLowCut = (): Insert => {
    const f = biquad('highpass', 10)
    return { input: f, output: f, update: (m) => (f.frequency.value = m.vocal.lowCut.on ? m.vocal.lowCut.freq : 10), nodes: [f] }
  }
  const makeEq = (): Insert => {
    const eq = [0, 1, 2, 3].map(() => biquad('peaking', 1000, 1))
    for (let i = 0; i < 3; i++) eq[i]!.connect(eq[i + 1]!)
    return {
      input: eq[0]!,
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
  const makeDynEq = (): Insert => {
    const p = (m: MixSettings) => {
      const d = m.vocal.dynEq
      return dyn({ mode: 'split', off: !d.on, freq: d.freq, q: d.q, thresholdDb: d.thresholdDb, ratio: d.ratio, rangeDb: d.maxCutDb, attackMs: 5, releaseMs: 80 })
    }
    const n = dynNode('dynEq', p(first))
    if (!n) return passthrough()
    return { input: n, output: n, update: (m) => setDyn(n, p(m)), nodes: [n] }
  }
  const makeComp = (which: 'comp' | 'comp2'): Insert & { comp: DynamicsCompressorNode } => {
    const comp = track(ctx.createDynamicsCompressor())
    const makeup = gain()
    comp.connect(makeup)
    return {
      comp,
      input: comp,
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
    }
  }
  const makeParallel = (): Insert => {
    const input = gain()
    const output = gain()
    const crush = track(ctx.createDynamicsCompressor())
    const wet = gain(0)
    input.connect(output)
    input.connect(crush).connect(wet).connect(output)
    return {
      input,
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
    }
  }
  const makeDeEss = (): Insert => {
    const p = (m: MixSettings) => {
      const d = m.vocal.deEss
      return dyn({ mode: 'split', off: !d.on, freq: d.freq, q: 1.4, thresholdDb: d.thresholdDb, ratio: 6, rangeDb: d.amountDb, attackMs: 1, releaseMs: 60 })
    }
    const n = dynNode('deEss', p(first))
    if (n) return { input: n, output: n, update: (m) => setDyn(n, p(m)), nodes: [n] }
    // Fallback: a static cut around the sibilance (the pre-0.21 behaviour).
    const f = biquad('peaking', 6500, 4)
    return {
      input: f,
      output: f,
      update: (m) => {
        f.frequency.value = m.vocal.deEss.freq
        f.gain.value = m.vocal.deEss.on ? -m.vocal.deEss.amountDb : 0
      },
      nodes: [f],
    }
  }
  const makeSaturation = (): Insert => {
    const input = gain()
    const output = gain()
    const dry = gain(1)
    const drive = gain(1)
    const shaper = track(ctx.createWaveShaper())
    shaper.oversample = '4x'
    const comp = gain(1)
    const wet = gain(0)
    input.connect(dry).connect(output)
    input.connect(drive).connect(shaper).connect(comp).connect(wet).connect(output)
    let key = ''
    return {
      input,
      output,
      update: (m) => {
        const s = m.vocal.saturation
        const k = `${s.type}|${s.drive.toFixed(2)}`
        if (k !== key) {
          shaper.curve = saturationCurve(s.type, s.drive) as Float32Array<ArrayBuffer>
          key = k
        }
        drive.gain.value = 1
        comp.gain.value = s.type === 'hard' ? 0.7 : 0.85
        dry.gain.value = s.on ? 1 - s.mix : 1
        wet.gain.value = s.on ? s.mix : 0
      },
      nodes: [input, output, dry, drive, shaper, comp, wet],
    }
  }
  const makeMod = (): Insert => {
    // All four kinds are built; only the chosen one is heard.
    const input = gain()
    const output = gain()
    const dry = gain(1)
    input.connect(dry).connect(output)
    const merger = track(ctx.createChannelMerger(2))
    merger.connect(output)
    const osc = lfo(v0.mod.rate)
    // chorus / doubler: two modulated delays, left and right, LFO in opposite phase
    const dl = track(ctx.createDelay(0.1))
    const dr = track(ctx.createDelay(0.1))
    const depthL = gain(0)
    const depthR = gain(0)
    osc.connect(depthL).connect(dl.delayTime)
    osc.connect(depthR).connect(dr.delayTime)
    const wetL = gain(0)
    const wetR = gain(0)
    input.connect(dl).connect(wetL).connect(merger, 0, 0)
    input.connect(dr).connect(wetR).connect(merger, 0, 1)
    // flanger: one short delay with feedback, both sides
    const fl = track(ctx.createDelay(0.05))
    const flDepth = gain(0)
    const flFb = gain(0)
    const flWet = gain(0)
    osc.connect(flDepth).connect(fl.delayTime)
    input.connect(fl)
    fl.connect(flFb).connect(fl)
    fl.connect(flWet)
    flWet.connect(merger, 0, 0)
    flWet.connect(merger, 0, 1)
    // phaser: four all-pass stages swept by the LFO
    const ap = [0, 1, 2, 3].map(() => biquad('allpass', 800, 0.7))
    const apDepth = gain(0)
    for (const f of ap) osc.connect(apDepth).connect(f.frequency)
    input.connect(ap[0]!)
    for (let i = 0; i < 3; i++) ap[i]!.connect(ap[i + 1]!)
    const apWet = gain(0)
    ap[3]!.connect(apWet)
    apWet.connect(merger, 0, 0)
    apWet.connect(merger, 0, 1)
    return {
      input,
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
      nodes: [input, output, dry, merger, dl, dr, depthL, depthR, wetL, wetR, fl, flDepth, flFb, flWet, ...ap, apDepth, apWet],
    }
  }

  const comp1 = makeComp('comp')
  const comp2 = makeComp('comp2')
  const builders: Record<InsertId, () => Insert> = {
    gate: makeGate,
    lowCut: makeLowCut,
    eq: makeEq,
    dynEq: makeDynEq,
    comp: () => comp1,
    comp2: () => comp2,
    parallel: makeParallel,
    deEss: makeDeEss,
    saturation: makeSaturation,
    mod: makeMod,
  }
  const inserts = first.vocal.order.map((id) => builders[id]())

  const voiceGain = gain()
  const pan = track(ctx.createStereoPanner())
  const voiceMeter = track(ctx.createAnalyser())
  let node: AudioNode = voiceIn
  for (const ins of inserts) {
    node.connect(ins.input)
    node = ins.output
  }
  node.connect(voiceGain).connect(pan)

  // ---- sends -------------------------------------------------------------------
  const bus = gain()
  pan.connect(voiceMeter)
  pan.connect(bus)
  const reverbSend = gain(0)
  const preDelay = track(ctx.createDelay(0.5))
  const convolver = track(ctx.createConvolver())
  const revLow = biquad('highpass', 200)
  const revHigh = biquad('lowpass', 8000)
  pan.connect(reverbSend).connect(preDelay).connect(convolver).connect(revLow).connect(revHigh).connect(bus)

  const delaySend = gain(0)
  const delayL = track(ctx.createDelay(2.5))
  const delayR = track(ctx.createDelay(2.5))
  const delayTone = biquad('lowpass', 6000)
  const feedback = gain(0)
  const cross = gain(0)
  const straight = gain(1)
  const delayMerge = track(ctx.createChannelMerger(2))
  const delayDown = gain(1)
  delayDown.channelCount = 1
  delayDown.channelCountMode = 'explicit'
  pan.connect(delaySend).connect(delayDown).connect(delayL)
  delayL.connect(delayTone)
  // straight: L feeds back into itself and plays both sides; ping-pong: L → R → L
  delayTone.connect(feedback).connect(delayL)
  delayTone.connect(straight)
  straight.connect(delayMerge, 0, 0)
  straight.connect(delayMerge, 0, 1)
  delayTone.connect(cross).connect(delayR)
  const pingL = gain(0)
  const pingR = gain(0)
  delayTone.connect(pingL).connect(delayMerge, 0, 0)
  delayR.connect(pingR).connect(delayMerge, 0, 1)
  const pingBack = gain(0)
  delayR.connect(pingBack).connect(delayL)
  delayMerge.connect(bus)

  // ---- backing -------------------------------------------------------------------
  const stemGains = Array.from({ length: Math.max(0, opts.stems ?? 0) }, () => {
    const g = gain()
    g.connect(backingIn)
    return g
  })
  const bLow = biquad('lowshelf', 120)
  const bMid = biquad('peaking', 1000, 0.8)
  const bHigh = biquad('highshelf', 8000)
  const pocket = biquad('peaking', 3000, 1)
  const backingGain = gain()
  const backingMeter = track(ctx.createAnalyser())
  backingIn.connect(bLow).connect(bMid).connect(bHigh).connect(pocket)
  const duckParams = (m: MixSettings) => dyn({ mode: 'comp', off: !m.backing.duck.on, sidechain: true, thresholdDb: -40, ratio: 20, rangeDb: m.backing.duck.amountDb, attackMs: 15, releaseMs: m.backing.duck.releaseMs })
  const duck = dynNode('duck', duckParams(first), 2)
  if (duck) {
    pocket.connect(duck, 0, 0)
    pan.connect(duck, 0, 1)
    duck.connect(backingGain)
  } else {
    pocket.connect(backingGain)
  }
  backingGain.connect(backingMeter)
  backingGain.connect(bus)

  // ---- master --------------------------------------------------------------------
  const master = gain()
  bus.connect(master)
  // multiband: Linkwitz–Riley-style splits (two 2nd-order filters per edge)
  const mbDry = gain(1)
  const mbSum = gain(1)
  master.connect(mbDry).connect(mbSum)
  const lp = (f: number) => [biquad('lowpass', f), biquad('lowpass', f)]
  const hp = (f: number) => [biquad('highpass', f), biquad('highpass', f)]
  const lowF = lp(200)
  const midH = hp(200)
  const midL = lp(3000)
  const highF = hp(3000)
  const chain = (src: AudioNode, fs: AudioNode[]) => fs.reduce<AudioNode>((a, f) => a.connect(f), src)
  const mbComps = [0, 1, 2].map(() => track(ctx.createDynamicsCompressor()))
  const mbGains = [0, 1, 2].map(() => gain(0))
  chain(master, lowF).connect(mbComps[0]!).connect(mbGains[0]!).connect(mbSum)
  chain(chain(master, midH), midL).connect(mbComps[1]!).connect(mbGains[1]!).connect(mbSum)
  chain(master, highF).connect(mbComps[2]!).connect(mbGains[2]!).connect(mbSum)
  // width: L' = L·(1+w)/2 + R·(1−w)/2, R' = R·(1+w)/2 + L·(1−w)/2
  const split = track(ctx.createChannelSplitter(2))
  const wMerge = track(ctx.createChannelMerger(2))
  const ll = gain(1)
  const rr = gain(1)
  const lr = gain(0)
  const rl = gain(0)
  mbSum.connect(split)
  split.connect(ll, 0).connect(wMerge, 0, 0)
  split.connect(rl, 1).connect(wMerge, 0, 0)
  split.connect(rr, 1).connect(wMerge, 0, 1)
  split.connect(lr, 0).connect(wMerge, 0, 1)
  const limiter = track(ctx.createDynamicsCompressor())
  const ceiling = gain(1)
  wMerge.connect(limiter).connect(ceiling)
  const masterMeter = track(ctx.createAnalyser())
  const mSplit = track(ctx.createChannelSplitter(2))
  const masterL = track(ctx.createAnalyser())
  const masterR = track(ctx.createAnalyser())
  const kShelf = biquad('highshelf', 1500)
  kShelf.gain.value = 4
  const kHp = biquad('highpass', 38, 0.5)
  const loudness = track(ctx.createAnalyser())
  ceiling.connect(masterMeter)
  ceiling.connect(mSplit)
  mSplit.connect(masterL, 0)
  mSplit.connect(masterR, 1)
  ceiling.connect(kShelf).connect(kHp).connect(loudness)
  ceiling.connect(out)
  for (const a of [voiceMeter, backingMeter, masterMeter, masterL, masterR]) a.fftSize = 2048
  loudness.fftSize = 16384

  let irKey = ''
  const update = (input: MixSettings, tempo = bpm) => {
    const m = clampMix(input)
    for (const ins of inserts) ins.update(m, tempo)
    const v = m.vocal
    voiceGain.gain.value = dbToGain(v.gainDb)
    pan.pan.value = v.pan
    // reverb
    reverbSend.gain.value = v.reverb.on ? v.reverb.mix : 0
    preDelay.delayTime.value = v.reverb.preDelayMs / 1000
    revLow.frequency.value = v.reverb.lowCut
    revHigh.frequency.value = v.reverb.highCut
    const key = `${v.reverb.type}|${v.reverb.size.toFixed(2)}|${v.reverb.decay.toFixed(2)}`
    if (key !== irKey) {
      convolver.buffer = reverbImpulse(ctx, v.reverb.size, v.reverb.decay, v.reverb.type)
      irKey = key
    }
    // delay
    const d = v.delay
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
    // backing
    const be = m.backing.eq
    bLow.gain.value = be.on ? be.lowDb : 0
    bMid.gain.value = be.on ? be.midDb : 0
    bHigh.gain.value = be.on ? be.highDb : 0
    pocket.frequency.value = m.backing.pocket.freq
    pocket.gain.value = m.backing.pocket.on ? -m.backing.pocket.amountDb : 0
    setDyn(duck, duckParams(m))
    backingGain.gain.value = dbToGain(m.backing.gainDb)
    // master
    const ms = m.master
    master.gain.value = dbToGain(ms.gainDb)
    const mb = ms.multiband
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
    const w = ms.width.on ? ms.width.amount : 1
    ll.gain.value = (1 + w) / 2
    rr.gain.value = (1 + w) / 2
    lr.gain.value = (1 - w) / 2
    rl.gain.value = (1 - w) / 2
    limiter.threshold.value = ms.limiter ? ms.ceilingDb - 0.5 : 0
    limiter.ratio.value = ms.limiter ? 20 : 1
    limiter.attack.value = 0.002
    limiter.release.value = 0.1
    limiter.knee.value = 0
    ceiling.gain.value = 1
  }
  update(first, bpm)

  return {
    update,
    meters: { voice: voiceMeter, backing: backingMeter, master: masterMeter, masterL, masterR, loudness },
    reduction: () => comp1.comp.reduction,
    dynReduction: () => ({ gate: gr.gate ?? 0, dynEq: gr.dynEq ?? 0, deEss: gr.deEss ?? 0, duck: gr.duck ?? 0, comp2: comp2.comp.reduction, limiter: limiter.reduction }),
    stemGains,
    dispose: () => {
      for (const o of oscillators) {
        try {
          o.stop()
        } catch {
          // already stopped
        }
      }
      for (const n of all) n.disconnect()
      for (const ins of inserts) for (const n of ins.nodes) n.disconnect()
    },
  }
}

/** Mono samples → AudioBuffer in a context. */
export function toBuffer(ctx: BaseAudioContext, channels: Float32Array[], sampleRate: number): AudioBuffer {
  const len = Math.max(1, ...channels.map((c) => c.length))
  const buf = ctx.createBuffer(channels.length, len, sampleRate)
  channels.forEach((c, i) => buf.copyToChannel(c as Float32Array<ArrayBuffer>, i))
  return buf
}

/** Gain of each backing stem from the mix (names as given; unnamed stems at 0 dB). */
export function stemGain(m: MixSettings, name: string | undefined): number {
  const s = name ? m.backing.stems[name] : undefined
  return s ? (s.mute ? 0 : dbToGain(s.gainDb)) : 1
}

/**
 * Render the finished mix offline: the voice (already level-ridden / tuned
 * when those are on) plus the backing stems (each with its own level),
 * through the same chain. Returns stereo channels at `sampleRate`.
 */
export async function renderMix(input: {
  voice: AudioBuffer | null
  backing: AudioBuffer[]
  /** Stem names of the backing buffers (for per-stem levels). */
  backingNames?: string[]
  mix: MixSettings
  bpm?: number
  /** Which part to render: everything, or the processed voice / the backing alone. */
  part?: 'all' | 'voice' | 'backing'
  sampleRate?: number
  /** Only this stretch, seconds (lesson demos, A/B). */
  region?: { start: number; end: number }
}): Promise<Float32Array[]> {
  const sampleRate = input.sampleRate ?? 44100
  const mix = clampMix(input.mix)
  const r = input.region
  const songLen = Math.max(input.voice?.duration ?? 0, ...input.backing.map((b) => b.duration))
  const span = r ? Math.max(0, Math.min(r.end, songLen) - r.start) : songLen
  const tail = r ? 0 : Math.min(4, mix.vocal.reverb.decay)
  const length = Math.ceil((span + tail) * sampleRate)
  const ctx = new OfflineAudioContext(2, Math.max(1, length), sampleRate)
  const worklets = await ensureMixWorklet(ctx)
  const voiceIn = ctx.createGain()
  const backingIn = ctx.createGain()
  const part = input.part ?? 'all'
  voiceIn.gain.value = part === 'backing' ? 0 : 1
  backingIn.gain.value = part === 'voice' ? 0 : 1
  const graph = buildMixGraph(ctx, voiceIn, backingIn, ctx.destination, mix, input.bpm, { worklets, stems: input.backing.length })
  const offset = r?.start ?? 0
  if (input.voice) {
    const s = ctx.createBufferSource()
    s.buffer = input.voice
    s.connect(voiceIn)
    s.start(0, offset)
  }
  input.backing.forEach((b, i) => {
    const s = ctx.createBufferSource()
    s.buffer = b
    graph.stemGains[i]!.gain.value = stemGain(mix, input.backingNames?.[i])
    s.connect(graph.stemGains[i]!)
    s.start(0, offset)
  })
  const out = await ctx.startRendering()
  let channels: Float32Array[] = [out.getChannelData(0), out.getChannelData(1)]
  // The live limiter lets brief peaks through; the rendered file is made safe here.
  if (part === 'all' && mix.master.targetLufs !== null) channels = normalizeLoudness(channels, sampleRate, mix.master.targetLufs, mix.master.ceilingDb, mix.master.limiter)
  else if (mix.master.limiter) channels = limitPeaks(channels, sampleRate, mix.master.ceilingDb)
  return channels
}
