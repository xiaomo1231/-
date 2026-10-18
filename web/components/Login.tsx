import { useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from '../lib/api'
import { buttonClass } from '../lib/classes'

function loginMessage(e: unknown): string {
  if (e instanceof ApiError && e.status === 401) return '密码不对，请再试一次。'
  if (e instanceof ApiError && e.status === 429) return e.message
  return errorText(e)
}

export function LoginScreen({
  notice,
  onLoggedIn,
}: {
  notice: string | null
  onLoggedIn: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(notice)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    try {
      await api.login(password)
      setPassword('')
      onLoggedIn()
    } catch (err) {
      setError(loginMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="gutter grid min-h-dvh place-items-center py-10">
      <div className="w-full max-w-sm space-y-6">
        <div className="text-center">
          <h1 className="font-display text-3xl font-semibold">谱库</h1>
          <p className="mt-2 text-sm text-muted-foreground">输入密码后查看你的吉他谱</p>
        </div>
        <form
          onSubmit={submit}
          className="space-y-4 rounded-3xl border border-border/80 bg-card p-5"
        >
          <label className="block space-y-2">
            <span className="text-sm font-medium">密码</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-border bg-background px-3 text-base text-foreground outline-none focus:border-ring"
            />
          </label>
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className={buttonClass('primary') + ' w-full'}
          >
            {busy ? '正在登录…' : '登录'}
          </button>
        </form>
      </div>
    </main>
  )
}
