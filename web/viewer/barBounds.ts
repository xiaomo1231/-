import type { BarComment } from '../lib/api'

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

/** Groups comments by 1-based bar: [{ bar, count, latest: BarComment }], sorted by bar. */
export function groupByBar(
  comments: readonly BarComment[],
): Array<{ bar: number; count: number; latest: BarComment }> {
  const byBar = new Map<number, { bar: number; count: number; latest: BarComment }>()
  for (const c of comments) {
    const group = byBar.get(c.bar)
    if (!group) {
      byBar.set(c.bar, { bar: c.bar, count: 1, latest: c })
      continue
    }
    group.count += 1
    if (c.at > group.latest.at) group.latest = c
  }
  return [...byBar.values()].sort((a, b) => a.bar - b.bar)
}

/** Where to draw a badge for a bar box: top-right corner, kept inside `width`. */
export function badgePosition(box: Box, width: number, badgeW = 56): { left: number; top: number } {
  const maxLeft = Math.max(0, width - badgeW)
  const left = Math.min(Math.max(0, box.x + box.w - badgeW), maxLeft)
  return { left, top: Math.max(0, box.y) }
}
