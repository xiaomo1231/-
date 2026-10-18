import { describe, expect, it } from 'vitest'
import { estimateOffset, localTimeFor, planFor, LATE_START_MS } from '../web/viewer/liveSync'
import type { LiveState } from '../src/songs/scoreServerTypes'

const base: LiveState = {
  songId: 's1',
  leaderId: 'u1',
  playing: true,
  tick: 960,
  speedPct: 100,
  startAt: 10_000,
  seq: 5,
  present: ['u1', 'u2'],
}

describe('一起播放 · 时钟偏移', () => {
  it('picks the sample with the smallest round trip', () => {
    const offset = estimateOffset([
      { t0: 0, server: 1_500, t1: 200 }, // rtt 200, offset 1500 - 100 = 1400
      { t0: 1_000, server: 2_405, t1: 1_010 }, // rtt 10, offset 2405 - 1005 = 1400
      { t0: 2_000, server: 9_999, t1: 2_400 }, // rtt 400, ignored
    ])
    expect(offset).toBe(1_400)
  })

  it('uses the midpoint of the chosen round trip', () => {
    expect(estimateOffset([{ t0: 100, server: 500, t1: 103 }])).toBe(500 - 101.5)
  })

  it('maps server time to local time with the offset', () => {
    expect(localTimeFor(10_000, 1_400)).toBe(8_600)
  })

  it('refuses an empty sample set', () => {
    expect(() => estimateOffset([])).toThrow()
  })
})

describe('一起播放 · 状态应用', () => {
  it('ignores stale or repeated states', () => {
    expect(planFor(base, 5, 0, 0)).toEqual({ kind: 'ignore' })
    expect(planFor(base, 9, 0, 0)).toEqual({ kind: 'ignore' })
  })

  it('pauses at the state tick when not playing', () => {
    expect(planFor({ ...base, playing: false, tick: 120 }, 4, 0, 0)).toEqual({ kind: 'pause', tick: 120 })
  })

  it('schedules a future start on the local clock', () => {
    // server 10000 happens locally at 10000 - 1400 = 8600; now is 8000 => 600 ms away
    expect(planFor(base, 4, 1_400, 8_000)).toEqual({ kind: 'start', tick: 960, speedPct: 100, delayMs: 600 })
  })

  it('starts immediately when the start time has just passed', () => {
    const p = planFor(base, 4, 1_400, 8_600 + 1_000)
    expect(p).toEqual({ kind: 'start', tick: 960, speedPct: 100, delayMs: 0 })
  })

  it('does not join a song that started long ago', () => {
    expect(planFor(base, 4, 1_400, 8_600 + LATE_START_MS)).toEqual({ kind: 'ignore' })
  })
})
