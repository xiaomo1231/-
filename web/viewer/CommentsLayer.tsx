/**
 * 小节留言 badges drawn over the sheet. Positions come from alphaTab's bounds
 * lookup and are recomputed when the render version, comments or window size change.
 */
import { useEffect, useMemo, useState } from 'react'
import type { AlphaTabApi } from '@coderline/alphatab'
import type { BarComment } from '../lib/api'
import { badgePosition, groupByBar } from './barBounds'

const BADGE_W = 56

export function CommentsLayer(props: {
  api: AlphaTabApi | null
  /** The element alphaTab renders into (the .at-surface div). Badges are positioned relative to its offset parent. */
  surface: HTMLElement | null
  comments: BarComment[]
  /** Bumped by the parent after each alphaTab render, so positions are recomputed. */
  renderVersion: number
  onOpen: (bar: number) => void
}) {
  const { api, surface, comments, renderVersion, onOpen } = props
  const [resizeTick, setResizeTick] = useState(0)

  useEffect(() => {
    const onResize = () => setResizeTick((n) => n + 1)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  // renderVersion and resizeTick are triggers only: alphaTab re-lays out the sheet and
  // the window resizes without changing the other inputs, so the bounds must be re-read.
  const badges = useMemo(() => {
    const out: Array<{ bar: number; count: number; left: number; top: number }> = []
    if (!api || !surface || comments.length === 0) return out
    const lookup = api.renderer.boundsLookup
    if (!lookup) return out
    const width = surface.clientWidth
    for (const group of groupByBar(comments)) {
      const visual = lookup.findMasterBarByIndex(group.bar - 1)?.visualBounds
      if (!visual) continue
      const pos = badgePosition(
        { x: visual.x, y: visual.y, w: visual.w, h: visual.h },
        width || visual.x + visual.w,
        BADGE_W,
      )
      out.push({
        bar: group.bar,
        count: group.count,
        left: surface.offsetLeft + pos.left,
        top: surface.offsetTop + pos.top,
      })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps -- triggers, see above
  }, [api, surface, comments, renderVersion, resizeTick])

  if (badges.length === 0) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-[5]">
      {badges.map((b) => (
        <button
          key={b.bar}
          type="button"
          aria-label={`第 ${b.bar} 小节有 ${b.count} 条留言`}
          onClick={() => onOpen(b.bar)}
          className="pointer-events-auto absolute rounded-full border px-2 py-0.5 text-xs leading-none shadow-sm"
          style={{
            left: b.left,
            top: b.top,
            width: BADGE_W,
            borderColor: 'var(--sheet-pen)',
            background: 'var(--sheet-bg)',
            color: 'var(--sheet-pen)',
            fontFamily: 'var(--font-mono)',
          }}
        >
          留言 {b.count}
        </button>
      ))}
    </div>
  )
}
