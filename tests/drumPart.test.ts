import { describe, expect, it } from 'vitest'
import type { DrumBar, DrumPart, DrumPiece, DrumVelocity } from '@/songs/drumTypes'
import {
  changeResolution,
  clearBars,
  copyBars,
  createHistory,
  current,
  emptyBar,
  getHit,
  isFillLike,
  normalizeBar,
  patternStats,
  pasteBars,
  push,
  redo,
  repeatBars,
  replaceRange,
  setHit,
  toDrumTab,
  toggleHit,
  undo,
  usedPieces,
  validatePart,
  visiblePieces,
} from '@/songs/drumPart'

function bar(num: number, den: number, spq: 3 | 4 | 6, hits: Array<[number, DrumPiece, DrumVelocity?]>): DrumBar {
  return {
    num,
    den,
    stepsPerQuarter: spq,
    hits: hits.map(([step, piece, vel = 2]) => ({ step, piece, vel })),
  }
}

function part(bars: DrumBar[]): DrumPart {
  return { version: 1, path: 'a/b.mxl', title: '歌', artist: '人', bars, source: 'hand', edited: false, style: null, updatedAt: 1, updatedBy: 'u' }
}

const deepCopy = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T

describe('drumPart: bar edits', () => {
  it('emptyBar has no hits and the given meter', () => {
    expect(emptyBar(3, 4)).toEqual({ num: 3, den: 4, stepsPerQuarter: 4, hits: [] })
  })

  it('normalizeBar sorts, drops out-of-range and unknown hits, and keeps the louder duplicate', () => {
    const b = bar(4, 4, 4, [
      [8, 'snare', 2],
      [0, 'kick', 2],
      [0, 'hihatClosed', 1],
      [0, 'hihatClosed', 3],
      [16, 'kick', 2],
      [-1, 'kick', 2],
    ])
    b.hits.push({ step: 2, piece: 'nope' as DrumPiece, vel: 2 })
    const n = normalizeBar(b)
    expect(n.hits).toEqual([
      { step: 0, piece: 'hihatClosed', vel: 3 },
      { step: 0, piece: 'kick', vel: 2 },
      { step: 8, piece: 'snare', vel: 2 },
    ])
  })

  it('getHit finds a hit or undefined', () => {
    const b = bar(4, 4, 4, [[4, 'snare', 2]])
    expect(getHit(b, 4, 'snare')?.vel).toBe(2)
    expect(getHit(b, 4, 'kick')).toBeUndefined()
  })

  it('setHit adds, replaces and removes (vel 0), without mutating the input', () => {
    const b = bar(4, 4, 4, [[0, 'kick', 2]])
    const snapshot = deepCopy(b)
    const added = setHit(b, 4, 'snare', 3)
    expect(getHit(added, 4, 'snare')?.vel).toBe(3)
    expect(setHit(added, 0, 'kick', 0).hits.some(h => h.piece === 'kick')).toBe(false)
    expect(setHit(b, 0, 'kick', 1).hits[0]?.vel).toBe(1)
    expect(b).toEqual(snapshot)
  })

  it('toggleHit cycles: add, remove on same velocity, set on another velocity', () => {
    let b = emptyBar(4, 4)
    b = toggleHit(b, 0, 'hihatClosed')
    expect(getHit(b, 0, 'hihatClosed')?.vel).toBe(2)
    b = toggleHit(b, 0, 'hihatClosed')
    expect(b.hits).toEqual([])
    b = toggleHit(b, 0, 'hihatClosed', 2)
    b = toggleHit(b, 0, 'hihatClosed', 3)
    expect(b.hits).toEqual([{ step: 0, piece: 'hihatClosed', vel: 3 }])
  })

  it('changeResolution re-quantizes to the nearest step and keeps the louder hit on collisions', () => {
    const b = bar(4, 4, 4, [[2, 'hihatClosed', 2], [3, 'snare', 2], [2, 'kick', 3]])
    const t = changeResolution(b, 3)
    expect(t.stepsPerQuarter).toBe(3)
    // step 2 (eighth) -> 1.5 -> 2; step 3 -> 2.25 -> 2
    expect(t.hits).toEqual([
      { step: 2, piece: 'hihatClosed', vel: 2 },
      { step: 2, piece: 'snare', vel: 2 },
      { step: 2, piece: 'kick', vel: 3 },
    ])
    // same piece twice on one new step: the louder one survives
    const collide = changeResolution(bar(4, 4, 4, [[2, 'kick', 1], [3, 'kick', 3]]), 3)
    expect(collide.hits).toEqual([{ step: 2, piece: 'kick', vel: 3 }])
  })
})

