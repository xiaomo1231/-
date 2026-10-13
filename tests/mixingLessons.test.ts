import { describe, expect, it } from 'vitest'
import { MIX_LESSONS, MIX_UNITS, lessonById, lessonsOf } from '@/mixing/lessons'
import { CONTROLS, getPath } from '@/mixing/controls'
import type { EarDrillKind, MixPatch } from '@/mixing/types'
import { DEFAULT_MIX } from '@/songs/mixPresets'

const DRILLS: EarDrillKind[] = ['eqFreq', 'eqBoostCut', 'lowCut', 'compAmount', 'reverbSize', 'delayTime', 'pan', 'distortion', 'loudness', 'width']
const DESK = ['lowcut', 'eq', 'comp', 'comp2', 'parallel', 'deess', 'gate', 'dynEq', 'saturation', 'mod', 'reverb', 'delay', 'balance', 'duck', 'pocket', 'autoLevel', 'tune', 'master']

/** Every key path in the patch must exist in DEFAULT_MIX (array elements are checked against the default's first element). */
function badKeys(patch: unknown, ref: unknown, path: string): string[] {
  if (patch === null || typeof patch !== 'object') return []
  if (ref === null || typeof ref !== 'object') return [path]
  if (Array.isArray(patch)) {
    if (!Array.isArray(ref) || ref.length === 0) return [path]
    return patch.flatMap((el, i) => badKeys(el, ref[Math.min(i, ref.length - 1)], `${path}.${i}`))
  }
  return Object.entries(patch as Record<string, unknown>).flatMap(([k, v]) => {
    const r = (ref as Record<string, unknown>)[k]
    if (r === undefined) return [`${path}.${k}`]
    if (typeof v !== typeof r && !(Array.isArray(r) && Array.isArray(v))) return [`${path}.${k} (type)`]
    return badKeys(v, r, `${path}.${k}`)
  })
}

const patches = (): Array<[string, MixPatch]> =>
  MIX_LESSONS.flatMap((l) => {
    const out: Array<[string, MixPatch]> = []
    if (l.demo) out.push([`${l.id}.demo.a`, l.demo.a], [`${l.id}.demo.b`, l.demo.b])
    if (l.task) out.push([`${l.id}.task.start`, l.task.start])
    return out
  })

describe('mixing lessons', () => {
  it('has seven units with at least four lessons each, in unit order', () => {
    expect(MIX_UNITS.map((u) => u.id)).toEqual(['basics', 'eq', 'dynamics', 'space', 'vocal', 'color', 'master'])
    for (const u of MIX_UNITS) expect(lessonsOf(u.id).length).toBeGreaterThanOrEqual(4)
    const order = MIX_LESSONS.map((l) => MIX_UNITS.findIndex((u) => u.id === l.unit))
    expect([...order].sort((a, b) => a - b)).toEqual(order)
  })

  it('ids are unique, kebab-case and prefixed by unit', () => {
    const ids = MIX_LESSONS.map((l) => l.id)
    expect(new Set(ids).size).toBe(ids.length)
    const prefix: Record<string, string> = { basics: 'basics-', eq: 'eq-', dynamics: 'dyn-', space: 'space-', vocal: 'vocal-', color: 'color-', master: 'master-' }
    for (const l of MIX_LESSONS) {
      expect(l.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
      expect(l.id.startsWith(prefix[l.unit]!)).toBe(true)
      expect(lessonById(l.id)).toBe(l)
    }
    expect(lessonById('nope')).toBeUndefined()
  })

  it('lesson text is within limits', () => {
    for (const l of MIX_LESSONS) {
      expect(l.minutes).toBeGreaterThanOrEqual(3)
      expect(l.minutes).toBeLessThanOrEqual(8)
      expect(l.body.length).toBeGreaterThanOrEqual(3)
      expect(l.body.length).toBeLessThanOrEqual(6)
      for (const p of l.body) expect(p.length, `${l.id}: ${p}`).toBeLessThanOrEqual(160)
      expect(l.keyPoints.length).toBeGreaterThanOrEqual(2)
      expect(l.keyPoints.length).toBeLessThanOrEqual(4)
    }
  })

  it('task controls and checks use registered paths with in-range values', () => {
    for (const l of MIX_LESSONS) {
      if (!l.task) continue
      expect(l.task.controls.length, l.id).toBeGreaterThanOrEqual(1)
      expect(l.task.controls.length, l.id).toBeLessThanOrEqual(5)
      for (const c of l.task.controls) {
        expect(CONTROLS[c], `${l.id}: ${c}`).toBeDefined()
        expect(getPath(DEFAULT_MIX, c), `${l.id}: ${c}`).toBeDefined()
      }
      expect(l.task.checks.length + (l.task.measures?.length ?? 0), l.id).toBeGreaterThan(0)
      for (const ch of l.task.checks) {
        const spec = CONTROLS[ch.path]
        expect(spec, `${l.id}: ${ch.path}`).toBeDefined()
        if (spec?.kind === 'number') {
          for (const v of [ch.min, ch.max]) {
            if (v === undefined) continue
            expect(v, `${l.id}: ${ch.path}`).toBeGreaterThanOrEqual(spec.min)
            expect(v, `${l.id}: ${ch.path}`).toBeLessThanOrEqual(spec.max)
          }
          if (ch.min !== undefined && ch.max !== undefined) expect(ch.min).toBeLessThan(ch.max)
        } else if (spec?.kind === 'switch') {
          expect(typeof ch.equals, `${l.id}: ${ch.path}`).toBe('boolean')
        } else if (spec?.kind === 'select') {
          expect(spec.options.map((o) => o.value), `${l.id}: ${ch.path}`).toContain(ch.equals)
        }
      }
    }
  })

  it('patches only use keys of the mix settings', () => {
    for (const [where, p] of patches()) expect(badKeys(p, DEFAULT_MIX, where), where).toEqual([])
  })

  it('demos compare two different settings', () => {
    for (const l of MIX_LESSONS) if (l.demo) expect(JSON.stringify(l.demo.a), l.id).not.toBe(JSON.stringify(l.demo.b))
  })

  it('has enough tasks, valid drills and desk modules', () => {
    expect(MIX_LESSONS.filter((l) => l.task).length).toBeGreaterThanOrEqual(20)
    for (const l of MIX_LESSONS) {
      if (l.drill) expect(DRILLS).toContain(l.drill)
      if (l.deskModule) expect(DESK).toContain(l.deskModule)
    }
  })
})
