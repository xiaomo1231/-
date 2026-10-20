import { useEffect, useRef, useState } from 'react'
import type { UserInfo } from '@/songs/scoreServerTypes'
import { api, ApiError, AUTH_LOST, errorText } from './lib/api'
import { reloadMe } from './lib/band'
import { setMe } from './lib/session'
import { navigate, useRoute } from './lib/route'
import { InvitePage } from './pages/InvitePage'
import { LoginScreen } from './components/Login'
import { Shell } from './components/Shell'

type Auth = 'checking' | 'in' | 'out'

export function App() {
  const [auth, setAuth] = useState<Auth>('checking')
  const [notice, setNotice] = useState<string | null>(null)
  /** On an invite, signed out: show the login first (the invite stays in the address). */
  const [loginFirst, setLoginFirst] = useState(false)
  const route = useRoute()
  /** The account last signed in on this page (its stores live in memory). */
  const lastUser = useRef<string | null>(null)
  const signedIn = (u: UserInfo) => {
    // Someone else signs in after a lost session: start from a fresh page, so nothing of
    // the previous account (favourites, practice, band, 每日一练) is shown to them.
    if (lastUser.current && lastUser.current !== u.id) {
      window.location.reload()
      return
    }
    lastUser.current = u.id
    setNotice(null)
    setLoginFirst(false)
    setMe(u)
    setAuth('in')
    // The login answer has no bands: read them.
    void reloadMe()
  }

  useEffect(() => {
    const lost = () => {
      setMe(null)
      setAuth('out')
    }
    window.addEventListener(AUTH_LOST, lost)
    api.me().then(
      (u: UserInfo) => {
        lastUser.current = u.id
        setMe(u)
        setAuth('in')
      },
      (e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) setNotice(errorText(e))
        setMe(null)
        setAuth('out')
      },
    )
    return () => window.removeEventListener(AUTH_LOST, lost)
  }, [])

  if (auth === 'checking') {
    return (
      <p className="grid min-h-dvh place-items-center text-sm text-muted-foreground">
        正在连接谱库…
      </p>
    )
  }
  if (auth === 'out' && route.kind === 'invite' && !loginFirst) {
    return (
      <main className="gutter grid min-h-dvh place-items-center py-10">
        <div className="w-full max-w-sm">
          <InvitePage
            token={route.token}
            onJoined={(u) => {
              signedIn(u)
              navigate('#/b')
            }}
            onLogin={route.token ? () => setLoginFirst(true) : undefined}
          />
          <p className="mt-6 text-center text-sm">
            <button
              type="button"
              onClick={() => navigate('#/')}
              className="text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              已有账号？去登录
            </button>
          </p>
        </div>
      </main>
    )
  }
  if (auth === 'out') {
    return (
      <LoginScreen
        notice={notice}
        onLoggedIn={signedIn}
      />
    )
  }
  return <Shell onLoggedOut={() => setAuth('out')} />
}
