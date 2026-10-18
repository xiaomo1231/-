import type { ReactNode } from 'react'
import type { ScoreSong, ScoreVersion } from '@/songs/scoreLibraryTypes'
import { cx, PANEL, ROW } from '../lib/classes'
import { formatSize } from '../lib/format'
import { hrefViewer } from '../lib/route'
import { Link } from './Link'
import { FormatBadge } from './ui'

/** A song and its versions: each version row opens in the viewer. */
export function SongCard({
  song,
  artistName,
  subtitle,
}: {
  song: ScoreSong
  artistName: string
  subtitle?: ReactNode
}) {
  const title = song.unknownTitle ? '未识别的曲名' : song.title
  return (
    <article className={cx(PANEL, 'p-0')}>
      <header className="p-4">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="min-w-0 break-words font-display text-xl font-black leading-snug">
            {title}
          </h3>
          <span className="mono shrink-0 text-xs text-muted-foreground">
            {song.versions.length} 个版本
          </span>
        </div>
        {subtitle && <div className="mt-1 text-xs text-muted-foreground">{subtitle}</div>}
      </header>
      <ul className="divide-y divide-border/60 border-t border-border/60">
        {song.versions.map((v) => (
          <li key={v.file.path}>
            <VersionRow song={song} version={v} artistName={artistName} />
          </li>
        ))}
      </ul>
    </article>
  )
}

function VersionRow({
  song,
  version,
  artistName,
}: {
  song: ScoreSong
  version: ScoreVersion
  artistName: string
}) {
  const pages = version.pages?.length ?? 0
  const href = hrefViewer({
    path: version.file.path,
    format: version.file.format,
    pages: version.pages?.map((p) => p.path),
    title: song.unknownTitle ? version.label : song.title,
    artist: artistName,
  })
  return (
    <Link href={href} className={cx(ROW, 'px-4')}>
      <FormatBadge format={version.file.format} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{version.label}</span>
        {version.tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {version.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-border px-2 text-[11px] leading-5 text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="mono shrink-0 text-right text-xs text-muted-foreground">
        <span className="block">{formatSize(version.size)}</span>
        {pages > 1 && <span className="block">{pages} 页</span>}
      </span>
      <span aria-hidden className="shrink-0 text-xl text-muted-foreground">
        ›
      </span>
    </Link>
  )
}
