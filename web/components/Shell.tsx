import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText, type LibraryInfo, type UserInfo } from '../lib/api'
import { cx } from '../lib/classes'
import { useFavorites } from '../lib/favorites'
import { LibraryContext, type LibraryValue } from '../lib/libraryContext'
import { useMe } from '../lib/session'
import {
  HREF_ACCOUNT,
  HREF_BAND,
  HREF_DAILY,
  HREF_FAVORITES,
  HREF_USERS,
  hrefSearch,
  navigate,
  useRoute,
  type Route,
} from '../lib/route'
import { Link } from './Link'
import { Notice } from './ui'
import { Home } from '../pages/Home'
import { CategoryPage } from '../pages/CategoryPage'
import { ArtistsPage } from '../pages/ArtistsPage'
import { SongsPage } from '../pages/SongsPage'
import { SearchPage } from '../pages/SearchPage'
import { FavoritesPage } from '../pages/FavoritesPage'
import { BandPage } from '../pages/BandPage'
import { BandSongPage } from '../pages/BandSongPage'
import { EnsemblesPage } from '../pages/EnsemblesPage'
import { AccountPage } from '../pages/AccountPage'
import { UsersPage } from '../pages/UsersPage'
import { DrumEditorPage } from '../pages/DrumEditorPage'
import { CombinePage } from '../pages/CombinePage'
import { DailyPage } from '../pages/DailyPage'
import { InvitePage } from '../pages/InvitePage'
import { Viewer } from '../viewer/Viewer'

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

const ICON_BUTTON =
  'grid h-11 min-w-11 place-items-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-card hover:text-foreground disabled:opacity-40'

/** Pages that read the score library; members without library access get the band page instead. */
const LIBRARY_ROUTES: ReadonlySet<Route['kind']> = new Set<Route['kind']>([
  'home',
  'category',
  'group',
  'artist',
  'search',
  'favorites',
])

