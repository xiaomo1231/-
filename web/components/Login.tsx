import { useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { Staff } from './ui'

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
      <div className="w-full max-w-sm">
        <h1 className="m-0 font-display text-[clamp(56px,14vw,96px)] font-black leading-none tracking-[-0.02em]">
          谱库
        </h1>
        <div className="mt-6">
          <Staff />
        </div>

        <form onSubmit={submit} className="mt-8 space-y-4">
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">输入密码，打开你的吉他谱</span>
            <input
              type="password"
              name="password"
              autoComplete="current-password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-lg border border-border bg-card px-4 text-base text-foreground outline-none transition-colors focus:border-primary"
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
            className={buttonClass('primary') + ' h-12 w-full text-base'}
          >
            {busy ? '正在打开…' : '打开谱库'}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-muted-foreground">
          只读：在这里看谱、下载，谱库里的文件不会被改动。
        </p>
      </div>
    </main>
  )
}
