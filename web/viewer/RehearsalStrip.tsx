/**
 * The slim sticky status line over the sheet during a rehearsal: song position,
 * section, bar, speed, loop pass and this device's role. Wraps on phones.
 */
import type { ReactNode } from 'react'

export function RehearsalStrip(props: {
  songTitle: string
  /** 1-based position in today's setlist, and its length (0 = not in the setlist). */
  songIndex: number
  songCount: number
  section: string | null
  nextSection: string | null
  bar: number
  bars: number
  speedPct: number
  /** Loop pass info, or null when not looping. */
  loop: { pass: number; passes: number | null; startBar: number; endBar: number } | null
  playing: boolean
  /** e.g. '你是音箱' / '静音看谱' / '耳机出声'. */
  role: string
  /** Optional right-side content (buttons from the parent). */
  children?: ReactNode
}) {
  const { songTitle, songIndex, songCount, section, nextSection, bar, bars, speedPct, loop } = props
  const mono = { fontFamily: 'var(--font-mono)' }

  let loopText: string | null = null
  if (loop) {
    const passText =
      loop.passes === null ? `第 ${loop.pass} 遍（一直循环）` : `第 ${loop.pass}/${loop.passes} 遍`
    loopText = `循环 ${loop.startBar}–${loop.endBar} 小节 · ${passText}`
  }

  return (
    <div
      role="region"
      aria-label="排练状态"
      className="sticky top-0 z-10 mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--background))] px-3 py-1.5 text-sm"
    >
      <span className="flex min-w-0 items-center gap-1.5">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 shrink-0 rounded-full"
          style={{
            background: props.playing ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))',
          }}
        />
        <span className="truncate">
          {songIndex > 0 && (
            <span className="text-[hsl(var(--muted-foreground))]" style={mono}>
              第 {songIndex}/{songCount} 首 ·{' '}
            </span>
          )}
          {songTitle}
        </span>
      </span>

      {section && (
        <span className="flex min-w-0 items-center gap-1.5">
          <b className="font-semibold">{section}</b>
          {nextSection && (
            <span className="text-[hsl(var(--muted-foreground))]">→ 下一段：{nextSection}</span>
          )}
        </span>
      )}

      <span className="text-[hsl(var(--muted-foreground))]" style={mono}>
        第 {bar}/{bars} 小节
      </span>

      <span className="text-[hsl(var(--muted-foreground))]" style={mono}>
        {speedPct}%
      </span>

      {loopText && (
        <span className="text-[hsl(var(--muted-foreground))]" style={mono}>
          {loopText}
        </span>
      )}

      <span className="rounded-full border border-[hsl(var(--primary))] px-2 py-0.5 text-xs text-[hsl(var(--primary))]">
        {props.role}
      </span>

      {props.children && (
        <span className="ml-auto flex flex-wrap items-center gap-2">{props.children}</span>
      )}
    </div>
  )
}
