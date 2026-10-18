/**
 * 鼓谱编辑 (pure): operations on a DrumPart's bars, undo/redo history, the text
 * drum tab, pattern statistics and server-side validation. Every function returns
 * new objects and never mutates its inputs (unchanged bars may be shared).
 */
import {
  DRUM_PIECES,
  barSteps,
  type DrumBar,
  type DrumHit,
  type DrumPart,
  type DrumPiece,
  type DrumSource,
  type DrumVelocity,
} from './drumTypes'

type Grid = DrumBar['stepsPerQuarter']

const PIECE_RANK = new Map<DrumPiece, number>(DRUM_PIECES.map((p, i) => [p.id, i]))
const ABBR = new Map<DrumPiece, string>(DRUM_PIECES.map(p => [p.id, p.abbr]))
const HISTORY_LIMIT = 100
const MAX_PATTERNS = 10
/** Cymbals and closed / pedal hi-hat: a normal hit is 'x' in the text tab. */
const CYMBALS = new Set<DrumPiece>(['crash', 'china', 'splash', 'ride', 'rideBell', 'hihatClosed', 'hihatPedal'])
/** Rows always shown in the text tab, even without a hit in that line. */
const TAB_ALWAYS = new Set<DrumPiece>(['hihatClosed', 'snare', 'kick'])
/** Pieces counted as "tom / snare" when telling a fill from a groove. */
const FILL_PIECES = new Set<DrumPiece>(['snare', 'tomHigh', 'tomMid', 'tomFloor'])
const SOURCES: readonly DrumSource[] = ['file', 'template', 'drumify', 'hand']
const DENOMINATORS: readonly number[] = [1, 2, 4, 8, 16, 32]
const GRIDS: readonly number[] = [3, 4, 6]
const LEGEND = '图例：X 重音　x 镲片普通击打　o 鼓类或开镲普通击打　g 鬼音　- 无击打'

function rank(piece: DrumPiece): number {
  return PIECE_RANK.get(piece) ?? Number.MAX_SAFE_INTEGER
}

function copyBar(bar: DrumBar): DrumBar {
  return {
    num: bar.num,
    den: bar.den,
    stepsPerQuarter: bar.stepsPerQuarter,
    hits: bar.hits.map(h => ({ step: h.step, piece: h.piece, vel: h.vel })),
  }
}

// ---------------------------------------------------------------------------
// bar edits
// ---------------------------------------------------------------------------

export function emptyBar(num: number, den: number, stepsPerQuarter: Grid = 4): DrumBar {
  return { num, den, stepsPerQuarter, hits: [] }
}

/**
 * Sort by step then piece order; drop steps outside the bar, unknown pieces and
 * invalid velocities; keep only the louder hit when a (step, piece) repeats.
 */
export function normalizeBar(bar: DrumBar): DrumBar {
  const steps = barSteps(bar)
  const best = new Map<string, DrumHit>()
  for (const h of bar.hits) {
    if (!PIECE_RANK.has(h.piece)) continue
    if (!Number.isInteger(h.step) || h.step < 0 || h.step >= steps) continue
    if (h.vel !== 1 && h.vel !== 2 && h.vel !== 3) continue
    const key = `${h.step}:${h.piece}`
    const prev = best.get(key)
    if (!prev || h.vel > prev.vel) best.set(key, { step: h.step, piece: h.piece, vel: h.vel })
  }
  const hits = [...best.values()].sort((a, b) => a.step - b.step || rank(a.piece) - rank(b.piece))
  return { num: bar.num, den: bar.den, stepsPerQuarter: bar.stepsPerQuarter, hits }
}

export function getHit(bar: DrumBar, step: number, piece: DrumPiece): DrumHit | undefined {
  return bar.hits.find(h => h.step === step && h.piece === piece)
}

/** Set the velocity of one hit; `0` removes it. */
export function setHit(bar: DrumBar, step: number, piece: DrumPiece, vel: DrumVelocity | 0): DrumBar {
  const rest = bar.hits.filter(h => !(h.step === step && h.piece === piece))
  if (vel !== 0) rest.push({ step, piece, vel })
  return normalizeBar({ ...bar, hits: rest })
}

/** Absent → add with `vel`; present with the same velocity → remove; otherwise → set `vel`. */
export function toggleHit(bar: DrumBar, step: number, piece: DrumPiece, vel: DrumVelocity = 2): DrumBar {
  const current = getHit(bar, step, piece)
  if (current && current.vel === vel) return setHit(bar, step, piece, 0)
  return setHit(bar, step, piece, vel)
}

