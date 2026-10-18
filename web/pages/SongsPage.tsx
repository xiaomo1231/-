import { useMemo, useState } from 'react'
import type { ScoreSong, ScoreVersion } from '@/songs/scoreLibraryTypes'
import { api, errorText } from '../lib/api'
import { PAGE_SIZE } from '../lib/classes'
import { toggleFavorite, useFavorites } from '../lib/favorites'
import { useLibrary } from '../lib/libraryContext'
import { hrefGroup } from '../lib/route'
import { useLoad } from '../lib/useLoad'
import { SongCard } from '../components/SongCard'
import { LoadMore, Notice, PageBar } from '../components/ui'

/** One artist's songs: each title opens its versions inline; a version can be starred or opened. */
export function SongsPage({ artist }: { artist: { id: string; name: string } }) {
  const { info, version } = useLibrary()
  const { items: favorites } = useFavorites()
  const [limit, setLimit] = useState(PAGE_SIZE)
  // undefined: the first song is open (the default); null: all closed.
  const [openId, setOpenId] = useState<string | null | undefined>(undefined)
  const [busyPath, setBusyPath] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const state = useLoad((signal) => api.songs(artist.id, signal), `songs\n${artist.id}\n${version}`)
  const name = artist.name || '歌手'

  // The group this artist sits in (the longest matching group id), for 「← 男歌手」.
  const group = useMemo(
    () =>
      (info?.categories.flatMap((c) => c.groups) ?? [])
        .filter((g) => artist.id.startsWith(`${g.id}/`))
        .sort((a, b) => b.id.length - a.id.length)[0],
    [info, artist.id],
  )
  const back = group ? `← ${group.name}` : '← 返回'
  const backTo = group ? hrefGroup(group) : '#/'

  const starred = useMemo(() => new Set(favorites.map((f) => f.path)), [favorites])

  const star = async (song: ScoreSong, v: ScoreVersion) => {
    if (busyPath) return
    setBusyPath(v.file.path)
    setError(null)
    try {
      await toggleFavorite({
        path: v.file.path,
        format: v.file.format,
        pages: v.pages?.map((p) => p.path) ?? [],
        title: song.unknownTitle ? v.label : song.title,
        artist: name,
      })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusyPath(null)
    }
  }

  if (state.status === 'loading') {
    return (
      <>
        <PageBar title={name} back={back} fallback={backTo} />
        <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
      </>
    )
  }
  if (state.status === 'error') {
    return (
      <>
        <PageBar title={name} back={back} fallback={backTo} />
        <div className="py-6">
          <Notice tone="error">{state.message}</Notice>
        </div>
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
  const current = openId === undefined ? (songs[0]?.id ?? null) : openId

  return (
    <>
      <PageBar
        title={name}
        back={back}
        fallback={backTo}
        subtitle={`${songs.length} 首 · ${files.toLocaleString('zh-CN')} 份`}
      />

      {songs.length === 0 ? (
        <div className="py-6">
          <Notice>这位歌手下还没有谱子。</Notice>
        </div>
      ) : (
        <div className="pb-20">
          <ul className="m-0 list-none border-t-2 border-foreground p-0">
            {shown.map((song) => (
              <SongCard
                key={song.id}
                song={song}
                artistName={name}
                open={current === song.id}
                onToggle={() => setOpenId(current === song.id ? null : song.id)}
                isStarred={(path) => starred.has(path)}
                busyPath={busyPath}
                onStar={star}
              />
            ))}
          </ul>
          {error && (
            <p role="alert" className="pt-3 text-sm text-destructive">
              {error}
            </p>
          )}
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
