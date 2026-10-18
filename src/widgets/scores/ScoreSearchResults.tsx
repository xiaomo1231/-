import type { ScoreArtist, ScoreSearchResult } from '@/songs/scoreLibraryTypes'
import { cn } from '@/shared/lib/utils'
import { MATCH_LABEL } from './formatBadge'
import { ScoreVersionRow } from './ScoreVersionRow'
import { SongHeading } from './ScoreSongList'

interface Props {
  query: string
  /** null while the search runs. */
  result: ScoreSearchResult | null
  onPickArtist: (artist: ScoreArtist) => void
}

const MatchTag = ({ kind }: { kind: keyof typeof MATCH_LABEL }) => {
  const label = MATCH_LABEL[kind]
  if (!label) return null
  return (
    <span
      className={cn('shrink-0 rounded-md bg-muted px-1.5 py-px text-[11px] text-muted-foreground')}
    >
      {label}
    </span>
  )
}

/** Replaces the browser while a search is typed: matching artists, then songs. */
export function ScoreSearchResults({ query, result, onPickArtist }: Props) {
  if (result === null)
    return <p className="px-5 py-8 text-sm text-muted-foreground">正在搜索「{query}」…</p>

  return (
    <div className="grid gap-6 p-4 md:grid-cols-[minmax(0,1fr)] lg:grid-cols-[260px_minmax(0,1fr)]">
      <section aria-label="歌手搜索结果" className="min-w-0">
        <h3 className="px-1 pb-2 text-xs tracking-[0.08em] text-muted-foreground">歌手</h3>
        {result.artists.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">没有找到歌手。</p>
        )}
        <ul className="space-y-0.5">
          {result.artists.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPickArtist(a)}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted/60"
              >
                <span className="min-w-0">
                  <span className="block truncate">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {a.categoryName} · {a.groupName}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <MatchTag kind={a.match} />
                  <span className="num text-xs text-muted-foreground">
                    {a.files.toLocaleString()}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="谱子搜索结果" className="min-w-0">
        <h3 className="px-1 pb-2 text-xs tracking-[0.08em] text-muted-foreground">谱子</h3>
        {result.songs.length === 0 && (
          <p className="px-1 text-sm text-muted-foreground">没有找到谱子。</p>
        )}
        <ul className="divide-y divide-border/70">
          {result.songs.map(({ song, artistName, match }) => (
            <li key={song.id} className="py-3">
              <div className="flex items-center gap-2 px-1">
                <SongHeading song={song} />
                <span className="truncate text-xs text-muted-foreground">{artistName}</span>
                <MatchTag kind={match} />
              </div>
              <div className="mt-1 space-y-0.5">
                {song.versions.map((v) => (
                  <ScoreVersionRow
                    key={v.file.path}
                    version={v}
                    title={song.title}
                    artistName={artistName}
                  />
                ))}
              </div>
            </li>
          ))}
        </ul>
        {result.moreSongs && (
          <p className="px-1 pt-3 text-sm text-muted-foreground">
            只显示前 200 个，输入更多字缩小范围。
          </p>
        )}
      </section>
    </div>
  )
}
