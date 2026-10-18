import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { Instrument, Role, UserInfo } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { INSTRUMENT_LABELS, useMe } from '../lib/session'
import { Notice, PageBar, Staff } from '../components/ui'

const INPUT =
  'h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base text-foreground outline-none focus:border-primary'

const MIN_PASSWORD = 6

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' }

type Panel =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'reset'; id: string }
  | { kind: 'delete'; id: string }
  | null

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

function RoleSelect({ value, onChange }: { value: Role; onChange: (r: Role) => void }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Role)}
      className={cx(SELECT, 'w-full')}
    >
      <option value="member">{ROLE_LABEL.member}</option>
      <option value="admin">{ROLE_LABEL.admin}</option>
    </select>
  )
}

function InstrumentSelect({
  value,
  onChange,
}: {
  value: Instrument | ''
  onChange: (v: Instrument | '') => void
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as Instrument | '')}
      className={cx(SELECT, 'w-full')}
    >
      <option value="">未设置</option>
      {(Object.keys(INSTRUMENT_LABELS) as Instrument[]).map((k) => (
        <option key={k} value={k}>
          {INSTRUMENT_LABELS[k]}
        </option>
      ))}
    </select>
  )
}

function LibraryCheck({
  checked,
  disabled,
  onChange,
}: {
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <label className="flex min-h-11 items-center gap-3 text-base">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="h-5 w-5 accent-[hsl(var(--primary))]"
      />
      <span>
        可看完整谱库
        {disabled && <span className="text-xs text-muted-foreground">（管理员始终可看）</span>}
      </span>
    </label>
  )
}

function FormError({ error }: { error: string | null }) {
  if (!error) return null
  return (
    <p role="alert" className="text-sm text-destructive">
      {error}
    </p>
  )
}

/** 添加成员: a new account with an initial password the admin hands over. */
function AddForm({
  onDone,
  onCancel,
}: {
  onDone: (list: UserInfo[], name: string) => void
  onCancel: () => void
}) {
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<Role>('member')
  const [instrument, setInstrument] = useState<Instrument | ''>('')
  const [libraryAccess, setLibraryAccess] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const name = username.trim()
    const shown = displayName.trim()
    if (!name) {
      setError('请输入用户名。')
      return
    }
    if (!shown) {
      setError('请输入显示名称。')
      return
    }
    if (password.length < MIN_PASSWORD) {
      setError(`初始密码至少 ${MIN_PASSWORD} 个字符。`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const list = await api.addUser({
        username: name,
        displayName: shown,
        password,
        role,
        libraryAccess: role === 'admin' || libraryAccess,
        instrument: instrument || null,
      })
      onDone(list, shown)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border p-4">
      <h2 className="label m-0">添加成员</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="用户名">
          <input
            type="text"
            name="username"
            autoCapitalize="none"
            autoCorrect="off"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="显示名称">
          <input
            type="text"
            name="displayName"
            maxLength={32}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="初始密码（至少 6 个字符）">
          <input
            type="text"
            name="password"
            autoComplete="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="角色">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <Field label="乐器">
          <InstrumentSelect value={instrument} onChange={setInstrument} />
        </Field>
        <div className="flex items-end">
          <LibraryCheck
            checked={role === 'admin' || libraryAccess}
            disabled={role === 'admin'}
            onChange={setLibraryAccess}
          />
        </div>
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonClass('primary')}>
          {busy ? '正在添加…' : '添加'}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
          取消
        </button>
      </div>
    </form>
  )
}

/** 编辑: display name, role, instrument and library access. */
function EditForm({
  user,
  onDone,
  onCancel,
}: {
  user: UserInfo
  onDone: (list: UserInfo[]) => void
  onCancel: () => void
}) {
  const [displayName, setDisplayName] = useState(user.displayName)
  const [role, setRole] = useState<Role>(user.role)
  const [instrument, setInstrument] = useState<Instrument | ''>(user.instrument ?? '')
  const [libraryAccess, setLibraryAccess] = useState(user.libraryAccess)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const shown = displayName.trim()
    if (!shown) {
      setError('显示名称不能为空。')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const list = await api.updateUser({
        id: user.id,
        displayName: shown,
        role,
        libraryAccess: role === 'admin' || libraryAccess,
        instrument: instrument || null,
      })
      onDone(list)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-4 rounded-lg border border-border p-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="显示名称">
          <input
            type="text"
            name="displayName"
            maxLength={32}
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className={INPUT}
          />
        </Field>
        <Field label="角色">
          <RoleSelect value={role} onChange={setRole} />
        </Field>
        <Field label="乐器">
          <InstrumentSelect value={instrument} onChange={setInstrument} />
        </Field>
        <div className="flex items-end">
          <LibraryCheck
            checked={role === 'admin' || libraryAccess}
            disabled={role === 'admin'}
            onChange={setLibraryAccess}
          />
        </div>
      </div>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy} className={buttonClass('primary')}>
          {busy ? '正在保存…' : '保存'}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
          取消
        </button>
      </div>
    </form>
  )
}