/** Re-quantize hits to the nearest step of a new grid; collisions keep the louder hit. */
export function changeResolution(bar: DrumBar, stepsPerQuarter: Grid): DrumBar {
  const src = normalizeBar(bar)
  const steps = barSteps({ num: src.num, den: src.den, stepsPerQuarter })
  const hits = src.hits.map(h => {
    const quarters = h.step / src.stepsPerQuarter
    const step = Math.min(steps - 1, Math.max(0, Math.round(quarters * stepsPerQuarter)))
    return { step, piece: h.piece, vel: h.vel }
  })
  return normalizeBar({ num: src.num, den: src.den, stepsPerQuarter, hits })
}

/**
 * Put a source bar onto a target bar's time signature: the same meter and grid
 * are copied; otherwise hits are re-gridded to the target's stepsPerQuarter and
 * the ones past the target's last step are dropped.
 */
function fitTo(src: DrumBar, target: DrumBar): DrumBar {
  if (src.num === target.num && src.den === target.den && src.stepsPerQuarter === target.stepsPerQuarter) {
    return normalizeBar(src)
  }
  const regridded = changeResolution(src, target.stepsPerQuarter)
  return normalizeBar({
    num: target.num,
    den: target.den,
    stepsPerQuarter: target.stepsPerQuarter,
    hits: regridded.hits,
  })
}

// ---------------------------------------------------------------------------
// bar-range operations (first / last / until are 0-based, inclusive)
// ---------------------------------------------------------------------------

export function copyBars(part: DrumPart, first: number, last: number): DrumBar[] {
  const lo = Math.max(0, first)
  const hi = Math.min(part.bars.length - 1, last)
  if (hi < lo) return []
  return part.bars.slice(lo, hi + 1).map(copyBar)
}

/** Overwrite bars at..at+n-1 (clipped to the part); converts across time signatures. */
export function pasteBars(part: DrumPart, at: number, bars: readonly DrumBar[]): DrumPart {
  const out = part.bars.slice()
  bars.forEach((src, i) => {
    const idx = at + i
    const target = out[idx]
    if (idx < 0 || !target) return
    out[idx] = fitTo(src, target)
  })
  return { ...part, bars: out }
}

/** Fill the bars after `last` up to `until` with copies of first..last, cyclically. */
export function repeatBars(part: DrumPart, first: number, last: number, until: number): DrumPart {
  const len = part.bars.length
  const lo = Math.max(0, first)
  const hi = Math.min(len - 1, last)
  const end = Math.min(len - 1, until)
  if (hi < lo || end <= hi) return { ...part, bars: part.bars.slice() }
  const pattern = part.bars.slice(lo, hi + 1)
  const seq: DrumBar[] = []
  for (let r = 0; hi + 1 + r <= end; r++) {
    const src = pattern[r % pattern.length]
    if (src) seq.push(src)
  }
  return pasteBars(part, hi + 1, seq)
}

export function clearBars(part: DrumPart, first: number, last: number): DrumPart {
  const lo = Math.max(0, first)
  const hi = Math.min(part.bars.length - 1, last)
  const bars = part.bars.map((b, i) => (i >= lo && i <= hi ? emptyBar(b.num, b.den, b.stepsPerQuarter) : b))
  return { ...part, bars }
}

/** Overwrite bars from `first` with the given bars as they are (used to merge generated bars). */
export function replaceRange(part: DrumPart, first: number, bars: readonly DrumBar[]): DrumPart {
  const out = part.bars.slice()
  bars.forEach((b, i) => {
    const idx = first + i
    if (idx >= 0 && idx < out.length) out[idx] = normalizeBar(b)
  })
  return { ...part, bars: out }
}

// ---------------------------------------------------------------------------
// undo / redo (immutable, capped at 100 steps)
// ---------------------------------------------------------------------------

export interface DrumHistory {
  readonly past: readonly DrumPart[]
  readonly present: DrumPart
  readonly future: readonly DrumPart[]
}

export function createHistory(part: DrumPart): DrumHistory {
  return { past: [], present: part, future: [] }
}

export function push(history: DrumHistory, part: DrumPart): DrumHistory {
  const past = [...history.past, history.present].slice(-HISTORY_LIMIT)
  return { past, present: part, future: [] }
}

export function undo(history: DrumHistory): DrumHistory {
  const prev = history.past[history.past.length - 1]
  if (!prev) return history
  return {
    past: history.past.slice(0, -1),
    present: prev,
    future: [history.present, ...history.future],
  }
}

export function redo(history: DrumHistory): DrumHistory {
  const next = history.future[0]
  if (!next) return history
  return {
    past: [...history.past, history.present].slice(-HISTORY_LIMIT),
    present: next,
    future: history.future.slice(1),
  }
}

export function current(history: DrumHistory): DrumPart {
  return history.present
}

