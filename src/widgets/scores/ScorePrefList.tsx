import { useNavigate } from 'react-router-dom'
import { Star } from 'lucide-react'
import type { ScoreVersion } from '@/songs/scoreLibraryTypes'
import { cn } from '@/shared/lib/utils'
import { FORMAT_BADGE } from './formatBadge'
import { extOf, fileBaseName, scoreFormatOf } from './ScoreViewerFormat'
import { scoreViewUrl } from './scoreViewUrl'

/** One starred or recently opened score, as the lists show it. */
export interface PrefRow {
  path: string
  title: string
  artist: string
  pages?: string[]
  /** When it was starred / opened (ms). */
  date: number
}

/** The row as a version, so it opens in the viewer the same way a song's version does. */
function versionOf(row: PrefRow): ScoreVersion {
  const ext = extOf(row.path)
  const pages = row.pages && row.pages.length > 0 ? row.pages : undefined
  return {
    file: { path: row.path, size: 0, format: scoreFormatOf(ext), ext },
    ...(pages
      ? { pages: pages.map((p) => ({ path: p, size: 0, format: 'image' as const, ext: extOf(p) })) }
      : {}),
    tags: [],
    label: fileBaseName(row.path),
    size: 0,
  }
}

interface Props {
  kind: 'favorites' | 'recent'
  /** null while loading. */
  rows: PrefRow[] | null
  /** Favourites only: removes the star. */
  onUnstar?: (row: PrefRow) => void
}

/** Right side of the library: the starred scores or the recently opened ones. */
export function ScorePrefList({ kind, rows, onUnstar }: Props) {
  const navigate = useNavigate()
  const heading = kind === 'favorites' ? '★ 收藏' : '最近打开'
  const empty =
    kind === 'favorites' ? '还没有收藏。在谱子旁边点 ☆ 就能收藏。' : '最近打开的谱子会出现在这里。'

  return (
    <section aria-label={heading} className="min-w-0 px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 pb-2">
        <h2 className="text-xl font-semibold">{heading}</h2>
        {rows !== null && (
          <p className="num text-sm text-muted-foreground">{rows.length.toLocaleString()} 个谱子</p>
        )}
      </div>

      {rows === null && <p className="py-6 text-sm text-muted-foreground">正在读取…</p>}
      {rows !== null && rows.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">{empty}</p>
      )}
      {rows !== null && rows.length > 0 && (
        <ul className="divide-y divide-border/70 lg:max-h-[600px] lg:overflow-y-auto">
          {rows.map((row) => {
            const badge = FORMAT_BADGE[scoreFormatOf(extOf(row.path))]
            return (
              <li key={row.path} className="flex items-center gap-1 py-1">
                <button
                  type="button"
                  onClick={() => navigate(scoreViewUrl(versionOf(row), row.title, row.artist))}
                  className="focus-ring flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-muted/60"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-md border px-1.5 py-px text-[11px] font-medium',
                      badge.className,
                    )}
                  >
                    {badge.label}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {row.title || fileBaseName(row.path)}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {row.artist || '（未知歌手）'} · {fileBaseName(row.path)}
                    </span>
                  </span>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {new Date(row.date).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </button>
                {onUnstar && (
                  <button
                    type="button"
                    aria-pressed="true"
                    aria-label="取消收藏"
                    title="取消收藏"
                    onClick={() => onUnstar(row)}
                    className="focus-ring shrink-0 rounded-lg p-2 text-amber hover:bg-muted/60"
                  >
                    <Star className="h-4 w-4 fill-current" aria-hidden />
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
