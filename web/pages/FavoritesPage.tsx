import { useMemo, useState } from 'react'
import { errorText, type FavoriteItem } from '../lib/api'
import { toggleFavorite, useFavorites } from '../lib/favorites'
import { practiceLine, usePractice } from '../lib/practice'
import type { PracticeRecord } from '../lib/api'
import { hrefViewer } from '../lib/route'
import { ScoreLine, Notice, PageBar, Seg, Staff } from '../components/ui'

type Order = 'time' | 'artist' | 'practice'

const collator = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true })

/** 我的收藏: every starred score, newest first or grouped by artist; each ★ removes it. */
export function FavoritesPage() {
  const { items, loaded } = useFavorites()
  const practice = usePractice()
  const [order, setOrder] = useState<Order>('time')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const byTime = useMemo(() => [...items].sort((a, b) => b.addedAt - a.addedAt), [items])
  const recordOf = useMemo(() => {
    const map = new Map<string, PracticeRecord>()
    for (const r of practice.items) map.set(r.path, r)
    return map
  }, [practice.items])
  /** Practised favourites first (latest practice first), then the rest by when they were starred. */
  const byPractice = useMemo(() => {
    const practised = byTime
      .filter((f) => recordOf.has(f.path))
      .sort((a, b) => recordOf.get(b.path)!.lastAt - recordOf.get(a.path)!.lastAt)
    const rest = byTime.filter((f) => !recordOf.has(f.path))
    return [...practised, ...rest]
  }, [byTime, recordOf])
  const byArtist = useMemo(() => {
    const map = new Map<string, FavoriteItem[]>()
    for (const f of byTime) {
      const key = f.artist || '未知歌手'
      const list = map.get(key)
      if (list) list.push(f)
      else map.set(key, [f])
    }
    return [...map.entries()].sort(([a], [b]) => collator.compare(a, b))
  }, [byTime])

  const remove = async (f: FavoriteItem) => {
    if (busy) return
    setBusy(f.path)
    setError(null)
    try {
      await toggleFavorite({
        path: f.path,
        format: f.format,
        pages: f.pages,
        title: f.title,
        artist: f.artist,
      })
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const line = (f: FavoriteItem) => (
    <>
      <ScoreLine
        title={f.title}
        artist={f.artist}
        format={f.format}
        href={hrefViewer({
          path: f.path,
          format: f.format,
          pages: f.pages,
          title: f.title,
          artist: f.artist,
        })}
        action={
          <button
            type="button"
            aria-pressed="true"
            aria-label="取消收藏"
            title="取消收藏"
            disabled={busy === f.path}
            onClick={() => void remove(f)}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-base text-primary transition-colors hover:text-muted-foreground disabled:opacity-50"
          >
            <span aria-hidden>★</span>
          </button>
        }
      />
      {recordOf.get(f.path) && (
        <p className="mono -mt-1 truncate pb-1.5 text-[11px] text-muted-foreground">
          {practiceLine(recordOf.get(f.path)!)}
        </p>
      )}
    </>
  )

  return (
    <>
      <PageBar
        title="我的收藏"
        back="← 目录"
        fallback="#/"
        subtitle={loaded ? `${items.length} 个` : undefined}
      >
        <Seg<Order>
          label="排序"
          value={order}
          onChange={setOrder}
          options={[
            ['time', '按收藏时间'],
            ['artist', '按歌手'],
            ['practice', '最近练过'],
          ]}
        />
      </PageBar>
      <Staff />

      {!loaded ? (
        <p className="py-10 text-center text-sm text-muted-foreground">正在读取…</p>
      ) : items.length === 0 ? (
        <div className="max-w-[640px] py-6">
          <Notice>还没有收藏。打开任意歌手，点谱子旁边的 ☆ 试试。</Notice>
        </div>
      ) : (
        <div className="max-w-[640px] pb-20 pt-2">
          {order === 'time' || order === 'practice' ? (
            <ul className="m-0 list-none p-0">
              {(order === 'time' ? byTime : byPractice).map((f) => (
                <li key={f.path}>{line(f)}</li>
              ))}
            </ul>
          ) : (
            byArtist.map(([artist, list]) => (
              <section key={artist} className="mt-6 first:mt-0">
                <h2 className="mono mb-1 flex items-center gap-2.5 text-[15px] font-semibold text-primary">
                  {artist}
                  <span aria-hidden className="h-px flex-1 bg-border" />
                </h2>
                <ul className="m-0 list-none p-0">
                  {list.map((f) => (
                    <li key={f.path}>{line(f)}</li>
                  ))}
                </ul>
              </section>
            ))
          )}
          {error && (
            <p role="alert" className="pt-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  )
}
