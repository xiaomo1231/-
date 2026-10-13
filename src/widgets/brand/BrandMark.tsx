import { cn } from '@/shared/lib/utils'

/** Waveform-in-a-tile logo; colours come from theme tokens. */
export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden="true">
      <rect width="64" height="64" rx="16" className="fill-[hsl(var(--card))] stroke-[hsl(var(--border))]" strokeWidth="2" />
      <path
        d="M10 40 L18 40 L22 26 L28 46 L34 20 L40 44 L44 34 L54 34"
        fill="none"
        className="stroke-[hsl(var(--amber))]"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="54" cy="34" r="3.5" className="fill-[hsl(var(--cyan))]" />
    </svg>
  )
}