describe('drumPart: bar ranges', () => {
  const base = part([
    bar(4, 4, 4, [[0, 'kick']]),
    bar(4, 4, 4, [[4, 'snare']]),
    bar(4, 4, 4, [[8, 'kick']]),
    bar(4, 4, 4, [[0, 'crash', 3]]),
  ])

  it('copyBars returns copies of the range, clipped', () => {
    const copied = copyBars(base, 1, 2)
    expect(copied).toHaveLength(2)
    expect(copied[0]?.hits[0]?.piece).toBe('snare')
    expect(copyBars(base, 9, 12)).toEqual([])
    expect(copyBars(base, -3, 0)).toHaveLength(1)
  })

  it('pasteBars overwrites bars and clips to the part length; the input stays unchanged', () => {
    const snapshot = deepCopy(base)
    const next = pasteBars(base, 3, copyBars(base, 0, 1))
    expect(next.bars).toHaveLength(4)
    expect(next.bars[3]?.hits[0]?.piece).toBe('kick')
    expect(base).toEqual(snapshot)
  })

  it('pasteBars across time signatures keeps the hits that fit and re-grids to the target', () => {
    const src = bar(4, 4, 4, [[0, 'kick'], [8, 'snare'], [12, 'hihatClosed']])
    const target = part([emptyBar(3, 4, 4)])
    const next = pasteBars(target, 0, [src])
    expect(next.bars[0]?.num).toBe(3)
    expect(next.bars[0]?.hits).toEqual([
      { step: 0, piece: 'kick', vel: 2 },
      { step: 8, piece: 'snare', vel: 2 },
    ])
    const tripletTarget = part([emptyBar(4, 4, 3)])
    const re = pasteBars(tripletTarget, 0, [src])
    expect(re.bars[0]?.stepsPerQuarter).toBe(3)
    expect(re.bars[0]?.hits.map(h => h.step)).toEqual([0, 6, 9])
  })

  it('repeatBars fills the following bars cyclically up to `until` (inclusive)', () => {
    const p = part([bar(4, 4, 4, [[0, 'kick']]), bar(4, 4, 4, [[4, 'snare']]), emptyBar(4, 4), emptyBar(4, 4), emptyBar(4, 4)])
    const r = repeatBars(p, 0, 1, 4)
    expect(r.bars.map(b => b.hits[0]?.piece ?? null)).toEqual(['kick', 'snare', 'kick', 'snare', 'kick'])
    expect(repeatBars(p, 0, 1, 1).bars).toHaveLength(5)
  })

  it('clearBars empties the range and keeps the meter', () => {
    const r = clearBars(base, 1, 2)
    expect(r.bars[1]).toEqual({ num: 4, den: 4, stepsPerQuarter: 4, hits: [] })
    expect(r.bars[0]?.hits).toHaveLength(1)
    expect(r.bars[3]?.hits).toHaveLength(1)
  })

  it('replaceRange overwrites bars from `first` with normalized bars', () => {
    const r = replaceRange(base, 2, [bar(4, 4, 4, [[12, 'snare'], [12, 'snare', 3]])])
    expect(r.bars[2]?.hits).toEqual([{ step: 12, piece: 'snare', vel: 3 }])
    expect(r.bars[3]).toBe(base.bars[3])
  })
})

