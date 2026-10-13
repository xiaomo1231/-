import { describe, expect, it } from 'vitest'
import { applyPhraseGains, phraseGainsDb, phraseLevels, rideLevels } from '@/audio/fx/autoLevel'

const SR = 8000
/** Phrases of a sine at the given dBFS levels, 1 s each, 0.5 s gaps. */
function song(levelsDb: number[]) {
  const total = levelsDb.length * 1.5 * SR
  const x = new Float32Array(total)
  const phrases = levelsDb.map((db, k) => {
    const a = Math.round(k * 1.5 * SR)
    const amp = Math.pow(10, db / 20) * Math.SQRT2
    for (let i = 0; i < SR; i++) x[a + i] = amp * Math.sin((2 * Math.PI * 220 * i) / SR)
    return { startMs: k * 1500, endMs: k * 1500 + 1000 }
  })
  return { x, phrases }
}

describe('逐句音量平衡', () => {
  it('measures each phrase and pulls it toward the median', () => {
    const { x, phrases } = song([-20, -12, -20, -26])
    const levels = phraseLevels(x, SR, phrases)
    levels.forEach((l, i) => expect(l).toBeCloseTo([-20, -12, -20, -26][i]!, 0))
    expect(phraseGainsDb(levels, 1).map((g) => Math.round(g))).toEqual([0, -8, 0, 6])
    expect(phraseGainsDb(levels, 0.5).map((g) => Math.round(g))).toEqual([0, -4, 0, 3])
    expect(phraseGainsDb(levels, 0, { 2: 3 }).map((g) => Math.round(g))).toEqual([0, 0, 3, 0])
  })

  it('evens out the phrases, without clicks', () => {
    const { x, phrases } = song([-20, -12, -20, -26])
    const r = rideLevels(x, SR, phrases, 1)
    const after = phraseLevels(r.samples, SR, phrases)
    const spread = Math.max(...after) - Math.min(...after)
    expect(spread).toBeLessThan(1)
    let maxJump = 0
    for (let i = 1; i < r.samples.length; i++) maxJump = Math.max(maxJump, Math.abs(r.samples[i]! - r.samples[i - 1]!))
    let inJump = 0
    for (let i = 1; i < x.length; i++) inJump = Math.max(inJump, Math.abs(x[i]! - x[i - 1]!) * 2.6)
    expect(maxJump).toBeLessThanOrEqual(inJump)
    expect(r.samples).not.toBe(x)
  })

  it('leaves the voice alone without phrases or with zero gains', () => {
    const { x, phrases } = song([-20, -20])
    expect(Array.from(applyPhraseGains(x, SR, [], []))).toEqual(Array.from(x))
    const same = applyPhraseGains(x, SR, phrases, [0, 0])
    expect(Math.max(...Array.from(same, (v, i) => Math.abs(v - x[i]!)))).toBeLessThan(1e-6)
  })
})
