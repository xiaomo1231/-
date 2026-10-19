import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Instrument, InviteCheck, UserInfo } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass } from '../lib/classes'
import { HREF_BAND } from '../lib/route'
import { INSTRUMENT_LABELS, useMe } from '../lib/session'
import { Link } from '../components/Link'
import { Notice, Staff } from '../components/ui'

const FIELD =
  'h-12 w-full rounded-lg border border-border bg-card px-4 text-base text-foreground outline-none transition-colors focus:border-primary'

const MIN_PASSWORD = 6
const NAME_MIN = 2
const NAME_MAX = 32

/** A labelled form row. */
function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted-foreground">{hint}</span>}
    </label>
  )
}

/** 邀请链接页: a new member opens the link, picks a login name and password, and joins the band. */
export function InvitePage({
  token,
  onJoined,
}: {
  token: string
  onJoined?: (u: UserInfo) => void
}) {
  const me = useMe()
  const [check, setCheck] = useState<InviteCheck | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [instrument, setInstrument] = useState<Instrument | ''>('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    api.checkInvite(token).then(
      (res) => {
        if (cancelled) return
        setCheck(res)
        setInstrument(res.instrument ?? '')
      },
      (e: unknown) => {
        if (!cancelled) setLoadError(errorText(e))
      },
    )
    return () => {
      cancelled = true
    }
  }, [token])

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const name = username.trim()
    const shown = displayName.trim()
    const nameLen = [...name].length
    if (nameLen < NAME_MIN || nameLen > NAME_MAX) {
      setError(`用户名需要 ${NAME_MIN}–${NAME_MAX} 位，只能用字母、数字、_、- 或汉字。`)
      return
    }
    if (!shown) {
      setError('请输入显示名称。')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`密码至少 ${MIN_PASSWORD} 位。`)
      return
    }
    if (password !== password2) {
      setError('两次输入的密码不一样，请再输入一次。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const user = await api.acceptInvite({
        token,
        username: name,
        displayName: shown,
        password,
        instrument: instrument || null,
      })
      setPassword('')
      setPassword2('')
      onJoined?.(user)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  if (me) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 py-8">
        <Staff />
        <Notice>
          你已经登录为「{me.displayName}」。这个链接是给新成员注册用的，请发给要加入的人。
        </Notice>
        <Link
          href={HREF_BAND}
          className={buttonClass('outline') + ' inline-flex h-11 items-center px-4'}
        >
          去乐队页
        </Link>
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 py-8">
        <Staff />
        <Notice tone="error">{loadError}</Notice>
      </div>
    )
  }

  if (!check) {
    return (
      <div className="mx-auto w-full max-w-sm py-8">
        <p className="text-sm text-muted-foreground">正在检查邀请链接…</p>
      </div>
    )
  }

  if (!check.valid) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 py-8">
        <Staff />
        <Notice tone="error">{check.reason ?? '这个邀请链接不能用了。'}</Notice>
        <p className="text-xs text-muted-foreground">请向乐队管理员要一个新的邀请链接。</p>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <h1 className="m-0 font-display text-[clamp(36px,10vw,56px)] font-black leading-tight tracking-[-0.02em]">
        加入「{check.bandName}」
      </h1>
      <div className="mt-5">
        <Staff />
      </div>
      {check.note && (
        <p className="mt-5 text-sm leading-relaxed text-muted-foreground">{check.note}</p>
      )}

      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="用户名" hint="2–32 位，字母、数字、_、- 或中文。以后用来登录。">
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus
            maxLength={NAME_MAX}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="显示名称">
          <input
            type="text"
            name="displayName"
            maxLength={NAME_MAX}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label={`密码（至少 ${MIN_PASSWORD} 位）`}>
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="再输一次密码">
          <input
            type="password"
            name="password2"
            autoComplete="new-password"
            value={password2}
            onChange={(e) => setPassword2(e.target.value)}
            className={FIELD}
          />
        </Field>
        <Field label="乐器">
          <select
            name="instrument"
            value={instrument}
            onChange={(e) => setInstrument(e.target.value as Instrument | '')}
            className={FIELD}
          >
            {(Object.keys(INSTRUMENT_LABELS) as Instrument[]).map((k) => (
              <option key={k} value={k}>
                {INSTRUMENT_LABELS[k]}
              </option>
            ))}
            <option value="">不选</option>
          </select>
        </Field>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || !username || !displayName || !password || !password2}
          className={buttonClass('primary') + ' h-12 w-full text-base'}
        >
          {busy ? '正在创建账号…' : '创建账号并加入'}
        </button>
      </form>
    </div>
  )
}
