import { useEffect, useState } from 'react'
import { Search } from 'lucide-react'
import type { ScoreArtist } from '@/songs/scoreLibraryTypes'
import { ScoreLibrary } from '@/features/scores/scoreLibraryClient'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'

interface Props {
  artist: ScoreArtist
  /** Merges `from` into `to` (`null`: separates `from` again); `select` is the artist to show afterwards. */
  onMerge: (from: string, to: string | null, select?: ScoreArtist) => void
}

/** The artist's merged folders ("也叫") and the 合并到… panel that merges this one into another. */
export function ScoreArtistMerge({ artist, onMerge }: Props) {
  const [open, setOpen] = useState(false)
  const aliases = artist.aliases ?? []
  const aliasIds = artist.aliasIds ?? []

  return (
    <div className="space-y-2 pb-2">
      {aliases.length > 0 && (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <span>也叫：</span>
          {aliases.map((name, i) => {
            const id = aliasIds[i]
            return (
              <span
                key={id ?? name}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-px text-foreground"
              >
                {name}
                {id && (
                  <button
                    type="button"
                    onClick={() => onMerge(id, null)}
                    aria-label={`拆开 ${name}`}
                    className="focus-ring rounded px-1 text-xs text-muted-foreground hover:text-foreground"
                  >
                    拆开
                  </button>
                )}
              </span>
            )
          })}
        </p>
      )}
      <div>
        <Button variant="outline" size="sm" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          合并到…
        </Button>
      </div>
      {open && (
        <MergePanel
          artist={artist}
          onPick={(target) => {
            setOpen(false)
            onMerge(artist.id, target.id, target)
          }}
        />
      )}
    </div>
  )
}

function MergePanel({ artist, onPick }: { artist: ScoreArtist; onPick: (a: ScoreArtist) => void }) {
  const [similar, setSimilar] = useState<ScoreArtist[] | null>(null)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [found, setFound] = useState<ScoreArtist[] | null>(null)

  useEffect(() => {
    let alive = true
    ScoreLibrary.artistsLike(artist.id).then(
      (list) => alive && setSimilar(list),
      () => alive && setSimilar([]),
    )
    return () => {
      alive = false
    }
  }, [artist.id])

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 150)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!debounced) return
    let alive = true
    ScoreLibrary.search(debounced).then(
      (r) => alive && setFound(r.artists.filter((a) => a.id !== artist.id)),
      () => alive && setFound([]),
    )
    return () => {
      alive = false
    }
  }, [debounced, artist.id])

  const shown = debounced ? found : similar
  const heading = debounced ? '搜索结果' : '可能是同一位歌手'

  return (
    <div className="space-y-3 rounded-2xl border border-border/80 bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">
        只在谱库里合在一起显示，不会移动或改名文件夹。
      </p>
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          aria-hidden
        />
        <Input
          type="search"
          aria-label="搜索要合并到的歌手"
          placeholder="搜歌手名"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 rounded-xl pl-9"
          autoComplete="off"
        />
      </div>
      <h3 className="text-xs tracking-[0.08em] text-muted-foreground">{heading}</h3>
      {shown === null && <p className="text-sm text-muted-foreground">正在查找…</p>}
      {shown !== null && shown.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {debounced ? '没有找到这位歌手。' : '没有找到相似的歌手，可以在上面搜索。'}
        </p>
      )}
      {shown !== null && shown.length > 0 && (
        <ul className="space-y-0.5">
          {shown.map((a) => (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onPick(a)}
                className="focus-ring flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm hover:bg-muted/60"
              >
                <span className="min-w-0 truncate">合并到 {a.name}</span>
                <span className="num shrink-0 text-xs text-muted-foreground">
                  {a.files.toLocaleString()} 个文件
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
