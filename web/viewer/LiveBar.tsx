/**
 * The 一起播放 bar above the score: connection dot, who is here, the leader (主控)
 * and the claim/release button. Compact on desktop, wraps on phones.
 */
import type { useLiveSync } from './liveSync'

type LiveSyncResult = ReturnType<typeof useLiveSync>

export function LiveBar(props: {
  live: LiveSyncResult
  members: Array<{ id: string; displayName: string }>
  myId: string | null
}) {
  const { live, members, myId } = props
  const { state, connected, isLeader, error } = live
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? '成员'

  const present = state?.present ?? []
  const leaderId = state?.leaderId ?? null
  // Someone else is leading and is still here: the button cannot take over.
  const otherLeaderHere = leaderId !== null && leaderId !== myId && present.includes(leaderId)

  let note: string | null = null
  if (isLeader) note = '你是主控'
  else if (otherLeaderHere) note = `跟随 ${nameOf(leaderId!)} 的播放`

  const buttonTitle = otherLeaderHere ? `${nameOf(leaderId!)} 正在主控` : undefined

  return (
    <div
      role="region"
      aria-label="一起播放"
      className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-md border border-[hsl(var(--border))] px-3 py-1.5 text-sm"
    >
      <span className="font-medium">一起播放</span>

      <span
        className="inline-flex items-center gap-1.5 text-[hsl(var(--muted-foreground))]"
        title={connected ? '已连接' : '未连接'}
      >
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-full"
          style={{ background: connected ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
        />
        {connected ? '已连接' : '未连接'}
      </span>

      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-[hsl(var(--muted-foreground))]" style={{ fontFamily: 'var(--font-mono)' }}>
          在线 {present.length}
        </span>
        {present.map((id) => (
          <span key={id} className="inline-flex items-center gap-1">
            {nameOf(id)}
            {id === leaderId && (
              <span className="rounded border border-[hsl(var(--primary))] px-1 text-xs text-[hsl(var(--primary))]">
                主控
              </span>
            )}
          </span>
        ))}
      </span>

      {note && <span className="text-[hsl(var(--muted-foreground))]">{note}</span>}

      <button
        type="button"
        className="ml-auto rounded-md border border-[hsl(var(--border))] px-2.5 py-1 hover:border-[hsl(var(--primary))] disabled:cursor-not-allowed disabled:opacity-50"
        disabled={!isLeader && otherLeaderHere}
        title={buttonTitle}
        onClick={() => (isLeader ? live.release() : live.take())}
      >
        {isLeader ? '放弃主控' : '成为主控'}
      </button>

      {error && (
        <p role="alert" className="w-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
