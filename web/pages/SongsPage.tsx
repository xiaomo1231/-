import { useState } from 'react'
import { api } from '../lib/api'
import { PAGE_SIZE } from '../lib/classes'
import { useLibrary } from '../lib/libraryContext'
import { useLoad } from '../lib/useLoad'
import { SongCard } from '../components/SongCard'
import { LoadMore, Notice, PageBar } from '../components/ui'

/** One artist's songs; each song lists its versions (files) to open. */
export function SongsPage({ artist }: { artist: { id: string; name: string } }) {
  const { version } = useLibrary()
  const [limit, setLimit] = useState(PAGE_SIZE)
  const state = useLoad((signal) => api.songs(artist.id, signal), `songs\n${artist.id}\n${version}`)
  const name = artist.name || '歌手'

  if (state.status === 'loading') {
    return (
      <>
        <PageBar title={name} fallback="#/" />
        <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageBar title={name} fallback="#/" />
        <Notice tone="error">{state.message}</Notice>
      </>
    )
  }

  const songs = state.data
  const shown = songs.slice(0, limit)
  // Files on disk: an image score's pages are separate files.
  const files = songs.reduce(
    (n, s) => n + s.versions.reduce((m, v) => m + (v.pages?.length ?? 1), 0),
    0,
  )
  return (
    <>
      <PageBar
        title={name}
        subtitle={`${songs.length} 首 · ${files.toLocaleString('zh-CN')} 个文件`}
        fallback="#/"
      />
      {songs.length === 0 ? (
        <Notice>这位歌手下还没有谱子。</Notice>
      ) : (
        <div className="space-y-3">
          {shown.map((song) => (
            <SongCard key={song.id} song={song} artistName={name} />
          ))}
          {songs.length > limit && (
            <LoadMore
              remaining={songs.length - limit}
              onMore={() => setLimit((n) => n + PAGE_SIZE)}
            />
          )}
        </div>
      )}
    </>
  )
}