// ---------------------------------------------------------------------------
// which rows to show
// ---------------------------------------------------------------------------

/** Pieces used by any hit, in DRUM_PIECES order. */
export function usedPieces(part: DrumPart): DrumPiece[] {
  const used = new Set<DrumPiece>()
  for (const bar of part.bars) for (const h of bar.hits) used.add(h.piece)
  return DRUM_PIECES.filter(p => used.has(p.id)).map(p => p.id)
}

/** Common pieces plus the pieces the part uses, in DRUM_PIECES order. */
export function visiblePieces(part: DrumPart): DrumPiece[] {
  const used = new Set(usedPieces(part))
  return DRUM_PIECES.filter(p => p.common || used.has(p.id)).map(p => p.id)
}

// ---------------------------------------------------------------------------
// text drum tab
// ---------------------------------------------------------------------------

function symbolOf(h: DrumHit): string {
  if (h.vel === 3) return 'X'
  if (h.vel === 1) return 'g'
  return CYMBALS.has(h.piece) ? 'x' : 'o'
}

function tabCells(bar: DrumBar, piece: DrumPiece): string {
  const steps = barSteps(bar)
  const chars = Array.from({ length: steps }, () => '-')
  for (const h of bar.hits) {
    if (h.piece === piece && h.step < steps) chars[h.step] = symbolOf(h)
  }
  return chars.join('')
}

/**
 * ASCII drum tab, `barsPerLine` bars per block. Each block starts with
 * "第 N 小节" (1-based number of its first bar) and shows only the rows that have
 * a hit in that block, plus HH / SD / BD. A legend closes the tab.
 */
export function toDrumTab(part: DrumPart, opts: { barsPerLine: number; pieces?: DrumPiece[] }): string {
  if (part.bars.length === 0) return ''
  const perLine = Math.max(1, Math.floor(opts.barsPerLine) || 1)
  const wanted = opts.pieces
  const candidates = wanted ? DRUM_PIECES.map(p => p.id).filter(id => wanted.includes(id)) : visiblePieces(part)
  const blocks: string[] = []
  for (let start = 0; start < part.bars.length; start += perLine) {
    const group = part.bars.slice(start, start + perLine)
    const present = new Set<DrumPiece>()
    for (const bar of group) for (const h of bar.hits) present.add(h.piece)
    const rows = candidates.filter(p => present.has(p) || TAB_ALWAYS.has(p))
    const lines = [`第 ${start + 1} 小节`]
    for (const piece of rows) {
      const cells = group.map(bar => `${tabCells(bar, piece)}|`).join('')
      lines.push(`${ABBR.get(piece) ?? '??'} |${cells}`)
    }
    blocks.push(lines.join('\n'))
  }
  return `${blocks.join('\n\n')}\n\n${LEGEND}`
}

// ---------------------------------------------------------------------------
// statistics
// ---------------------------------------------------------------------------

export interface PatternStat {
  /** 0-based indices of the bars with this pattern. */
  bars: number[]
  count: number
  label: string
}

function signature(bar: DrumBar): string {
  const n = normalizeBar(bar)
  const hits = n.hits.map(h => `${h.step}.${h.piece}.${h.vel}`).join(',')
  return `${n.num}/${n.den}@${n.stepsPerQuarter}:${hits}`
}

/**
 * Identical non-empty bars (same meter, grid and hits) that occur at least twice,
 * most common first (at most 10). A pattern that falls mostly into one section is
 * labelled with that section's name; otherwise "常用节奏型 N".
 * `sections[i]` is the section name active at bar i (null when none).
 */
export function patternStats(part: DrumPart, sections: Array<string | null>): PatternStat[] {
  const groups = new Map<string, number[]>()
  part.bars.forEach((bar, i) => {
    if (bar.hits.length === 0) return
    const key = signature(bar)
    const list = groups.get(key)
    if (list) list.push(i)
    else groups.set(key, [i])
  })
  const found = [...groups.values()]
    .filter(g => g.length >= 2)
    .sort((a, b) => b.length - a.length || (a[0] ?? 0) - (b[0] ?? 0))
    .slice(0, MAX_PATTERNS)
  return found.map((bars, k) => {
    const counts = new Map<string, number>()
    for (const i of bars) {
      const name = sections[i] ?? null
      if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
    }
    let top: string | null = null
    let topCount = 0
    for (const [name, c] of counts) {
      if (c > topCount) {
        top = name
        topCount = c
      }
    }
    if (top !== null && topCount * 2 > bars.length) {
      return { bars, count: bars.length, label: `${top}常用节奏（${bars.length} 次）` }
    }
    return { bars, count: bars.length, label: `常用节奏型 ${k + 1}` }
  })
}

