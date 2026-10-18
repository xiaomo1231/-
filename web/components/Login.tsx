import { useState, type FormEvent } from 'react'
import { api, ApiError, errorText } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { Seal, StringsArt } from './Brand'

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
  const [pluck, setPluck] = useState(0)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!password || busy) return
    setBusy(true)
    setError(null)
    setPluck((n) => n + 1)
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
        <div className="flex items-center gap-3">
          <Seal size={44} />
          <div>
            <h1 className="font-display text-3xl font-black leading-none">谱库</h1>
            <p className="eyebrow mt-1.5">Guitar tab archive</p>
          </div>
        </div>

        <StringsArt pluck={pluck} className="mt-8 h-16 w-full" />

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
              onFocus={() => setPluck((n) => n + 1)}
              className="mono h-12 w-full rounded-xl border border-border bg-card px-4 text-base tracking-widest text-foreground outline-none transition-colors focus:border-primary"
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
