import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Instrument, InviteCheck, UserInfo } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { reloadMe } from '../lib/band'
import { buttonClass } from '../lib/classes'
import { HREF_BAND, navigate } from '../lib/route'
import { INSTRUMENT_LABELS, chooseBand, useMe } from '../lib/session'
import { Notice } from '../components/ui'

const FIELD =
  'h-12 w-full rounded-lg border border-border bg-card px-4 text-base text-foreground outline-none transition-colors focus:border-primary'

const MIN_PASSWORD = 6
const NAME_MIN = 2
const NAME_MAX = 32
const BAND_NAME_MAX = 40

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

const Title = ({ children }: { children: ReactNode }) => (
  <h1 className="m-0 font-display text-[clamp(36px,10vw,56px)] font-black leading-tight tracking-[-0.02em]">
    {children}
  </h1>
)

/** 输入邀请码: the code as typed goes into the address (spaces dropped), then it is checked. */
function CodeEntry() {
  const me = useMe()
  const [code, setCode] = useState('')
  const clean = code.replace(/\s+/g, '').toUpperCase()
  const ok = /^[A-Z0-9_-]{10,64}$/i.test(clean)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (ok) navigate(`#/invite/${clean}`)
  }
  return (
    <div className="mx-auto w-full max-w-sm">
      <Title>{me ? '用邀请码加入乐队' : '用邀请码注册'}</Title>
      <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
        {me ? '用现在的账号加入另一个乐队，不用再注册。' : '谱库只对受邀的人开放。'}
        向队长要一个邀请码（像 <span className="mono">K7QM3-PXD2A</span>），填在下面。
      </p>
      <form onSubmit={submit} className="mt-8 space-y-4">
        <Field label="邀请码">
          <input
            type="text"
            name="code"
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            autoFocus
            maxLength={64}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className={FIELD + ' mono tracking-[0.15em]'}
          />
        </Field>
        <button type="submit" disabled={!ok} className={buttonClass('primary') + ' h-12 w-full text-base'}>
          下一步
        </button>
      </form>
    </div>
  )
}

/** The band name a leader invite asks for. */
function BandNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="乐队名" hint="你会是这个乐队的队长，之后可以邀请成员，也可以改名。">
      <input
        type="text"
        name="bandName"
        maxLength={BAND_NAME_MAX}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
      />
    </Field>
  )
}

/**
 * 邀请码页 (#/invite/<code>, or #/invite to type one): signed out, the person makes an
 * account; signed in, the account joins the band (or, with a leader invite, starts one).
 */
export function InvitePage({
  token,
  onJoined,
  onLogin,
}: {
  token: string
  onJoined?: (u: UserInfo) => void
  /** Signed out: sign in with an existing account first (the invite stays open). */
  onLogin?: () => void
}) {
  const me = useMe()
  const [check, setCheck] = useState<InviteCheck | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [instrument, setInstrument] = useState<Instrument | ''>('')
  const [bandName, setBandName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) return
    let cancelled = false
    setCheck(null)
    setLoadError(null)
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

  if (!token) return <CodeEntry />

  const leader = check?.kind === 'leader'
  const bandNameOk = !leader || [...bandName.trim()].length >= 1

  /** Signed in: use the invite with this account. */
  const join = async () => {
    if (busy || !bandNameOk) return
    setBusy(true)
    setError(null)
    try {
      const { bandId } = await api.joinInvite({ token, ...(leader ? { bandName: bandName.trim() } : {}) })
      await reloadMe()
      chooseBand(bandId)
      navigate(HREF_BAND)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

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
    if (!bandNameOk) {
      setError('请给你的乐队起个名字。')
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
        ...(leader ? { bandName: bandName.trim() } : {}),
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

  if (loadError) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 py-8">
        <Notice tone="error">{loadError}</Notice>
      </div>
    )
  }

  if (!check) {
    return (
      <div className="mx-auto w-full max-w-sm py-8">
        <p className="text-sm text-muted-foreground">正在检查邀请码…</p>
      </div>
    )
  }

  if (!check.valid) {
    return (
      <div className="mx-auto w-full max-w-sm space-y-6 py-8">
        <Notice tone="error">{check.reason ?? '这个邀请码不能用了。'}</Notice>
        <p className="text-xs text-muted-foreground">请向邀请你的人要一个新的邀请码。</p>
        <button
          type="button"
          onClick={() => navigate('#/invite')}
          className={buttonClass('outline') + ' h-11 px-4'}
        >
          换一个邀请码
        </button>
      </div>
    )
  }

  const heading = leader ? '创建你的乐队' : `加入「${check.bandName}」`
  const intro = (
    <>
      {check.inviter && (
        <p className="mt-4 text-sm text-muted-foreground">
          {check.inviter} 邀请你{leader ? '来当队长：建好乐队后，你可以邀请自己的成员。' : '加入乐队。'}
        </p>
      )}
      {check.note && <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{check.note}</p>}
    </>
  )
  const errorLine = error && (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )

  if (me) {
    return (
      <div className="mx-auto w-full max-w-sm py-8">
        <Title>{heading}</Title>
        {intro}
        <div className="mt-8 space-y-4">
          <p className="text-sm text-muted-foreground">
            用你现在的账号「{me.displayName}」{leader ? '建一个新乐队' : '加入'}，不用另外注册。
          </p>
          {leader && <BandNameField value={bandName} onChange={setBandName} />}
          {errorLine}
          <button
            type="button"
            onClick={() => void join()}
            disabled={busy || !bandNameOk}
            className={buttonClass('primary') + ' h-12 w-full text-base'}
          >
            {busy ? '正在加入…' : leader ? '创建乐队' : '加入乐队'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto w-full max-w-sm">
      <Title>{heading}</Title>
      {intro}
      {onLogin && (
        <p className="mt-4 text-sm text-muted-foreground">
          已经有账号了？
          <button
            type="button"
            onClick={onLogin}
            className="text-primary underline underline-offset-4"
          >
            登录后直接{leader ? '建乐队' : '加入'}
          </button>
          ，不用再注册一个。
        </p>
      )}

      <form onSubmit={submit} className="mt-8 space-y-4">
        {leader && <BandNameField value={bandName} onChange={setBandName} />}
        <Field label="用户名" hint="2–32 位，字母、数字、_、- 或中文。以后用来登录。">
          <input
            type="text"
            name="username"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            autoFocus={!leader}
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
        {errorLine}
        <button
          type="submit"
          disabled={busy || !username || !displayName || !password || !password2 || !bandNameOk}
          className={buttonClass('primary') + ' h-12 w-full text-base'}
        >
          {busy ? '正在创建账号…' : leader ? '注册并创建乐队' : '注册并加入'}
        </button>
      </form>
    </div>
  )
}
