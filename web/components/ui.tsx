import type { ReactNode } from 'react'
import type { ScoreFormat, SearchMatch } from '@/songs/scoreLibraryTypes'
import { FORMAT_BADGE, MATCH_LABEL } from '../lib/format'
import { buttonClass, cx, PAGE_SIZE, PANEL } from '../lib/classes'
import { goBack } from '../lib/route'

export function FormatBadge({ format }: { format: ScoreFormat }) {
  const badge = FORMAT_BADGE[format]
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[11px] font-medium',
        badge.className,
      )}
    >
      {badge.label}
    </span>
  )
}

export function MatchTag({ match }: { match: SearchMatch }) {
  const label = MATCH_LABEL[match]
  if (!label) return null
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-primary/10 px-2 text-[11px] text-primary">
      {label}
    </span>
  )
}

export function BackButton({ fallback }: { fallback: string }) {
  return (
    <button
      type="button"
      aria-label="返回"
      onClick={() => goBack(fallback)}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-3xl leading-none text-muted-foreground transition-colors hover:bg-accent hover:text-foreground active:scale-[0.96]"
    >
      <span aria-hidden className="-translate-y-0.5">
        ‹
      </span>
    </button>
  )
}

/** Page header: back button, serif title, mono subtitle, then a string-thin rule with a brass nut. */
export function PageBar({
  title,
  subtitle,
  fallback,
}: {
  title: string
  subtitle?: string
  fallback: string
}) {
  return (
    <header className="pb-4 pt-2">
      <div className="-ml-2 flex items-start gap-2">
        <BackButton fallback={fallback} />
        <div className="min-w-0 flex-1 pt-1.5">
          <h1 className="break-words font-display text-3xl font-black leading-tight">{title}</h1>
          {subtitle && (
            <p className="mono mt-1.5 break-words text-xs text-muted-foreground">{subtitle}</p>
          )}
        </div>
      </div>
      <div aria-hidden className="relative mt-4 h-[3px]">
        <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
        <span className="absolute left-0 top-0 h-[3px] w-12 rounded-full bg-primary" />
      </div>
    </header>
  )
}

export function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  return (
    <div className="flex pt-3">
      <button
        type="button"
        onClick={onMore}
        className={cx(buttonClass('outline'), 'w-full sm:w-auto')}
      >
        再显示 {Math.min(PAGE_SIZE, remaining)} 个（还有 {remaining} 个）
      </button>
    </div>
  )
}

export function Notice({
  tone = 'muted',
  children,
}: {
  tone?: 'muted' | 'error'
  children: ReactNode
}) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cx(
        PANEL,
        'p-4 text-sm leading-relaxed',
        tone === 'error' ? 'border-destructive/50 text-destructive' : 'text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