describe('drumPart: undo / redo', () => {
  it('undoes and redoes, immutably', () => {
    const p0 = part([emptyBar(4, 4)])
    const p1 = part([setHit(emptyBar(4, 4), 0, 'kick', 2)])
    let h = createHistory(p0)
    h = push(h, p1)
    expect(current(h)).toBe(p1)
    h = undo(h)
    expect(current(h)).toBe(p0)
    h = redo(h)
    expect(current(h)).toBe(p1)
    expect(undo(undo(h)).past).toHaveLength(0)
  })

  it('caps the history at 100 steps', () => {
    let h = createHistory(part([emptyBar(4, 4)]))
    for (let i = 0; i < 105; i++) h = push(h, part([setHit(emptyBar(4, 4), i % 16, 'kick', 2)]))
    expect(h.past).toHaveLength(100)
    let steps = 0
    while (h.past.length) {
      h = undo(h)
      steps++
    }
    expect(steps).toBe(100)
  })
})

describe('drumPart: pieces to show', () => {
  it('usedPieces follows DRUM_PIECES order; visiblePieces adds the common pieces', () => {
    const p = part([bar(4, 4, 4, [[0, 'cowbell'], [0, 'kick'], [0, 'crash']])])
    expect(usedPieces(p)).toEqual(['crash', 'kick', 'cowbell'])
    const vis = visiblePieces(p)
    expect(vis).toContain('hihatClosed')
    expect(vis).toContain('cowbell')
    expect(vis).not.toContain('clap')
  })
})

describe('drumPart: text drum tab', () => {
  it('renders an exact tab for two bars on one line', () => {
    const p = part([
      bar(4, 4, 4, [[0, 'crash'], ...[0, 2, 4, 6, 8, 10, 12, 14].map((s): [number, DrumPiece] => [s, 'hihatClosed']), [4, 'snare'], [12, 'snare'], [0, 'kick'], [6, 'kick']]),
      bar(4, 4, 4, [[0, 'hihatClosed', 3], [8, 'kick']]),
    ])
    const tab = toDrumTab(p, { barsPerLine: 2 })
    expect(tab.split('\n').slice(0, 6)).toEqual([
      '第 1 小节',
      'CR |x---------------|----------------|',
      'HH |x-x-x-x-x-x-x-x-|X---------------|',
      'SD |----o-------o---|----------------|',
      'BD |o-----o---------|--------o-------|',
      '',
    ])
    expect(tab.endsWith('图例：X 重音　x 镲片普通击打　o 鼓类或开镲普通击打　g 鬼音　- 无击打')).toBe(true)
  })

  it('shows only rows with hits in that block plus HH / SD / BD, and labels blocks by their first bar', () => {
    const p = part([
      bar(4, 4, 4, [[0, 'cowbell']]),
      bar(4, 4, 4, [[0, 'kick']]),
      bar(4, 4, 4, [[0, 'kick']]),
    ])
    const lines = toDrumTab(p, { barsPerLine: 1 }).split('\n')
    expect(lines[0]).toBe('第 1 小节')
    // block 1 has the cowbell, so CB appears after BD; blocks 2 and 3 have no CB row
    expect(lines.slice(1, 5).map(l => l.slice(0, 2))).toEqual(['HH', 'SD', 'BD', 'CB'])
    expect(lines).toContain('第 2 小节')
    expect(lines).toContain('第 3 小节')
    // blocks are separated by a blank line: 5 and 10 are blank, block 2 has no CB row
    expect(lines[5]).toBe('')
    expect(lines.slice(7, 10).map(l => l.slice(0, 2))).toEqual(['HH', 'SD', 'BD'])
  })

  it('uses its own step count per bar and returns an empty string for an empty part', () => {
    const p = part([bar(3, 4, 4, [[0, 'kick']]), bar(6, 8, 3, [[0, 'kick']])])
    const lines = toDrumTab(p, { barsPerLine: 2 }).split('\n')
    expect(lines[3]).toBe(`BD |o${'-'.repeat(11)}|o${'-'.repeat(8)}|`)
    expect(toDrumTab(part([]), { barsPerLine: 4 })).toBe('')
  })
})

