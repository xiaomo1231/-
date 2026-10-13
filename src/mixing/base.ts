/**
 * 后期课堂: the neutral mix every lesson starts from (all processing off,
 * levels at 0 dB, no limiter), and merging a lesson's patch onto it.
 */
import { cloneMix, DEFAULT_MIX, clampMix } from '@/songs/mixPresets'
import type { MixSettings } from '@/songs/singTypes'
import type { MixPatch } from './types'

const FLAT_BANDS: MixSettings['vocal']['eq']['bands'] = [
  { type: 'lowshelf', freq: 120, gainDb: 0, q: 0.7 },
  { type: 'peaking', freq: 300, gainDb: 0, q: 1 },
  { type: 'peaking', freq: 3000, gainDb: 0, q: 1 },
  { type: 'highshelf', freq: 10000, gainDb: 0, q: 0.7 },
]

/** Everything off, levels at 0 dB, limiter off. */
export function neutralMix(): MixSettings {
  const m = cloneMix(DEFAULT_MIX)
  const v = m.vocal
  v.gainDb = 0
  v.pan = 0
  v.lowCut.on = false
  v.eq = { on: false, bands: FLAT_BANDS.map((b) => ({ ...b })) }
  for (const k of ['comp', 'comp2', 'deEss', 'gate', 'dynEq', 'parallel', 'saturation', 'mod', 'reverb', 'delay', 'autoLevel', 'tune'] as const) v[k].on = false
  m.backing.gainDb = 0
  m.backing.eq.on = false
  m.backing.duck.on = false
  m.backing.pocket.on = false
  m.master.limiter = false
  m.master.gainDb = 0
  m.master.multiband.on = false
  m.master.width = { on: false, amount: 1 }
  m.master.targetLufs = null
  return m
}

function merge(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, val] of Object.entries(patch)) {
    if (val === undefined) continue
    const cur = target[k]
    if (val && typeof val === 'object' && !Array.isArray(val) && cur && typeof cur === 'object' && !Array.isArray(cur)) merge(cur as Record<string, unknown>, val as Record<string, unknown>)
    else target[k] = Array.isArray(val) ? JSON.parse(JSON.stringify(val)) : val
  }
}

/** A lesson's patch on top of `base` (default: the neutral mix). Arrays are replaced whole. */
export function applyPatch(patch: MixPatch | undefined, base: MixSettings = neutralMix()): MixSettings {
  const m = cloneMix(base)
  if (patch) merge(m as unknown as Record<string, unknown>, patch as Record<string, unknown>)
  return clampMix(m)
}
