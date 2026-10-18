import { useMemo } from 'react'
import type { FretNote } from './fretboardNotes'

// viewBox geometry (user units). The svg is min-width 640px, so narrow screens scroll instead of shrinking the text.
const VB_W = 880
const VB_H = 122
const NUT_X = 60
const BOARD_END_X = VB_W - 20
const BOARD_W = BOARD_END_X - NUT_X
const TOP = 16
const BOARD_H = 80
const LABEL_X = 24
const FRET_NUM_Y = 114
const MAX_FRETS = 24
const MIN_FRETS = 12
const INLAY_SINGLE = [3, 5, 7, 9, 15, 17, 19, 21]
const INLAY_DOUBLE = [12, 24]
const FRET_NUMBERS = [3, 5, 7, 9, 12, 15, 17, 19, 21, 24]

const INK = { fill: 'var(--sheet-ink)', fontFamily: 'var(--font-mono)' }
const DIM = { fill: 'var(--sheet-dim)', fontFamily: 'var(--font-mono)' }
const PEN = { fill: 'var(--sheet-pen)' }

interface Board {
  rows: number
  rowSpacing: number
  fretCount: number
  /** x of fret line n (0 = nut), n = 0..fretCount */
  xs: number[]
  rowY: (row: number) => number
  strings: { y: number; width: number }[]
  labels: { y: number; text: string }[]
  wires: number[]
  inlays: { x: number; y: number }[]
  fretNumbers: { x: number; text: string }[]
}

function buildBoard(labelList: string[], fretCount: number): Board {
  const rows = Math.max(labelList.length, 1)
  const rowSpacing = rows > 1 ? BOARD_H / (rows - 1) : BOARD_H
  const rowY = (row: number) => TOP + row * rowSpacing
  // Real-guitar spacing: distance from the nut is proportional to 1 - 2^(-n/12), normalised to the board width.
  const norm = 1 - Math.pow(2, -fretCount / 12)
  const xs = Array.from({ length: fretCount + 1 }, (_, n) => NUT_X + (BOARD_W * (1 - Math.pow(2, -n / 12))) / norm)
  const midY = rowY((rows - 1) / 2)

  const inlays: Board['inlays'] = []
  for (let n = 1; n <= fretCount; n++) {
    const x = (xs[n - 1] + xs[n]) / 2
    if (INLAY_SINGLE.includes(n)) inlays.push({ x, y: midY })
    if (INLAY_DOUBLE.includes(n)) {
      inlays.push({ x, y: midY - rowSpacing })
      inlays.push({ x, y: midY + rowSpacing })
    }
  }

  return {
    rows,
    rowSpacing,
    fretCount,
    xs,
    rowY,
    strings: Array.from({ length: rows }, (_, row) => ({
      y: rowY(row),
      // top row thinnest, lowest string thickest
      width: 0.8 + (rows > 1 ? (row / (rows - 1)) * 0.9 : 0),
    })),
    labels: labelList.map((text, row) => ({ y: rowY(row) + 4, text })),
    wires: xs.slice(1),
    inlays,
    fretNumbers: FRET_NUMBERS.filter((n) => n <= fretCount).map((n) => ({
      x: (xs[n - 1] + xs[n]) / 2,
      text: String(n),
    })),
  }
}

/** Accessible Chinese description; string numbers count from the top row (1 = highest string). */
function describeNotes(notes: FretNote[]): string {
  if (notes.length === 0) return '指板：当前没有音'
  const parts = [...notes]
    .sort((a, b) => a.row - b.row || a.fret - b.fret)
    .map((note) => {
      const where = note.fret === 0 ? '空弦' : `${note.fret} 品`
      return `第 ${note.row + 1} 弦 ${where}${note.dead ? '（闷音）' : ''}`
    })
  return `指板：${parts.join('，')}`
}

/** Guitar fretboard strip. Colours come only from the sheet CSS variables (the parent has class `sheet`). */
export function Fretboard({ labels, notes, frets }: { labels: string[]; notes: FretNote[]; frets?: number }) {
  const labelsKey = labels.join('\n')
  const maxLit = notes.reduce((max, note) => (note.dead ? max : Math.max(max, note.fret)), 0)
  const fretCount = Math.min(MAX_FRETS, Math.max(1, Math.round(frets ?? Math.max(MIN_FRETS, maxLit + 2))))

  const board = useMemo(
    () => buildBoard(labelsKey ? labelsKey.split('\n') : [], fretCount),
    [labelsKey, fretCount],
  )

  const radius = Math.min(11, board.rowSpacing * 0.42)
  const visible = notes.filter((note) => note.row >= 0 && note.row < board.rows && note.fret <= board.fretCount)

  return (
    <div className="overflow-x-auto">
      <svg
        role="img"
        aria-label={describeNotes(notes)}
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        width="100%"
        style={{ minWidth: 640, display: 'block' }}
      >
        {board.strings.map((s, i) => (
          <line
            key={`s${i}`}
            x1={NUT_X}
            x2={BOARD_END_X}
            y1={s.y}
            y2={s.y}
            strokeWidth={s.width}
            style={{ stroke: 'var(--sheet-ink)', strokeOpacity: 0.55 }}
          />
        ))}
        {board.wires.map((x, i) => (
          <line
            key={`w${i}`}
            x1={x}
            x2={x}
            y1={board.rowY(0)}
            y2={board.rowY(board.rows - 1)}
            strokeWidth={1}
            style={{ stroke: 'var(--sheet-line)' }}
          />
        ))}
        {/* nut */}
        <line
          x1={NUT_X}
          x2={NUT_X}
          y1={board.rowY(0) - 6}
          y2={board.rowY(board.rows - 1) + 6}
          strokeWidth={4}
          style={{ stroke: 'var(--sheet-ink)' }}
        />
        {board.labels.map((l, i) => (
          <text key={`l${i}`} x={LABEL_X} y={l.y} textAnchor="middle" fontSize={12} style={INK}>
            {l.text}
          </text>
        ))}
        {board.inlays.map((d, i) => (
          <circle key={`i${i}`} cx={d.x} cy={d.y} r={3.5} style={DIM} />
        ))}
        {board.fretNumbers.map((f) => (
          <text key={`n${f.text}`} x={f.x} y={FRET_NUM_Y} textAnchor="middle" fontSize={10} style={DIM}>
            {f.text}
          </text>
        ))}
        {visible.map((note, i) => {
          const y = board.rowY(note.row)
          // open string sits just left of the nut, over the label column
          const cx = note.fret === 0 ? NUT_X - 16 : (board.xs[note.fret - 1] + board.xs[note.fret]) / 2
          if (note.dead) {
            return (
              <text key={`d${i}`} x={cx} y={y + 6} textAnchor="middle" fontSize={radius * 2} style={PEN}>
                ×
              </text>
            )
          }
          if (note.fret === 0) {
            return (
              <circle
                key={`o${i}`}
                cx={cx}
                cy={y}
                r={radius - 1}
                fill="none"
                strokeWidth={2}
                style={{ stroke: 'var(--sheet-pen)' }}
              />
            )
          }
          return (
            <g key={`p${i}`}>
              <circle cx={cx} cy={y} r={radius} style={PEN} />
              <text x={cx} y={y + 3.5} textAnchor="middle" fontSize={10} style={{ fill: 'var(--sheet-bg)', fontFamily: 'var(--font-mono)' }}>
                {note.fret}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