/**
 * Heuristic: a bar is a fill when it has more tom / snare hits than the groove
 * (average over the groove bars when a list of bars is given).
 */
export function isFillLike(bar: DrumBar, groove: DrumBar | readonly DrumBar[]): boolean {
  const count = (b: DrumBar) => b.hits.filter(h => FILL_PIECES.has(h.piece)).length
  const list: readonly DrumBar[] = 'hits' in groove ? [groove] : groove
  if (list.length === 0) return false
  const average = list.reduce((t, b) => t + count(b), 0) / list.length
  return count(bar) > average
}

// ---------------------------------------------------------------------------
// validation (server side)
// ---------------------------------------------------------------------------

export type PartCheck = { ok: true; value: DrumPart } | { ok: false; error: string }

class PartError extends Error {}

function fail(message: string): never {
  throw new PartError(message)
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function textField(v: unknown, label: string, max = 300): string {
  if (typeof v !== 'string') fail(`${label}必须是文字`)
  if (v.length > max) fail(`${label}不能超过 ${max} 个字符`)
  return v
}

function intField(v: unknown, label: string, min: number, max: number): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    fail(`${label}必须是 ${min}–${max} 之间的整数`)
  }
  return v
}

function checkHit(h: unknown, steps: number, label: string): DrumHit {
  if (!isRecord(h)) fail(`${label}的击打格式不对`)
  const step = intField(h.step, `${label}击打位置`, 0, steps - 1)
  const piece = h.piece
  if (typeof piece !== 'string' || !PIECE_RANK.has(piece as DrumPiece)) {
    fail(`${label}含未知鼓件：${String(piece)}`)
  }
  const vel = intField(h.vel, `${label}力度`, 1, 3)
  return { step, piece: piece as DrumPiece, vel: vel as DrumVelocity }
}

function checkBar(b: unknown, index: number): DrumBar {
  const label = `第 ${index + 1} 小节`
  if (!isRecord(b)) fail(`${label}格式不对`)
  const num = intField(b.num, `${label}拍子分子`, 1, 32)
  const den = b.den
  if (typeof den !== 'number' || !DENOMINATORS.includes(den)) fail(`${label}拍子分母只能是 1/2/4/8/16/32`)
  const grid = b.stepsPerQuarter
  if (typeof grid !== 'number' || !GRIDS.includes(grid)) fail(`${label}的网格只能是 3、4 或 6`)
  const rawHits = b.hits
  if (!Array.isArray(rawHits)) fail(`${label}的击打必须是数组`)
  if (rawHits.length > 64) fail(`${label}的击打超过 64 个`)
  const steps = barSteps({ num, den, stepsPerQuarter: grid as Grid })
  const hits = rawHits.map((h: unknown) => checkHit(h, steps, label))
  return normalizeBar({ num, den, stepsPerQuarter: grid as Grid, hits })
}

/**
 * Strictly check an untrusted drum part (e.g. a request body). On success returns a
 * normalized copy (duplicate hits merged, hits sorted).
 */
export function validatePart(raw: unknown, maxBars = 2000): PartCheck {
  try {
    if (!isRecord(raw)) fail('鼓谱数据格式不对')
    if (raw.version !== 1) fail('鼓谱版本号必须是 1')
    const path = textField(raw.path, '谱子路径')
    if (path === '') fail('谱子路径不能为空')
    const title = textField(raw.title, '标题')
    const artist = textField(raw.artist, '艺人')
    const source = raw.source
    if (typeof source !== 'string' || !SOURCES.includes(source as DrumSource)) fail('鼓谱来源不对')
    const edited = raw.edited
    if (typeof edited !== 'boolean') fail('编辑标记必须是 true 或 false')
    const rawStyle = raw.style
    const style = rawStyle === null ? null : textField(rawStyle, '鼓型', 40)
    const updatedAt = raw.updatedAt
    if (typeof updatedAt !== 'number' || !Number.isFinite(updatedAt) || updatedAt < 0) fail('保存时间不对')
    const updatedBy = textField(raw.updatedBy, '保存者')
    const rawBars = raw.bars
    if (!Array.isArray(rawBars)) fail('小节列表必须是数组')
    if (rawBars.length === 0) fail('鼓谱至少要有一小节')
    if (rawBars.length > maxBars) fail(`鼓谱最多 ${maxBars} 小节`)
    const bars = rawBars.map((b: unknown, i: number) => checkBar(b, i))
    return {
      ok: true,
      value: {
        version: 1,
        path,
        title,
        artist,
        bars,
        source: source as DrumSource,
        edited,
        style,
        updatedAt,
        updatedBy,
      },
    }
  } catch (e) {
    if (e instanceof PartError) return { ok: false, error: e.message }
    throw e
  }
}
