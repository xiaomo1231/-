/**
 * Full-screen count-in digits (1..beats) shown over every screen. Each beat's digit
 * fades out across the beat unless the user prefers reduced motion.
 */
import { useEffect, useRef, useState } from 'react'

export function CountInOverlay(props: {
  /** Local Date.now()-based time when the count-in starts, or null (hidden). */
  startAt: number | null
  beats: number
  beatMs: number
}) {
  const { startAt, beats, beatMs } = props
  const [beat, setBeat] = useState<number | null>(null)
  const digitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (startAt === null) return
    const total = beats * beatMs
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
    let raf = 0
    let current: number | null = null

    const tick = () => {
      const elapsed = Date.now() - startAt
      if (elapsed >= total) {
        setBeat(null)
        return
      }
      if (elapsed >= 0) {
        const b = Math.floor(elapsed / beatMs) + 1
        if (b !== current) {
          current = b
          setBeat(b)
        }
        const frac = (elapsed % beatMs) / beatMs
        if (digitRef.current) {
          digitRef.current.style.opacity = String(reduce ? 1 : 1 - 0.7 * frac)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [startAt, beats, beatMs])

  if (startAt === null || beat === null) return null

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'hsl(var(--background) / 0.35)' }}
    >
      <span className="sr-only">
        预备拍 {beat}/{beats}
      </span>
      <div
        ref={digitRef}
        aria-hidden="true"
        className="font-bold leading-none text-[hsl(var(--primary))]"
        style={{ fontFamily: 'var(--font-mono)', fontSize: 'min(45vw, 28rem)' }}
      >
        {beat}
      </div>
    </div>
  )
}
