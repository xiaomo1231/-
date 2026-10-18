import type { ReactNode } from 'react'
import type { ScoreFormat, SearchMatch } from '@/songs/scoreLibraryTypes'
import { FORMAT_BADGE, MATCH_LABEL } from '../lib/format'
import { buttonClass, cx, PAGE_SIZE } from '../lib/classes'
import { goBack } from '../lib/route'

export function FormatBadge({ format }: { format: ScoreFormat }) {
  const badge = FORMAT_BADGE[format]
  return (
    <span
      className={cx(
        'inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-xs font-medium',
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
    <span className="inline-flex shrink-0 items-center rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
      {label}
    </span>
  )
}

export function BackButton({ fallback }: { fallback: string }) {
  return (
    <button
      type="button"
      onClick={() => goBack(fallback)}
      className={buttonClass('ghost') + ' px-3'}
    >
      ← 返回
    </button>
  )
}

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
    <div className="flex items-center gap-2 py-3">
      <BackButton fallback={fallback} />
      <div className="min-w-0 flex-1">
        <h1 className="break-words text-xl font-semibold leading-tight">{title}</h1>
        {subtitle && <p className="truncate text-sm text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  )
}

export function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  return (
    <div className="flex justify-center pt-3">
      <button type="button" onClick={onMore} className={buttonClass('outline')}>
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
        'rounded-2xl border p-4 text-sm leading-relaxed',
        tone === 'error'
          ? 'border-destructive/50 text-destructive'
          : 'border-border/80 bg-card text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
