import { describe, expect, it } from 'vitest'
import type { DrumBar, DrumPart } from '@/songs/drumTypes'
import {
  DRUM_BLOCK_GAP_PX,
  DRUM_HEADER_PX,
  barsPerRow,
  cellSymbol,
  cursorFor,
  groupBarsIntoRows,
} from '../web/viewer/drumView'

function bar(num: number, den: number, stepsPerQuarter: 4 | 3 | 6 = 4): DrumBar {
  return { num, den, stepsPerQuarter, hits: [] }
}

function part(bars: DrumBar[]): DrumPart {
  return {
    version: 1,
    path: 'a.gp',
    title: 't',
    artist: 'a',
    bars,
    source: 'hand',
    edited: false,
    style: null,
    updatedAt: 0,
    updatedBy: 'u',
  }
}

describe('cursorFor', () => {
  // 4/4 bars of 3840 ticks (960 per quarter), starts 0 / 3840 / 7680
  const p = part([bar(4, 4), bar(4, 4), bar(4, 4)])
  const starts = [0, 3840, 7680]

  it('maps the first tick to bar 0 step 0', () => {
    expect(cursorFor(p, 0, starts)).toEqual({ bar: 0, step: 0 })
  })

  it('maps sixteenth-note steps (240 ticks each) inside a bar', () => {
    expect(cursorFor(p, 239, starts)).toEqual({ bar: 0, step: 0 })
    expect(cursorFor(p, 240, starts)).toEqual({ bar: 0, step: 1 })
    expect(cursorFor(p, 960, starts)).toEqual({ bar: 0, step: 4 })
  })

  it('moves to the next bar exactly at its start tick', () => {
    expect(cursorFor(p, 3839, starts)).toEqual({ bar: 0, step: 15 })
    expect(cursorFor(p, 3840, starts)).toEqual({ bar: 1, step: 0 })
    expect(cursorFor(p, 8000, starts)).toEqual({ bar: 2, step: 1 })
  })

  it('returns null before the start, after the last bar, or for negative / NaN ticks', () => {
    expect(cursorFor(p, -1, starts)).toBeNull()
    expect(cursorFor(p, NaN, starts)).toBeNull()
    expect(cursorFor(p, 7680 + 3840, starts)).toBeNull()
    expect(cursorFor(p, 100000, starts)).toBeNull()
    expect(cursorFor(part([]), 0, [])).toBeNull()
  })

  it('uses the bar own time signature and resolution (triplet eighths, 3/4)', () => {
    // 3/4 with 3 steps per quarter = 9 steps; 320 ticks per step
    const q = part([bar(3, 4, 3)])
    expect(cursorFor(q, 320 * 8, [0])).toEqual({ bar: 0, step: 8 })
    expect(cursorFor(q, 2880, [0])).toBeNull()
  })

  it('ignores bars beyond the shorter of the two lists', () => {
    expect(cursorFor(p, 4000, [0, 3840])).toEqual({ bar: 1, step: 0 })
    expect(cursorFor(p, 8000, [0, 3840])).toBeNull()
  })
})

describe('barsPerRow', () => {
  it('fits as many bar blocks as the width allows after the header', () => {
    const block = 16 * 14 + DRUM_BLOCK_GAP_PX
    const width = DRUM_HEADER_PX + block * 3 + 5
    expect(barsPerRow(width, 16, 14)).toBe(3)
  })

  it('never returns less than one bar, even when the screen is too narrow', () => {
    expect(barsPerRow(120, 16, 18)).toBe(1)
    expect(barsPerRow(0, 16, 18)).toBe(1)
    expect(barsPerRow(NaN, 16, 18)).toBe(1)
  })
})

describe('cellSymbol', () => {
  it('draws drums as filled dots and cymbals as crosses', () => {
    expect(cellSymbol('kick', 2)).toEqual({ glyph: '●', level: 'normal', cymbal: false })
    expect(cellSymbol('snare', 3).glyph).toBe('●')
    expect(cellSymbol('ride', 2)).toEqual({ glyph: '×', level: 'normal', cymbal: true })
    expect(cellSymbol('hihatClosed', 2).glyph).toBe('×')
  })

  it('uses ring for open hi-hat and star for crash', () => {
    expect(cellSymbol('hihatOpen', 2)).toEqual({ glyph: '○', level: 'normal', cymbal: true })
    expect(cellSymbol('crash', 3)).toEqual({ glyph: '✱', level: 'accent', cymbal: true })
  })

  it('maps velocity to accent / normal / ghost, ghost always as hollow "( )"', () => {
    expect(cellSymbol('snare', 3).level).toBe('accent')
    expect(cellSymbol('snare', 2).level).toBe('normal')
    expect(cellSymbol('snare', 1)).toEqual({ glyph: '( )', level: 'ghost', cymbal: false })
    expect(cellSymbol('hihatOpen', 1).glyph).toBe('( )')
  })
})

describe('groupBarsIntoRows', () => {
  const p = part([bar(4, 4), bar(4, 4), bar(4, 4), bar(4, 4), bar(4, 4)])

  it('splits bar indices into lines of perRow', () => {
    expect(groupBarsIntoRows(p, 2)).toEqual([[0, 1], [2, 3], [4]])
  })

  it('keeps at least one bar per line', () => {
    expect(groupBarsIntoRows(p, 0)).toEqual([[0], [1], [2], [3], [4]])
    expect(groupBarsIntoRows(p, 1.9)).toHaveLength(5)
  })

  it('returns no lines for an empty part', () => {
    expect(groupBarsIntoRows(part([]), 4)).toEqual([])
  })
})
