import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { DRUM_PIECES, barSteps } from '@/songs/drumTypes'
import type { DrumBar, DrumPart, DrumPiece } from '@/songs/drumTypes'
import {
  DRUM_BLOCK_GAP_PX,
  DRUM_HEADER_PX,
  barsPerRow,
  cellSymbol,
  groupBarsIntoRows,
} from './drumView'
import type { CellSymbol } from './drumView'

const ROW_H = 20
const LABEL_H = 22
/** Below this container width (px) the cells get smaller so a bar fits a phone screen. */
const PHONE_MAX_W = 480
const CELL_PHONE = 16
const CELL_WIDE = 22

const PIECE_ZH: ReadonlyMap<DrumPiece, string> = new Map(
  DRUM_PIECES.map((p): [DrumPiece, string] => [p.id, p.zh]),
)

interface Props {
  part: DrumPart
  cursor: { bar: number; step: number } | null
  /** Rows to show, in order (top to bottom). */
  pieces: DrumPiece[]
  /** Section name starting at each bar (index = bar index), or null. */
  sections: Array<string | null>
  /** Called with the 0-based bar index when a bar number is clicked. */
  onSeekBar?: (bar: number) => void
  editable?: false
}

export function DrumGrid({ part, cursor, pieces, sections, onSeekBar }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  // measure the container; re-layout on resize
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const update = () => setWidth(el.clientWidth)
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // keep the latest callback without re-rendering every bar block
  const seekRef = useRef(onSeekBar)
  useLayoutEffect(() => {
    seekRef.current = onSeekBar
  }, [onSeekBar])
  const handleSeek = useCallback((bar: number) => seekRef.current?.(bar), [])

  // a string key keeps the row list identity stable when the caller passes a new array
  const pieceKey = pieces.join(',')
  const rows = useMemo(() => (pieceKey ? (pieceKey.split(',') as DrumPiece[]) : []), [pieceKey])

  const cellPx = width > 0 && width < PHONE_MAX_W ? CELL_PHONE : CELL_WIDE
  const maxSteps = useMemo(
    () => part.bars.reduce((m, b) => Math.max(m, barSteps(b)), 1),
    [part.bars],
  )
  const perRow = barsPerRow(width, maxSteps, cellPx)
  const lines = useMemo(() => groupBarsIntoRows(part, perRow), [part, perRow])

  const cursorBar = cursor ? cursor.bar : null

  // scroll the block holding the cursor into view, only when it has left the viewport
  useEffect(() => {
    if (cursorBar === null || !rootRef.current) return
    const el = rootRef.current.querySelector<HTMLElement>(`[data-bar="${cursorBar}"]`)
    if (!el) return
    const r = el.getBoundingClientRect()
    const vh = window.innerHeight || document.documentElement.clientHeight
    const offscreenY = r.top < 0 || r.bottom > vh
    let offscreenX = false
    const line = el.closest<HTMLElement>('[data-drum-line]')
    if (line) {
      const lr = line.getBoundingClientRect()
      offscreenX = r.left < lr.left + DRUM_HEADER_PX || r.right > lr.right
    }
    if (!offscreenY && !offscreenX) return
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' })
  }, [cursorBar])

  if (part.bars.length === 0) {
    return <p className="text-sm text-[color:var(--sheet-dim)]">这份鼓谱还没有小节。</p>
  }

  return (
    <div ref={rootRef} className="w-full text-[color:var(--sheet-ink)]" style={{ fontFamily: 'var(--font-mono)' }}>
      {lines.map((line) => (
        <div
          key={line[0]}
          data-drum-line
          className="flex items-start overflow-x-auto pb-2"
          style={{ scrollbarWidth: 'thin' }}
        >
          <div
            className="sticky left-0 z-10 flex-none"
            style={{ width: DRUM_HEADER_PX, background: 'var(--sheet-bg)' }}
          >
            <div style={{ height: LABEL_H }} />
            {rows.map((p) => (
              <div
                key={p}
                className="flex items-center overflow-hidden pr-1 text-[11px] leading-tight text-[color:var(--sheet-dim)]"
                style={{ height: ROW_H, fontFamily: 'var(--font-sans, inherit)' }}
              >
                {PIECE_ZH.get(p) ?? p}
              </div>
            ))}
          </div>
          {line.map((i) => (
            <BarBlock
              key={i}
              index={i}
              bar={part.bars[i]}
              section={sections[i] ?? null}
              rows={rows}
              cellPx={cellPx}
              cursorStep={cursor && cursor.bar === i ? cursor.step : null}
              onSeek={handleSeek}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

interface BlockProps {
  index: number
  bar: DrumBar
  section: string | null
  rows: DrumPiece[]
  cellPx: number
  cursorStep: number | null
  onSeek: (bar: number) => void
}

const BarBlock = memo(function BarBlock({ index, bar, section, rows, cellPx, cursorStep, onSeek }: BlockProps) {
  const steps = barSteps(bar)
  const quarterPx = cellPx * bar.stepsPerQuarter
  const width = steps * cellPx
  const height = LABEL_H + rows.length * ROW_H

  const hits = useMemo(() => {
    const rowOf = new Map(rows.map((p, r) => [p, r]))
    const out: Array<{ key: string; left: number; top: number; sym: CellSymbol }> = []
    for (const h of bar.hits) {
      const r = rowOf.get(h.piece)
      if (r === undefined) continue
      out.push({
        key: `${h.step}-${h.piece}`,
        left: h.step * cellPx,
        top: LABEL_H + r * ROW_H,
        sym: cellSymbol(h.piece, h.vel),
      })
    }
    return out
  }, [bar, rows, cellPx])

  const barNo = index + 1
  return (
    <div
      role="group"
      aria-label={`第 ${barNo} 小节${section ? `，${section}` : ''}`}
      data-bar={index}
      className="relative flex-none"
      style={{ width, height, marginRight: DRUM_BLOCK_GAP_PX }}
    >
      <div className="flex items-center gap-1 whitespace-nowrap" style={{ height: LABEL_H, fontSize: 11 }}>
        <button
          type="button"
          onClick={() => onSeek(index)}
          aria-label={`跳到第 ${barNo} 小节`}
          className="rounded px-0.5 text-[color:var(--sheet-dim)] underline-offset-2 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[color:var(--sheet-pen)]"
        >
          {barNo}
        </button>
        {section && (
          <span className="truncate font-semibold text-[color:var(--sheet-pen)]" style={{ maxWidth: width - 24 }}>
            {section}
          </span>
        )}
      </div>

      {/* grid lines: thin per step, thick per quarter note; horizontal per piece row */}
      <div
        aria-hidden
        className="absolute left-0 right-0 bottom-0"
        style={{
          top: LABEL_H,
          backgroundImage: [
            `linear-gradient(to bottom, color-mix(in srgb, var(--sheet-line) 60%, transparent) 1px, transparent 1px)`,
            `linear-gradient(to right, var(--sheet-dim) 2px, transparent 2px)`,
            `linear-gradient(to right, color-mix(in srgb, var(--sheet-line) 55%, transparent) 1px, transparent 1px)`,
          ].join(','),
          backgroundSize: `100% ${ROW_H}px, ${quarterPx}px 100%, ${cellPx}px 100%`,
          borderRight: '1px solid color-mix(in srgb, var(--sheet-dim) 60%, transparent)',
        }}
      />

      {cursorStep !== null && (
        <div
          aria-hidden
          className="pointer-events-none absolute bottom-0"
          style={{
            top: LABEL_H,
            left: cursorStep * cellPx,
            width: cellPx,
            background: 'color-mix(in srgb, var(--sheet-pen) 28%, transparent)',
            boxShadow: 'inset 0 0 0 1px var(--sheet-pen)',
          }}
        />
      )}

      {hits.map((h) => (
        <span
          key={h.key}
          aria-hidden
          className="absolute flex items-center justify-center leading-none"
          style={{
            left: h.left,
            top: h.top,
            width: cellPx,
            height: ROW_H,
            fontSize: h.sym.level === 'accent' ? 18 : h.sym.level === 'ghost' ? 10 : 14,
            fontWeight: h.sym.level === 'accent' ? 700 : 400,
            color: h.sym.level === 'ghost' ? 'var(--sheet-dim)' : 'var(--sheet-ink)',
            letterSpacing: h.sym.level === 'ghost' ? '-0.08em' : undefined,
          }}
        >
          {h.sym.glyph}
        </span>
      ))}
    </div>
  )
})

/** Piece names with their symbols and velocity meaning, shown under a grid or tab. */
export function DrumLegend({ pieces }: { pieces?: DrumPiece[] }) {
  const list = pieces ?? DRUM_PIECES.map((p) => p.id)
  return (
    <div className="text-xs text-[color:var(--sheet-dim)]">
      <p className="flex flex-wrap gap-x-4 gap-y-1">
        <span>
          <b className="font-bold text-[color:var(--sheet-ink)]">大号</b> 重音
        </span>
        <span>
          <b className="text-[color:var(--sheet-ink)]">普通</b> 常规力度
        </span>
        <span>
          <span className="text-[color:var(--sheet-ink)]">( )</span> 鬼音（轻）
        </span>
      </p>
      <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
        {list.map((p) => (
          <span key={p} className="whitespace-nowrap">
            <span className="text-[color:var(--sheet-ink)]">{cellSymbol(p, 2).glyph}</span> {PIECE_ZH.get(p) ?? p}
          </span>
        ))}
      </p>
    </div>
  )
}
