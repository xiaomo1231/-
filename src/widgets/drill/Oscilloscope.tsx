import { useEffect, useRef } from 'react'
import { cn } from '@/shared/lib/utils'

/**
 * Decorative oscilloscope trace: a calm flat line when idle, a moving
 * waveform while audio plays. Purely visual (no audio analysis).
 */
export function Oscilloscope({ active, className }: { active: boolean; className?: string }) {
  const pathRef = useRef<SVGPathElement>(null)
  const ampRef = useRef(0)

  useEffect(() => {
    let raf = 0
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    const draw = (t: number) => {
      const target = active ? 1 : 0
      ampRef.current += (target - ampRef.current) * 0.08
      const amp = ampRef.current * 18
      const phase = reduce ? 0 : t / 180
      let d = ''
      for (let x = 0; x <= 600; x += 6) {
        const env = Math.sin((Math.PI * x) / 600)
        const y = 30 + env * amp * (Math.sin(x / 14 + phase) * 0.7 + Math.sin(x / 5.3 - phase * 1.7) * 0.3)
        d += `${x === 0 ? 'M' : 'L'}${x} ${y.toFixed(2)} `
      }
      pathRef.current?.setAttribute('d', d)
      if (active || ampRef.current > 0.01) raf = requestAnimationFrame(draw)
    }
    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [active])

  return (
    <div className={cn('relative overflow-hidden rounded-2xl border border-border/70 bg-background/60', className)} aria-hidden="true">
      <svg viewBox="0 0 600 60" preserveAspectRatio="none" className="h-16 w-full">
        {[15, 30, 45].map((y) => (
          <line key={y} x1="0" x2="600" y1={y} y2={y} className="stroke-[hsl(var(--border))]" strokeDasharray="2 6" />
        ))}
        <path
          ref={pathRef}
          d="M0 30 L600 30"
          fill="none"
          strokeWidth="2"
          className={cn('transition-colors duration-300', active ? 'stroke-[hsl(var(--cyan))]' : 'stroke-[hsl(var(--muted-foreground)/0.5)]')}
          style={active ? { filter: 'drop-shadow(0 0 6px hsl(var(--cyan) / 0.7))' } : undefined}
        />
      </svg>
    </div>
  )
}
