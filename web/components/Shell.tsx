import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText, type LibraryInfo } from '../lib/api'
import { cx } from '../lib/classes'
import { useFavorites } from '../lib/favorites'
import { libraryName } from '../lib/format'
import { LibraryContext, type LibraryValue } from '../lib/libraryContext'
import { HREF_FAVORITES, hrefSearch, navigate, useRoute, type Route } from '../lib/route'
import { Link } from './Link'
import { Notice } from './ui'
import { Home } from '../pages/Home'
import { CategoryPage } from '../pages/CategoryPage'
import { ArtistsPage } from '../pages/ArtistsPage'
import { SongsPage } from '../pages/SongsPage'
import { SearchPage } from '../pages/SearchPage'
import { FavoritesPage } from '../pages/FavoritesPage'
import { Viewer } from '../viewer/Viewer'

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const ICON_BUTTON =
  'grid h-11 min-w-11 place-items-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40'

/** Goes to 目录 and scrolls to 最近看过 (the phone's 「最近」 tab). */
function showRecent() {
  navigate('#/')
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  window.setTimeout(
    () =>
      document
        .getElementById('recent')
        ?.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' }),
    50,
  )
}

/** The signed-in page: the library state (shared by every page), the top bar and the current page. */
export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const route = useRoute()
  const { items: favorites } = useFavorites()
  const [info, setInfo] = useState<LibraryInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const polling = useRef(false)

  /** Reads the library until the scan has finished, then refreshes every page. */
  const poll = useCallback(async () => {
    if (polling.current) return
    polling.current = true
    try {
      let next: LibraryInfo
      do {
        await delay(1200)
        next = await api.library()
        setInfo(next)
      } while (next.scanning)
      setError(null)
      setVersion((v) => v + 1)
    } catch (e) {
      setError(errorText(e))
    } finally {
      polling.current = false
    }
  }, [])

  const load = useCallback(async () => {
    try {
      const next = await api.library()
      setInfo(next)
      setError(null)
      if (next.scanning) void poll()
    } catch (e) {
      setError(errorText(e))
    }
  }, [poll])

  useEffect(() => {
    void load()
  }, [load])

  // Ctrl/⌘ + K opens 搜索谱 (or focuses its field when it is already open).
  const routeKind = route.kind
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (routeKind === 'search') document.getElementById('song-search')?.focus()
        else navigate(hrefSearch())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [routeKind])

  const rescan = useCallback(async () => {
    setError(null)
    try {
      await api.rescan()
      setInfo((i) => (i ? { ...i, scanning: true } : i))
      await poll()
    } catch (e) {
      setError(errorText(e))
    }
  }, [poll])

  const logout = () => {
    api
      .logout()
      .catch(() => undefined)
      .finally(onLoggedOut)
  }

  const scanning = info?.scanning ?? false
  const value: LibraryValue = useMemo(
    () => ({
      info,
      error,
      version,
      scanning,
      reload: () => void load(),
      rescan: () => void rescan(),
    }),
    [info, error, version, scanning, load, rescan],
  )

  const onViewer = route.kind === 'viewer'

  return (
    <LibraryContext.Provider value={value}>
      <div className="flex min-h-dvh flex-col">
        <header
          className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-[10px]"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="gutter mx-auto flex h-[54px] w-full max-w-[1180px] items-center gap-3">
            <Link href="#/" className="flex min-w-0 flex-1 items-baseline gap-2.5">
              <span className="font-display text-xl font-black tracking-[0.02em]">谱库</span>
              <small className="mono min-w-0 truncate text-[11px] text-muted-foreground">
                {scanning
                  ? '正在扫描文件夹…'
                  : info
                    ? `${libraryName(info.root)} · ${info.files.toLocaleString('zh-CN')}`
                    : ' '}
              </small>
            </Link>

            <Link
              href={hrefSearch()}
              ariaLabel="搜索谱"
              className="hidden h-9 items-center gap-2.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-card min-[861px]:flex"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="10.5" cy="10.5" r="6.5" />
                <path d="M15.5 15.5 21 21" />
              </svg>
              <span>搜索谱</span>
              <kbd className="mono rounded-[4px] border border-border px-1.5 text-[11px]">
                Ctrl K
              </kbd>
            </Link>

            <Link
              href={HREF_FAVORITES}
              ariaLabel={`我的收藏，${favorites.length} 个`}
              className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-foreground transition-colors hover:bg-card min-[861px]:flex"
            >
              <span aria-hidden className="text-primary">
                ★
              </span>
              <span className="mono text-xs text-primary">{favorites.length}</span>
            </Link>

            <button
              type="button"
              onClick={() => value.rescan()}
              disabled={scanning || !info}
              className={ICON_BUTTON}
              aria-label={scanning ? '正在扫描' : '重新扫描'}
              title="重新扫描"
            >
              <span
                aria-hidden
                className={cx('text-lg leading-none', scanning && 'inline-block animate-spin')}
              >
                ↻
              </span>
            </button>
            <button
              type="button"
              onClick={logout}
              className={ICON_BUTTON}
              aria-label="退出登录"
              title="退出登录"
            >
              <span aria-hidden className="text-lg leading-none">
                ⏻
              </span>
            </button>
          </div>
        </header>

        <main
          className={cx(
            'mx-auto w-full flex-1',
            // The score fills the whole window; every other page sits in the 1180 px column.
            onViewer
              ? 'max-w-none'
              : 'gutter max-w-[1180px] pb-[max(2rem,env(safe-area-inset-bottom))] pt-2 max-[860px]:pb-[calc(72px_+_env(safe-area-inset-bottom,0px))]',
          )}
        >
          {info || onViewer ? (
            renderRoute(route)
          ) : error ? (
            <Notice tone="error">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => value.reload()}
                className="mt-3 inline-flex min-h-11 items-center rounded-lg border border-border px-4 text-sm text-foreground hover:border-foreground"
              >
                重试
              </button>
            </Notice>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">正在读取谱库…</p>
          )}
        </main>

        {!onViewer && <TabBar route={route} />}
      </div>
    </LibraryContext.Provider>
  )
}

