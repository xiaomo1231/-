import type { ReactNode } from 'react'
import { api } from '../lib/api'
import { cx, LIST_PANEL, ROW } from '../lib/classes'
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
    return <Notice>没找到。试试少打几个字，或者用拼音首字母（例如 zjl）。</Notice>
  }

  return (
    <div className="space-y-8">
      {artists.length > 0 && (
        <Section title="歌手" count={`${artists.length}`}>
          <ul className={LIST_PANEL}>
            {artists.map((a) => (
              <li key={a.id}>
                <Link href={hrefArtist(a)} className={cx(ROW, 'justify-between')}>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate font-medium">{a.name}</span>
                      <MatchTag match={a.match} />
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {a.categoryName} · {a.groupName}
                    </span>
                  </span>
                  <span className="mono shrink-0 text-sm text-muted-foreground">{a.songs} 首</span>
                  <span aria-hidden className="shrink-0 text-xl text-muted-foreground">
                    ›
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {songs.length > 0 && (
        <Section title="谱子" count={`${songs.length}${moreSongs ? '+' : ''}`}>
          <div className="space-y-3">
            {songs.map(({ song, artistName, match }) => (
              <SongCard
                key={song.id}
                song={song}
                artistName={artistName}
                subtitle={
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="truncate">{artistName}</span>
                    <MatchTag match={match} />
                  </span>
                }
              />
            ))}
          </div>
          {moreSongs && (
            <p className="px-1 pt-3 text-sm text-muted-foreground">
              结果较多，只显示前 200 个。输入更完整的歌名可以缩小范围。
            </p>
          )}
        </Section>
      )}
    </div>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: string
  children: ReactNode
}) {
  return (
    <section>
      <h2 className="mb-3 flex items-baseline gap-2 px-1 font-display text-lg font-black">
        {title}
        <span className="mono text-xs font-normal text-muted-foreground">{count}</span>
      </h2>
      {children}
    </section>
  )
}
