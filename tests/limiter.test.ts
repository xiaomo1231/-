import { describe, expect, it } from 'vitest'
import { limitPeaks, normalizeLoudness } from '@/audio/fx/limiter'
import { integratedLufs, truePeakDb } from '@/audio/fx/loudness'

const SR = 44100
function music(seconds: number, amp: number): Float32Array[] {
  const n = seconds * SR
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const hit = Math.exp(-((t % 0.5) * 20)) // a drum hit every half second
    l[i] = amp * (0.5 * Math.sin(2 * Math.PI * 110 * t) + 0.8 * hit * Math.sin(2 * Math.PI * 60 * t) + 0.2 * Math.sin(2 * Math.PI * 3000 * t + 0.3))
    r[i] = l[i]! * 0.9
  }
  return [l, r]
}

describe('limiter and loudness', () => {
  it('keeps the true peak under the ceiling', () => {
    const x = music(4, 1.6)
    expect(truePeakDb(x, SR)).toBeGreaterThan(0)
    const y = limitPeaks(x, SR, -1)
    expect(truePeakDb(y, SR)).toBeLessThanOrEqual(-1)
    expect(y[0]!.length).toBe(x[0]!.length)
  })
  it('leaves quiet audio untouched', () => {
    const x = music(2, 0.2)
    const y = limitPeaks(x, SR, -1)
    expect(Array.from(y[0]!.slice(0, 1000))).toEqual(Array.from(x[0]!.slice(0, 1000)))
  })
  it('normalises to a target loudness without breaking the ceiling', () => {
    const x = music(6, 0.1)
    const y = normalizeLoudness(x, SR, -14, -1, true)
    expect(Math.abs(integratedLufs(y, SR) - -14)).toBeLessThan(1)
    expect(truePeakDb(y, SR)).toBeLessThanOrEqual(-1)
  })
})
