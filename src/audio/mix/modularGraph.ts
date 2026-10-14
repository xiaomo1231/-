/**
 * 模块化后期的音频 (0.25.0): builds the student's wired graph (songs/mixGraph)
 * from the shared modules, in any BaseAudioContext (live preview and export
 * sound the same). Offers the same interface as the quick desk's chain, plus
 * a level per module (shown on the workspace) and listening at any module.
 */
import type { MixSettings } from '@/songs/singTypes'
import { MODULES, mixFor, wouldCycle, type ModGraph, type ModNode } from '@/songs/mixGraph'
import { masterMeters, type MixGraph } from '@/audio/sing/mixChain'
import {
  backingEqModule,
  compModule,
  deEssModule,
  delayModule,
  disposeKit,
  duckModule,
  dynEqModule,
  eqModule,
  gainModule,
  gateModule,
  limiterModule,
  lowCutModule,
  makeKit,
  mixerModule,
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
} from './modules'

export interface ModularGraph extends MixGraph {
  /** New parameters for the same wiring. */
  updateGraph(g: ModGraph, bpm?: number): void
  /** Peak level (0–1+) at each module's output now. */
  levels(): Record<string, number>
  /** Hear the signal at this module's output instead of the output (null = normal). */
  solo(id: string | null): void
}

function build(k: Kit, node: ModNode, base: MixSettings): Module {
  const first = mixFor(base, node)
  const send = () => !!node.send
  switch (node.type) {
    case 'gate':
      return gateModule(k, first)
    case 'lowCut':
      return lowCutModule(k)
    case 'eq':
      return eqModule(k)
    case 'dynEq':
      return dynEqModule(k, first)
    case 'comp':
      return compModule(k, 'comp')
    case 'parallel':
      return parallelModule(k)
    case 'deEss':
      return deEssModule(k, first)
    case 'saturation':
      return saturationModule(k)
    case 'mod':
      return modModule(k, first)
    case 'reverb':
      return reverbModule(k, send)
    case 'delay':
      return delayModule(k, send)
    case 'backEq':
      return backingEqModule(k)
    case 'pocket':
      return pocketModule(k)
    case 'duck':
      return duckModule(k, first)
    case 'gain':
      return gainModule(k, (m) => m.vocal.gainDb)
    case 'pan':
      return panModule(k, (m) => m.vocal.pan)
    case 'multiband':
      return multibandModule(k)
    case 'width':
      return widthModule(k)
    case 'limiter':
      return limiterModule(k)
    default:
      return mixerModule(k)
  }
}

/**
 * `voiceIn` / `backingIn` feed the voice and backing modules; `out` gets the
 * output module. Cables that would close a loop are left out.
 */
export function buildModularGraph(
  ctx: BaseAudioContext,
  voiceIn: AudioNode,
  backingIn: AudioNode,
  out: AudioNode,
  graph: ModGraph,
  base: MixSettings,
  bpm = 100,
  opts: { worklets?: boolean; stems?: number } = {},
): ModularGraph {
  const k = makeKit(ctx, opts.worklets ?? false)
  const mods = new Map<string, Module>()
  const meters = new Map<string, AnalyserNode>()
  let current = graph
  const outNode = k.gain()
  const listen = k.gain()

  for (const node of graph.nodes) {
    let mod: Module
    if (node.type === 'voice') {
      const g = k.gain()
      voiceIn.connect(g)
      mod = { inputs: [], output: g, update: () => undefined, nodes: [g] }
    } else if (node.type === 'backing') {
      const g = k.gain()
      backingIn.connect(g)
      mod = { inputs: [], output: g, update: () => undefined, nodes: [g] }
    } else if (node.type === 'output') {
      mod = { inputs: [outNode], output: outNode, update: () => undefined, nodes: [outNode] }
    } else if (node.bypass) {
      // Bypassed: the signal passes; a sidechain input goes nowhere.
      const g = k.gain()
      mod = {
        inputs: MODULES[node.type].inputs > 1 ? [g, k.gain(0)] : [g],
        output: g,
        update: () => undefined,
        nodes: [g],
      }
    } else mod = build(k, node, base)
    mods.set(node.id, mod)
    const a = k.track(ctx.createAnalyser())
    a.fftSize = 256
    mod.output.connect(a)
    meters.set(node.id, a)
  }
  const kept: ModGraph = { ...graph, edges: [] }
  for (const e of graph.edges) {
    if (wouldCycle(kept, e.from, e.to)) continue
    const a = mods.get(e.from)
    const b = mods.get(e.to)
    const input = b?.inputs[e.port]
    if (!a || !input) continue
    a.output.connect(input)
    kept.edges.push(e)
  }
  outNode.connect(listen)
  const master = masterMeters(k, listen)
  listen.connect(out)

  // Voice and backing meters: their source modules.
  const pick = (type: ModNode['type']) => {
    const n = graph.nodes.find((x) => x.type === type)
    return (n && meters.get(n.id)) ?? k.track(ctx.createAnalyser())
  }
  const voiceMeter = pick('voice')
  const backingMeter = pick('backing')
  voiceMeter.fftSize = 2048
  backingMeter.fftSize = 2048

  const stemGains = Array.from({ length: Math.max(0, opts.stems ?? 0) }, () => {
    const g = k.gain()
    g.connect(backingIn)
    return g
  })

  const updateGraph = (g: ModGraph, tempo = bpm) => {
    current = g
    for (const node of g.nodes) mods.get(node.id)?.update(mixFor(base, node), tempo)
  }
  updateGraph(graph, bpm)

  const levelBuf = new Float32Array(256)
  const firstOf = (type: ModNode['type']) => {
    const n = current.nodes.find((x) => x.type === type && !x.bypass)
    return (n && mods.get(n.id)?.reduction?.()) ?? 0
  }
  let soloed: AudioNode | null = null

  return {
    update: (m: MixSettings, tempo?: number) => {
      // The workspace keeps its own parameters; a new base (e.g. tempo) re-applies them.
      base = m
      updateGraph(current, tempo ?? bpm)
    },
    updateGraph,
    meters: { voice: voiceMeter, backing: backingMeter, ...master },
    reduction: () => firstOf('comp'),
    dynReduction: () => ({
      gate: firstOf('gate'),
      dynEq: firstOf('dynEq'),
      deEss: firstOf('deEss'),
      duck: firstOf('duck'),
      comp2: 0,
      limiter: firstOf('limiter'),
    }),
    stemGains,
    levels: () => {
      const out: Record<string, number> = {}
      for (const [id, a] of meters) {
        a.getFloatTimeDomainData(levelBuf)
        let p = 0
        for (const v of levelBuf) p = Math.max(p, Math.abs(v))
        out[id] = p
      }
      return out
    },
    solo: (id) => {
      if (soloed) {
        try {
          soloed.disconnect(listen)
        } catch {
          // already disconnected
        }
        soloed = null
      }
      const mod = id ? mods.get(id) : undefined
      if (mod && mod.output !== outNode) {
        outNode.disconnect(listen)
        mod.output.connect(listen)
        soloed = mod.output
      } else {
        try {
          outNode.disconnect(listen)
        } catch {
          // not connected
        }
        outNode.connect(listen)
      }
    },
    dispose: () => disposeKit(k),
  }
}