/** 重置密码: a new password typed here; the member is signed out everywhere. */
function ResetForm({
  user,
  onDone,
  onCancel,
}: {
  user: UserInfo
  onDone: (list: UserInfo[]) => void
  onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    if (password.length < MIN_PASSWORD) {
      setError(`新密码至少 ${MIN_PASSWORD} 个字符。`)
      return
    }
    setBusy(true)
    setError(null)
    try {
      const list = await api.updateUser({ id: user.id, password })
      onDone(list)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-4 rounded-lg border border-border p-4">
      <Field label={`给 ${user.displayName} 设置新密码（至少 6 个字符）`}>
        <input
          type="text"
          name="newPassword"
          autoComplete="off"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        重置后他在其他设备上的登录会退出，请把新密码告诉他。
      </p>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button type="submit" disabled={busy || !password} className={buttonClass('primary')}>
          {busy ? '正在重置…' : '重置密码'}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
          取消
        </button>
      </div>
    </form>
  )
}

/** 删除: confirmed inline, never with a browser dialog. */
function DeleteConfirm({
  user,
  onDone,
  onCancel,
}: {
  user: UserInfo
  onDone: (list: UserInfo[]) => void
  onCancel: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const remove = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      onDone(await api.removeUser(user.id))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-destructive p-4">
      <p className="m-0 text-sm leading-relaxed">
        确定删除 {user.displayName}？他的收藏和练习记录也会删除。
      </p>
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void remove()}
          disabled={busy}
          className={cx(buttonClass('outline'), 'border-destructive text-destructive')}
        >
          {busy ? '正在删除…' : '删除'}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
          取消
        </button>
      </div>
    </div>
  )
}

/** 成员管理 (admin only): the accounts, with add, edit, reset password and delete. */
export function UsersPage() {
  const me = useMe()
  const isAdmin = me?.role === 'admin'
  const [list, setList] = useState<UserInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [panel, setPanel] = useState<Panel>(null)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    const ac = new AbortController()
    api.users(ac.signal).then(
      (rows) => setList(rows),
      (e: unknown) => {
        if (!ac.signal.aborted) setLoadError(errorText(e))
      },
    )
    return () => ac.abort()
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <>
        <PageBar title="成员管理" back="← 我的账号" fallback="#/me" />
        <Staff />
        <div className="max-w-[640px] py-6">
          <Notice tone="error">只有管理员可以管理成员。</Notice>
        </div>
      </>
    )
  }

  /** Applies a server answer (the whole list) and closes the open form. */
  const applied = (rows: UserInfo[], text: string | null) => {
    setList(rows)
    setPanel(null)
    setMessage(text)
    setLoadError(null)
  }

  return (
    <>
      <PageBar
        title="成员管理"
        back="← 我的账号"
        fallback="#/me"
        subtitle={list ? `${list.length} 个账号` : undefined}
      >
        <button
          type="button"
          onClick={() => {
            setMessage(null)
            setPanel(panel?.kind === 'add' ? null : { kind: 'add' })
          }}
          className={buttonClass('primary')}
        >
          添加成员
        </button>
      </PageBar>
      <Staff />

      <div className="max-w-[640px] space-y-6 pb-20 pt-6">
        {message && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {loadError && <Notice tone="error">{loadError}</Notice>}

        {panel?.kind === 'add' && (
          <AddForm
            onCancel={() => setPanel(null)}
            onDone={(rows, name) => applied(rows, `已添加 ${name}。`)}
          />
        )}

        {!list && !loadError && <p className="py-6 text-sm text-muted-foreground">正在读取…</p>}

        {list && (
          <section>
            <h2 className="label m-0">成员</h2>
            <ul className="m-0 mt-3 list-none p-0">
              {list.map((u) => {
                const open = panel && 'id' in panel && panel.id === u.id ? panel : null
                const isSelf = u.id === me?.id
                return (
                  <li key={u.id} className="border-t border-border py-3 first:border-t-0">
                    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                      <span className="text-base font-bold break-all">{u.displayName}</span>
                      <span className="mono text-xs text-muted-foreground break-all">
                        {u.username}
                      </span>
                      {u.role === 'admin' && (
                        <span className="mono inline-flex items-center rounded-[3px] border border-primary px-1 text-[11px] leading-5 text-primary">
                          管理员
                        </span>
                      )}
                      {isSelf && <span className="text-xs text-muted-foreground">（你）</span>}
                    </div>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      乐器：{u.instrument ? INSTRUMENT_LABELS[u.instrument] : '未设置'} · 可看完整谱库：
                      {u.role === 'admin' || u.libraryAccess ? '是' : '否'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(null)
                          setPanel({ kind: 'edit', id: u.id })
                        }}
                        className={cx(buttonClass('outline'), 'min-h-11 px-3')}
                      >
                        编辑
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(null)
                          setPanel({ kind: 'reset', id: u.id })
                        }}
                        className={cx(buttonClass('outline'), 'min-h-11 px-3')}
                      >
                        重置密码
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(null)
                          setPanel({ kind: 'delete', id: u.id })
                        }}
                        className={cx(buttonClass('ghost'), 'min-h-11 px-3 hover:text-destructive')}
                      >
                        删除
                      </button>
                    </div>
                    {open?.kind === 'edit' && (
                      <EditForm
                        user={u}
                        onCancel={() => setPanel(null)}
                        onDone={(rows) => applied(rows, `已保存 ${u.displayName} 的资料。`)}
                      />
                    )}
                    {open?.kind === 'reset' && (
                      <ResetForm
                        user={u}
                        onCancel={() => setPanel(null)}
                        onDone={(rows) =>
                          applied(rows, `已重置 ${u.displayName} 的密码，他的其他登录已退出。`)
                        }
                      />
                    )}
                    {open?.kind === 'delete' && (
                      <DeleteConfirm
                        user={u}
                        onCancel={() => setPanel(null)}
                        onDone={(rows) => applied(rows, `已删除 ${u.displayName}。`)}
                      />
                    )}
                  </li>
                )
              })}
            </ul>
          </section>
        )}
      </div>
    </>
  )
}
