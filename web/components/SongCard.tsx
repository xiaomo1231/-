import type { ScoreSong, ScoreVersion } from '@/songs/scoreLibraryTypes'
import { cx } from '../lib/classes'
import { formatSize } from '../lib/format'
import { hrefViewer } from '../lib/route'
import { markSeen, openPreview, useSeen, usePreview, type PreviewItem } from '../lib/preview'
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
}: {
  song: ScoreSong
  artistName: string
  open: boolean
  onToggle: () => void
  isStarred: (path: string) => boolean
  /** The version whose favourite is being saved, if any. */
  busyPath: string | null
  onStar: (song: ScoreSong, version: ScoreVersion) => void
}) {
  const title = song.unknownTitle ? '未识别的曲名' : song.title
  return (
    <li className="border-b border-border">
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        className="grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-3.5 py-3.5 text-left"
      >
        <span className="min-w-0 break-words font-display text-[21px] font-black leading-snug">
          {title}
          {(song.jianpu ?? 0) > 0 && <JianpuBadge />}
        </span>
        <span className="mono text-xs text-muted-foreground">{song.versions.length} 个版本</span>
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
  return (
    <ul className="mb-3.5 list-none border-l-2 border-primary pl-[18px]">
      {song.versions.map((v) => (
        <VersionRow
          key={v.file.path}
          song={song}
          version={v}
          artistName={artistName}
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
  starred,
  busy,
  onStar,
}: {
  song: ScoreSong
  version: ScoreVersion
  artistName: string
  starred: boolean
  busy: boolean
  onStar: (song: ScoreSong, version: ScoreVersion) => void
}) {
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
        'grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-3 py-1.5 min-[861px]:grid-cols-[56px_minmax(0,1fr)_auto_auto]',
        previewing && 'rounded-lg bg-card px-2',
      )}
    >
      <FormatBadge format={version.file.format} className="w-[52px]" />
      <span className="min-w-0 truncate text-sm">
        {version.label}
        {seen && (
          <span className="ml-2 text-xs text-muted-foreground" title="看过">
            看过
          </span>
        )}
        {version.tags.length > 0 && (
          <em className="ml-2 text-xs not-italic text-muted-foreground">
            {version.tags.join(' · ')}
          </em>
        )}
      </span>
      <span className="mono hidden text-[11px] text-muted-foreground min-[861px]:block">
        {formatSize(version.size)}
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
