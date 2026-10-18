import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, errorText, type LibraryInfo } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { libraryName } from '../lib/format'
import { LibraryContext, type LibraryValue } from '../lib/libraryContext'
import { useRoute, type Route } from '../lib/route'
import { Link } from './Link'
import { Notice } from './ui'
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
          className="sticky top-0 z-20 border-b border-border/70 bg-background/95 backdrop-blur"
          style={{ paddingTop: 'env(safe-area-inset-top)' }}
        >
          <div className="gutter mx-auto flex w-full max-w-3xl items-center justify-between gap-3 py-3">
            <Link href="#/" className="min-w-0 flex-1">
              <span className="block truncate font-display text-lg font-semibold">谱库</span>
              <span className="block truncate text-xs text-muted-foreground">
                {scanning ? '正在扫描文件夹…' : info ? libraryName(info.root) : ' '}
              </span>
            </Link>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={() => value.rescan()}
                disabled={scanning || !info}
                className={buttonClass('outline')}
              >
                {scanning ? '扫描中…' : '重新扫描'}
              </button>
              <button type="button" onClick={logout} className={buttonClass('ghost')}>
                退出登录
              </button>
            </div>
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
