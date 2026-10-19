import { describe, expect, it } from 'vitest'
import {
  barAtTick,
  barEndTick,
  countInMs,
  nextSection,
  sectionAt,
  sectionsOf,
  type SectionBar,
} from '../src/songs/rehearsalSections'

function bars(
  count: number,
  marks: Record<number, { text: string; marker: string }> = {},
): SectionBar[] {
  return Array.from({ length: count }, (_, i) => ({
    start: i * 3840,
    section: marks[i + 1] ?? null,
  }))
}

describe('sectionsOf', () => {
  it('returns [] when there are no markers', () => {
    expect(sectionsOf(bars(8))).toEqual([])
    expect(sectionsOf([])).toEqual([])
  })

  it('uses the marker text as the name', () => {
    const s = sectionsOf(
      bars(8, { 1: { text: 'Verse', marker: 'A' }, 5: { text: 'Chorus', marker: 'B' } }),
    )
    expect(s).toEqual([
      { name: 'Verse', startBar: 1, startTick: 0 },
      { name: 'Chorus', startBar: 5, startTick: 4 * 3840 },
    ])
  })

  it('falls back to the marker, then to 段落 N', () => {
    const s = sectionsOf(
      bars(8, {
        1: { text: '', marker: 'A' },
        3: { text: '  ', marker: '' },
      }),
    )
    expect(s.map((x) => x.name)).toEqual(['A', '段落 2'])
  })

  it('adds a 开头 section at bar 1 when the first marker is later', () => {
    const b = bars(8, { 4: { text: 'Chorus', marker: 'C' } })
    const s = sectionsOf(b)
    expect(s).toEqual([
      { name: '开头', startBar: 1, startTick: 0 },
      { name: 'Chorus', startBar: 4, startTick: 3 * 3840 },
    ])
  })

  it('does not add 开头 when a marker is on bar 1', () => {
    const s = sectionsOf(bars(4, { 1: { text: 'Intro', marker: 'I' } }))
    expect(s).toHaveLength(1)
    expect(s[0].name).toBe('Intro')
  })

  it('numbers unnamed sections by their position in the final list', () => {
    const s = sectionsOf(bars(8, { 3: { text: '', marker: '' } }))
    expect(s.map((x) => x.name)).toEqual(['开头', '段落 2'])
  })
})

describe('sectionAt', () => {
  const sections = [
    { name: 'A', startBar: 1, startTick: 0 },
    { name: 'B', startBar: 5, startTick: 0 },
    { name: 'C', startBar: 9, startTick: 0 },
  ]

  it('returns the section containing the bar', () => {
    expect(sectionAt(sections, 1)).toBe(0)
    expect(sectionAt(sections, 4)).toBe(0)
    expect(sectionAt(sections, 5)).toBe(1)
    expect(sectionAt(sections, 8)).toBe(1)
    expect(sectionAt(sections, 100)).toBe(2)
  })

  it('returns -1 for bars before the first section or with no sections', () => {
    expect(sectionAt(sections, 0)).toBe(-1)
    expect(sectionAt([], 3)).toBe(-1)
  })
})

describe('nextSection', () => {
  const sections = [
    { name: 'A', startBar: 1, startTick: 0 },
    { name: 'B', startBar: 5, startTick: 0 },
    { name: 'C', startBar: 9, startTick: 0 },
  ]

  it('returns the section after the one containing the bar', () => {
    expect(nextSection(sections, 1)?.name).toBe('B')
    expect(nextSection(sections, 4)?.name).toBe('B')
    expect(nextSection(sections, 5)?.name).toBe('C')
  })

  it('returns null in the last section or with no sections', () => {
    expect(nextSection(sections, 9)).toBeNull()
    expect(nextSection(sections, 50)).toBeNull()
    expect(nextSection([], 1)).toBeNull()
  })

  it('returns the first section for bars before it', () => {
    expect(nextSection(sections, 0)?.name).toBe('A')
  })
})

describe('barAtTick', () => {
  const b = [{ start: 0 }, { start: 100 }, { start: 250 }, { start: 400 }]

  it('finds the containing bar, 1-based', () => {
    expect(barAtTick(b, 0)).toBe(1)
    expect(barAtTick(b, 99)).toBe(1)
    expect(barAtTick(b, 100)).toBe(2)
    expect(barAtTick(b, 249)).toBe(2)
    expect(barAtTick(b, 250)).toBe(3)
    expect(barAtTick(b, 400)).toBe(4)
    expect(barAtTick(b, 99999)).toBe(4)
  })

  it('returns 1 before the first bar or with no bars', () => {
    expect(barAtTick(b, -50)).toBe(1)
    expect(barAtTick([], 10)).toBe(1)
  })
})

describe('countInMs', () => {
  it('is beats × one beat at the written tempo', () => {
    expect(countInMs(4, 120, 100)).toBe(2000)
    expect(countInMs(3, 60, 100)).toBe(3000)
  })

  it('scales with speed', () => {
    expect(countInMs(4, 120, 50)).toBe(4000)
    expect(countInMs(4, 120, 200)).toBe(1000)
  })

  it('rounds to whole milliseconds', () => {
    expect(countInMs(4, 120, 75)).toBe(2667)
  })

  it('returns 0 for non-positive inputs', () => {
    expect(countInMs(0, 120, 100)).toBe(0)
    expect(countInMs(4, 0, 100)).toBe(0)
    expect(countInMs(4, 120, 0)).toBe(0)
    expect(countInMs(-1, 120, 100)).toBe(0)
  })
})

describe('barEndTick', () => {
  const b = [{ start: 0 }, { start: 100 }, { start: 250 }]

  it('is the start of the next bar', () => {
    expect(barEndTick(b, 1, 400)).toBe(100)
    expect(barEndTick(b, 2, 400)).toBe(250)
  })

  it('is songEndTick for the last bar', () => {
    expect(barEndTick(b, 3, 400)).toBe(400)
  })

  it('is songEndTick for bars past the end', () => {
    expect(barEndTick(b, 10, 400)).toBe(400)
  })

  it('handles a single bar and an empty list', () => {
    expect(barEndTick([{ start: 0 }], 1, 3840)).toBe(3840)
    expect(barEndTick([], 1, 1000)).toBe(1000)
  })
})
