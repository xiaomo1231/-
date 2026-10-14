import { describe, expect, it } from 'vitest'
import { DEFAULT_MIX, cloneMix } from '@/songs/mixPresets'
import {
  MODULES,
  TEMPLATES,
  checkGraph,
  exportSettings,
  graphFromMix,
  makeNode,
  mixFor,
  paramsFrom,
  sanitizeGraph,
  setControl,
  topologyKey,
  wouldCycle,
} from '@/songs/mixGraph'

describe('modular mix graph', () => {
  it('lays the quick chain out with everything reaching the output', () => {
    const g = graphFromMix(DEFAULT_MIX)
    const c = checkGraph(g)
    expect(c.ok).toBe(true)
    expect(c.idle).toEqual([])
    expect(g.nodes.filter((n) => n.type === 'comp')).toHaveLength(2)
    // the ducking is keyed by the voice (sidechain port)
    const duck = g.nodes.find((n) => n.type === 'duck')!
    expect(g.edges.some((e) => e.to === duck.id && e.port === 1)).toBe(true)
  })

  it('module params round-trip through a MixSettings view', () => {
    const m = cloneMix(DEFAULT_MIX)
    m.vocal.comp.thresholdDb = -27
    const n = makeNode('comp', 0, 0, m)
    expect(mixFor(DEFAULT_MIX, n).vocal.comp.thresholdDb).toBe(-27)
    const p = setControl(n, DEFAULT_MIX, 'vocal.comp.ratio', 7)
    expect((p.comp as { ratio: number }).ratio).toBe(7)
    expect(paramsFrom('gain', { ...m, vocal: { ...m.vocal, gainDb: -3 } })).toEqual({ gainDb: -3 })
    // a fresh effect is switched on
    expect((makeNode('saturation', 0, 0).params.saturation as { on: boolean }).on).toBe(true)
  })

  it('refuses loops and reports what does not reach the output', () => {
    const g = graphFromMix(DEFAULT_MIX)
    const voice = g.nodes.find((n) => n.type === 'voice')!
    const out = g.nodes.find((n) => n.type === 'output')!
    const firstInsert = g.edges.find((e) => e.from === voice.id)!.to
    expect(wouldCycle(g, firstInsert, voice.id)).toBe(true)
    expect(wouldCycle(g, voice.id, out.id)).toBe(false)
    const cut = { ...g, edges: g.edges.filter((e) => e.from !== voice.id) }
    const c = checkGraph(cut)
    expect(c.ok).toBe(false)
    expect(c.errors.join()).toContain('人声没有接到')
    expect(
      checkGraph({ ...g, nodes: g.nodes.filter((n) => n.type !== 'output') }).errors.join(),
    ).toContain('还没有「输出」')
  })

  it('topology changes only with wiring, not parameters', () => {
    const g = graphFromMix(DEFAULT_MIX)
    const moved = {
      ...g,
      nodes: g.nodes.map((n) => ({ ...n, x: n.x + 10, params: { ...n.params } })),
    }
    expect(topologyKey(moved)).toBe(topologyKey(g))
    expect(topologyKey({ ...g, edges: g.edges.slice(1) })).not.toBe(topologyKey(g))
  })

  it('export settings come from the output and limiter modules', () => {
    const m = cloneMix(DEFAULT_MIX)
    m.master.targetLufs = -14
    m.master.ceilingDb = -1.5
    const e = exportSettings(graphFromMix(m), DEFAULT_MIX)
    expect(e).toEqual({ targetLufs: -14, ceilingDb: -1.5, limiter: m.master.limiter })
  })

  it('templates are complete; stored graphs are checked on load', () => {
    for (const t of TEMPLATES) expect(checkGraph(t.make(DEFAULT_MIX)).ok).toBe(true)
    expect(sanitizeGraph({ version: 2 })).toBeNull()
    const g = graphFromMix(DEFAULT_MIX)
    const bad = {
      ...g,
      nodes: [...g.nodes, { id: 'x', type: 'nope', x: 0, y: 0, params: {} }],
      edges: [...g.edges, { id: 'y', from: 'x', to: g.nodes[0]!.id, port: 0 }],
    }
    const s = sanitizeGraph(bad)!
    expect(s.nodes).toHaveLength(g.nodes.length)
    expect(s.edges).toHaveLength(g.edges.length)
    expect(Object.keys(MODULES)).toContain('duck')
  })
})
