import { cn } from '@/shared/lib/utils'

/** Segmented VU-style meter (0–1). The top segments glow cyan. */
export function VuBar({ value, segments = 20, className }: { value: number; segments?: number; className?: string }) {
  const lit = Math.round(Math.max(0, Math.min(1, value)) * segments)
  return (
    <div
      className={cn('flex gap-[3px]', className)}
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
    >
      {Array.from({ length: segments }, (_, i) => (
        <span
          key={i}
          className={cn(
            'h-2 flex-1 rounded-[2px] transition-colors duration-300',
            i < lit ? (i >= segments * 0.85 ? 'bg-cyan' : 'bg-amber') : 'bg-muted',
          )}
          style={{ transitionDelay: `${i * 15}ms` }}
        />
      ))}
    </div>
  )
}
