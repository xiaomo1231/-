import type { ReactNode } from 'react'
import type { ScoreFormat, SearchMatch } from '@/songs/scoreLibraryTypes'
import { FORMAT_BADGE, MATCH_LABEL } from '../lib/format'
import { buttonClass, cx, PAGE_SIZE } from '../lib/classes'
import { goBack } from '../lib/route'
import { Link } from './Link'

/** A format chip: plain bordered mono, as printed on a score's label. */
export function FormatBadge({ format, className }: { format: ScoreFormat; className?: string }) {
  const badge = FORMAT_BADGE[format]
  return (
    <span
      className={cx(
        'mono inline-flex shrink-0 items-center justify-center rounded-[3px] border px-1 py-px text-[11px] leading-5',
        badge.className,
        className,
      )}
    >
      {badge.label}
    </span>
  )
}

/** 「简谱」 chip beside a song title whose library folder has 13-简谱 PDFs. */
export function JianpuBadge({ className }: { className?: string }) {
  return (
    <span
      className={cx(
        'ml-2 inline-flex shrink-0 items-center rounded-[3px] border border-primary px-1 py-px align-middle font-sans text-[11px] font-normal leading-5 text-primary',
        className,
      )}
    >
      简谱
    </span>
  )
}

/** How a search hit matched (拼音 / 首字母 / 繁简 / 相近); a plain name match shows none. */
export function MatchTag({ match }: { match: SearchMatch }) {
  const label = MATCH_LABEL[match]
  if (!label) return null
  return (
    <span className="ml-2 inline-flex shrink-0 items-center rounded-full border border-primary px-1.5 text-[11px] leading-5 text-primary">
      {label}
    </span>
  )
}

/** 「← 目录」: a text back link; the phone's back gesture when the app made the entry. */
export function BackLink({ label, fallback }: { label: string; fallback: string }) {
  return (
    <button
      type="button"
      onClick={() => goBack(fallback)}
      className="-ml-1 inline-flex min-h-11 items-center self-start px-1 text-sm text-muted-foreground transition-colors hover:text-primary"
    >
      {label}
    </button>
  )
}

/**
 * Page head, as on a printed contents page: a back link, a heavy title and a
 * mono note, with optional tools on the right. The staff rule follows it.
 */
export function PageBar({
  title,
  subtitle,
  fallback,
  back = '← 返回',
  children,
}: {
  title: string
  subtitle?: string
  fallback: string
  /** '' hides the back link (a page that is itself the home). */
  back?: string
  children?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end gap-x-4 gap-y-2 pb-[18px] pt-9">
      <div className="min-w-0 flex-1 basis-64">
        {back && <BackLink label={back} fallback={fallback} />}
        <h1 className="m-0 break-words font-display text-[clamp(36px,7vw,64px)] font-black leading-none tracking-[-0.01em]">
          {title}
        </h1>
      </div>
      {subtitle && <p className="mono pb-1.5 text-xs text-muted-foreground">{subtitle}</p>}
      {children && <div className="flex items-center gap-1.5 pb-1">{children}</div>}
    </header>
  )
}

/** The page's divider: six hairlines. */
export function Staff() {
  return <div className="staff" aria-hidden />
}

/** A two-to-four item segmented control (按拼音 / 按数量, 按收藏时间 / 按歌手). */
export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: T
  options: ReadonlyArray<readonly [T, string]>
  onChange: (v: T) => void
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex overflow-hidden rounded-lg border border-border"
    >
      {options.map(([v, text]) => (
        <button
          key={v}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cx(
            'min-h-11 px-3 text-[13px] transition-colors',
            value === v
              ? 'bg-foreground text-background'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  )
}

/** A contents-style line for a score: title over artist, format on the right. */
export function ScoreLine({
  title,
  artist,
  format,
  href,
  action,
}: {
  title: string
  artist: string
  format: ScoreFormat
  href: string
  action?: ReactNode
}) {
  return (
    <div className="flex items-center gap-2 border-t border-border py-1.5 first:border-t-0">
      <Link
        href={href}
        className="group grid min-h-11 min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2.5 py-1.5"
      >
        <span className="min-w-0">
          <span className="block truncate text-base font-bold transition-colors group-hover:text-primary">
            {title || '未识别的曲名'}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{artist || ' '}</span>
        </span>
        <span className="mono text-[11px] text-muted-foreground">{FORMAT_BADGE[format].label}</span>
      </Link>
      {action}
    </div>
  )
}

export function LoadMore({ remaining, onMore }: { remaining: number; onMore: () => void }) {
  return (
    <div className="flex pt-4">
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
        'rounded-lg border p-4 text-sm leading-relaxed',
        tone === 'error'
          ? 'border-destructive text-destructive'
          : 'border-dashed border-border text-muted-foreground',
      )}
    >
      {children}
    </div>
  )
}
