import { barSteps } from '@/songs/drumTypes'
import type { DrumBar, DrumPart, DrumPiece, DrumVelocity } from '@/songs/drumTypes'

/** Width of the sticky piece-name column at the start of each line of bars (px). */
export const DRUM_HEADER_PX = 64
/** Gap after each bar block (px). */
export const DRUM_BLOCK_GAP_PX = 10

/** Ticks per quarter note used by the score (alphaTab's standard resolution). */
const DEFAULT_TPQ = 960

function barTicks(bar: Pick<DrumBar, 'num' | 'den'>, ticksPerQuarter: number): number {
  return (bar.num * 4 * ticksPerQuarter) / bar.den
}

/**
 * Map a playback tick to the bar and step being played.
 * `masterBarStarts[i]` is the tick where bar i starts (ascending). Returns null before the
 * first bar, after the last bar, or when the tick falls outside the bars of the part.
 */
export function cursorFor(
  part: DrumPart,
  tick: number,
  masterBarStarts: number[],
  ticksPerQuarter: number = DEFAULT_TPQ,
): { bar: number; step: number } | null {
  if (!Number.isFinite(tick) || tick < 0) return null
  const count = Math.min(part.bars.length, masterBarStarts.length)
  if (count === 0 || masterBarStarts[0] > tick) return null

  // binary search: the last bar whose start is <= tick
  let lo = 0
  let hi = count - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (masterBarStarts[mid] <= tick) lo = mid
    else hi = mid - 1
  }

  const bar = part.bars[lo]
  const offset = tick - masterBarStarts[lo]
  if (offset >= barTicks(bar, ticksPerQuarter)) return null

  const steps = barSteps(bar)
  const step = Math.min(steps - 1, Math.floor((offset * bar.stepsPerQuarter) / ticksPerQuarter))
  return { bar: lo, step: Math.max(0, step) }
}

/**
 * How many bar blocks fit in a line of `widthPx`, after the piece-name column.
 * Always at least 1: a bar wider than the screen scrolls horizontally instead.
 */
export function barsPerRow(widthPx: number, stepsPerBar: number, cellPx: number): number {
  const blockPx = Math.max(1, stepsPerBar) * cellPx + DRUM_BLOCK_GAP_PX
  const usable = widthPx - DRUM_HEADER_PX
  if (!Number.isFinite(usable) || usable <= 0) return 1
  return Math.max(1, Math.floor(usable / blockPx))
}

const CYMBAL_PIECES: ReadonlySet<DrumPiece> = new Set<DrumPiece>([
  'china',
  'splash',
  'ride',
  'rideBell',
  'hihatClosed',
  'hihatPedal',
])

export type CellLevel = 'accent' | 'normal' | 'ghost'

export interface CellSymbol {
  /** Glyph drawn in the cell. Ghost notes always use the hollow "( )" marker. */
  glyph: string
  level: CellLevel
  /** Cymbals (×, ○, ✱) vs drums (●); used by the legend and for styling. */
  cymbal: boolean
}

/**
 * Symbol for one hit. Drums are ●, cymbals ×, open hi-hat ○, crash ✱; accents are drawn
 * larger by the caller (level 'accent'), ghost notes as a small "( )".
 */
export function cellSymbol(piece: DrumPiece, vel: DrumVelocity): CellSymbol {
  const level: CellLevel = vel === 3 ? 'accent' : vel === 1 ? 'ghost' : 'normal'
  const cymbal = piece === 'crash' || piece === 'hihatOpen' || CYMBAL_PIECES.has(piece)
  let glyph: string
  if (level === 'ghost') glyph = '( )'
  else if (piece === 'crash') glyph = '✱'
  else if (piece === 'hihatOpen') glyph = '○'
  else if (cymbal) glyph = '×'
  else glyph = '●'
  return { glyph, level, cymbal }
}

/**
 * Split bar indices into lines of `perRow` bars (at least 1 per line).
 * Returns indices into `part.bars`, in order.
 */
export function groupBarsIntoRows(part: DrumPart, perRow: number): number[][] {
  const size = Math.max(1, Math.floor(perRow) || 1)
  const rows: number[][] = []
  for (let start = 0; start < part.bars.length; start += size) {
    const row: number[] = []
    for (let i = start; i < Math.min(start + size, part.bars.length); i++) row.push(i)
    rows.push(row)
  }
  return rows
}
