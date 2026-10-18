import type { ReactNode } from 'react'
import type { ScoreSong, ScoreVersion } from '@/songs/scoreLibraryTypes'
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
    <article className="rounded-2xl border border-border/80 bg-card p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
        <h3 className="min-w-0 break-words text-base font-semibold">{title}</h3>
        <span className="shrink-0 text-xs text-muted-foreground">
          {song.versions.length} 个版本
        </span>
      </div>
      {subtitle && <div className="mt-0.5 text-xs text-muted-foreground">{subtitle}</div>}
      <ul className="mt-2 divide-y divide-border/60">
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
    <Link
      href={href}
      className="flex min-h-11 items-center gap-3 py-2 transition-colors hover:text-primary"
    >
      <FormatBadge format={version.file.format} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm">{version.label}</span>
        {version.tags.length > 0 && (
          <span className="mt-1 flex flex-wrap gap-1">
            {version.tags.map((t) => (
              <span
                key={t}
                className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </span>
        )}
      </span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">
        <span className="num block">{formatSize(version.size)}</span>
        {pages > 1 && <span className="block">{pages} 页</span>}
      </span>
    </Link>
  )
}