/** The phone's bottom navigation: 目录 / 搜索 / 收藏 / 最近. */
function TabBar({ route }: { route: Route }) {
  const current = route.kind === 'search' ? 'search' : route.kind === 'favorites' ? 'fav' : 'toc'
  const tab = (
    id: 'toc' | 'search' | 'fav' | 'recent',
    icon: string,
    label: string,
    onClick: () => void,
  ) => {
    const on = id === current
    return (
      <button
        key={id}
        type="button"
        onClick={onClick}
        aria-current={on ? 'page' : undefined}
        className={cx(
          'grid justify-items-center gap-0.5 py-1 text-[11px] transition-colors',
          on ? 'text-primary' : 'text-muted-foreground',
        )}
      >
        <b
          aria-hidden
          className={cx(
            'grid h-[30px] w-[52px] place-items-center rounded-full text-lg font-normal',
            on && 'bg-primary text-primary-foreground',
          )}
        >
          {icon}
        </b>
        {label}
      </button>
    )
  }
  return (
    <nav
      aria-label="主导航"
      className="fixed inset-x-0 bottom-0 z-[35] grid grid-cols-4 gap-1 border-t border-border bg-background/95 px-4 pt-1.5 backdrop-blur-[12px] min-[861px]:hidden"
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
    >
      {tab('toc', '☰', '目录', () => navigate('#/'))}
      {tab('search', '⌕', '搜索', () => navigate(hrefSearch()))}
      {tab('fav', '★', '收藏', () => navigate(HREF_FAVORITES))}
      {tab('recent', '◷', '最近', showRecent)}
    </nav>
  )
}

function renderRoute(route: Route) {
  switch (route.kind) {
    case 'home':
      return <Home />
    case 'category':
      return <CategoryPage id={route.id} />
    case 'group':
      return <ArtistsPage key={route.id} group={route} />
    case 'artist':
      return <SongsPage key={route.id} artist={route} />
    case 'search':
      return <SearchPage q={route.q} />
    case 'favorites':
      return <FavoritesPage />
    case 'viewer':
      return <Viewer key={route.path} route={route} />
  }
}
