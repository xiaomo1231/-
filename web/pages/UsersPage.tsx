import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import type { BandOverview, Instrument, Role, UserInfo } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { INSTRUMENT_LABELS, useMe } from '../lib/session'
import { InvitesPanel } from '../components/InvitesPanel'
import { Notice, PageBar } from '../components/ui'

const INPUT =
  'h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base text-foreground outline-none focus:border-primary'

const MIN_PASSWORD = 6

const ROLE_LABEL: Record<Role, string> = { admin: '管理员', member: '成员' }

type Panel =
  | { kind: 'add' }
  | { kind: 'edit'; id: string }
  | { kind: 'reset'; id: string }
  | { kind: 'delete'; id: string }
  | { kind: 'disable'; id: string }
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
  bands,
  onDone,
  onCancel,
}: {
  bands: BandOverview[]
  onDone: (list: UserInfo[], name: string) => void
  onCancel: () => void
}) {
  const [bandId, setBandId] = useState(bands[0]?.id ?? '')
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
        bandId: bandId || null,
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
        <Field label="加入乐队">
          <select value={bandId} onChange={(e) => setBandId(e.target.value)} className={cx(SELECT, 'w-full')}>
            {bands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
            <option value="">先不加入（以后用邀请码加入）</option>
          </select>
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

/** The accounts in invite order: each one under the person who invited it (depth = how far down). */
function inviteTree(users: UserInfo[]): { user: UserInfo; depth: number }[] {
  const ids = new Set(users.map((u) => u.id))
  const kids = new Map<string | null, UserInfo[]>()
  for (const u of users) {
    const parent = u.invitedBy && ids.has(u.invitedBy) && u.invitedBy !== u.id ? u.invitedBy : null
    kids.set(parent, [...(kids.get(parent) ?? []), u])
  }
  const out: { user: UserInfo; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const u of (kids.get(parent) ?? []).sort((a, b) => a.createdAt - b.createdAt)) {
      if (seen.has(u.id)) continue
      seen.add(u.id)
      out.push({ user: u, depth })
      walk(u.id, depth + 1)
    }
  }
  walk(null, 0)
  // Anything left (a loop in old data) still shows.
  for (const u of users) if (!seen.has(u.id)) out.push({ user: u, depth: 0 })
  return out
}

/** Everyone an account brought in, directly or through the people it invited. */
function inviteesOf(users: UserInfo[], id: string): string[] {
  const out = new Set<string>()
  for (let grew = true; grew; ) {
    grew = false
    for (const u of users)
      if (u.invitedBy && (u.invitedBy === id || out.has(u.invitedBy)) && !out.has(u.id) && u.id !== id) {
        out.add(u.id)
        grew = true
      }
  }
  return [...out]
}

/** 停用 / 恢复: a stopped account cannot sign in; optionally everyone it invited too. */
function DisableConfirm({
  user,
  users,
  onCancel,
  onDone,
}: {
  user: UserInfo
  users: UserInfo[]
  onCancel: () => void
  onDone: (rows: UserInfo[]) => void
}) {
  const stopping = !user.disabled
  const below = inviteesOf(users, user.id).length
  const [all, setAll] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      onDone(await api.disableUser(user.id, stopping, all))
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }
  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border p-4">
      <p className="m-0 text-sm">
        {stopping
          ? `停用后「${user.displayName}」不能再登录（已经登录的设备也会退出），资料都保留，随时可以恢复。`
          : `恢复后「${user.displayName}」可以重新登录。`}
      </p>
      {below > 0 && (
        <label className="flex min-h-11 items-center gap-3 text-sm">
          <input
            type="checkbox"
            checked={all}
            onChange={(e) => setAll(e.target.checked)}
            className="h-5 w-5 accent-[hsl(var(--primary))]"
          />
          连同 TA 邀请来的 {below} 个账号一起{stopping ? '停用' : '恢复'}
        </label>
      )}
      <FormError error={error} />
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className={cx(buttonClass('outline'), stopping && 'border-destructive text-destructive')}
        >
          {busy ? '正在保存…' : stopping ? '停用' : '恢复'}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass('ghost')}>
          取消
        </button>
      </div>
    </div>
  )
}

const GB = 1024 ** 3
const fmtSize = (n: number) => (n >= GB ? `${(n / GB).toFixed(1)} GB` : `${Math.round(n / 1024 / 1024)} MB`)

