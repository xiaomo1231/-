import type { ScoreSong, ScoreVersion } from '@/songs/scoreLibraryTypes'
import type { VersionInfo } from '@/songs/scoreServerTypes'
import { cx } from '../lib/classes'
import { versionLine } from '@/songs/versionLine'
import { FORMAT_BADGE, formatSize } from '../lib/format'
import { hrefViewer } from '../lib/route'
import { markSeen, openPreview, useSeen, usePreview, type PreviewItem } from '../lib/preview'
import { useVersionInfo } from '../lib/versionInfo'
import { Link } from './Link'
import { FormatBadge, JianpuBadge } from './ui'

/** A version as a preview item (the song's title, or the file name when the title is unknown). */
function previewItemOf(song: ScoreSong, artistName: string, v: ScoreVersion): PreviewItem {
  return {
    path: v.file.path,
    format: v.file.format,
    pages: v.pages?.map((p) => p.path) ?? [],
    title: song.unknownTitle ? v.label : song.title,
    artist: artistName,
    label: v.label,
  }
}

/**
 * One song in an artist's list: a title row that opens its versions inline
 * (a pen-blue rule on the left), each with a favourite star and 「看谱 →」.
 */
export function SongCard({
  song,
  artistName,
  open,
  onToggle,
  isStarred,
  busyPath,
  onStar,
  index,
}: {
  song: ScoreSong
  artistName: string
  open: boolean
  onToggle: () => void
  isStarred: (path: string) => boolean
  /** The version whose favourite is being saved, if any. */
  busyPath: string | null
  onStar: (song: ScoreSong, version: ScoreVersion) => void
  /** Position in a contents list (shown as 01, 02…). */
  index?: number
}) {
  const title = song.unknownTitle ? '未识别的曲名' : song.title
  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="flex min-h-11 w-full items-baseline gap-3.5 py-3.5 text-left"
      >
        {index !== undefined && (
          <span className="mono text-xs text-muted-foreground">
            {String(index).padStart(2, '0')}
          </span>
        )}
        <span className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="min-w-0 break-words font-display text-[21px] font-black leading-snug">
            {title}
            {(song.jianpu ?? 0) > 0 && <JianpuBadge />}
          </span>
          <span aria-hidden className="leader" />
        </span>
        {song.versions.length > 1 && (
          <span className="mono text-xs text-muted-foreground">{song.versions.length} 个谱</span>
        )}
        <span
          aria-hidden
          className={cx(
            'text-lg text-muted-foreground transition-transform duration-200 motion-reduce:transition-none',
            open && 'rotate-90',
          )}
        >
          ›
        </span>
      </button>

      {open && (
        <VersionList
          song={song}
          artistName={artistName}
          isStarred={isStarred}
          busyPath={busyPath}
          onStar={onStar}
        />
      )}
    </li>
  )
}

/** A song's versions (pen-blue rule on the left), each with ☆, 预览 and 看谱 →. */
export function VersionList({
  song,
  artistName,
  isStarred,
  busyPath,
  onStar,
}: {
  song: ScoreSong
  artistName: string
  isStarred: (path: string) => boolean
  busyPath: string | null
  onStar: (song: ScoreSong, version: ScoreVersion) => void
}) {
  // Only the GP files have a track list; asked once for the whole song, when the list is open.
  const info = useVersionInfo(
    song.versions.filter((v) => v.file.format === 'score').map((v) => v.file.path),
  )
  return (
    <ul className="mb-3.5 list-none border-l-2 border-primary pl-[18px]">
      {song.versions.map((v) => (
        <VersionRow
          key={v.file.path}
          song={song}
          version={v}
          artistName={artistName}
          info={info[v.file.path] ?? null}
          starred={isStarred(v.file.path)}
          busy={busyPath === v.file.path}
          onStar={onStar}
        />
      ))}
    </ul>
  )
}

function VersionRow({
  song,
  version,
  artistName,
  info,
  starred,
  busy,
  onStar,
}: {
  song: ScoreSong
  version: ScoreVersion
  artistName: string
  /** Track list and tempo of a GP file, once the reader has them. */
  info: VersionInfo | null
  starred: boolean
  busy: boolean
  onStar: (song: ScoreSong, version: ScoreVersion) => void
}) {
  const line = versionLine({
    format: version.file.format,
    info,
    pages: version.pages?.length ?? 1,
  })
  const href = hrefViewer({
    path: version.file.path,
    format: version.file.format,
    pages: version.pages?.map((p) => p.path),
    title: song.unknownTitle ? version.label : song.title,
    artist: artistName,
  })
  const seen = useSeen().has(version.file.path)
  const previewing = usePreview().item?.path === version.file.path
  return (
    <li
      className={cx(
        'grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-2.5 py-1.5 min-[861px]:grid-cols-[52px_minmax(0,1fr)_auto] min-[861px]:gap-3',
        previewing && 'rounded-lg bg-card px-2',
      )}
    >
      <span
        className="inline-flex"
        title={`${FORMAT_BADGE[version.file.format].label} · ${formatSize(version.size)}`}
      >
        <FormatBadge format={version.file.format} className="w-10 min-[861px]:w-[52px]" />
      </span>
      <span className="min-w-0">
        <span className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
          <span className="font-medium">{line.main}</span>
          {line.detail && (
            <span className="text-xs text-muted-foreground">{` · ${line.detail}`}</span>
          )}
          {seen && (
            <span className="text-xs text-muted-foreground" title="看过">
              看过
            </span>
          )}
          {version.tags.map((tag) => (
            <span
              key={tag}
              className="rounded-[3px] border border-border px-1.5 text-[11px] leading-5 text-muted-foreground"
            >
              {tag}
            </span>
          ))}
        </span>
        <span className="mono mt-0.5 block truncate text-[11px] text-muted-foreground" title={version.label}>
          {version.label}
        </span>
      </span>
      <span className="flex items-center gap-1">
        <button
          type="button"
          aria-pressed={starred}
          aria-label={starred ? '取消收藏' : '收藏'}
          title={starred ? '取消收藏' : '收藏'}
          disabled={busy}
          onClick={() => onStar(song, version)}
          className={cx(
            'grid h-11 w-11 place-items-center rounded-lg text-base transition-colors disabled:opacity-50 min-[861px]:h-8 min-[861px]:w-8',
            starred ? 'text-primary' : 'text-muted-foreground hover:text-primary',
          )}
        >
          <span aria-hidden>{starred ? '★' : '☆'}</span>
        </button>
        <button
          type="button"
          onClick={() =>
            openPreview(
              previewItemOf(song, artistName, version),
              song.versions.map((x) => previewItemOf(song, artistName, x)),
            )
          }
          className="inline-flex h-11 items-center px-1.5 text-[13px] text-muted-foreground transition-colors hover:text-primary min-[861px]:h-8"
        >
          预览
        </button>
        {/* Opening the full viewer marks the version as seen (the link still navigates). */}
        <span className="inline-flex" onClickCapture={() => markSeen(version.file.path)}>
          <Link
            href={href}
            className="inline-flex min-h-11 items-center px-1.5 text-[13px] text-primary"
          >
            看谱 →
          </Link>
        </span>
      </span>
    </li>
  )
}
