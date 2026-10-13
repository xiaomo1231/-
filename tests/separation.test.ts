import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { OVERLAP, SEGMENT, chunkPlan, chunkWeight } from '@/audio/separation/chunks'
import { detectStem } from '@/songs/backingSync'

describe('separation chunks', () => {
  it('covers every sample with weights that sum to 1 (no fade at the very start and end)', () => {
    for (const total of [1000, SEGMENT, SEGMENT + 1, 5 * SEGMENT + 12345]) {
      const plan = chunkPlan(total)
      const sum = new Float64Array(total)
      for (const c of plan) {
        expect(c.start + c.length).toBeLessThanOrEqual(total)
        for (let j = 0; j < c.length; j++) sum[c.start + j]! += chunkWeight(c, j)
      }
      for (const i of [0, 1, Math.floor(total / 2), total - 1]) expect(sum[i]).toBeGreaterThan(0.99)
      expect(plan[0]!.fadeIn).toBe(false)
      expect(plan.at(-1)!.fadeOut).toBe(false)
    }
  })
  it('steps by three quarters of a segment', () => {
    const plan = chunkPlan(4 * SEGMENT)
    expect(plan[1]!.start - plan[0]!.start).toBe(SEGMENT - OVERLAP)
    expect(plan.every((c, i) => i === plan.length - 1 || c.length === SEGMENT)).toBe(true)
  })
})

describe('separated file names', () => {
  it('helper and browser outputs are recognised by the stem detector', () => {
    for (const [name, stem] of [
      ['song_(Vocals).wav', 'vocals'],
      ['song_(Instrumental).wav', 'instrumental'],
      ['song_(Drums).wav', 'drums'],
      ['song_(Bass).wav', 'bass'],
      ['song_(Guitar).wav', 'guitar'],
      ['song_(Piano).wav', 'piano'],
      ['song_(Other).wav', 'other'],
    ] as const) {
      expect(detectStem(name)).toBe(stem)
    }
  })
  it('public/ort matches the installed onnxruntime-web (run scripts/copy-ort.mjs after upgrading)', () => {
    const root = path.resolve(__dirname, '..')
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version
    expect(readFileSync(path.join(root, 'public/ort/VERSION.txt'), 'utf8').trim()).toBe(installed)
  })
})
