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
 * others pass the signal through. A change of insert order or of engine
 * (Airwindows / classic) needs a new graph (`structureKey`).
 */
import type { InsertId, MixSettings } from '@/songs/singTypes'
import { clampMix, dbToGain } from '@/songs/mixPresets'
import { ensureMixWorklet } from '@/audio/fx/mixWorklet'
import { ensureAirwindows } from '@/audio/fx/airwindows/awNode'
import { buildModularGraph } from '@/audio/mix/modularGraph'
import { exportSettings, mixFor, type ModGraph } from '@/songs/mixGraph'
import {
  backingEqModule,
  compModule,
  delayModule,
  deEssModule,
  disposeKit,
  duckModule,
  dynEqModule,
  eqModule,
  gainModule,
  gateModule,
  limiterModule,
  lowCutModule,
  makeKit,
  modModule,
  multibandModule,
  panModule,
  parallelModule,
  pocketModule,
  reverbModule,
  saturationModule,
  widthModule,
  type Kit,
  type Module,
} from '@/audio/mix/modules'
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
  dynReduction(): {
    gate: number
    dynEq: number
    deEss: number
    duck: number
    comp2: number
    limiter: number
  }
  /** Per-stem input gains (one per backing buffer, in order). */
  stemGains: GainNode[]
  dispose(): void
}

/**
 * What makes a graph need rebuilding (rather than a parameter update): the
 * engine choice (Airwindows / classic modules) and the insert order.
 */
export function structureKey(m: MixSettings): string {
  return `${m.engine}|${m.vocal.order.join(',')}`
}

export { reverbImpulse, saturationCurve } from '@/audio/mix/modules'

/**
 * The quick desk's fixed chain, built from the shared modules (audio/mix/modules).
 */
export function buildMixGraph(
  ctx: BaseAudioContext,
  voiceIn: AudioNode,
  backingIn: AudioNode,
  out: AudioNode,
  initial: MixSettings,
  bpm = 100,
  opts: { worklets?: boolean; airwindows?: boolean; stems?: number } = {},
): MixGraph {
  const first = clampMix(initial)
  const k = makeKit(ctx, opts.worklets ?? false, opts.airwindows ?? false)

  // ---- voice inserts ----------------------------------------------------------
  const comp1 = compModule(k, 'comp', first)
  const comp2 = compModule(k, 'comp2', first)
  const gate = gateModule(k, first)
  const dynEq = dynEqModule(k, first)
  const deEss = deEssModule(k, first)
  const builders: Record<InsertId, () => Module> = {
    gate: () => gate,
    lowCut: () => lowCutModule(k),
    eq: () => eqModule(k),
    dynEq: () => dynEq,
    comp: () => comp1,
    comp2: () => comp2,
    parallel: () => parallelModule(k, first),
    deEss: () => deEss,
    saturation: () => saturationModule(k, first),
    mod: () => modModule(k, first),
  }
  const inserts = first.vocal.order.map((id) => builders[id]())
  const used = new Set(first.vocal.order)
  const voiceGain = gainModule(k, (m) => m.vocal.gainDb)
  const pan = panModule(k, (m) => m.vocal.pan)
  const voiceMeter = k.track(ctx.createAnalyser())
  let node: AudioNode = voiceIn
  for (const ins of inserts) {
    node.connect(ins.inputs[0]!)
    node = ins.output
  }
  node.connect(voiceGain.inputs[0]!)
  voiceGain.output.connect(pan.inputs[0]!)

  // ---- sends -------------------------------------------------------------------
  const bus = k.gain()
  pan.output.connect(voiceMeter)
  pan.output.connect(bus)
  const reverb = reverbModule(k, () => true, first)
  const delay = delayModule(k, () => true)
  pan.output.connect(reverb.inputs[0]!)
  reverb.output.connect(bus)
  pan.output.connect(delay.inputs[0]!)
  delay.output.connect(bus)

  // ---- backing -------------------------------------------------------------------
  const stemGains = Array.from({ length: Math.max(0, opts.stems ?? 0) }, () => {
    const g = k.gain()
    g.connect(backingIn)
    return g
  })
  const backEq = backingEqModule(k)
  const pocket = pocketModule(k)
  const duck = duckModule(k, first)
  const backingGain = gainModule(k, (m) => m.backing.gainDb)
  const backingMeter = k.track(ctx.createAnalyser())
  backingIn.connect(backEq.inputs[0]!)
  backEq.output.connect(pocket.inputs[0]!)
  pocket.output.connect(duck.inputs[0]!)
  pan.output.connect(duck.inputs[1]!)
  duck.output.connect(backingGain.inputs[0]!)
  backingGain.output.connect(backingMeter)
  backingGain.output.connect(bus)

  // ---- master --------------------------------------------------------------------
  const master = gainModule(k, (m) => m.master.gainDb)
  const multiband = multibandModule(k)
  const width = widthModule(k)
  const limiter = limiterModule(k)
  bus.connect(master.inputs[0]!)
  master.output.connect(multiband.inputs[0]!)
  multiband.output.connect(width.inputs[0]!)
  width.output.connect(limiter.inputs[0]!)
  const meters = masterMeters(k, limiter.output)
  limiter.output.connect(out)

  const modules = [
    ...inserts,
    voiceGain,
    pan,
    reverb,
    delay,
    backEq,
    pocket,
    duck,
    backingGain,
    master,
    multiband,
    width,
    limiter,
  ]
  for (const a of [voiceMeter, backingMeter]) a.fftSize = 2048
  const update = (input: MixSettings, tempo = bpm) => {
    const m = clampMix(input)
    for (const mod of modules) mod.update(m, tempo)
  }
  update(first, bpm)

  return {
    update,
    meters: { voice: voiceMeter, backing: backingMeter, ...meters },
    reduction: () => comp1.reduction?.() ?? 0,
    dynReduction: () => ({
      gate: used.has('gate') ? (gate.reduction?.() ?? 0) : 0,
      dynEq: used.has('dynEq') ? (dynEq.reduction?.() ?? 0) : 0,
      deEss: used.has('deEss') ? (deEss.reduction?.() ?? 0) : 0,
      duck: duck.reduction?.() ?? 0,
      comp2: comp2.reduction?.() ?? 0,
      limiter: limiter.reduction?.() ?? 0,
    }),
    stemGains,
    dispose: () => disposeKit(k),
  }
}

