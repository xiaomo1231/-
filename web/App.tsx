import { useEffect, useState } from 'react'
import type { UserInfo } from '@/songs/scoreServerTypes'
import { api, ApiError, AUTH_LOST, errorText } from './lib/api'
import { setMe } from './lib/session'
import { LoginScreen } from './components/Login'
import { Shell } from './components/Shell'

type Auth = 'checking' | 'in' | 'out'

export function App() {
  const [auth, setAuth] = useState<Auth>('checking')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const lost = () => {
      setMe(null)
      setAuth('out')
    }
    window.addEventListener(AUTH_LOST, lost)
    api.me().then(
      (u: UserInfo) => {
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
  if (auth === 'out') {
    return (
      <LoginScreen
        notice={notice}
        onLoggedIn={(u) => {
          setNotice(null)
          setMe(u)
          setAuth('in')
        }}
      />
    )
  }
  return <Shell onLoggedOut={() => setAuth('out')} />
}
