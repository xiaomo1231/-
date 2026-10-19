import type { dailyStaffNotes, DailyStaffNote } from '@/songs/dailyStaff'

type StaffData = ReturnType<typeof dailyStaffNotes>

const LINES = 5
const LABEL_H = 11
const BOTTOM_PAD = 3
const NOTE_RX = 4.5
const NOTE_RY = 3.4
const TILT = -20

/** Hover / screen-reader text of one note. */
function noteTitle(n: DailyStaffNote, technique: string | undefined): string {
  const tech = technique ? ` · ${technique}` : ''
  if (n.kind === 'missed') return `第 ${n.day} 天 · 没练`
  if (n.kind === 'today') return `今天${tech || ' · 还没练'}`
  const speed = n.bpm !== null ? ` · 练到 ${n.bpm} bpm` : ''
  return `第 ${n.day} 天${tech}${speed}`
}

/**
 * 每日一练 as a small five-line staff: one bar per program week, one note per day.
 * The faster the day got (its height on the tempo ladder), the higher the note.
 */
export function DailyStaff({
  data,
  width = 380,
  height = 36,
  techniqueOf,
}: {
  data: StaffData
  width?: number
  height?: number
  /** The technique name of a day, shown in the note's tooltip. */
  techniqueOf?: (day: number) => string | undefined
}) {
  const { firstWeek, weeks, notes } = data
  const barW = width / weeks
  const slotW = barW / 7
  const top = LABEL_H + 2
  const bottom = height - BOTTOM_PAD
  const staffH = bottom - top
  const gap = staffH / (LINES - 1)
  const rx = Math.min(NOTE_RX, slotW * 0.62)
  const ry = (rx * NOTE_RY) / NOTE_RX
  const doneCount = notes.filter((n) => n.kind === 'done').length
  const label = `第 ${firstWeek}–${firstWeek + weeks - 1} 周，已练 ${doneCount} 天`

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${width} ${height}`}
      width="100%"
      className="block h-auto overflow-visible"
    >
      {Array.from({ length: LINES }, (_, i) => (
        <line
          key={`l${i}`}
          x1={0}
          x2={width}
          y1={top + i * gap}
          y2={top + i * gap}
          stroke="hsl(var(--border))"
          strokeWidth={0.6}
        />
      ))}
      {Array.from({ length: weeks + 1 }, (_, i) => (
        <line
          key={`b${i}`}
          x1={i * barW}
          x2={i * barW}
          y1={top}
          y2={bottom}
          stroke={i === 0 ? 'hsl(var(--foreground))' : 'hsl(var(--muted-foreground))'}
          strokeWidth={i === 0 ? 1.6 : 0.5}
          opacity={i === 0 ? 1 : 0.6}
        />
      ))}
      {Array.from({ length: weeks }, (_, i) => (
        <text
          key={`w${i}`}
          x={i * barW + 1.5}
          y={LABEL_H - 2}
          fontSize={7}
          fontFamily="var(--font-mono, monospace)"
          fill="hsl(var(--muted-foreground))"
        >
          {firstWeek + i}
        </text>
      ))}
      {notes.map((n) => {
        const idx = n.week - firstWeek
        if (idx < 0 || idx >= weeks) return null
        const cx = idx * barW + (n.slot + 0.5) * slotW
        const cy =
          n.kind === 'missed'
            ? bottom
            : n.kind === 'today'
              ? (top + bottom) / 2
              : bottom - n.height * (staffH - 6) - 3
        const tilt = `rotate(${TILT} ${cx} ${cy})`
        const shape =
          n.kind === 'done' ? (
            <ellipse cx={cx} cy={cy} rx={rx} ry={ry} transform={tilt} fill="hsl(var(--primary))" />
          ) : n.kind === 'missed' ? (
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={tilt}
              fill="none"
              stroke="hsl(var(--muted-foreground))"
              strokeWidth={0.8}
            />
          ) : (
            <ellipse
              cx={cx}
              cy={cy}
              rx={rx}
              ry={ry}
              transform={tilt}
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth={1.2}
            />
          )
        return (
          <g key={n.day}>
            {shape}
            <title>{noteTitle(n, techniqueOf?.(n.day))}</title>
          </g>
        )
      })}
    </svg>
  )
}
