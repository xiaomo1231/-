import { useEffect, useState } from 'react'
import { api, ApiError, AUTH_LOST, errorText } from './lib/api'
import { LoginScreen } from './components/Login'
import { Shell } from './components/Shell'

type Auth = 'checking' | 'in' | 'out'

export function App() {
  const [auth, setAuth] = useState<Auth>('checking')
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    const lost = () => setAuth('out')
    window.addEventListener(AUTH_LOST, lost)
    api.me().then(
      () => setAuth('in'),
      (e: unknown) => {
        if (!(e instanceof ApiError && e.status === 401)) setNotice(errorText(e))
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
        onLoggedIn={() => {
          setNotice(null)
          setAuth('in')
        }}
      />
    )
  }
  return <Shell onLoggedOut={() => setAuth('out')} />
}
