import { useMemo, useState } from 'react'
import { errorText, type FavoriteItem } from '../lib/api'
import { renameFavorite, renameFavoriteSong, toggleFavorite, useFavorites } from '../lib/favorites'
import { practiceLine, usePractice } from '../lib/practice'
import type { PracticeRecord } from '../lib/api'
import { hrefViewer } from '../lib/route'
import {
  fileNameOf,
  filterGroups,
  groupFavorites,
  type FavoriteGroup,
  type FavoriteSort,
} from '../lib/favoriteGroups'
import { FormatBadge, Notice, PageBar, Seg, Staff } from '../components/ui'
import { Link } from '../components/Link'
import { useHistoryState, useRestoreScroll } from '../lib/scrollMemory'

type Order = 'time' | 'artist' | 'practice'

const SORT_OF: Record<Order, FavoriteSort> = {
  time: 'added',
  artist: 'artist',
  practice: 'practiced',
}

/**
 * 我的收藏: starred scores grouped by song (the folder under the artist), each starred file
 * listed under its song; each ★ removes it. The search box filters by song, artist or file name.
 */
export function FavoritesPage() {
  const { items, loaded } = useFavorites()
  const practice = usePractice()
  const [order, setOrder] = useHistoryState<Order>('order', 'time')
  const [query, setQuery] = useHistoryState('q', '')
  useRestoreScroll(loaded)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The name being edited: `f:<path>` for a file, `s:<song key>` for a song heading. */
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState('')

  const recordOf = useMemo(() => {
    const map = new Map<string, PracticeRecord>()
    for (const r of practice.items) map.set(r.path, r)
    return map
  }, [practice.items])

  const groups = useMemo(
    () =>
      groupFavorites(items, SORT_OF[order], (path) => recordOf.get(path)?.lastAt),
    [items, order, recordOf],
  )
  const visible = useMemo(() => filterGroups(groups, query), [groups, query])
  /** The whole group by key (a filtered group lists only some of its files). */
  const fullOf = useMemo(() => new Map(groups.map((g) => [g.key, g])), [groups])

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

  const startRename = (id: string, current: string) => {
    setEditing(id)
    setDraft(current)
    setError(null)
  }

  /** Runs one rename; an empty name clears it. Leaves edit mode on success, shows the error otherwise. */
  const commitRename = async (id: string, run: () => Promise<void>) => {
    if (busy) return
    setBusy(id)
    setError(null)
    try {
      await run()
      setEditing(null)
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const renameFile = (f: FavoriteItem, alias: string | null) =>
    commitRename(`f:${f.path}`, () => renameFavorite(f.path, alias))

  const renameSong = (g: FavoriteGroup, songAlias: string | null) => {
    const paths = (fullOf.get(g.key) ?? g).items.map((f) => f.path)
    return commitRename(`s:${g.key}`, () => renameFavoriteSong(paths, songAlias))
  }

  /** The inline name editor: Enter saves, Escape cancels. */
  const editor = (label: string, id: string, onSave: (name: string) => void) => (
    <form
      className="flex min-w-0 flex-1 flex-wrap items-center gap-2 py-1.5 pl-4"
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft.trim())
      }}
    >
      <input
        aria-label={label}
        autoFocus
        autoComplete="off"
        spellCheck={false}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault()
            setEditing(null)
          }
        }}
        className="h-11 min-w-0 flex-1 rounded-lg border border-border bg-card px-3 text-base text-foreground outline-none ring-inset focus:ring-2 focus:ring-primary"
      />
      <button
        type="submit"
        disabled={busy === id}
        className="h-11 rounded-lg px-3 text-sm font-medium text-primary transition-colors hover:text-foreground disabled:opacity-50"
      >
        保存
      </button>
      <button
        type="button"
        onClick={() => setEditing(null)}
        className="h-11 rounded-lg px-3 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        取消
      </button>
    </form>
  )

  /** One starred file under its song: the file name, format, practice line, ★ and the viewer link. */
  const row = (f: FavoriteItem, g: FavoriteGroup) => {
    const record = recordOf.get(f.path)
    const file = fileNameOf(f.path)
    const label = f.pages.length > 1 ? `${file} · ${f.pages.length} 页` : file
    const id = `f:${f.path}`
    const shown = f.alias
      ? f.pages.length > 1
        ? `${f.alias} · ${f.pages.length} 页`
        : f.alias
      : label
    const isEditing = editing === id
    return (
      <li key={f.path} className="border-t border-border first:border-t-0">
        <div className="flex items-center gap-2">
          {isEditing ? (
            editor('文件的新名字', id, (name) => void renameFile(f, name || null))
          ) : (
            <Link
              href={hrefViewer({
                path: f.path,
                format: f.format,
                pages: f.pages,
                title: f.alias || g.songAlias || f.title,
                artist: f.artist,
              })}
              className="group flex min-h-11 min-w-0 flex-1 items-center gap-2 py-1.5 pl-4"
            >
              <span aria-hidden className="mono shrink-0 text-muted-foreground">
                ──
              </span>
              <span className="min-w-0 flex-1 truncate text-[15px] font-medium transition-colors group-hover:text-primary">
                {shown}
              </span>
              <FormatBadge format={f.format} />
            </Link>
          )}
          {!isEditing && (
            <button
              type="button"
              onClick={() => startRename(id, f.alias ?? file)}
              disabled={busy === id}
              className="h-11 shrink-0 rounded-lg px-2 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              改名
            </button>
          )}
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
        </div>
        {f.alias && !isEditing && (
          <div className="-mt-1 flex flex-wrap items-center gap-x-3 pb-1 pl-4 text-[11px] text-muted-foreground">
            <span className="mono min-w-0 truncate">原名：{label}</span>
            <button
              type="button"
              onClick={() => void renameFile(f, null)}
              disabled={busy === id}
              className="mono underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
            >
              恢复原名
            </button>
          </div>
        )}
        {record && (
          <p className="mono -mt-1 truncate pb-1.5 pl-4 text-[11px] text-muted-foreground">
            {practiceLine(record)}
          </p>
        )}
      </li>
    )
  }

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
          <p className="mb-3 text-xs text-muted-foreground">
            改名只改你自己收藏里显示的名字，谱库和其他人看到的不变。
          </p>
          <div className="relative">
            <input
              type="search"
              aria-label="在收藏里搜索歌名、歌手或文件名"
              placeholder="在收藏里搜索歌名、歌手或文件名"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-11 w-full rounded-lg border border-border bg-card pl-3.5 pr-12 text-base text-foreground outline-none ring-inset transition-shadow placeholder:text-muted-foreground focus:ring-2 focus:ring-primary [&::-webkit-search-cancel-button]:appearance-none"
            />
            {query && (
              <button
                type="button"
                aria-label="清空"
                onClick={() => setQuery('')}
                className="absolute right-1 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground transition-colors hover:text-foreground"
              >
                <span aria-hidden>✕</span>
              </button>
            )}
          </div>

          {visible.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">没有匹配的收藏。</p>
          ) : (
            visible.map((g) => (
              <section key={g.key || '_'} className="mt-6 first:mt-0">
                {editing === `s:${g.key}` ? (
                  editor('歌名的新名字', `s:${g.key}`, (name) => void renameSong(g, name || null))
                ) : (
                  <h2 className="m-0 flex flex-wrap items-baseline gap-x-2.5 text-[17px] font-bold">
                    <span className="min-w-0 break-words">{g.displayTitle || '未归类'}</span>
                    <span className="mono text-xs font-normal text-muted-foreground">
                      {g.items.length} 个谱
                    </span>
                    <button
                      type="button"
                      onClick={() => startRename(`s:${g.key}`, g.displayTitle)}
                      disabled={busy === `s:${g.key}`}
                      className="rounded-lg px-1 text-xs font-normal text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
                    >
                      改名
                    </button>
                  </h2>
                )}
                {g.songAlias && editing !== `s:${g.key}` && (
                  <div className="mono mb-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                    <span className="min-w-0 break-words">原名：{g.originalTitle || '未归类'}</span>
                    <button
                      type="button"
                      onClick={() => void renameSong(g, null)}
                      disabled={busy === `s:${g.key}`}
                      className="underline-offset-2 transition-colors hover:text-foreground hover:underline disabled:opacity-50"
                    >
                      恢复原名
                    </button>
                  </div>
                )}
                {g.artist && (
                  <p className="mono mb-1 text-xs text-muted-foreground">{g.artist}</p>
                )}
                <ul className="m-0 list-none border-l-2 border-border p-0 pl-1">
                  {g.items.map((f) => row(f, g))}
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
