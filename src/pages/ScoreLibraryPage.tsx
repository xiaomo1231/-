import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { FolderOpen, FolderPlus, RefreshCw, Search } from 'lucide-react'
import type { ScoreFavoriteRow, ScoreRecentRow } from '@/entities/types'
import type {
  ScoreArtist,
  ScoreCategory,
  ScoreGroup,
  ScoreSearchResult,
  ScoreSong,
} from '@/songs/scoreLibraryTypes'
import type { LibraryState } from '@/features/scores/scoreLibraryApi'
import { ScoreLibrary } from '@/features/scores/scoreLibraryClient'
import {
  FavoritesContext,
  useScorePrefsVersion,
  type FavoritesValue,
} from '@/features/scores/scorePrefsHooks'
import type { FavoriteInput } from '@/services/scorePrefsService'
import { toast } from '@/features/toast/toastStore'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { ScoreCategoryList } from '@/widgets/scores/ScoreCategoryList'
import { ScoreArtistList, type ArtistSort } from '@/widgets/scores/ScoreArtistList'
import { SONG_PAGE, ScoreSongList } from '@/widgets/scores/ScoreSongList'
import { ScoreSearchResults } from '@/widgets/scores/ScoreSearchResults'
import { ScorePrefList, type PrefRow } from '@/widgets/scores/ScorePrefList'
import { ScorePrefsEntries, type LibraryView } from '@/widgets/scores/ScorePrefsEntries'

const LAST_KEY = 'groovelab:scores:last'

/** The group and artist the student last looked at. */
interface LastPick {
  groupId?: string
  artistId?: string
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e))

function readLast(): LastPick {
  try {
    const raw = window.localStorage.getItem(LAST_KEY)
    if (!raw) return {}
    const o = JSON.parse(raw) as Record<string, unknown>
    return {
      groupId: typeof o.groupId === 'string' ? o.groupId : undefined,
      artistId: typeof o.artistId === 'string' ? o.artistId : undefined,
    }
  } catch {
    return {}
  }
}

function writeLast(pick: LastPick) {
  try {
    window.localStorage.setItem(LAST_KEY, JSON.stringify(pick))
  } catch {
    // Storage may be blocked; the selection is then simply not remembered.
  }
}

/**
 * 谱库: the student's own score folder, browsed where it is (desktop app
 * only). Categories | artists | the artist's songs, with search on top.
 */
export function ScoreLibraryPage() {
  const [state, setState] = useState<LibraryState | null>(null)
  const [scanning, setScanning] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    ScoreLibrary.state().then(
      (s) => alive && setState(s),
      (e: unknown) => alive && setLoadError(errText(e)),
    )
    return () => {
      alive = false
    }
  }, [])

  const run = async (task: () => Promise<LibraryState>) => {
    setBusy(true)
    setLoadError(null)
    try {
      setState(await task())
    } catch (e) {
      toast({ title: '谱库读取失败', description: errText(e), variant: 'error' })
    } finally {
      setScanning(null)
      setBusy(false)
    }
  }

  const root = state && 'root' in state ? state.root : null

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="font-mono text-xs uppercase tracking-[0.25em] text-muted-foreground">
            Score library
          </div>
          <h1 className="mt-2 flex items-center gap-3 text-4xl font-semibold">
            <FolderOpen className="h-9 w-9 text-amber" aria-hidden /> 谱库
          </h1>
          {root !== null && (
            <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
              {root}
              {state?.kind === 'ready' && (
                <>
                  <span className="font-sans"> · </span>
                  <span className="num font-sans">{state.files.toLocaleString()} 个文件</span>
                  <span className="font-sans">
                    {' '}
                    · 上次扫描 {new Date(state.scannedAt).toLocaleString('zh-CN')}
                  </span>
                </>
              )}
            </p>
          )}
          {scanning !== null && (
            <p role="status" className="num mt-2 text-sm text-muted-foreground">
              已找到 {scanning.toLocaleString()} 个文件…
            </p>
          )}
        </div>
        {(state?.kind === 'ready' || state?.kind === 'not-scanned') && (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(() => ScoreLibrary.rescan(setScanning))}
            >
              <RefreshCw aria-hidden /> 重新扫描
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => run(() => ScoreLibrary.pickRoot())}
            >
              <FolderPlus aria-hidden /> 换文件夹
            </Button>
          </div>
        )}
      </header>

      {loadError && (
        <p role="alert" className="text-sm text-destructive">
          读取谱库失败：{loadError}
        </p>
      )}

      {state === null && !loadError && (
        <p className="text-sm text-muted-foreground">正在打开谱库…</p>
      )}

      {state?.kind === 'no-app' && (
        <Card title="谱库要在应用版里用">
          <p>谱库需要直接读取电脑上的文件夹，网页版做不到。请打开桌面应用来使用。</p>
        </Card>
      )}

      {state?.kind === 'no-root' && (
        <Card title="选一个放吉他谱的文件夹">
          <p>例如 F:\吉他谱\吉他谱库。应用直接读取那里的文件，不会复制、不会改动。</p>
          <div className="pt-4">
            <Button disabled={busy} onClick={() => run(() => ScoreLibrary.pickRoot())}>
              <FolderOpen aria-hidden /> 选择文件夹
            </Button>
          </div>
        </Card>
      )}

      {state?.kind === 'not-scanned' && (
        <Card title="还没有扫描这个文件夹">
          <p>第一次扫描可能要一点时间，文件多时会慢一些。</p>
          <div className="pt-4">
            <Button disabled={busy} onClick={() => run(() => ScoreLibrary.rescan(setScanning))}>
              <Search aria-hidden /> 开始扫描
            </Button>
          </div>
        </Card>
      )}

      {state?.kind === 'ready' && (
        <LibraryBrowser categories={state.categories} onState={setState} />
      )}
    </div>
  )
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-3xl border border-dashed border-border/80 bg-card/60 p-10 text-center">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mx-auto mt-2 max-w-xl space-y-1 text-sm text-muted-foreground">
        {children}
      </div>
    </section>
  )
}

