import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import type { Instrument, InviteInfo, InviteKind } from '@/songs/scoreServerTypes'
import { api, errorText } from '../lib/api'
import { buttonClass, cx, SELECT } from '../lib/classes'
import { inviteUrl } from '../lib/route'
import { INSTRUMENT_LABELS } from '../lib/session'
import { Notice } from './ui'

const INPUT =
  'h-11 w-full rounded-lg border border-border bg-transparent px-3 text-base text-foreground outline-none focus:border-primary'

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

/** The state of an invite now: revoked, expired, used up, or still usable. */
function inviteStatus(inv: InviteInfo, now: number): InviteStatus {
  if (inv.revoked) return '已作废'
  if (inv.expiresAt !== null && now >= inv.expiresAt) return '已过期'
  if (inv.maxUses !== null && inv.uses >= inv.maxUses) return '已用完'
  return '有效'
}

const fmtDate = (ms: number): string =>
  new Date(ms).toLocaleDateString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric' })

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-2">
      <span className="text-sm text-muted-foreground">{label}</span>
      {children}
    </label>
  )
}

/** A band the invite form can pick (admin: every band). */
export interface BandChoice {
  id: string
  name: string
}

/**
 * 邀请码: make a code (and link) and list / revoke the ones made. A leader invites
 * members of his band (`bandId`); an admin (`bands` given) also makes 队长邀请码,
 * with which the person starts a band of his own.
 */
