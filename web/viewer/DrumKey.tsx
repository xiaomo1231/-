import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { DRUM_PIECES, type DrumPiece } from '@/songs/drumTypes'

/**
 * 鼓谱图例: each piece drawn at its standard position on a five-line staff, with its
 * Chinese name underneath, laid out like the key printed in a songbook.
 * Positions count half-spaces from the bottom line: 0 = bottom line, 1 = first space, 8 = top line.
 */

const COL_W = 70
const CLEF_W = 36
const STEP = 4
const BASE_Y = 96
const NAME_Y = 150
const SVG_H = 160
const LINE_HALF_W = 9
const DEFAULT_PER_ROW = 4
const MAX_PER_ROW = 6

type Shape = 'x' | 'head' | 'diamond' | 'circledX' | 'triangle'

interface Glyph {
  shape: Shape
  /** Half-space position: 0 = bottom line, 8 = top line. */
  pos: number
  stem?: 'up' | 'down'
  /** Small hollow ring above an × (open hi-hat). */
  ringAbove?: boolean
  /** Ring around an × (china). */
  ring?: boolean
  /** Small tick marks above an × (tambourine). */
  jingles?: boolean
}

const GLYPH: Record<DrumPiece, Glyph> = {
  crash: { shape: 'x', pos: 10 },
  china: { shape: 'x', pos: 10, ring: true },
  splash: { shape: 'x', pos: 12 },
  ride: { shape: 'x', pos: 8 },
  rideBell: { shape: 'diamond', pos: 8 },
  hihatOpen: { shape: 'x', pos: 9, ringAbove: true },
  hihatClosed: { shape: 'x', pos: 9 },
  hihatPedal: { shape: 'x', pos: -1 },
  tomHigh: { shape: 'head', pos: 7, stem: 'up' },
  tomMid: { shape: 'head', pos: 6, stem: 'up' },
  snare: { shape: 'head', pos: 5, stem: 'up' },
  sideStick: { shape: 'circledX', pos: 5 },
  tomFloor: { shape: 'head', pos: 3, stem: 'up' },
  kick: { shape: 'head', pos: 1, stem: 'down' },
  cowbell: { shape: 'triangle', pos: 9 },
  tambourine: { shape: 'x', pos: 7, jingles: true },
  clap: { shape: 'x', pos: 7 },
}

const ZH = new Map(DRUM_PIECES.map((p) => [p.id, p.zh]))

const yOf = (pos: number) => BASE_Y - pos * STEP
const STAFF_LINES = [0, 2, 4, 6, 8]

/** Ledger lines a glyph needs above the top line (positions 10, 12, …) or below the bottom line. */
function ledgers(pos: number): number[] {
  const out: number[] = []
  if (pos > 8) for (let p = 10; p <= pos; p += 2) out.push(p)
  if (pos < 0) for (let p = -2; p >= pos; p -= 2) out.push(p)
  return out
}

function GlyphMark({ id }: { id: DrumPiece }) {
  const g = GLYPH[id]
  const cy = yOf(g.pos)
  const r = 4
  const stroke = { stroke: 'currentColor', strokeWidth: 1.4, fill: 'none' } as const
  let shape: ReactNode
  switch (g.shape) {
    case 'x':
      shape = (
        <g {...stroke}>
          <path d={`M${-r} ${cy - r} L${r} ${cy + r} M${r} ${cy - r} L${-r} ${cy + r}`} />
          {g.ring && <circle cx={0} cy={cy} r={r + 2.5} />}
          {g.ringAbove && <circle cx={0} cy={cy - 8} r={2.4} />}
          {g.jingles && <path d={`M-6 ${cy - 8} L-6 ${cy - 5} M6 ${cy - 8} L6 ${cy - 5}`} />}
        </g>
      )
      break
    case 'circledX':
      shape = (
        <g {...stroke}>
          <circle cx={0} cy={cy} r={r + 2.5} />
          <path d={`M${-r + 1} ${cy - r + 1} L${r - 1} ${cy + r - 1} M${r - 1} ${cy - r + 1} L${-r + 1} ${cy + r - 1}`} />
        </g>
      )
      break
    case 'head':
      shape = (
        <g>
          <ellipse cx={0} cy={cy} rx={4.6} ry={3.4} fill="currentColor" transform={`rotate(-20 0 ${cy})`} />
          {g.stem === 'up' && <line x1={4} y1={cy} x2={4} y2={cy - 14} stroke="currentColor" strokeWidth={1.2} />}
          {g.stem === 'down' && <line x1={-4} y1={cy} x2={-4} y2={cy + 14} stroke="currentColor" strokeWidth={1.2} />}
        </g>
      )
      break
    case 'diamond':
      shape = <path d={`M0 ${cy - 5} L5 ${cy} L0 ${cy + 5} L-5 ${cy} Z`} fill="currentColor" />
      break
    case 'triangle':
      shape = <path d={`M0 ${cy - 5} L5 ${cy + 4} L-5 ${cy + 4} Z`} {...stroke} />
      break
  }
  return (
    <g>
      {ledgers(g.pos).map((p) => (
        <line
          key={p}
          x1={-LINE_HALF_W}
          x2={LINE_HALF_W}
          y1={yOf(p)}
          y2={yOf(p)}
          style={{ stroke: 'var(--sheet-line)' }}
          strokeWidth={1}
        />
      ))}
      {shape}
    </g>
  )
}

