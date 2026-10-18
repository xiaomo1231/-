import { memo, useEffect, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react'
import { barSteps, DRUM_PIECES, type DrumBar, type DrumPart, type DrumPiece, type DrumVelocity } from '@/songs/drumTypes'
import { cx } from '../lib/classes'

const CYMBALS = new Set<DrumPiece>([
  'crash', 'china', 'splash', 'ride', 'rideBell', 'hihatOpen', 'hihatClosed', 'hihatPedal',
])
const ZH = new Map(DRUM_PIECES.map((p) => [p.id, p.zh]))
const VEL_ZH: Record<DrumVelocity, string> = { 1: '鬼音', 2: '普通', 3: '重音' }
const HEAD_H = 28
const NAME_W = 80

interface Props {
  part: DrumPart
  pieces: DrumPiece[]
  selection: [number, number] | null
  onSelect(range: [number, number] | null): void
  vel: DrumVelocity
  onToggle(bar: number, step: number, piece: DrumPiece): void
  playhead: { bar: number; step: number } | null
  onPlayBar?(bar: number): void
  /** Called when a pointer drag or a key press that toggled cells ends (one undo step per gesture). */
  onGestureEnd?(): void
}

interface CellPos {
  bar: number
  step: number
  row: number
}

const cellKey = (c: CellPos) => `${c.bar}:${c.step}:${c.row}`

function parseCell(el: HTMLElement): CellPos {
  return { bar: Number(el.dataset.bar), step: Number(el.dataset.step), row: Number(el.dataset.row) }
}

/** Touch targets 34 px on coarse pointers, 26 px on desktop (never below 24). */
function useCellSize(): number {
  const coarse = () =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer: coarse)').matches
      : false
  const [size, setSize] = useState(() => (coarse() ? 34 : 26))
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia('(pointer: coarse)')
    const update = () => setSize(mq.matches ? 34 : 26)
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])
  return size
}

function Mark({ piece, vel }: { piece: DrumPiece; vel: DrumVelocity }) {
  const cymbal = CYMBALS.has(piece)
  const glyph = cymbal ? '×' : vel === 1 ? '○' : '●'
  const size = vel === 3 ? 'text-[18px] font-black' : vel === 2 ? 'text-[13px]' : 'text-[9px] opacity-75'
  return (
    <span aria-hidden className={cx('leading-none', size)}>
      {glyph}
    </span>
  )
}

interface BlockProps {
  bar: DrumBar
  index: number
  pieces: DrumPiece[]
  cell: number
  selected: boolean
  playStep: number
  focusStep: number
  focusRow: number
  showPlay: boolean
}