/** The browser proper: categories | artists | songs, with search replacing the last two. */
function LibraryBrowser({
  categories,
  onState,
}: {
  categories: ScoreCategory[]
  onState: (s: LibraryState) => void
}) {
  const allGroups = useMemo(() => categories.flatMap((c) => c.groups), [categories])
  const [sel, setSel] = useState<LastPick>(readLast)
  const [view, setView] = useState<LibraryView>('library')
  // Bumped after a merge: the artists and songs are read again.
  const [dataVersion, setDataVersion] = useState(0)
  const prefsVersion = useScorePrefsVersion()
  const [favRows, setFavRows] = useState<ScoreFavoriteRow[] | null>(null)
  const [recentRows, setRecentRows] = useState<ScoreRecentRow[] | null>(null)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const [sort, setSort] = useState<ArtistSort>('count')
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [found, setFound] = useState<{ q: string; result: ScoreSearchResult } | null>(null)
  const [artistData, setArtistData] = useState<{ groupId: string; list: ScoreArtist[] } | null>(
    null,
  )
  const [songData, setSongData] = useState<{ artistId: string; list: ScoreSong[] } | null>(null)
  const [more, setMore] = useState<{ artistId: string; limit: number }>({
    artistId: '',
    limit: SONG_PAGE,
  })

  // A stored group that no longer exists falls back to the first one.
  const activeGroup: ScoreGroup | undefined =
    allGroups.find((g) => g.id === sel.groupId) ?? allGroups[0]
  const groupId = activeGroup?.id ?? ''

  useEffect(() => {
    if (!groupId) return
    let alive = true
    ScoreLibrary.artists(groupId).then(
      (list) => alive && setArtistData({ groupId, list }),
      (e: unknown) => {
        if (!alive) return
        setArtistData({ groupId, list: [] })
        toast({ title: '读取歌手失败', description: errText(e), variant: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [groupId, dataVersion])

  const artists = useMemo(() => {
    if (artistData?.groupId !== groupId) return null
    // The library already sends artists by file count; the name order is sorted here.
    const list = [...artistData.list]
    return sort === 'count' ? list : list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'))
  }, [artistData, groupId, sort])

  // The remembered artist when it is in this group, otherwise the first one.
  const activeArtist: ScoreArtist | undefined =
    artists?.find((a) => a.id === sel.artistId) ?? artists?.[0]
  const artistId = activeArtist?.id ?? ''

  useEffect(() => {
    if (!artistId) return
    let alive = true
    ScoreLibrary.songs(artistId).then(
      (list) => alive && setSongData({ artistId, list }),
      (e: unknown) => {
        if (!alive) return
        setSongData({ artistId, list: [] })
        toast({ title: '读取谱子失败', description: errText(e), variant: 'error' })
      },
    )
    return () => {
      alive = false
    }
  }, [artistId, dataVersion])

  const songs = songData?.artistId === artistId ? songData.list : null
  const limit = more.artistId === artistId ? more.limit : SONG_PAGE

  // Search waits 150 ms after typing stops.
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 150)
    return () => window.clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!debounced) return
    let alive = true
    ScoreLibrary.search(debounced).then(
      (result) => alive && setFound({ q: debounced, result }),
      (e: unknown) =>
        alive && toast({ title: '搜索失败', description: errText(e), variant: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [debounced])

  // The starred scores (also the favourites count and the stars on the rows).
  useEffect(() => {
    let alive = true
    ScoreLibrary.favorites().then(
      (rows) => alive && setFavRows(rows),
      (e: unknown) =>
        alive && toast({ title: '读取收藏失败', description: errText(e), variant: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [prefsVersion])

  useEffect(() => {
    if (view !== 'recent') return
    let alive = true
    ScoreLibrary.recent().then(
      (rows) => alive && setRecentRows(rows),
      (e: unknown) =>
        alive && toast({ title: '读取最近打开失败', description: errText(e), variant: 'error' }),
    )
    return () => {
      alive = false
    }
  }, [view, prefsVersion])

  const favoritePaths = useMemo(() => new Set((favRows ?? []).map((r) => r.path)), [favRows])
  const toggleFavorite = useCallback((row: FavoriteInput) => {
    ScoreLibrary.toggleFavorite(row).catch((e: unknown) =>
      toast({ title: '没能收藏', description: errText(e), variant: 'error' }),
    )
  }, [])
  const favoritesValue = useMemo<FavoritesValue>(
    () => ({ paths: favoritePaths, toggle: toggleFavorite }),
    [favoritePaths, toggleFavorite],
  )

  const searching = debounced !== ''
  const searchResult = searching && found?.q === debounced ? found.result : null

  const pick = (nextGroupId: string, nextArtistId?: string) => {
    const next = { groupId: nextGroupId, artistId: nextArtistId }
    setView('library')
    setSel(next)
    writeLast(next)
  }

  /** Merges (or separates) artists; the library state comes back from the worker. */
  const merge = async (from: string, to: string | null, select?: ScoreArtist) => {
    try {
      onState(await ScoreLibrary.mergeArtist(from, to))
      setDataVersion((v) => v + 1)
      if (select) pick(select.groupId, select.id)
    } catch (e) {
      toast({ title: '没能合并', description: errText(e), variant: 'error' })
    }
  }

  const prefRows = (kind: 'favorites' | 'recent'): PrefRow[] | null => {
    if (kind === 'favorites') return favRows?.map((r) => ({ ...r, date: r.addedAt })) ?? null
    return recentRows?.map((r) => ({ ...r, date: r.openedAt })) ?? null
  }

  const toggleCategory = (cat: ScoreCategory) => {
    if (cat.groups.some((g) => g.id === groupId)) {
      setCollapsed((prev) => toggleIn(prev, cat.id))
      return
    }
    setCollapsed((prev) => withoutIn(prev, cat.id))
    pick(cat.groups[0].id)
  }

  const pickFromSearch = (a: ScoreArtist) => {
    pick(a.groupId, a.id)
    setQuery('')
    setDebounced('')
  }

  return (
    <FavoritesContext.Provider value={favoritesValue}>
      <div className="space-y-4">
        <div className="relative">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <Input
            type="search"
            aria-label="搜索谱库"
            placeholder="搜歌名、歌手，支持拼音、首字母、繁体和相近的写法"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-11 rounded-2xl pl-9 text-base"
            autoComplete="off"
          />
        </div>

        <div className="overflow-hidden rounded-3xl border border-border/80 bg-card">
          {searching ? (
            <ScoreSearchResults
              query={debounced}
              result={searchResult}
              onPickArtist={pickFromSearch}
            />
          ) : (
            <div className="lg:grid lg:grid-cols-[210px_280px_minmax(0,1fr)]">
              <div className="border-b border-border/80 lg:border-b-0 lg:border-r">
                <ScorePrefsEntries
                  view={view}
                  favoriteCount={favRows?.length ?? 0}
                  onPick={setView}
                />
                <ScoreCategoryList
                  categories={categories}
                  activeGroupId={view === 'library' ? groupId : ''}
                  collapsed={collapsed}
                  onPickGroup={(g) => pick(g.id)}
                  onToggle={toggleCategory}
                />
              </div>
              {view === 'library' ? (
                <>
                  <div className="min-w-0 border-b border-border/80 lg:border-b-0 lg:border-r">
                    {activeGroup && (
                      <ScoreArtistList
                        key={activeGroup.id}
                        group={activeGroup}
                        artists={artists}
                        sort={sort}
                        onSort={setSort}
                        activeArtistId={artistId || undefined}
                        onPick={(a) => pick(groupId, a.id)}
                      />
                    )}
                  </div>
                  <div className="min-w-0">
                    <ScoreSongList
                      artist={activeArtist}
                      songs={songs}
                      limit={limit}
                      onMore={() => setMore({ artistId, limit: limit + SONG_PAGE })}
                      onMerge={merge}
                    />
                  </div>
                </>
              ) : (
                <div className="min-w-0 lg:col-span-2">
                  <ScorePrefList
                    kind={view}
                    rows={prefRows(view)}
                    onUnstar={
                      view === 'favorites'
                        ? (row) =>
                            toggleFavorite({
                              path: row.path,
                              title: row.title,
                              artist: row.artist,
                              pages: row.pages,
                            })
                        : undefined
                    }
                  />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </FavoritesContext.Provider>
  )
}

function toggleIn(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(set)
  if (next.has(id)) next.delete(id)
  else next.add(id)
  return next
}

function withoutIn(set: ReadonlySet<string>, id: string): ReadonlySet<string> {
  if (!set.has(id)) return set
  const next = new Set(set)
  next.delete(id)
  return next
}
