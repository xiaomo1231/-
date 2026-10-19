import { describe, expect, it } from 'vitest'
import { badgePosition, groupByBar } from '../web/viewer/barBounds'
import type { BarComment } from '../web/lib/api'

const c = (id: string, bar: number, at: number): BarComment => ({
  id,
  bar,
  text: id,
  userId: 'u1',
  at,
})

describe('groupByBar', () => {
  it('groups by bar, sorts ascending, counts and keeps the latest by time', () => {
    const groups = groupByBar([
      c('a', 12, 100),
      c('b', 3, 500),
      c('c', 12, 300),
      c('d', 12, 200),
      c('e', 3, 400),
    ])
    expect(groups.map((g) => g.bar)).toEqual([3, 12])
    expect(groups[0]).toMatchObject({ count: 2 })
    expect(groups[0].latest.id).toBe('b')
    expect(groups[1]).toMatchObject({ count: 3 })
    expect(groups[1].latest.id).toBe('c')
  })

  it('returns an empty list for no comments', () => {
    expect(groupByBar([])).toEqual([])
  })
})

describe('badgePosition', () => {
  it('places the badge at the top-right corner of the bar box', () => {
    expect(badgePosition({ x: 100, y: 40, w: 200, h: 80 }, 1000, 56)).toEqual({
      left: 244,
      top: 40,
    })
  })

  it('keeps the badge inside the surface width', () => {
    const pos = badgePosition({ x: 900, y: 10, w: 200, h: 80 }, 1000, 56)
    expect(pos.left).toBe(944)
    expect(pos.left + 56).toBeLessThanOrEqual(1000)
  })

  it('never goes left of zero', () => {
    expect(badgePosition({ x: 0, y: 0, w: 10, h: 10 }, 1000, 56).left).toBe(0)
    expect(badgePosition({ x: 0, y: 0, w: 10, h: 10 }, 20, 56).left).toBe(0)
  })
})
