import { describe, expect, it } from 'vitest'
import { estimateLatency, reportedLatencyMs } from '../web/viewer/latencyMath'

/** 16 clicks every 600 ms starting at t = 1000. */
const CLICKS = Array.from({ length: 16 }, (_, i) => 1000 + i * 600)

describe('estimateLatency', () => {
  it('recovers a constant offset', () => {
    const taps = CLICKS.map((c) => c + 220)
    const r = estimateLatency(CLICKS, taps)
    expect(r).not.toBeNull()
    expect(r!.ms).toBe(220)
    expect(r!.used).toBe(16)
    expect(r!.spread).toBe(0)
  })

  it('ignores outliers and reports a stable median', () => {
    const noise = [-12, 8, 5, -6, 14, 3, -9, 0, 11, -4, 7, 2, -10, 6, 1, -3]
    const taps = CLICKS.map((c, i) => c + 180 + noise[i])
    // Two wild taps: a double-tap and a late tap, both still within the match window.
    taps[4] = CLICKS[4] + 180 + 390
    taps[9] = CLICKS[9] + 180 - 300
    const r = estimateLatency(CLICKS, taps)
    expect(r).not.toBeNull()
    expect(Math.abs(r!.ms - 180)).toBeLessThanOrEqual(6)
    expect(r!.used).toBeLessThan(16)
    expect(r!.spread).toBeGreaterThan(0)
  })

  it('returns null with too few taps', () => {
    const taps = [CLICKS[0] + 200, CLICKS[1] + 200, CLICKS[2] + 200, CLICKS[3] + 200]
    expect(estimateLatency(CLICKS, taps)).toBeNull()
    expect(estimateLatency(CLICKS, [])).toBeNull()
  })

  it('clamps a negative offset to 0', () => {
    const taps = CLICKS.slice(0, 8).map((c) => c - 30)
    const r = estimateLatency(CLICKS, taps)
    expect(r).not.toBeNull()
    expect(r!.ms).toBe(0)
  })

  it('ignores taps far from every click', () => {
    const taps = CLICKS.slice(0, 8).map((c) => c + 150)
    // Taps in the gap between clicks, far more than 400 ms from any click.
    const far = [CLICKS[2] + 300, CLICKS[5] + 300, CLICKS[7] + 300]
    const clean = estimateLatency(CLICKS, taps)
    const withFar = estimateLatency(CLICKS, [...taps, ...far])
    expect(withFar).not.toBeNull()
    expect(withFar!.ms).toBe(clean!.ms)
    expect(withFar!.used).toBe(clean!.used)
    // A tap long before the first click is also ignored.
    const early = estimateLatency(CLICKS, [...taps, CLICKS[0] - 500])
    expect(early!.used).toBe(clean!.used)
  })
})

describe('reportedLatencyMs', () => {
  it('sums output and base latency in ms', () => {
    expect(reportedLatencyMs({ outputLatency: 0.1, baseLatency: 0.0051 })).toBe(105)
  })

  it('uses whichever value exists', () => {
    expect(reportedLatencyMs({ outputLatency: 0.25 })).toBe(250)
    expect(reportedLatencyMs({ baseLatency: 0.01 })).toBe(10)
  })

  it('returns null when neither is a number', () => {
    expect(reportedLatencyMs({})).toBeNull()
  })
})