export function InvitesPanel({
  title,
  bandId,
  bands,
  nameOf,
  canGrantLibrary,
}: {
  title: string
  /** The band a leader invites to (the list shows only its invites). */
  bandId?: string
  /** Admin: every band, to invite members to any of them. */
  bands?: BandChoice[]
  nameOf: (userId: string) => string
  /** Whether the maker himself can open the whole library (only then can he give it). */
  canGrantLibrary: boolean
}) {
  const admin = bands !== undefined
  const [list, setList] = useState<InviteInfo[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [kind, setKind] = useState<InviteKind>(admin ? 'leader' : 'member')
  const [pickBand, setPickBand] = useState(bandId ?? bands?.[0]?.id ?? '')
  const [days, setDays] = useState('7')
  const [uses, setUses] = useState('1')
  const [instrument, setInstrument] = useState<Instrument | ''>('')
  const [libraryAccess, setLibraryAccess] = useState(false)
  const [note, setNote] = useState('')
  const [created, setCreated] = useState<{ code: string; link: string; kind: InviteKind } | null>(null)
  const [copyNote, setCopyNote] = useState<string | null>(null)
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const ac = new AbortController()
    setList(null)
    api.invites(ac.signal).then(
      (rows) => setList(rows),
      (e: unknown) => {
        if (!ac.signal.aborted) setLoadError(errorText(e))
      },
    )
    return () => ac.abort()
  }, [bandId])

  const bandName = (id: string | null) => bands?.find((b) => b.id === id)?.name ?? ''
  const shown = (list ?? []).filter((inv) => !bandId || inv.bandId === bandId)

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
        kind,
        bandId: kind === 'member' ? (bandId ?? pickBand) : null,
        days: dayOpt?.days ?? null,
        maxUses: useOpt?.uses ?? null,
        instrument: kind === 'member' ? instrument || null : null,
        libraryAccess,
        note: note.trim(),
      })
      setCreated({ code: res.token, link: inviteUrl(res.token), kind })
      setList((rows) => [res.invite, ...(rows ?? [])])
      setNote('')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopyNote(`已复制${what}。`)
    } catch {
      // Clipboard API is missing on plain-http addresses: select the link for a manual copy.
      linkRef.current?.select()
      setCopyNote('浏览器不允许自动复制，请手动选中复制。')
    }
  }

  const revoke = async (id: string) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      setList(await api.revokeInvite(id))
      setRevokeId(null)
      setMessage('已作废这个邀请码。')
    } catch (err) {
      setError(errorText(err))
    } finally {
      setBusy(false)
    }
  }

  const now = Date.now()

  return (
    <section className="space-y-4">
      <h2 className="label m-0">{title}</h2>
      <form onSubmit={create} className="space-y-4 rounded-lg border border-border p-4">
        {admin && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="邀请谁">
              <select
                value={kind}
                onChange={(e) => setKind(e.target.value as InviteKind)}
                className={cx(SELECT, 'w-full')}
              >
                <option value="leader">队长（自己建一个乐队）</option>
                <option value="member">成员（加入已有的乐队）</option>
              </select>
            </Field>
            {kind === 'member' && !bandId && (
              <Field label="加入哪个乐队">
                <select
                  value={pickBand}
                  onChange={(e) => setPickBand(e.target.value)}
                  className={cx(SELECT, 'w-full')}
                >
                  {(bands ?? []).map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="有效期">
            <select value={days} onChange={(e) => setDays(e.target.value)} className={cx(SELECT, 'w-full')}>
              {DAY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="可用次数">
            <select value={uses} onChange={(e) => setUses(e.target.value)} className={cx(SELECT, 'w-full')}>
              {USE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </Field>
          {kind === 'member' && (
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
          )}
          <Field label="备注（可不填，对方打开时能看到）">
            <input
              type="text"
              name="note"
              maxLength={100}
              placeholder={kind === 'leader' ? '例如：给老王的乐队' : '例如：给新鼓手'}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={INPUT}
            />
          </Field>
        </div>
        {canGrantLibrary && (
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
                {kind === 'leader'
                  ? '勾选后，这位队长也能给他的成员开这个权限。不勾选时只能看乐队歌单里的歌。'
                  : '不勾选时，对方只能看乐队歌单里的歌。'}
              </span>
            </span>
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy || (kind === 'member' && !(bandId ?? pickBand))}
          className={buttonClass('primary')}
        >
          {busy ? '正在生成…' : kind === 'leader' ? '生成队长邀请码' : '生成邀请码'}
        </button>
      </form>

      {created && (
        <div role="status" className="space-y-3 rounded-lg border border-primary p-4">
          <p className="m-0 text-sm font-bold">邀请码已生成</p>
          <div className="flex flex-wrap items-center gap-3">
            <span className="mono select-all text-2xl font-bold tracking-[0.12em]">{created.code}</span>
            <button
              type="button"
              onClick={() => void copy(created.code, '邀请码')}
              className={cx(buttonClass('outline'), 'min-h-11 px-3')}
            >
              复制邀请码
            </button>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              ref={linkRef}
              type="text"
              readOnly
              value={created.link}
              aria-label="邀请链接"
              onFocus={(e) => e.target.select()}
              className={cx(INPUT, 'mono text-xs')}
            />
            <button
              type="button"
              onClick={() => void copy(created.link, '链接')}
              className={cx(buttonClass('primary'), 'min-h-11 shrink-0 px-4')}
            >
              复制链接
            </button>
          </div>
          {copyNote && <p className="m-0 text-xs text-muted-foreground">{copyNote}</p>}
          <p className="m-0 text-sm leading-relaxed">
            只显示这一次，请现在发给对方。对方打开链接，或在登录页点「用邀请码注册」填入邀请码；
            {created.kind === 'leader' ? '注册时会给自己的乐队起名。' : '已经有账号的人登录后打开链接，直接加入，不用再注册。'}
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
      {list && shown.length === 0 && <p className="m-0 text-sm text-muted-foreground">还没有邀请码。</p>}

      {shown.length > 0 && (
        <ul className="m-0 list-none p-0">
          {shown.map((inv) => {
            const status = inviteStatus(inv, now)
            const joined = inv.usedBy.map(nameOf)
            return (
              <li key={inv.id} className="border-t border-border py-3 first:border-t-0">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="break-all text-base font-bold">{inv.note || '（无备注）'}</span>
                  {admin && (
                    <span className="text-xs text-muted-foreground">
                      {inv.kind === 'leader' ? '队长邀请' : `加入「${bandName(inv.bandId) || '已删除的乐队'}」`}
                    </span>
                  )}
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
                  {nameOf(inv.createdBy)} 创建于 {fmtDate(inv.createdAt)} ·{' '}
                  {inv.expiresAt === null ? '永不过期' : `${fmtDate(inv.expiresAt)} 到期`} · 已用 {inv.uses} /{' '}
                  {inv.maxUses ?? '不限'}
                  {inv.kind === 'member' &&
                    ` · 默认乐器：${inv.instrument ? INSTRUMENT_LABELS[inv.instrument] : '不指定'}`}{' '}
                  · {inv.libraryAccess ? '可看完整谱库' : '只能看乐队歌单'}
                </p>
                <p className="m-0 mt-1 text-xs text-muted-foreground">
                  用过的人：{joined.length > 0 ? joined.join('、') : '暂无'}
                </p>
                {status === '有效' &&
                  (revokeId === inv.id ? (
                    <div className="mt-2 space-y-2 rounded-lg border border-destructive p-3">
                      <p className="m-0 text-sm">作废后这个邀请码就不能再用了，确定作废？</p>
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void revoke(inv.id)}
                          disabled={busy}
                          className={cx(buttonClass('outline'), 'min-h-11 border-destructive px-3 text-destructive')}
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
