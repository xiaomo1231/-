/**
 * 小节留言 list grouped by bar, with an add form and delete for the author or an admin.
 */
import { useMemo, useState, type FormEvent } from 'react'
import type { BarComment, UserInfo } from '../lib/api'

const TEXT_MAX = 200

function errMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '操作失败，请重试'
}

function fmtWhen(at: number, now: number): string {
  const diff = now - at
  if (diff < 60_000) return '刚刚'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  return new Date(at).toLocaleString('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

const INPUT =
  'rounded-md border border-[hsl(var(--border))] bg-transparent px-2 py-2 text-sm focus:border-[hsl(var(--primary))] focus:outline-none'

export function CommentsPanel(props: {
  comments: BarComment[]
  members: Array<{ id: string; displayName: string }>
  me: UserInfo | null
  /** Pre-filled bar number for a new comment (the current bar). */
  currentBar: number
  /** Bars in the song (for the number input max). */
  bars: number
  /** When set, only this bar's comments are listed first / highlighted. */
  focusBar: number | null
  onAdd: (bar: number, text: string) => Promise<void>
  onRemove: (id: string) => Promise<void>
  /** Jump the sheet to that bar (optional). */
  onJump?: (bar: number) => void
}) {
  const { comments, members, me, currentBar, bars, focusBar, onAdd, onRemove, onJump } = props

  const [draftBar, setDraftBar] = useState(String(currentBar))
  const [draftText, setDraftText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Follow the current bar until the user types their own number.
  const [lastCurrent, setLastCurrent] = useState(currentBar)
  if (lastCurrent !== currentBar) {
    setLastCurrent(currentBar)
    setDraftBar(String(currentBar))
  }

  const nameOf = (userId: string) => {
    if (me && userId === me.id) return me.displayName
    return members.find((m) => m.id === userId)?.displayName ?? '成员'
  }

  const groups = useMemo(() => {
    const byBar = new Map<number, BarComment[]>()
    for (const c of comments) {
      const list = byBar.get(c.bar) ?? []
      list.push(c)
      byBar.set(c.bar, list)
    }
    const bars = [...byBar.keys()].sort((a, b) => {
      if (a === focusBar) return -1
      if (b === focusBar) return 1
      return a - b
    })
    return bars.map((bar) => ({
      bar,
      items: (byBar.get(bar) ?? []).slice().sort((a, b) => a.at - b.at),
    }))
  }, [comments, focusBar])

  const now = Date.now()

  const handleAdd = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const bar = Number(draftBar)
    const text = draftText.trim()
    if (!Number.isInteger(bar) || bar < 1 || bar > bars) {
      setError(`小节号需在 1–${bars} 之间`)
      return
    }
    if (!text) {
      setError('留言不能为空')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onAdd(bar, text)
      setDraftText('')
    } catch (err) {
      setError(errMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const handleRemove = async (c: BarComment) => {
    if (!window.confirm('删除这条留言？')) return
    setError(null)
    try {
      await onRemove(c.id)
    } catch (err) {
      setError(errMessage(err))
    }
  }

  return (
    <section aria-label="小节留言" className="flex flex-col gap-3 text-sm">
      {groups.length === 0 && (
        <p className="text-[hsl(var(--muted-foreground))]">
          还没有留言。在小节上留一句话，比如“这里一起停两拍”，大家都会看到。
        </p>
      )}

      {groups.map((group) => {
        const focused = group.bar === focusBar
        return (
          <div
            key={group.bar}
            className={`rounded-md border px-3 py-2 ${
              focused ? 'border-[hsl(var(--primary))]' : 'border-[hsl(var(--border))]'
            }`}
          >
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="font-medium">第 {group.bar} 小节</span>
              {onJump && (
                <button
                  type="button"
                  onClick={() => onJump(group.bar)}
                  className="rounded px-2 py-1 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]"
                >
                  定位
                </button>
              )}
            </div>
            <ul className="flex flex-col gap-2">
              {group.items.map((c) => {
                const canDelete = !!me && (c.userId === me.id || me.role === 'admin')
                return (
                  <li key={c.id} className="flex flex-col gap-0.5">
                    <p className="whitespace-pre-wrap break-words">{c.text}</p>
                    <div className="flex flex-wrap items-center gap-x-2 text-xs text-[hsl(var(--muted-foreground))]">
                      <span>{nameOf(c.userId)}</span>
                      <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtWhen(c.at, now)}</span>
                      {canDelete && (
                        <button
                          type="button"
                          onClick={() => void handleRemove(c)}
                          className="ml-auto rounded px-1.5 py-0.5 hover:text-destructive"
                        >
                          删除
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          </div>
        )
      })}

      <form
        onSubmit={(e) => void handleAdd(e)}
        className="flex flex-col gap-2 border-t border-[hsl(var(--border))] pt-3"
      >
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-1.5">
            <span className="text-[hsl(var(--muted-foreground))]">小节</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={bars}
              value={draftBar}
              onChange={(e) => setDraftBar(e.target.value)}
              className={`${INPUT} w-20`}
              style={{ fontFamily: 'var(--font-mono)' }}
            />
          </label>
          <span
            className="ml-auto text-xs text-[hsl(var(--muted-foreground))]"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {draftText.length}/{TEXT_MAX}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="留言内容"
            maxLength={TEXT_MAX}
            value={draftText}
            onChange={(e) => setDraftText(e.target.value)}
            placeholder="写一句话"
            className={`${INPUT} min-w-0 flex-1`}
          />
          <button
            type="submit"
            disabled={busy}
            className="min-h-11 shrink-0 rounded-md border border-[hsl(var(--primary))] px-3 text-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50"
          >
            添加
          </button>
        </div>
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </form>
    </section>
  )
}