/** Master meters (peak, L / R, a K-weighting approximation for loudness) on `from`. */
export function masterMeters(k: Kit, from: AudioNode): Omit<MixMeters, 'voice' | 'backing'> {
  const masterMeter = k.track(k.ctx.createAnalyser())
  const mSplit = k.track(k.ctx.createChannelSplitter(2))
  const masterL = k.track(k.ctx.createAnalyser())
  const masterR = k.track(k.ctx.createAnalyser())
  const kShelf = k.biquad('highshelf', 1500)
  kShelf.gain.value = 4
  const kHp = k.biquad('highpass', 38, 0.5)
  const loudness = k.track(k.ctx.createAnalyser())
  from.connect(masterMeter)
  from.connect(mSplit)
  mSplit.connect(masterL, 0)
  mSplit.connect(masterR, 1)
  from.connect(kShelf).connect(kHp).connect(loudness)
  for (const a of [masterMeter, masterL, masterR]) a.fftSize = 2048
  loudness.fftSize = 16384
  return { master: masterMeter, masterL, masterR, loudness }
}

/** Mono samples → AudioBuffer in a context. */
export function toBuffer(
  ctx: BaseAudioContext,
  channels: Float32Array[],
  sampleRate: number,
): AudioBuffer {
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
  /** The modular workspace's wiring (0.25.0) instead of the quick desk's chain. */
  graph?: ModGraph | null
}): Promise<Float32Array[]> {
  const sampleRate = input.sampleRate ?? 44100
  const mix = clampMix(input.mix)
  const r = input.region
  const songLen = Math.max(input.voice?.duration ?? 0, ...input.backing.map((b) => b.duration))
  const span = r ? Math.max(0, Math.min(r.end, songLen) - r.start) : songLen
  const g = input.graph ?? null
  const decay = g
    ? Math.max(
        0,
        ...g.nodes
          .filter((n) => n.type === 'reverb' && !n.bypass)
          .map((n) => mixFor(mix, n).vocal.reverb.decay),
      )
    : mix.vocal.reverb.decay
  const tail = r ? 0 : Math.min(4, decay)
  const length = Math.ceil((span + tail) * sampleRate)
  const ctx = new OfflineAudioContext(2, Math.max(1, length), sampleRate)
  const worklets = await ensureMixWorklet(ctx)
  const airwindows = await ensureAirwindows(ctx)
  const voiceIn = ctx.createGain()
  const backingIn = ctx.createGain()
  const part = input.part ?? 'all'
  voiceIn.gain.value = part === 'backing' ? 0 : 1
  backingIn.gain.value = part === 'voice' ? 0 : 1
  const graph = g
    ? buildModularGraph(ctx, voiceIn, backingIn, ctx.destination, g, mix, input.bpm, {
        worklets,
        airwindows,
        stems: input.backing.length,
      })
    : buildMixGraph(ctx, voiceIn, backingIn, ctx.destination, mix, input.bpm, {
        worklets,
        airwindows,
        stems: input.backing.length,
      })
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
  const fin = g ? exportSettings(g, mix) : mix.master
  if (part === 'all' && fin.targetLufs !== null)
    channels = normalizeLoudness(channels, sampleRate, fin.targetLufs, fin.ceilingDb, fin.limiter)
  else if (fin.limiter) channels = limitPeaks(channels, sampleRate, fin.ceilingDb)
  return channels
}
