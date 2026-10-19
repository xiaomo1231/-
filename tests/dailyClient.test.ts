import { describe, expect, it } from 'vitest'
import {
  clampDay,
  daysBetweenLocal,
  doneCount,
  nextTempo,
  pickBacking,
  startTempo,
  streak,
  todayNumber,
} from '../web/lib/daily'

const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime()

describe('daysBetweenLocal', () => {
  it('counts across midnight as one day', () => {
    expect(daysBetweenLocal(at(2026, 3, 28, 23, 59), at(2026, 3, 29, 0, 1))).toBe(1)
    expect(daysBetweenLocal(at(2026, 3, 28, 0, 1), at(2026, 3, 28, 23, 59))).toBe(0)
  })

  it('counts whole calendar days regardless of the hours between', () => {
    expect(daysBetweenLocal(at(2026, 3, 1, 23, 50), at(2026, 3, 2, 0, 10))).toBe(1)
    expect(daysBetweenLocal(at(2026, 3, 1, 0, 0), at(2026, 3, 31, 23, 59))).toBe(30)
  })

  it('stays correct over a DST change (23-hour day)', () => {
    // US spring-forward day: 2026-03-08 has 23 real hours in New York.
    expect(daysBetweenLocal(at(2026, 3, 7, 12), at(2026, 3, 8, 12))).toBe(1)
    expect(daysBetweenLocal(at(2026, 3, 7, 23, 30), at(2026, 3, 8, 0, 30))).toBe(1)
    expect(daysBetweenLocal(at(2026, 3, 7, 12), at(2026, 3, 9, 11))).toBe(2)
  })

  it('is negative when the second instant is earlier', () => {
    expect(daysBetweenLocal(at(2026, 3, 10), at(2026, 3, 8))).toBe(-2)
  })
})

describe('todayNumber', () => {
  it('is day 1 on the local day the program was opened, even late in the evening', () => {
    const started = at(2026, 1, 1, 23, 55)
    expect(todayNumber(started, at(2026, 1, 1, 23, 59))).toBe(1)
    expect(todayNumber(started, at(2026, 1, 2, 0, 5))).toBe(2)
  })

  it('advances at local midnight', () => {
    const started = at(2026, 5, 10, 9)
    expect(todayNumber(started, at(2026, 5, 11, 0, 0))).toBe(2)
    expect(todayNumber(started, at(2026, 5, 20, 8, 0))).toBe(11)
  })

  it('caps at 365 and treats an unstarted account as day 1', () => {
    expect(todayNumber(at(2026, 1, 1), at(2030, 1, 1))).toBe(365)
    expect(todayNumber(null, at(2026, 1, 1))).toBe(1)
  })

  it('clampDay keeps 1…365 and maps NaN to 1', () => {
    expect(clampDay(0)).toBe(1)
    expect(clampDay(400)).toBe(365)
    expect(clampDay(Number.NaN)).toBe(1)
    expect(clampDay(7.9)).toBe(7)
  })
})

describe('streak', () => {
  it('counts back from today when today is done', () => {
    expect(streak({ '1': 1, '2': 1, '3': 1 }, 3)).toBe(3)
  })

  it('still counts when today is not marked yet but yesterday is', () => {
    expect(streak({ '1': 1, '2': 1 }, 3)).toBe(2)
  })

  it('is zero when neither today nor yesterday is done, and stops at a gap', () => {
    expect(streak({ '1': 1 }, 5)).toBe(0)
    expect(streak({ '1': 1, '2': 1, '4': 1, '5': 1 }, 5)).toBe(2)
  })

  it('does not count past day 1', () => {
    expect(streak({ '1': 1 }, 1)).toBe(1)
    expect(streak({}, 1)).toBe(0)
  })

  it('doneCount counts marked days', () => {
    expect(doneCount({ '1': 10, '9': 20 })).toBe(2)
  })
})

describe('pickBacking', () => {
  const backing = [
    { style: '金属', bpm: 40, path: 'a' },
    { style: '金属', bpm: 56, path: 'b' },
    { style: '布鲁斯', bpm: 48, path: 'c' },
  ]

  it('prefers the exact bpm of the same style', () => {
    expect(pickBacking(backing, '金属', 56)?.path).toBe('b')
  })

  it('falls back to the nearest bpm of that style, lower on a tie', () => {
    expect(pickBacking(backing, '金属', 50)?.path).toBe('b')
    expect(pickBacking(backing, '金属', 48)?.path).toBe('a')
    expect(pickBacking(backing, '金属', 60)?.path).toBe('b')
  })

  it('returns null for a style with no track', () => {
    expect(pickBacking(backing, '爵士', 48)).toBeNull()
  })
})

describe('nextTempo', () => {
  const ladder = [{ bpm: 40 }, { bpm: 48 }, { bpm: 56 }]

  it('gives the next faster rung', () => {
    expect(nextTempo(ladder, 40)).toEqual({ bpm: 48 })
    expect(nextTempo(ladder, 44)).toEqual({ bpm: 48 })
  })

  it('is null at the top, and for an empty ladder', () => {
    expect(nextTempo(ladder, 56)).toBeNull()
    expect(nextTempo([], 40)).toBeNull()
  })
})

describe('startTempo', () => {
  const ladder = [{ bpm: 40 }, { bpm: 48 }, { bpm: 56 }]

  it('starts at the slowest rung when nothing is completed', () => {
    expect(startTempo(ladder, null)).toEqual({ bpm: 40 })
  })

  it('starts at the slowest rung faster than the completed tempo', () => {
    expect(startTempo(ladder, 40)).toEqual({ bpm: 48 })
    expect(startTempo(ladder, 44)).toEqual({ bpm: 48 })
  })

  it('stays on the top rung when everything is completed, and is null for no rungs', () => {
    expect(startTempo(ladder, 56)).toEqual({ bpm: 56 })
    expect(startTempo([], null)).toBeNull()
  })
})
