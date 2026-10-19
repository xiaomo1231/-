import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Instrument, InviteInfo, Role, UserInfo } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { inviteUrl } from '../lib/route'
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
        确定删除 {user.displayName}？这个账号的收藏和练习记录也会删除。
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

const DAY_OPTIONS: { value: string; label: string; days: number | null }[] = [
  { value: '1', label: '1 天', days: 1 },
  { value: '7', label: '7 天', days: 7 },
  { value: '30', label: '30 天', days: 30 },
  { value: 'never', label: '永不过期', days: null },
]

const USE_OPTIONS: { value: string; label: string; uses: number | null }[] = [
  { value: '1', label: '1 次', uses: 1 },
  { value: '5', label: '5 次', uses: 5 },
  { value: 'unlimited', label: '不限', uses: null },
]

type InviteStatus = '有效' | '已过期' | '已用完' | '已作废'

const STATUS_CLASS: Record<InviteStatus, string> = {
  有效: 'border-primary text-primary',
  已过期: 'border-border text-muted-foreground',
  已用完: 'border-border text-muted-foreground',
  已作废: 'border-border text-muted-foreground',
}

/** The state of a link now: revoked, expired, used up, or still usable. */
function inviteStatus(inv: InviteInfo, now: number): InviteStatus {
  if (inv.revoked) return '已作废'
  if (inv.expiresAt !== null && now >= inv.expiresAt) return '已过期'
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return '已用完'
  return '有效'
}

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })

