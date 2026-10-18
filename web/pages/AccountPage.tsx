import { useState, type FormEvent } from 'react'
import type { Instrument } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { INSTRUMENT_LABELS, setMe, useMe } from '../lib/session'
import { HREF_USERS } from '../lib/route'
import { Link } from '../components/Link'
import { Notice, PageBar, Staff } from '../components/ui'

const INPUT =
  'h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base text-foreground outline-none focus:border-primary'

const MIN_PASSWORD = 6

/** 我的账号: name, instrument, password, sign-out; admins also reach 成员管理. */
export function AccountPage() {
  const me = useMe()
  const [displayName, setDisplayName] = useState(me?.displayName ?? '')
  const [instrument, setInstrument] = useState<Instrument | ''>(me?.instrument ?? '')
  const [profileBusy, setProfileBusy] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [profileSaved, setProfileSaved] = useState(false)

  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newPassword2, setNewPassword2] = useState('')
  const [pwBusy, setPwBusy] = useState(false)
  const [pwError, setPwError] = useState<string | null>(null)
  const [pwDone, setPwDone] = useState(false)

  const [signingOut, setSigningOut] = useState(false)

  if (!me) {
    return (
      <>
        <PageBar title="我的账号" fallback="#/" />
        <Staff />
        <div className="max-w-[640px] py-6">
          <Notice>还没有登录。</Notice>
        </div>
      </>
    )
  }

  const trimmedName = displayName.trim()
  const profileChanged =
    trimmedName !== me.displayName || (instrument || null) !== (me.instrument ?? null)

  const saveProfile = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (profileBusy || !profileChanged) return
    if (!trimmedName) {
      setProfileError('显示名称不能为空。')
      return
    }
    setProfileBusy(true)
    setProfileError(null)
    setProfileSaved(false)
    try {
      const updated = await api.updateMe({
        displayName: trimmedName,
        instrument: instrument || null,
      })
      setMe(updated)
      setDisplayName(updated.displayName)
      setInstrument(updated.instrument ?? '')
      setProfileSaved(true)
    } catch (err) {
      setProfileError(errorText(err))
    } finally {
      setProfileBusy(false)
    }
  }

  const changePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (pwBusy) return
    setPwDone(false)
    if (!oldPassword) {
      setPwError('请输入原密码。')
      return
    }
    if (newPassword.length < MIN_PASSWORD) {
      setPwError(`新密码至少 ${MIN_PASSWORD} 个字符。`)
      return
    }
    if (newPassword !== newPassword2) {
      setPwError('两次输入的新密码不一样。')
      return
    }
    setPwBusy(true)
    setPwError(null)
    try {
      const updated = await api.updateMe({ oldPassword, newPassword })
      setMe(updated)
      setOldPassword('')
      setNewPassword('')
      setNewPassword2('')
      setPwDone(true)
    } catch (err) {
      setPwError(errorText(err))
    } finally {
      setPwBusy(false)
    }
  }

  const signOut = async () => {
    if (signingOut) return
    setSigningOut(true)
    try {
      await api.logout()
    } catch {
      // the session is dropped on this device either way
    }
    setMe(null)
    // A fresh page clears every cached list (favourites, practice) before the next sign-in.
    window.location.reload()
  }

  return (
    <>
      <PageBar title="我的账号" fallback="#/" />
      <Staff />

      <div className="max-w-[640px] space-y-10 pb-20 pt-6">
        <section className="space-y-3">
          <h2 className="label m-0">账号</h2>
          <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-base">
            <dt className="text-muted-foreground">用户名</dt>
            <dd className="mono m-0">{me.username}</dd>
            <dt className="text-muted-foreground">角色</dt>
            <dd className="m-0">{me.role === 'admin' ? '管理员' : '成员'}</dd>
          </dl>
        </section>

        <form onSubmit={saveProfile} className="space-y-4">
          <h2 className="label m-0">资料</h2>
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">显示名称</span>
            <input
              type="text"
              name="displayName"
              maxLength={32}
              value={displayName}
              onChange={(e) => {
                setDisplayName(e.target.value)
                setProfileSaved(false)
              }}
              className={INPUT}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">乐器</span>
            <select
              name="instrument"
              value={instrument}
              onChange={(e) => {
                setInstrument(e.target.value as Instrument | '')
                setProfileSaved(false)
              }}
              className={cx(SELECT, 'w-full')}
            >
              <option value="">未设置</option>
              {(Object.keys(INSTRUMENT_LABELS) as Instrument[]).map((k) => (
                <option key={k} value={k}>
                  {INSTRUMENT_LABELS[k]}
                </option>
              ))}
            </select>
          </label>
          {profileError && (
            <p role="alert" className="text-sm text-destructive">
              {profileError}
            </p>
          )}
          {profileSaved && (
            <p role="status" className="text-sm text-muted-foreground">
              已保存。
            </p>
          )}
          <button
            type="submit"
            disabled={profileBusy || !profileChanged}
            className={buttonClass('primary')}
          >
            {profileBusy ? '正在保存…' : '保存资料'}
          </button>
        </form>

        <form onSubmit={changePassword} className="space-y-4">
          <h2 className="label m-0">修改密码</h2>
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">原密码</span>
            <input
              type="password"
              name="oldPassword"
              autoComplete="current-password"
              value={oldPassword}
              onChange={(e) => setOldPassword(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">新密码（至少 6 个字符）</span>
            <input
              type="password"
              name="newPassword"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              className={INPUT}
            />
          </label>
          <label className="block space-y-2">
            <span className="text-sm text-muted-foreground">再输一次新密码</span>
            <input
              type="password"
              name="newPassword2"
              autoComplete="new-password"
              value={newPassword2}
              onChange={(e) => setNewPassword2(e.target.value)}
              className={INPUT}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            修改密码后，其他设备上的登录会全部退出，本机保持登录。
          </p>
          {pwError && (
            <p role="alert" className="text-sm text-destructive">
              {pwError}
            </p>
          )}
          {pwDone && (
            <p role="status" className="text-sm text-muted-foreground">
              密码已修改，其他设备上的登录已退出。
            </p>
          )}
          <button
            type="submit"
            disabled={pwBusy || !oldPassword || !newPassword || !newPassword2}
            className={buttonClass('outline')}
          >
            {pwBusy ? '正在修改…' : '修改密码'}
          </button>
        </form>

        {me.role === 'admin' && (
          <section className="space-y-3">
            <h2 className="label m-0">管理</h2>
            <Link
              href={HREF_USERS}
              className="flex min-h-11 items-center justify-between border-t border-border py-2 text-base font-bold transition-colors hover:text-primary"
            >
              <span>成员管理</span>
              <span aria-hidden className="text-muted-foreground">
                →
              </span>
            </Link>
          </section>
        )}

        <section className="space-y-3">
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={signingOut}
            className={buttonClass('outline')}
          >
            {signingOut ? '正在退出…' : '退出登录'}
          </button>
        </section>
      </div>
    </>
  )
}