/** One bar as a column of cells. Memoized: it re-renders only when its own data or state changes. */
const BarBlock = memo(function BarBlock({
  bar,
  index,
  pieces,
  cell,
  selected,
  playStep,
  focusStep,
  focusRow,
  showPlay,
}: BlockProps) {
  const steps = barSteps(bar)
  const hits = useMemo(() => {
    const m = new Map<string, DrumVelocity>()
    for (const h of bar.hits) m.set(`${h.step}:${h.piece}`, h.vel)
    return m
  }, [bar])
  const perBeat = bar.stepsPerQuarter

  return (
    <div
      className={cx('shrink-0 border-r-2 border-border', selected && 'bg-accent/60')}
      style={{ width: steps * cell }}
    >
      <div className="flex items-center justify-between gap-1 pr-0.5" style={{ height: HEAD_H }}>
        <button
          type="button"
          data-bar-head={index}
          aria-pressed={selected}
          aria-label={`第 ${index + 1} 小节`}
          style={{ touchAction: 'pan-x pan-y' }}
          className={cx(
            'mono h-full min-w-0 flex-1 truncate px-1.5 text-left text-[12px] transition-colors',
            selected ? 'font-bold text-primary' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {index + 1}
          <span className="ml-1 text-[10px] opacity-70">
            {bar.num}/{bar.den}
          </span>
        </button>
        {showPlay && (
          <button
            type="button"
            data-bar-play={index}
            aria-label={`播放第 ${index + 1} 小节`}
            className="h-6 w-6 shrink-0 rounded text-[11px] text-muted-foreground hover:text-primary"
          >
            ▶
          </button>
        )}
      </div>
      {pieces.map((piece, row) => (
        <div key={piece} className="flex" style={{ height: cell }}>
          {Array.from({ length: steps }, (_, step) => {
            const vel = hits.get(`${step}:${piece}`)
            const beat = step > 0 && step % perBeat === 0
            const playing = playStep === step
            const focused = focusStep === step && focusRow === row
            return (
              <button
                key={step}
                type="button"
                data-cell=""
                data-bar={index}
                data-step={step}
                data-row={row}
                tabIndex={focused ? 0 : -1}
                aria-pressed={vel !== undefined}
                aria-label={`第 ${index + 1} 小节 第 ${step + 1} 格 ${ZH.get(piece) ?? piece}${vel ? ` ${VEL_ZH[vel]}` : ' 空'}`}
                style={{ width: cell, height: cell, touchAction: 'none' }}
                className={cx(
                  'relative flex shrink-0 items-center justify-center border-b border-border/30 transition-colors hover:bg-primary/10',
                  beat ? 'border-l border-l-foreground/40' : 'border-l border-l-border/40',
                  playing && 'bg-primary/15',
                  vel !== undefined ? 'text-primary' : 'text-transparent',
                )}
              >
                {vel !== undefined && <Mark piece={piece} vel={vel} />}
              </button>
            )
          })}
        </div>
      ))}
    </div>
  )
})

/**
 * Editable step grid of a 鼓谱: bars side by side (scrolls sideways), one row per piece.
 * Clicks and keys toggle cells with the current velocity; a drag paints (or erases,
 * when it starts on a hit). Handlers are delegated to the container so the bar blocks
 * stay memoized.
 */
export function DrumEditorGrid(props: Props) {
  const { part, pieces, selection, onSelect, vel, onToggle, playhead, onPlayBar, onGestureEnd } = props
  const cell = useCellSize()
  const containerRef = useRef<HTMLDivElement>(null)
  const [focus, setFocus] = useState<CellPos>({ bar: 0, step: 0, row: 0 })
  const drag = useRef<{ paint: boolean; seen: Set<string> } | null>(null)

  // Latest callback for the window-level pointerup handler.
  const endRef = useRef(onGestureEnd)
  endRef.current = onGestureEnd
  useEffect(() => {
    const end = () => {
      if (!drag.current) return
      drag.current = null
      endRef.current?.()
    }
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    return () => {
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
    }
  }, [])

  const hasHit = (bar: number, step: number, row: number): boolean => {
    const piece = pieces[row]
    const b = part.bars[bar]
    if (!piece || !b) return false
    return b.hits.some((h) => h.step === step && h.piece === piece)
  }

  /** Makes a cell present (paint) or absent (erase), when it is not already so. */
  const apply = (c: CellPos, paint: boolean) => {
    const piece = pieces[c.row]
    if (!piece || !part.bars[c.bar]) return
    if (hasHit(c.bar, c.step, c.row) === paint) return
    onToggle(c.bar, c.step, piece)
  }

  const cellAt = (x: number, y: number): CellPos | null => {
    const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]')
    return el ? parseCell(el) : null
  }

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!el) return
    const c = parseCell(el)
    const paint = !hasHit(c.bar, c.step, c.row)
    drag.current = { paint, seen: new Set([cellKey(c)]) }
    apply(c, paint)
    setFocus(c)
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      // Capture only helps touch drags; the grid works without it.
    }
  }

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current
    if (!d) return
    const c = cellAt(e.clientX, e.clientY)
    if (!c) return
    const key = cellKey(c)
    if (d.seen.has(key)) return
    d.seen.add(key)
    apply(c, d.paint)
  }

  const pick = (bar: number, extend: boolean) => {
    if (extend && selection) {
      const [a, b] = selection
      onSelect(bar < a ? [bar, b] : [a, bar])
      return
    }
    if (selection && selection[0] === bar && selection[1] === bar) {
      onSelect(null)
      return
    }
    onSelect([bar, bar])
  }

  const onClick = (e: MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement
    const head = target.closest<HTMLElement>('[data-bar-head]')
    if (head) {
      pick(Number(head.dataset.barHead), e.shiftKey)
      return
    }
    const play = target.closest<HTMLElement>('[data-bar-play]')
    if (play) {
      onPlayBar?.(Number(play.dataset.barPlay))
      return
    }
    // Pointer clicks toggle on pointerdown; only keyboard clicks (detail 0) toggle here.
    const el = target.closest<HTMLElement>('[data-cell]')
    if (el && e.detail === 0) {
      const c = parseCell(el)
      const piece = pieces[c.row]
      if (piece) {
        onToggle(c.bar, c.step, piece)
        onGestureEnd?.()
      }
    }
  }

  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (el) setFocus(parseCell(el))
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-cell]')
    if (!el) return
    const c = parseCell(el)
    const here = part.bars[c.bar]
    if (!here) return
    const steps = barSteps(here)
    let next: CellPos = { ...c }
    switch (e.key) {
      case 'ArrowRight':
        if (c.step + 1 < steps) next.step = c.step + 1
        else if (c.bar + 1 < part.bars.length) next = { bar: c.bar + 1, step: 0, row: c.row }
        else return
        break
      case 'ArrowLeft': {
        if (c.step > 0) next.step = c.step - 1
        else if (c.bar > 0) {
          const prev = part.bars[c.bar - 1]
          if (!prev) return
          next = { bar: c.bar - 1, step: barSteps(prev) - 1, row: c.row }
        } else return
        break
      }
      case 'ArrowDown':
        next.row = Math.min(c.row + 1, pieces.length - 1)
        break
      case 'ArrowUp':
        next.row = Math.max(c.row - 1, 0)
        break
      case 'Home':
        next.step = 0
        break
      case 'End':
        next.step = steps - 1
        break
      default:
        return
    }
    e.preventDefault()
    setFocus(next)
    const target = containerRef.current?.querySelector<HTMLElement>(
      `[data-cell][data-bar="${next.bar}"][data-step="${next.step}"][data-row="${next.row}"]`,
    )
    target?.focus()
    target?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  return (
    <div
      ref={containerRef}
      role="group"
      aria-label={`鼓谱网格，当前力度：${VEL_ZH[vel]}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onClick={onClick}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
      className="relative max-w-full overflow-x-auto rounded-lg border border-border bg-card/40"
    >
      <div className="flex w-max min-w-full">
        <div
          className="sticky left-0 z-10 shrink-0 border-r border-border bg-background"
          style={{ width: NAME_W }}
          aria-hidden
        >
          <div style={{ height: HEAD_H }} />
          {pieces.map((p) => (
            <div
              key={p}
              title={ZH.get(p) ?? p}
              className="flex items-center truncate border-b border-border/30 px-2 text-[12px] text-muted-foreground"
              style={{ height: cell }}
            >
              {ZH.get(p) ?? p}
            </div>
          ))}
        </div>
        {part.bars.map((bar, i) => (
          <BarBlock
            key={i}
            bar={bar}
            index={i}
            pieces={pieces}
            cell={cell}
            selected={selection !== null && i >= selection[0] && i <= selection[1]}
            playStep={playhead && playhead.bar === i ? playhead.step : -1}
            focusStep={focus.bar === i ? focus.step : -1}
            focusRow={focus.bar === i ? focus.row : -1}
            showPlay={Boolean(onPlayBar)}
          />
        ))}
      </div>
    </div>
  )
}
