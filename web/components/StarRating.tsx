import { useRef, useState, type KeyboardEvent } from 'react'
import { cx } from '../lib/classes'

type Size = 'sm' | 'md'

const ICON: Record<Size, string> = { sm: 'h-4 w-4', md: 'h-6 w-6' }
/** Tap target for one star when the rating is editable (at least 44px tall). */
const TARGET: Record<Size, string> = { sm: 'h-11 w-8', md: 'h-11 w-9' }
const STARS = [1, 2, 3, 4, 5] as const

const STAR_PATH =
  'M12 2.5l2.94 6.02 6.64.96-4.8 4.68 1.13 6.6L12 17.6l-5.91 3.16 1.13-6.6-4.8-4.68 6.64-.96z'

function StarIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path d={STAR_PATH} fill="currentColor" />
    </svg>
  )
}

/** One star, filled from the left by `fill` (0–1): an empty star with an accent overlay clipped to the share. */
function Star({ fill, size }: { fill: number; size: Size }) {
  const box = ICON[size]
  return (
    <span className={cx('relative inline-block', box)}>
      <StarIcon className={cx('block text-border', box)} />
      {fill > 0 && (
        <span
          className="absolute inset-y-0 left-0 overflow-hidden text-primary"
          style={{ width: `${fill * 100}%` }}
        >
          <StarIcon className={cx('block', box)} />
        </span>
      )}
    </span>
  )
}

const clamp01 = (x: number) => Math.min(1, Math.max(0, x))

/**
 * Average rating as five stars. With `onRate` the stars are radio buttons:
 * hover previews, arrow keys move and set the rating, `mine` is the user's own stars.
 */
export function StarRating({
  value,
  count,
  mine,
  onRate,
  size = 'md',
}: {
  value: number
  count: number
  mine: number | null
  onRate?: (stars: number) => void
  size?: 'sm' | 'md'
}) {
  const [hover, setHover] = useState<number | null>(null)
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  const average = Number.isFinite(value) ? clamp01(value / 5) * 5 : 0
  const shown = hover ?? average
  const summary = count > 0 ? `${average.toFixed(1)} · ${count} 人评` : '还没有评分'

  const onKey = (e: KeyboardEvent<HTMLButtonElement>, n: number) => {
    if (!onRate) return
    let next: number
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        next = n === 5 ? 1 : n + 1
        break
      case 'ArrowLeft':
      case 'ArrowDown':
        next = n === 1 ? 5 : n - 1
        break
      case 'Home':
        next = 1
        break
      case 'End':
        next = 5
        break
      default:
        return
    }
    e.preventDefault()
    refs.current[next - 1]?.focus()
    onRate(next)
  }

  const stars = onRate ? (
    <div
      role="radiogroup"
      aria-label="用户品鉴"
      className="inline-flex items-center"
      onMouseLeave={() => setHover(null)}
    >
      {STARS.map((n) => {
        const tabbable = mine === n || (mine === null && n === 1)
        return (
          <button
            key={n}
            ref={(el) => {
              refs.current[n - 1] = el
            }}
            type="button"
            role="radio"
            aria-checked={mine === n}
            aria-label={`打 ${n} 星`}
            tabIndex={tabbable ? 0 : -1}
            onClick={() => onRate(n)}
            onKeyDown={(e) => onKey(e, n)}
            onMouseEnter={() => setHover(n)}
            onFocus={() => setHover(null)}
            className={cx(
              'inline-flex items-center justify-center rounded-md transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              TARGET[size],
            )}
          >
            <Star fill={clamp01(shown - (n - 1))} size={size} />
          </button>
        )
      })}
    </div>
  ) : (
    <span role="img" aria-label={summary} className="inline-flex items-center gap-0.5">
      {STARS.map((n) => (
        <Star key={n} fill={clamp01(shown - (n - 1))} size={size} />
      ))}
    </span>
  )

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        {stars}
        <span className="mono text-sm text-muted-foreground">{summary}</span>
      </div>
      {onRate && mine !== null && <p className="m-0 text-sm text-foreground">你给了 {mine} 星</p>}
    </div>
  )
}