/** One staff with its clef-like double bar, drawn for one row of pieces. */
function KeyStaff({ pieces }: { pieces: DrumPiece[] }) {
  const width = CLEF_W + pieces.length * COL_W
  const label = pieces.map((p) => ZH.get(p) ?? p).join('、')
  return (
    <svg
      role="img"
      aria-label={`鼓谱图例：${label}`}
      width={width}
      height={SVG_H}
      viewBox={`0 0 ${width} ${SVG_H}`}
      className="block max-w-none text-[color:var(--sheet-ink)]"
    >
      {STAFF_LINES.map((p) => (
        <line
          key={p}
          x1={CLEF_W - 4}
          x2={width}
          y1={yOf(p)}
          y2={yOf(p)}
          style={{ stroke: 'var(--sheet-line)' }}
          strokeWidth={1}
        />
      ))}
      {/* percussion clef-like double bar at the left */}
      <line x1={CLEF_W - 12} x2={CLEF_W - 12} y1={yOf(8)} y2={yOf(0)} style={{ stroke: 'var(--sheet-ink)' }} strokeWidth={1} />
      <line x1={CLEF_W - 8} x2={CLEF_W - 8} y1={yOf(8)} y2={yOf(0)} style={{ stroke: 'var(--sheet-ink)' }} strokeWidth={3} />
      {pieces.map((id, i) => {
        const cx = CLEF_W + i * COL_W + COL_W / 2
        return (
          <g key={id} transform={`translate(${cx} 0)`}>
            <GlyphMark id={id} />
            <text x={0} y={NAME_Y} textAnchor="middle" fontSize={11} fill="currentColor">
              {ZH.get(id) ?? id}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

export function DrumKey({ pieces }: { pieces: DrumPiece[] }) {
  const boxRef = useRef<HTMLDivElement>(null)
  const [perRow, setPerRow] = useState(DEFAULT_PER_ROW)

  // Columns per row follow the container width, so each row fits a 375 px phone screen.
  useLayoutEffect(() => {
    const el = boxRef.current
    if (!el) return
    const update = () => {
      const n = Math.floor((el.clientWidth - CLEF_W) / COL_W)
      setPerRow(Math.max(1, Math.min(MAX_PER_ROW, n)))
    }
    update()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update)
      return () => window.removeEventListener('resize', update)
    }
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const rows: DrumPiece[][] = []
  for (let i = 0; i < pieces.length; i += perRow) rows.push(pieces.slice(i, i + perRow))

  return (
    <div ref={boxRef} className="text-[color:var(--sheet-ink)]">
      {rows.length === 0 && <p className="text-sm text-[color:var(--sheet-dim)]">这份鼓谱还没有乐器。</p>}
      <div className="flex flex-col gap-2 overflow-x-auto">
        {rows.map((row, i) => (
          <KeyStaff key={i} pieces={row} />
        ))}
      </div>
      <p className="mt-3 text-xs leading-relaxed text-[color:var(--sheet-dim)]">
        「&gt;」重音 「( )」鬼音 「%」重复上一小节
      </p>
    </div>
  )
}
