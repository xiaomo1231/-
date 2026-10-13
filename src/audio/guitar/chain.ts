import type { RigSettings } from './rigSettings'
import { createWorkletNode } from './worklets'
import { syncedDelayTime } from './rigSettings'
import {
  AMP_VOICING,
  CAB_FILTERS,
  ampPreGain,
  chorusParams,
  compressorParams,
  eqDb,
  levelGain,
  masterGain,
  pedalDrive,
  reverbImpulse,
  shaperCurve,
  toneCutoff,
} from './dsp'

/**
 * The monitor chain, built from native Web Audio nodes (they add no extra
 * buffering, so effects do not increase latency). Ten stages in a fixed
 * order; each stage is always connected and switched with short gain ramps,
 * so toggling an effect never clicks.
 *
 *   in → gate → comp → overdrive → distortion → amp → cab
 *      → chorus → delay → reverb → master → limiter → out
 */

const RAMP = 0.015

function ramp(param: AudioParam, value: number, ctx: BaseAudioContext) {
  param.cancelScheduledValues(ctx.currentTime)
  param.setTargetAtTime(value, ctx.currentTime, RAMP)
}

/** An inline stage: on = processed, off = bypassed (crossfaded). */
class InlineStage {
  readonly input: GainNode
  readonly output: GainNode
  private wet: GainNode
  private dry: GainNode
  constructor(
    private ctx: BaseAudioContext,
    first: AudioNode,
    last: AudioNode,
  ) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.wet = ctx.createGain()
    this.dry = ctx.createGain()
    this.input.connect(first)
    last.connect(this.wet).connect(this.output)
    this.input.connect(this.dry).connect(this.output)
    this.wet.gain.value = 0
    this.dry.gain.value = 1
  }
  setOn(on: boolean) {
    ramp(this.wet.gain, on ? 1 : 0, this.ctx)
    ramp(this.dry.gain, on ? 0 : 1, this.ctx)
  }
}

/** A send stage: the dry signal always passes; the effect is mixed on top. */
class SendStage {
  readonly input: GainNode
  readonly output: GainNode
  readonly send: GainNode
  constructor(
    private ctx: BaseAudioContext,
    first: AudioNode,
    last: AudioNode,
  ) {
    this.input = ctx.createGain()
    this.output = ctx.createGain()
    this.send = ctx.createGain()
    this.send.gain.value = 0
    this.input.connect(this.output)
    this.input.connect(first)
    last.connect(this.send).connect(this.output)
  }
  setMix(on: boolean, mix: number) {
    ramp(this.send.gain, on ? mix : 0, this.ctx)
  }
}

function filter(ctx: BaseAudioContext, type: BiquadFilterType, frequency: number, Q = 0.7, gain = 0): BiquadFilterNode {
  const f = ctx.createBiquadFilter()
  f.type = type
  f.frequency.value = frequency
  f.Q.value = Q
  f.gain.value = gain
  return f
}

function shaper(ctx: BaseAudioContext, kind: Parameters<typeof shaperCurve>[0]): WaveShaperNode {
  const s = ctx.createWaveShaper()
  s.curve = shaperCurve(kind)
  s.oversample = '4x'
  return s
}

export class GuitarRigChain {
  readonly input: GainNode
  readonly output: GainNode
  private nodes: AudioNode[] = []
  private gate: InlineStage
  private gateNode: AudioWorkletNode | null
  private comp: InlineStage
  private compNode: DynamicsCompressorNode
  private compMakeup: GainNode
  private od: InlineStage
  private odPre: GainNode
  private odTone: BiquadFilterNode
  private odLevel: GainNode
  private dist: InlineStage
  private distPre: GainNode
  private distTone: BiquadFilterNode
  private distLevel: GainNode
  private ampIn: GainNode
  private ampMid: BiquadFilterNode
  private ampPre: GainNode
  private ampShapers: Record<'clean' | 'crunch' | 'high', { node: WaveShaperNode; gain: GainNode }>
  private ampBass: BiquadFilterNode
  private ampMidEq: BiquadFilterNode
  private ampTreble: BiquadFilterNode
  private ampMaster: GainNode
  private cab: InlineStage
  private chorus: SendStage
  private chorusLfo: OscillatorNode
  private chorusDepth: GainNode
  private delay: SendStage
  private delayNode: DelayNode
  private delayFeedback: GainNode
  private reverb: SendStage
  private convolver: ConvolverNode
  private reverbSize = -1
  private master: GainNode
  private limiter: DynamicsCompressorNode

