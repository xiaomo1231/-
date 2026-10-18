import type { ScoreArtist, ScoreSong } from '@/songs/scoreLibraryTypes'
import { Button } from '@/shared/ui/Button'
import { ScoreVersionRow } from './ScoreVersionRow'

export const SONG_PAGE = 200

interface Props {
  artist: ScoreArtist | undefined
  /** null while loading. */
  songs: ScoreSong[] | null
  /** How many songs are shown (the list is cut to keep big collections light). */
  limit: number
  onMore: () => void
}

/** Right column: the chosen artist's songs, each with its versions. */
export function ScoreSongList({ artist, songs, limit, onMore }: Props) {
  if (!artist)
    return (
      <p className="px-5 py-8 text-sm text-muted-foreground">选一位歌手，这里会列出他的谱子。</p>
    )

  return (
    <section aria-label={`${artist.name}的谱子`} className="min-w-0 px-4 pb-4 pt-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 pb-2">
        <h2 className="text-xl font-semibold">{artist.name}</h2>
        <p className="num text-sm text-muted-foreground">
          {artist.files.toLocaleString()} 个文件 · {artist.songs.toLocaleString()} 首
        </p>
      </div>

      {songs === null && <p className="py-6 text-sm text-muted-foreground">正在读取…</p>}
      {songs !== null && songs.length === 0 && (
        <p className="py-6 text-sm text-muted-foreground">这位歌手下面没有谱子。</p>
      )}

      {songs !== null && songs.length > 0 && (
        <div className="lg:max-h-[600px] lg:overflow-y-auto">
          <ul className="divide-y divide-border/70">
            {songs.slice(0, limit).map((song) => (
              <li key={song.id} className="py-3">
                <SongHeading song={song} />
                <div className="mt-1 space-y-0.5">
                  {song.versions.map((v) => (
                    <ScoreVersionRow
                      key={v.file.path}
                      version={v}
                      title={song.title}
                      artistName={artist.name}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          {songs.length > limit && (
            <div className="pt-2">
              <Button variant="outline" size="sm" onClick={onMore}>
                再显示 {SONG_PAGE} 首（还有 {(songs.length - limit).toLocaleString()} 首）
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

/** Song title, with a muted note when the file names do not give the title. */
export function SongHeading({ song }: { song: ScoreSong }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 px-1">
      <span className={song.unknownTitle ? 'text-sm text-muted-foreground' : 'font-medium'}>
        {song.unknownTitle ? '（文件名认不出歌名）' : song.title}
      </span>
      <span className="num text-xs text-muted-foreground">{song.versions.length} 个版本</span>
    </div>
  )
}
