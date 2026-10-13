import { useMemo } from 'react'
import { layoutJianpu } from '@/music/jianpu'
import type { Event } from '@/music/score'
import { spell, spelledName } from '@/music/spelling'
import { cn } from '@/shared/lib/utils'

export interface JianpuViewProps {
  events: readonly Event[]
  bars: number
  signatureTonic: number
  chords?: ReadonlyArray<{ start: number; text: string }>
  activeEvent?: number | null
  marks?: Record<number, 'ok' | 'bad' | 'warn'>
  className?: string
}

const LINE_H = 118
const TOP = 34

/** Numbered notation (简谱) rendered as SVG from the shared score events. */
export function JianpuView({ events, bars, signatureTonic, chords = [], activeEvent = null, marks, className }: JianpuViewProps) {
  const lines = useMemo(() => layoutJianpu(events, signatureTonic, bars, chords), [events, signatureTonic, bars, chords])
  const width = 16 + 4 * 4 * 46 + 16
  const keyName = spelledName(spell(signatureTonic, { keyTonic: signatureTonic }))

  return (
    <div className={cn('overflow-x-auto', className)}>
      <svg viewBox={`0 0 ${width} ${lines.length * LINE_H + 24}`} className="w-full" role="img" aria-label="简谱">
        <text x={16} y={18} className="fill-[hsl(var(--foreground))] font-display text-[14px] font-semibold">
          1={keyName.replace('#', '♯').replace(/b$/, '♭')}
          <tspan dx={14}>4/4</tspan>
        </text>
        {lines.map((line, li) => {
          const y0 = 24 + li * LINE_H
          const base = y0 + TOP + 24
          return (
            <g key={li}>
              {line.chords.map((c, i) => (
                <text key={`c${i}`} x={c.x} y={y0 + 18} className="fill-[hsl(var(--cyan))] font-display text-[13px] font-semibold">
                  {c.text}
                </text>
              ))}
              {line.barLines.map((x, i) => {
                const isEnd = li === lines.length - 1 && i === line.barLines.length - 1
                return (
                  <g key={`b${i}`} className="stroke-[hsl(var(--foreground)/0.7)]">
                    <line x1={x} x2={x} y1={base - 26} y2={base + 8} strokeWidth={1.4} />
                    {isEnd && <line x1={x + 4} x2={x + 4} y1={base - 26} y2={base + 8} strokeWidth={3.5} />}
                  </g>
                )
              })}
              {line.beams.map((b, i) => (
                <line key={`u${i}`} x1={b.x1} x2={b.x2} y1={base + 6 + (b.level - 1) * 5} y2={base + 6 + (b.level - 1) * 5} className="stroke-[hsl(var(--foreground))]" strokeWidth={1.4} />
              ))}
              {line.tokens.map((t, i) => {
                const mark = t.event === activeEvent ? 'active' : marks?.[t.event]
                const color =
                  mark === 'active'
                    ? 'fill-[hsl(var(--amber))]'
                    : mark === 'ok'
                      ? 'fill-[hsl(var(--success))]'
                      : mark === 'bad'
                        ? 'fill-[hsl(var(--destructive))]'
                        : mark === 'warn'
                          ? 'fill-[hsl(var(--amber))]'
                          : t.kind === 'rest'
                            ? 'fill-[hsl(var(--muted-foreground))]'
                            : 'fill-[hsl(var(--foreground))]'
                // Octave dots sit below the underlines for low notes.
                const lowDotY = base + 10 + t.lines * 5
                return (
                  <g key={i}>
                    {t.accidental && (
                      <text x={t.x - 11} y={base - 8} textAnchor="middle" className={cn('font-mono text-[11px]', color)}>
                        {t.accidental === '#' ? '♯' : '♭'}
                      </text>
                    )}
                    <text x={t.x} y={base} textAnchor="middle" className={cn('font-mono text-[20px] font-medium', color)}>
                      {t.digit}
                    </text>
                    {t.dotted && <circle cx={t.x + 11} cy={base - 6} r={2} className={color} />}
                    {Array.from({ length: Math.max(0, t.octave) }, (_, k) => (
                      <circle key={`a${k}`} cx={t.x} cy={base - 22 - k * 6} r={2.2} className={color} />
                    ))}
                    {Array.from({ length: Math.max(0, -t.octave) }, (_, k) => (
                      <circle key={`d${k}`} cx={t.x} cy={lowDotY + k * 6} r={2.2} className={color} />
                    ))}
                    {t.lyric && (
                      <text x={t.x} y={base + 40} textAnchor="middle" className="fill-[hsl(var(--muted-foreground))] text-[13px]">
                        {t.lyric}
                      </text>
                    )}
                  </g>
                )
              })}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