describe('drumPart: pattern statistics', () => {
  it('groups identical bars and labels them with the dominant section', () => {
    const groove = bar(4, 4, 4, [[0, 'kick'], [4, 'snare']])
    const other = bar(4, 4, 4, [[0, 'kick']])
    const p = part([groove, groove, other, groove])
    const stats = patternStats(p, ['主歌', '主歌', '主歌', '主歌'])
    expect(stats).toEqual([{ bars: [0, 1, 3], count: 3, label: '主歌常用节奏（3 次）' }])
  })

  it('uses a numbered label when no section dominates, and ignores single occurrences and empty bars', () => {
    const a = bar(4, 4, 4, [[0, 'kick']])
    const b = bar(4, 4, 4, [[4, 'snare']])
    const p = part([a, emptyBar(4, 4), a, b, emptyBar(4, 4), emptyBar(4, 4)])
    const stats = patternStats(p, [null, null, 'A', null, null, null])
    expect(stats).toEqual([{ bars: [0, 2], count: 2, label: '常用节奏型 1' }])
  })

  it('isFillLike compares tom and snare hits with the groove', () => {
    const groove = bar(4, 4, 4, [[0, 'kick'], [4, 'snare']])
    const fill = bar(4, 4, 4, [[8, 'tomHigh'], [10, 'tomMid'], [12, 'tomFloor'], [14, 'snare']])
    expect(isFillLike(fill, groove)).toBe(true)
    expect(isFillLike(groove, groove)).toBe(false)
    expect(isFillLike(fill, [groove, groove])).toBe(true)
  })
})

describe('drumPart: validatePart', () => {
  const good = (): Record<string, unknown> => ({
    version: 1,
    path: 'songs/a.mxl',
    title: '歌',
    artist: '人',
    bars: [
      { num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 8, piece: 'snare', vel: 2 }, { step: 0, piece: 'kick', vel: 3 }, { step: 0, piece: 'kick', vel: 1 }] },
      { num: 6, den: 8, stepsPerQuarter: 3, hits: [] },
    ],
    source: 'template',
    edited: false,
    style: 'rock8',
    updatedAt: 123,
    updatedBy: 'acc',
  })

  it('accepts a valid part and returns a normalized copy', () => {
    const r = validatePart(good())
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.value.bars[0]?.hits).toEqual([
      { step: 0, piece: 'kick', vel: 3 },
      { step: 8, piece: 'snare', vel: 2 },
    ])
    expect(r.value.style).toBe('rock8')
  })

  it('rejects bad parts with a Chinese message', () => {
    const cases: Array<[string, (p: Record<string, unknown>) => void, RegExp]> = [
      ['version', p => (p.version = 2), /版本号/],
      ['source', p => (p.source = 'x'), /来源/],
      ['path too long', p => (p.path = 'a'.repeat(301)), /300/],
      ['empty path', p => (p.path = ''), /不能为空/],
      ['no bars', p => (p.bars = []), /至少/],
      ['num 0', p => (p.bars = [{ num: 0, den: 4, stepsPerQuarter: 4, hits: [] }]), /分子/],
      ['den 3', p => (p.bars = [{ num: 3, den: 3, stepsPerQuarter: 4, hits: [] }]), /分母/],
      ['grid 5', p => (p.bars = [{ num: 4, den: 4, stepsPerQuarter: 5, hits: [] }]), /网格/],
      ['step out of range', p => (p.bars = [{ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 16, piece: 'kick', vel: 2 }] }]), /击打位置/],
      ['unknown piece', p => (p.bars = [{ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 0, piece: 'banjo', vel: 2 }] }]), /未知鼓件/],
      ['vel 0', p => (p.bars = [{ num: 4, den: 4, stepsPerQuarter: 4, hits: [{ step: 0, piece: 'kick', vel: 0 }] }]), /力度/],
      ['too many hits', p => (p.bars = [{ num: 4, den: 4, stepsPerQuarter: 4, hits: Array.from({ length: 65 }, () => ({ step: 0, piece: 'kick', vel: 2 })) }]), /超过 64/],
      ['style too long', p => (p.style = 'x'.repeat(41)), /鼓型/],
    ]
    for (const [, mutate, msg] of cases) {
      const p = good()
      mutate(p)
      const r = validatePart(p)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toMatch(msg)
    }
  })

  it('rejects non-objects and too many bars', () => {
    expect(validatePart(null).ok).toBe(false)
    const p = good()
    p.bars = Array.from({ length: 3 }, () => ({ num: 4, den: 4, stepsPerQuarter: 4, hits: [] }))
    const r = validatePart(p, 2)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/最多 2 小节/)
  })
})