/** 邀请链接 (admin): make a one-off link for a new member, and list / revoke the links made. */
function InvitesSection({ users }: { users: UserInfo[] }) {
  const [list, setList] = useState<InviteInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [days, setDays] = useState('7')
  const [uses, setUses] = useState('1')
  const [instrument, setInstrument] = useState<Instrument | ''>('')
  const [libraryAccess, setLibraryAccess] = useState(false)
  const [note, setNote] = useState('')
  const [created, setCreated] = useState<string | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ac = new AbortController()
    api.invites(ac.signal).then(
      (rows) => setList(rows),
      (e: unknown) => {
        if (!ac.signal.aborted) setLoadError(errorText(e))
      },
    )
    return () => ac.abort()
  }, [])

  const create = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (busy) return
    const dayOpt = DAY_OPTIONS.find((o) => o.value === days)
    const useOpt = USE_OPTIONS.find((o) => o.value === uses)
    setBusy(true)
    setError(null)
    setMessage(null)
    setCopyNote(null)
    try {
      const res = await api.createInvite({
        days: dayOpt?.days ?? null,
        maxUses: useOpt?.uses ?? null,
        instrument: instrument || null,
        libraryAccess,
        note: note.trim(),
      })
      setCreated(inviteUrl(res.token))
      setList((rows) => [res.invite, ...(rows ?? [])])
      setNote('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async () => {
    if (!created) return
    try {
      await navigator.clipboard.writeText(created)
      setCopyNote('已复制。')
    } catch {
      // Clipboard API is missing on plain-http addresses: select the text for a manual copy.
      linkRef.current?.select()
      setCopyNote('浏览器不允许自动复制，链接已选中，请按 Ctrl+C 复制。')
    }
  }

  const revoke = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setList(await api.revokeInvite(id))
      setRevokeId(null)
      setMessage('已作废这个邀请链接。')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (id: string): string =>
    users.find((u) => u.id === id)?.displayName ?? '已删除的成员'
  const now = Date.now()

  return (
    <section className="space-y-4">
      <h2 className="label m-0">邀请链接</h2>
      <form onSubmit={create} className="space-y-4 rounded-lg border border-border p-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="有效期">
            <select
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={cx(SELECT, 'w-full')}
            >
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="可用次数">
            <select
              value={uses}
              onChange={(e) => setUses(e.target.value)}
              className={cx(SELECT, 'w-full')}
            >
              {USE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="默认乐器">
            <select
              value={instrument}
              onChange={(e) => setInstrument(e.target.value as Instrument | '')}
              className={cx(SELECT, 'w-full')}
            >
              <option value="">不指定</option>
              {(Object.keys(INSTRUMENT_LABELS) as Instrument[]).map((k) => (
                <option key={k} value={k}>
                  {INSTRUMENT_LABELS[k]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="备注（可不填，对方打开链接时能看到）">
            <input
              type="text"
              name="note"
              maxLength={100}
              placeholder="例如：给新鼓手"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        <label className="flex min-h-11 items-start gap-3 text-base">
          <input
            type="checkbox"
            checked={libraryAccess}
            onChange={(e) => setLibraryAccess(e.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-[hsl(var(--primary))]"
          />
          <span>
            能看整个谱库
            <span className="block text-xs text-muted-foreground">
              不勾选时，对方只能看乐队歌单里的歌。
            </span>
          </span>
        </label>
        <FormError error={error} />
        <button type="submit" disabled={busy} className={buttonClass('primary')}>
          {busy ? '正在生成…' : '生成邀请链接'}
        </button>
      </form>

      {created && (
        <div role="status" className="space-y-3 rounded-lg border border-primary p-4">
          <p className="m-0 text-sm font-bold">邀请链接已生成</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={linkRef}
              type="text"
              readOnly
              value={created}
              aria-label="邀请链接"
              onFocus={(e) => e.target.select()}
              className={cx(INPUT, 'mono text-xs')}
            />
            <button
              type="button"
              onClick={() => void copy()}
              className={cx(buttonClass('primary'), 'min-h-11 shrink-0 px-4')}
            >
              复制
            </button>
          </div>
          {copyNote && <p className="m-0 text-xs text-muted-foreground">{copyNote}</p>}
          <p className="m-0 text-sm leading-relaxed">
            链接只显示这一次，请现在复制发给对方。对方打开后自己设置用户名和密码。
          </p>
          <p className="m-0 text-xs text-muted-foreground">
            对方要能访问这台服务器（同一 Wi-Fi，或已加入 Tailscale）。
          </p>
          <button
            type="button"
            onClick={() => setCreated(null)}
            className={cx(buttonClass('ghost'), 'min-h-11 px-3')}
          >
            收起
          </button>
        </div>
      )}

      {message && (
        <p role="status" className="m-0 text-sm text-muted-foreground">
          {message}
        </p>
      )}
      {loadError && <Notice tone="error">{loadError}</Notice>}
      {!list && !loadError && <p className="py-4 text-sm text-muted-foreground">正在读取…</p>}

      {list && list.length === 0 && (
        <p className="m-0 text-sm text-muted-foreground">还没有邀请链接。</p>
      )}

      {list && list.length > 0 && (
        <ul className="m-0 list-none p-0">
          {list.map((inv) => {
            const status = inviteStatus(inv, now)
            const joined = inv.usedBy.map(nameOf)
            return (
              <li key={inv.id} className="border-t border-border py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="break-all text-base font-bold">{inv.note || '（无备注）'}</span>
                  <span
                    className={cx(
                      'mono inline-flex items-center rounded-[3px] border px-1 text-[11px] leading-5',
                      STATUS_CLASS[status],
                    )}
                  >
                    {status}
                  </span>
                </div>
                <p className="m-0 mt-1 text-xs leading-relaxed text-muted-foreground">
                  创建于 {fmtDate(inv.createdAt)} ·{' '}
                  {inv.expiresAt === null ? '永不过期' : `${fmtDate(inv.expiresAt)} 到期`} · 已用{' '}
                  {inv.uses} / {inv.maxUses ?? '不限'} · 默认乐器：
                  {inv.instrument ? INSTRUMENT_LABELS[inv.instrument] : '不指定'} ·
                  {inv.libraryAccess ? '可看完整谱库' : '只能看乐队歌单'}
                </p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  加入的成员：{joined.length > 0 ? joined.join('、') : '暂无'}
                </p>
                {status === '有效' &&
                  (revokeId === inv.id ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-destructive p-3">
                      <p className="m-0 text-sm">作废后这个链接就不能再用了，确定作废？</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void revoke(inv.id)}
                          disabled={busy}
                          className={cx(
                            buttonClass('outline'),
                            'min-h-11 border-destructive px-3 text-destructive',
                          )}
                        >
                          {busy ? '正在作废…' : '作废'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setRevokeId(null)}
                          className={cx(buttonClass('ghost'), 'min-h-11 px-3')}
                        >
                          取消
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="mt-2">
                      <button
                        type="button"
                        onClick={() => {
                          setMessage(null)
                          setRevokeId(inv.id)
                        }}
                        className={cx(buttonClass('outline'), 'min-h-11 px-3')}
                      >
                        作废
                      </button>
                    </div>
                  ))}
              </li>
            )
          })}
        </ul>
      )}
    </section>
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
                      <span className="break-all text-base font-bold">{u.displayName}</span>
                      <span className="mono break-all text-xs text-muted-foreground">
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
                      乐器：{u.instrument ? INSTRUMENT_LABELS[u.instrument] : '未设置'} ·
                      可看完整谱库：
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
                          applied(rows, `已重置 ${u.displayName} 的密码，这个账号在其他设备上的登录已退出。`)
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

        {list && <InvitesSection users={list} />}
      </div>
    </>
  )
}
