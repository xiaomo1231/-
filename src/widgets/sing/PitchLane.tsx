import { useEffect, useRef } from 'react'
import type { PitchCurve, RefNote, SungSample } from '@/songs/singAlong'
import { foldToRef } from './laneUtils'

/** A CSS colour (theme variables allowed) resolved to rgb() for canvas. */
function resolve(value: string): string {
  const el = document.createElement('span')
  el.style.color = value
  el.style.display = 'none'
  document.body.appendChild(el)
  const c = getComputedStyle(el).color
  el.remove()
  return c
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']

export interface PitchLaneProps {
  curve: PitchCurve
  notes: readonly RefNote[]
  /** Where the recording is now, ms (read every animation frame). */
  positionMs: () => number
  /** Student's live samples (recording time); read every frame. */
  sung: () => readonly SungSample[]
  /** A previous take drawn faded underneath (the one selected in the report). */
  overlay?: () => readonly SungSample[]
  /** Octave shift for the current phrase (semitones). */
  shift: () => number
  low: number
  high: number
  /** The song's lowest and highest notes (marked with dashed lines). */
  extremes?: { low: number; high: number } | null
  /** Tailwind height class of the lane. */
  heightClass?: string
  windowMs?: number
}

/**
 * Scrolling pitch lane: the singer's notes as bars (their raw line faint
 * behind), the student's line on top (green within ±50 cents of the note,
 * amber otherwise), a faded earlier take, and a playhead at 30 %.
 */
export function PitchLane({
  curve,
  notes,
  positionMs,
  sung,
  overlay,
  shift,
  low,
  high,
  extremes = null,
  heightClass = 'h-64',
  windowMs = 6000,
}: PitchLaneProps) {
  const canvas = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const cv = canvas.current
    if (!cv) return
    const colors = {
      grid: resolve('hsl(var(--border))'),
      label: resolve('hsl(var(--muted-foreground))'),
      raw: resolve('hsl(var(--muted-foreground) / 0.25)'),
      note: resolve('hsl(var(--muted-foreground) / 0.55)'),
      ok: resolve('hsl(var(--success))'),
      off: resolve('hsl(var(--amber))'),
      ghost: resolve('hsl(var(--cyan) / 0.45)'),
      edge: resolve('hsl(var(--amber) / 0.7)'),
      head: resolve('hsl(var(--cyan))'),
    }
    let raf = 0
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = cv.clientWidth
      const h = cv.clientHeight
      if (cv.width !== Math.round(w * dpr)) cv.width = Math.round(w * dpr)
      if (cv.height !== Math.round(h * dpr)) cv.height = Math.round(h * dpr)
      const g = cv.getContext('2d')!
      g.setTransform(dpr, 0, 0, dpr, 0, 0)
      g.clearRect(0, 0, w, h)
      const now = positionMs()
      const t0 = now - windowMs * 0.3
      const x = (ms: number) => ((ms - t0) / windowMs) * w
      const y = (m: number) => h - ((m - low) / (high - low)) * h
      const hopMs = curve.hop * 1000
      const refAt = (ms: number) => curve.midi[Math.round(ms / hopMs)]
      // Semitone grid, C and G labelled.
      g.font = '10px ui-monospace, monospace'
      for (let m = Math.ceil(low); m <= high; m++) {
        g.strokeStyle = colors.grid
        g.globalAlpha = m % 12 === 0 ? 0.9 : 0.35
        g.beginPath()
        g.moveTo(0, y(m))
        g.lineTo(w, y(m))
        g.stroke()
        if (m % 12 === 0 || m % 12 === 7) {
          g.globalAlpha = 1
          g.fillStyle = colors.label
          g.fillText(`${NAMES[m % 12]}${Math.floor(m / 12) - 1}`, 4, y(m) - 2)
        }
      }
      g.globalAlpha = 1
      // The song's highest and lowest notes.
      if (extremes) {
        g.setLineDash([5, 5])
        g.strokeStyle = colors.edge
        g.fillStyle = colors.edge
        g.lineWidth = 1
        for (const [m, word] of [
          [extremes.high, '最高'],
          [extremes.low, '最低'],
        ] as const) {
          g.beginPath()
          g.moveTo(0, y(m))
          g.lineTo(w, y(m))
          g.stroke()
          const r = Math.round(m)
          const text = `${word} ${NAMES[((r % 12) + 12) % 12]}${Math.floor(r / 12) - 1}`
          g.fillText(
            text,
            w - g.measureText(text).width - 6,
            m === extremes.high ? y(m) + 12 : y(m) - 4,
          )
        }
        g.setLineDash([])
      }
      // Singer: faint raw line, then note bars.
      g.strokeStyle = colors.raw
      g.lineWidth = 2
      g.beginPath()
      let pen = false
      for (
        let i = Math.max(0, Math.floor(t0 / hopMs));
        i * hopMs <= t0 + windowMs && i < curve.midi.length;
        i++
      ) {
        const m = curve.midi[i]!
        if (Number.isNaN(m)) {
          pen = false
          continue
        }
        if (pen) g.lineTo(x(i * hopMs), y(m))
        else g.moveTo(x(i * hopMs), y(m))
        pen = true
      }
      g.stroke()
      const bar = Math.max(6, (h / (high - low)) * 0.8)
      g.fillStyle = colors.note
      for (const n of notes) {
        if (n.endMs < t0 || n.startMs > t0 + windowMs) continue
        const x0 = x(n.startMs)
        const x1 = x(n.endMs)
        g.beginPath()
        g.roundRect(x0, y(n.midi) - bar / 2, Math.max(2, x1 - x0), bar, bar / 2)
        g.fill()
      }
      const k = shift()
      const line = (
        pts: readonly SungSample[],
        color: (ok: boolean) => string,
        width: number,
        until: number,
      ) => {
        g.lineWidth = width
        let prev: { x: number; y: number; ms: number; m: number } | null = null
        for (const s of pts) {
          if (s.ms < t0 - 200 || s.ms > until) {
            prev = null
            continue
          }
          const ref = refAt(s.ms)
          const m = foldToRef(s.midi, k, ref, low, high)
          const ok = ref !== undefined && !Number.isNaN(ref) && Math.abs(m - ref) <= 0.5
          const p = { x: x(s.ms), y: y(m), ms: s.ms, m }
          // Only join neighbours: forward in time (an earlier pass of the same phrase must not be joined
          // to a later one), close together, and no octave-error jumps.
          if (prev && s.ms >= prev.ms && s.ms - prev.ms < 120 && Math.abs(m - prev.m) < 3) {
            g.strokeStyle = color(ok)
            g.beginPath()
            g.moveTo(prev.x, prev.y)
            g.lineTo(p.x, p.y)
            g.stroke()
          }
          prev = p
        }
      }
      if (overlay) line(overlay(), () => colors.ghost, 2, t0 + windowMs)
      line(sung(), (ok) => (ok ? colors.ok : colors.off), 3, now + 50)
      g.strokeStyle = colors.head
      g.lineWidth = 2
      g.beginPath()
      g.moveTo(x(now), 0)
      g.lineTo(x(now), h)
      g.stroke()
      raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [curve, notes, positionMs, sung, overlay, shift, low, high, extremes, windowMs])

  return (
    <canvas
      ref={canvas}
      className={`${heightClass} w-full rounded-2xl border border-border/80 bg-card`}
      role="img"
      aria-label="音高对比：灰色横条是原唱的音，彩色线是你唱的（绿色表示在半音以内），淡蓝线是你选中的那一次"
    />
  )
}
