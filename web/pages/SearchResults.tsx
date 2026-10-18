import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { PANEL, cx } from '../lib/classes'
import { hrefArtist } from '../lib/route'
import { useLibrary } from '../lib/libraryContext'
import { useLoad } from '../lib/useLoad'
import { Link } from '../components/Link'
import { SongCard } from '../components/SongCard'
import { MatchTag, Notice } from '../components/ui'

/** Search results: 歌手 first, then 谱子 (each with its versions). */
export function SearchResults({ q }: { q: string }) {
  const { version } = useLibrary()
  const state = useLoad((signal) => api.search(q, signal), `search\n${q}\n${version}`)

  if (state.status === 'loading') {
    return <p className="py-10 text-center text-sm text-muted-foreground">正在搜索…</p>
  }
  if (state.status === 'error') {
    return <Notice tone="error">{state.message}</Notice>
  }

  const { artists, songs, moreSongs } = state.data
  if (artists.length === 0 && songs.length === 0) {
    return (
      <Notice>
        没有找到「{q}」。试试只输入歌名的一部分，或换个写法（拼音、首字母、繁体都可以）。
      </Notice>
    )
  }

  return (
    <div className="space-y-6">
      {artists.length > 0 && (
        <Section title={`歌手（${artists.length}）`}>
          <ul className="space-y-2">
            {artists.map((a) => (
              <li key={a.id}>
                <Link
                  href={hrefArtist(a)}
                  className={cx(
                    PANEL,
                    'flex min-h-14 items-center justify-between gap-3 p-4 transition-colors hover:bg-accent',
                  )}
                >
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-semibold">{a.name}</span>
                      <MatchTag match={a.match} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.categoryName} · {a.groupName}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{a.songs} 首</span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {songs.length > 0 && (
        <Section title={`谱子（${songs.length}${moreSongs ? '+' : ''}）`}>
          <div className="space-y-3">
            {songs.map(({ song, artistName, match }) => (
              <SongCard
                key={song.id}
                song={song}
                artistName={artistName}
                subtitle={
                  <span className="flex items-center gap-2">
                    <span className="truncate">{artistName}</span>
                    <MatchTag match={match} />
                  </span>
                }
              />
            ))}
          </div>
          {moreSongs && (
            <p className="pt-3 text-sm text-muted-foreground">
              结果较多，只显示了前面的。输入更完整的歌名可以缩小范围。
            </p>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  )
}