/** The signed-in page: the library state (shared by every page), the top bar and the current page. */
export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const route = useRoute()
  const me = useMe()
  const { items: favorites } = useFavorites()
  const [info, setInfo] = useState<LibraryInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const polling = useRef(false)

  const isAdmin = me?.role === 'admin'
  // Members without library access only see the band (their setlists) and their account.
  const libraryHidden = me !== null && me.role === 'member' && !me.libraryAccess

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
    if (!libraryHidden) void load()
  }, [load, libraryHidden])

  // Ctrl/⌘ + K opens 搜索谱 (or focuses its field when it is already open).
  const routeKind = route.kind
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (libraryHidden) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        if (routeKind === 'search') document.getElementById('song-search')?.focus()
        else navigate(hrefSearch())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [routeKind, libraryHidden])

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
      // A fresh page: favourites, practice and the band from this account are not kept in memory.
      .finally(() => {
        onLoggedOut()
        window.location.reload()
      })
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
  // Band and account pages do not need the library, so they never wait for it.
  const pageReady = info !== null || onViewer || libraryHidden || !LIBRARY_ROUTES.has(route.kind)

  return (
    <LibraryContext.Provider value={value}>
      <div className="flex min-h-dvh flex-col">
        <header
          className="sticky top-0 z-30 border-b border-border bg-background/90 backdrop-blur-[10px]"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="gutter mx-auto flex h-[54px] w-full max-w-[1180px] items-center gap-3">
            <Link
              href={libraryHidden ? HREF_BAND : '#/'}
              className="flex min-w-0 flex-1 items-baseline gap-2.5"
            >
              <span className="font-display text-xl font-black tracking-[0.02em]">谱库</span>
            </Link>

            {!libraryHidden && (
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
            )}

            {!libraryHidden && (
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
            )}

            <Link
              href={HREF_DAILY}
              className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-foreground transition-colors hover:bg-card min-[861px]:flex"
            >
              <span aria-hidden className="text-primary">
                ◷
              </span>
              <span className="text-sm">每日一练</span>
            </Link>

            <Link
              href={HREF_BAND}
              className="hidden h-9 items-center gap-1.5 rounded-lg px-3 text-foreground transition-colors hover:bg-card min-[861px]:flex"
            >
              <span aria-hidden className="text-primary">
                ♫
              </span>
              <span className="text-sm">乐队</span>
            </Link>

            {me && <AccountLinks me={me} />}

            {isAdmin && (
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
            )}
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
          {pageReady ? (
            renderRoute(route, libraryHidden)
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

        {!onViewer && <TabBar route={route} libraryHidden={libraryHidden} />}
      </div>
    </LibraryContext.Provider>
  )
}

/** Top-bar account entries: 成员 (admins only) and the signed-in user's name, both to their pages. */
function AccountLinks({ me }: { me: UserInfo }) {
  return (
    <>
      {me.role === 'admin' && (
        <Link
          href={HREF_USERS}
          className="flex h-9 items-center rounded-lg px-2.5 text-sm text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          成员
        </Link>
      )}
      <Link
        href={HREF_ACCOUNT}
        ariaLabel={`我的账号：${me.displayName}`}
        className="flex h-9 max-w-[10rem] items-center gap-1.5 rounded-lg px-2.5 text-sm text-foreground transition-colors hover:bg-card"
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
          className="shrink-0"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21c0-4.4 3.6-7 8-7s8 2.6 8 7" />
        </svg>
        <span className="hidden truncate min-[861px]:inline">{me.displayName}</span>
      </Link>
    </>
  )
}

/** The phone's bottom navigation: 目录 / 搜索 / 乐队 / 每日 / 收藏, or 乐队 / 每日 / 我的 without library access (最近看过 is on 目录). */
function TabBar({ route, libraryHidden }: { route: Route; libraryHidden: boolean }) {
  const current =
    route.kind === 'band' || route.kind === 'bandSong' || route.kind === 'ensembles'
      ? 'band'
      : route.kind === 'daily'
        ? 'daily'
        : route.kind === 'account' || route.kind === 'users'
          ? 'me'
          : route.kind === 'search'
            ? 'search'
            : route.kind === 'favorites'
              ? 'fav'
              : 'toc'
  const tab = (
    id: 'toc' | 'search' | 'band' | 'daily' | 'fav' | 'me',
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
      className={cx(
        'fixed inset-x-0 bottom-0 z-[35] grid gap-1 border-t border-border bg-background/95 px-4 pt-1.5 backdrop-blur-[12px] min-[861px]:hidden',
        libraryHidden ? 'grid-cols-3' : 'grid-cols-5',
      )}
      style={{ paddingBottom: 'max(8px, env(safe-area-inset-bottom))' }}
    >
      {!libraryHidden && tab('toc', '☰', '目录', () => navigate('#/'))}
      {!libraryHidden && tab('search', '⌕', '搜索', () => navigate(hrefSearch()))}
      {tab('band', '♫', '乐队', () => navigate(HREF_BAND))}
      {tab('daily', '◷', '每日', () => navigate(HREF_DAILY))}
      {!libraryHidden && tab('fav', '★', '收藏', () => navigate(HREF_FAVORITES))}
      {libraryHidden && tab('me', '☺', '我的', () => navigate(HREF_ACCOUNT))}
    </nav>
  )
}

function renderRoute(route: Route, libraryHidden: boolean) {
  if (libraryHidden && LIBRARY_ROUTES.has(route.kind)) return <BandPage />
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
    case 'band':
      return <BandPage />
    case 'bandSong':
      return <BandSongPage key={route.id} id={route.id} />
    case 'ensembles':
      return <EnsemblesPage q={route.q} need={route.need} />
    case 'account':
      return <AccountPage />
    case 'users':
      return <UsersPage />
    case 'daily':
      return <DailyPage key={route.day ?? 0} day={route.day} />
    case 'invite':
      return <InvitePage key={route.token} token={route.token} />
    case 'combine':
      return <CombinePage key={route.path + route.id} path={route.path} id={route.id} />
    case 'drums':
      return (
        <DrumEditorPage
          key={route.path}
          path={route.path}
          title={route.title}
          artist={route.artist}
        />
      )
    case 'viewer':
      // The viewer takes the whole route, including `band` (the setlist it was opened from).
      return <Viewer key={route.path} route={route} />
  }
}
