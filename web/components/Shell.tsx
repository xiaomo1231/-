import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText, type LibraryInfo } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { libraryName } from '../lib/format'
import { LibraryContext, type LibraryValue } from '../lib/libraryContext'
import { useRoute, type Route } from '../lib/route'
import { Link } from './Link'
import { Notice } from './ui'
import { Seal } from './Brand'
import { Home } from '../pages/Home'
import { CategoryPage } from '../pages/CategoryPage'
import { ArtistsPage } from '../pages/ArtistsPage'
import { SongsPage } from '../pages/SongsPage'
import { Viewer } from '../viewer/Viewer'

const delay = (ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms))

/** The signed-in page: the library state (shared by every page), the header and the current page. */
export function Shell({ onLoggedOut }: { onLoggedOut: () => void }) {
  const route = useRoute()
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

  return (
    <LibraryContext.Provider value={value}>
      <div className="flex min-h-dvh flex-col">
        <header
          className="sticky top-0 z-20 border-b border-border/60 bg-background/85 backdrop-blur-md"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="gutter mx-auto flex w-full max-w-3xl items-center gap-3 py-2.5">
            <Link href="#/" className="flex min-w-0 flex-1 items-center gap-2.5" ariaLabel="回到谱库首页">
              <Seal size={30} />
              <span className="min-w-0">
                <span className="block truncate font-display text-base font-black leading-tight">
                  谱库
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {scanning ? '正在扫描文件夹…' : info ? libraryName(info.root) : ' '}
                </span>
              </span>
            </Link>
            <button
              type="button"
              onClick={() => value.rescan()}
              disabled={scanning || !info}
              className={buttonClass('ghost') + ' w-11 px-0 sm:w-auto sm:px-3'}
              aria-label={scanning ? '正在扫描' : '重新扫描'}
              title="重新扫描"
            >
              <span aria-hidden className={scanning ? 'inline-block animate-spin' : 'inline-block'}>
                ↻
              </span>
              <span className="hidden sm:inline">{scanning ? '扫描中…' : '重新扫描'}</span>
            </button>
            <button
              type="button"
              onClick={logout}
              className={buttonClass('ghost') + ' w-11 px-0 sm:w-auto sm:px-3'}
              aria-label="退出登录"
              title="退出登录"
            >
              <span aria-hidden>⏻</span>
              <span className="hidden sm:inline">退出</span>
            </button>
          </div>
        </header>

        <main className="gutter mx-auto w-full max-w-3xl flex-1 pb-[max(2rem,env(safe-area-inset-bottom))] pt-2">
          {info || route.kind === 'viewer' ? (
            renderRoute(route)
          ) : error ? (
            <Notice tone="error">
              <p>{error}</p>
              <button
                type="button"
                onClick={() => value.reload()}
                className={buttonClass('outline') + ' mt-3'}
              >
                重试
              </button>
            </Notice>
          ) : (
            <p className="py-16 text-center text-sm text-muted-foreground">正在读取谱库…</p>
          )}
        </main>
      </div>
    </LibraryContext.Provider>
  )
}

function renderRoute(route: Route) {
  switch (route.kind) {
    case 'home':
      return <Home />
    case 'category':
      return <CategoryPage id={route.id} />
    case 'group':
      return <ArtistsPage group={route} />
    case 'artist':
      return <SongsPage artist={route} />
    case 'viewer':
      return <Viewer key={route.path} route={route} />
  }
}