/** One band's limits, leader and delete, for the admin. */
function BandRow({
  band,
  nameOf,
  onChange,
}: {
  band: BandOverview
  nameOf: (id: string) => string
  onChange: (rows: BandOverview[], text: string) => void
}) {
  const [open, setOpen] = useState<'edit' | 'delete' | null>(null)
  const [members, setMembers] = useState(String(band.limits.maxMembers))
  const [gb, setGb] = useState(String(Math.round((band.limits.storageBytes / GB) * 10) / 10))
  const [leader, setLeader] = useState(band.leaderId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const max = Number(members)
    const bytes = Math.round(Number(gb) * GB)
    if (!Number.isInteger(max) || max < 1 || max > 200) return setError('人数上限要在 1–200 之间。')
    if (!Number.isFinite(bytes) || bytes < 1 || bytes > 200 * GB) return setError('上传空间要在 0.1–200 GB 之间。')
    if (max < band.memberIds.length) return setError(`乐队现在有 ${band.memberIds.length} 人，上限不能更少。`)
    setBusy(true)
    setError(null)
    try {
      const rows = await api.updateAdminBand({
        id: band.id,
        limits: { maxMembers: max, storageBytes: bytes },
        ...(leader !== band.leaderId ? { leaderId: leader } : {}),
      })
      setOpen(null)
      onChange(rows, `已保存「${band.name}」。`)
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      onChange(await api.removeAdminBand(band.id), `已删除「${band.name}」。`)
    } catch (err) {
      setError(errorText(err))
      setBusy(false)
    }
  }

  return (
    <li className="border-t border-border py-3 first:border-t-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="break-all text-base font-bold">{band.name}</span>
        <span className="text-xs text-muted-foreground">队长：{nameOf(band.leaderId)}</span>
      </div>
      <p className="m-0 mt-1 text-xs text-muted-foreground">
        {band.memberIds.length} / {band.limits.maxMembers} 人 · 上传空间 {fmtSize(band.storageUsed)} /{' '}
        {fmtSize(band.limits.storageBytes)} · 成员：{band.memberIds.map(nameOf).join('、')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(open === 'edit' ? null : 'edit')}
          className={cx(buttonClass('outline'), 'min-h-11 px-3')}
        >
          设置
        </button>
        <button
          type="button"
          onClick={() => setOpen(open === 'delete' ? null : 'delete')}
          className={cx(buttonClass('ghost'), 'min-h-11 px-3 hover:text-destructive')}
        >
          删除乐队
        </button>
      </div>
      {open === 'edit' && (
        <form onSubmit={save} className="mt-3 space-y-4 rounded-lg border border-border p-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="人数上限">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={200}
                value={members}
                onChange={(e) => setMembers(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="上传空间（GB）">
              <input
                type="number"
                inputMode="decimal"
                min={0.1}
                step={0.1}
                max={200}
                value={gb}
                onChange={(e) => setGb(e.target.value)}
                className={INPUT}
              />
            </Field>
            <Field label="队长">
              <select value={leader} onChange={(e) => setLeader(e.target.value)} className={cx(SELECT, 'w-full')}>
                {band.memberIds.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <FormError error={error} />
          <div className="flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className={buttonClass('primary')}>
              {busy ? '正在保存…' : '保存'}
            </button>
            <button type="button" onClick={() => setOpen(null)} className={buttonClass('ghost')}>
              取消
            </button>
          </div>
        </form>
      )}
      {open === 'delete' && (
        <div className="mt-3 space-y-3 rounded-lg border border-destructive p-4">
          <p className="m-0 text-sm leading-relaxed">
            删除「{band.name}」会同时删掉它的歌单、留言、上传的谱和排练录音（{fmtSize(band.storageUsed)}），
            还有它的邀请码。成员的账号不受影响。确定删除？
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
            <button type="button" onClick={() => setOpen(null)} className={buttonClass('ghost')}>
              取消
            </button>
          </div>
        </div>
      )}
    </li>
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
  const [bands, setBands] = useState<BandOverview[] | null>(null)

  useEffect(() => {
    if (!isAdmin) return
    const ac = new AbortController()
    api.users(ac.signal).then(
      (rows) => setList(rows),
      (e: unknown) => {
        if (!ac.signal.aborted) setLoadError(errorText(e))
      },
    )
    api.adminBands(ac.signal).then(
      (rows) => setBands(rows),
      (e: unknown) => {
        if (!ac.signal.aborted) setLoadError(errorText(e))
      },
    )
    return () => ac.abort()
  }, [isAdmin])

  if (!isAdmin) {
    return (
      <>
        <PageBar title="管理" back="← 我的账号" fallback="#/me" />
        <div className="max-w-[640px] py-6">
          <Notice tone="error">只有管理员可以打开管理页。</Notice>
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
  const nameOf = (id: string): string => list?.find((u) => u.id === id)?.displayName ?? '已删除的账号'
  const bandsOf = (id: string): string[] =>
    (bands ?? []).filter((b) => b.memberIds.includes(id)).map((b) => (b.leaderId === id ? `${b.name}（队长）` : b.name))

  return (
    <>
      <PageBar
        title="管理"
        back="← 我的账号"
        fallback="#/me"
        subtitle={list ? `${list.length} 个账号${bands ? ` · ${bands.length} 个乐队` : ''}` : undefined}
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

      <div className="max-w-[640px] space-y-6 pb-20 pt-6">
        {message && (
          <p role="status" className="m-0 text-sm text-muted-foreground">
            {message}
          </p>
        )}
        {loadError && <Notice tone="error">{loadError}</Notice>}

        {panel?.kind === 'add' && bands && (
          <AddForm
            bands={bands}
            onCancel={() => setPanel(null)}
            onDone={(rows, name) => {
              applied(rows, `已添加 ${name}。`)
              void api.adminBands().then(setBands, () => undefined)
            }}
          />
        )}

        {!list && !loadError && <p className="py-6 text-sm text-muted-foreground">正在读取…</p>}

        {bands && list && (
          <section>
            <h2 className="label m-0">乐队</h2>
            <p className="m-0 mt-1 text-xs text-muted-foreground">
              队长用你发的队长邀请码注册后会自动建一个乐队。每个乐队的歌单、排练、上传的谱和录音互相看不到。
            </p>
            {bands.length === 0 ? (
              <p className="m-0 mt-3 text-sm text-muted-foreground">还没有乐队。</p>
            ) : (
              <ul className="m-0 mt-3 list-none p-0">
                {bands.map((b) => (
                  <BandRow
                    key={b.id}
                    band={b}
                    nameOf={nameOf}
                    onChange={(rows, text) => {
                      setBands(rows)
                      setMessage(text)
                    }}
                  />
                ))}
              </ul>
            )}
          </section>
        )}

        {list && (
          <section>
            <h2 className="label m-0">账号</h2>
            <p className="m-0 mt-1 text-xs text-muted-foreground">按邀请关系排列：缩进的账号是上面那个人邀请来的。</p>
            <ul className="m-0 mt-3 list-none p-0">
              {inviteTree(list).map(({ user: u, depth }) => {
                const open = panel && 'id' in panel && panel.id === u.id ? panel : null
                const isSelf = u.id === me?.id
                const inBands = bandsOf(u.id)
                return (
                  <li
                    key={u.id}
                    className="border-t border-border py-3 first:border-t-0"
                    style={{ paddingLeft: `${Math.min(depth, 4) * 20}px` }}
                  >
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
                      {u.disabled && (
                        <span className="mono inline-flex items-center rounded-[3px] border border-destructive px-1 text-[11px] leading-5 text-destructive">
                          已停用
                        </span>
                      )}
                      {isSelf && <span className="text-xs text-muted-foreground">（你）</span>}
                    </div>
                    <p className="m-0 mt-1 text-xs text-muted-foreground">
                      乐器：{u.instrument ? INSTRUMENT_LABELS[u.instrument] : '未设置'} ·
                      可看完整谱库：
                      {u.role === 'admin' || u.libraryAccess ? '是' : '否'}
                      {u.invitedBy && ` · 邀请人：${nameOf(u.invitedBy)}`}
                    </p>
                    <p className="m-0 mt-0.5 text-xs text-muted-foreground">
                      乐队：{inBands.length > 0 ? inBands.join('、') : '还没加入乐队'}
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
                      {!isSelf && u.role !== 'admin' && (
                        <button
                          type="button"
                          onClick={() => {
                            setMessage(null)
                            setPanel({ kind: 'disable', id: u.id })
                          }}
                          className={cx(buttonClass('outline'), 'min-h-11 px-3')}
                        >
                          {u.disabled ? '恢复' : '停用'}
                        </button>
                      )}
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
                    {open?.kind === 'disable' && (
                      <DisableConfirm
                        user={u}
                        users={list}
                        onCancel={() => setPanel(null)}
                        onDone={(rows) =>
                          applied(rows, u.disabled ? `已恢复 ${u.displayName}。` : `已停用 ${u.displayName}。`)
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

        {list && bands && (
          <InvitesPanel
            title="邀请码"
            bands={bands.map((b) => ({ id: b.id, name: b.name }))}
            nameOf={nameOf}
            canGrantLibrary
          />
        )}
      </div>
    </>
  )
}