  /** `gateAvailable` false when the worklet could not be loaded: the gate is then a pass-through. */
  constructor(
    private ctx: BaseAudioContext,
    gateAvailable: boolean,
  ) {
    const track = <T extends AudioNode>(n: T): T => {
      this.nodes.push(n)
      return n
    }
    this.input = track(ctx.createGain())
    this.output = track(ctx.createGain())

    // 1 gate
    this.gateNode = gateAvailable ? track(createWorkletNode('groove-gate', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] })) : null
    const gatePass = track(ctx.createGain())
    this.gate = this.gateNode ? new InlineStage(ctx, this.gateNode, this.gateNode) : new InlineStage(ctx, gatePass, gatePass)

    // 2 compressor
    this.compNode = track(ctx.createDynamicsCompressor())
    this.compNode.attack.value = 0.004
    this.compNode.release.value = 0.18
    this.compNode.knee.value = 8
    this.compMakeup = track(ctx.createGain())
    this.compNode.connect(this.compMakeup)
    this.comp = new InlineStage(ctx, this.compNode, this.compMakeup)

    // 3 overdrive: mid-hump into a soft clipper
    const odHp = track(filter(ctx, 'highpass', 160))
    const odHump = track(filter(ctx, 'peaking', 720, 0.9, 6))
    this.odPre = track(ctx.createGain())
    const odShaper = track(shaper(ctx, 'soft'))
    this.odTone = track(filter(ctx, 'lowpass', 4000))
    this.odLevel = track(ctx.createGain())
    odHp.connect(odHump).connect(this.odPre).connect(odShaper).connect(this.odTone).connect(this.odLevel)
    this.od = new InlineStage(ctx, odHp, this.odLevel)

    // 4 distortion: hard asymmetric clipper
    const distHp = track(filter(ctx, 'highpass', 90))
    this.distPre = track(ctx.createGain())
    const distShaper = track(shaper(ctx, 'hard'))
    this.distTone = track(filter(ctx, 'lowpass', 4000))
    const distScoop = track(filter(ctx, 'peaking', 800, 0.8, -3))
    this.distLevel = track(ctx.createGain())
    distHp.connect(this.distPre).connect(distShaper).connect(distScoop).connect(this.distTone).connect(this.distLevel)
    this.dist = new InlineStage(ctx, distHp, this.distLevel)

    // 5 amp (always on): voicing → pre-gain → one of three clippers → tone stack → master
    this.ampIn = track(ctx.createGain())
    const ampHp = track(filter(ctx, 'highpass', 70))
    this.ampMid = track(filter(ctx, 'peaking', 900, 0.8, 0))
    this.ampPre = track(ctx.createGain())
    this.ampIn.connect(ampHp).connect(this.ampMid).connect(this.ampPre)
    const ampSum = track(ctx.createGain())
    const mk = (kind: 'amp-clean' | 'amp-crunch' | 'amp-high') => {
      const node = track(shaper(ctx, kind))
      const gain = track(ctx.createGain())
      gain.gain.value = 0
      this.ampPre.connect(node).connect(gain).connect(ampSum)
      return { node, gain }
    }
    this.ampShapers = { clean: mk('amp-clean'), crunch: mk('amp-crunch'), high: mk('amp-high') }
    this.ampBass = track(filter(ctx, 'lowshelf', 120))
    this.ampMidEq = track(filter(ctx, 'peaking', 700, 0.9))
    this.ampTreble = track(filter(ctx, 'highshelf', 3200))
    this.ampMaster = track(ctx.createGain())
    ampSum.connect(this.ampBass).connect(this.ampMidEq).connect(this.ampTreble).connect(this.ampMaster)

    // 6 cabinet
    const cabNodes = CAB_FILTERS.map((f) => track(filter(ctx, f.type, f.frequency, f.Q, f.gain)))
    cabNodes.reduce<AudioNode>((a, b) => a.connect(b), cabNodes[0]!)
    this.cab = new InlineStage(ctx, cabNodes[0]!, cabNodes[cabNodes.length - 1]!)

    // 7 chorus: modulated short delay
    const chDelay = track(ctx.createDelay(0.05))
    chDelay.delayTime.value = 0.014
    this.chorusLfo = track(ctx.createOscillator())
    this.chorusDepth = track(ctx.createGain())
    this.chorusLfo.connect(this.chorusDepth).connect(chDelay.delayTime)
    this.chorusLfo.start()
    this.chorus = new SendStage(ctx, chDelay, chDelay)

    // 8 delay with a darkening feedback loop
    this.delayNode = track(ctx.createDelay(1.5))
    this.delayFeedback = track(ctx.createGain())
    const damp = track(filter(ctx, 'lowpass', 3200))
    this.delayNode.connect(damp).connect(this.delayFeedback).connect(this.delayNode)
    this.delay = new SendStage(ctx, this.delayNode, damp)

    // 9 reverb
    this.convolver = track(ctx.createConvolver())
    this.reverb = new SendStage(ctx, this.convolver, this.convolver)

    // 10 master + limiter (protects ears)
    this.master = track(ctx.createGain())
    this.limiter = track(ctx.createDynamicsCompressor())
    this.limiter.threshold.value = -3
    this.limiter.knee.value = 0
    this.limiter.ratio.value = 20
    this.limiter.attack.value = 0.001
    this.limiter.release.value = 0.1

    this.input
      .connect(this.gate.input)
    this.gate.output.connect(this.comp.input)
    this.comp.output.connect(this.od.input)
    this.od.output.connect(this.dist.input)
    this.dist.output.connect(this.ampIn)
    this.ampMaster.connect(this.cab.input)
    this.cab.output.connect(this.chorus.input)
    this.chorus.output.connect(this.delay.input)
    this.delay.output.connect(this.reverb.input)
    this.reverb.output.connect(this.master).connect(this.limiter).connect(this.output)
  }

  /** Apply settings with short ramps. `bpm` is used when the delay is tempo-synced. */
  apply(s: RigSettings, bpm = 100) {
    const c = this.ctx
    // gate
    if (this.gateNode) {
      ramp(this.gateNode.parameters.get('threshold')!, s.gate.threshold, c)
      ramp(this.gateNode.parameters.get('release')!, s.gate.release, c)
    }
    this.gate.setOn(s.gate.on && this.gateNode !== null)
    // compressor
    const cp = compressorParams(s.comp.amount)
    ramp(this.compNode.threshold, cp.threshold, c)
    ramp(this.compNode.ratio, cp.ratio, c)
    ramp(this.compMakeup.gain, levelGain(s.comp.level) * (1 + s.comp.amount), c)
    this.comp.setOn(s.comp.on)
    // overdrive
    ramp(this.odPre.gain, pedalDrive('soft', s.overdrive.gain), c)
    ramp(this.odTone.frequency, toneCutoff(s.overdrive.tone), c)
    ramp(this.odLevel.gain, levelGain(s.overdrive.level) * 0.7, c)
    this.od.setOn(s.overdrive.on)
    // distortion
    ramp(this.distPre.gain, pedalDrive('hard', s.distortion.gain), c)
    ramp(this.distTone.frequency, toneCutoff(s.distortion.tone), c)
    ramp(this.distLevel.gain, levelGain(s.distortion.level) * 0.5, c)
    this.dist.setOn(s.distortion.on)
    // amp
    const v = AMP_VOICING[s.amp.type]
    ramp(this.ampMid.gain, v.midPush, c)
    ramp(this.ampPre.gain, ampPreGain(s.amp.type, s.amp.gain), c)
    for (const [type, sh] of Object.entries(this.ampShapers) as Array<[keyof typeof this.ampShapers, { gain: GainNode }]>) {
      ramp(sh.gain.gain, type === s.amp.type ? AMP_VOICING[type].trim : 0, c)
    }
    ramp(this.ampBass.gain, eqDb(s.amp.bass), c)
    ramp(this.ampMidEq.gain, eqDb(s.amp.mid, 10), c)
    ramp(this.ampTreble.gain, eqDb(s.amp.treble), c)
    ramp(this.ampMaster.gain, levelGain(s.amp.master), c)
    // cabinet
    this.cab.setOn(s.cab.on)
    // chorus
    const ch = chorusParams(s.chorus.rate, s.chorus.depth)
    ramp(this.chorusLfo.frequency, ch.hz, c)
    ramp(this.chorusDepth.gain, ch.swing, c)
    this.chorus.setMix(s.chorus.on, s.chorus.mix)
    // delay
    ramp(this.delayNode.delayTime, s.delay.sync ? syncedDelayTime(bpm) : s.delay.time, c)
    ramp(this.delayFeedback.gain, s.delay.feedback, c)
    this.delay.setMix(s.delay.on, s.delay.mix)
    // reverb (the impulse is rebuilt only when the size changes noticeably)
    if (Math.abs(s.reverb.size - this.reverbSize) > 0.02) {
      const [l, r] = reverbImpulse(c.sampleRate, s.reverb.size)
      const buf = c.createBuffer(2, l.length, c.sampleRate)
      buf.copyToChannel(l, 0)
      buf.copyToChannel(r, 1)
      this.convolver.buffer = buf
      this.reverbSize = s.reverb.size
    }
    this.reverb.setMix(s.reverb.on, s.reverb.mix)
    // master
    ramp(this.master.gain, masterGain(s.volume), c)
  }

  dispose() {
    try {
      this.chorusLfo.stop()
    } catch {
      // already stopped
    }
    for (const n of this.nodes) n.disconnect()
  }
}
