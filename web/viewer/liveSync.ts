/**
 * 一起播放 (live rehearsal): every band member's player starts the same tick at
 * the same server time. The leader (主控) sends commands; everyone, the leader
 * included, applies the server's LiveState the same way.
 *
 * Clock model: `offsetMs` is what to ADD to the local clock to get server time,
 * so a server time `t` happens locally at `t - offsetMs`.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { api, errorText, type LiveCommand, type LiveState } from '../lib/api'

/** What the viewer provides; the hook drives it. */
export interface LivePlayer {
  /** Seek to tick, set speed, and start playing (with the viewer's own count-in setting). */
  startAt(tick: number, speedPct: number): void
  pause(tick: number): void
  seek(tick: number): void
  setSpeed(speedPct: number): void
  currentTick(): number
  currentSpeed(): number
}

export interface TimeSample {
  /** Local time before the request. */
  t0: number
  /** Server time from the response. */
  server: number
  /** Local time after the response. */
  t1: number
}

/** A follower joining more than this late does not join mid-song (see planFor). */
export const LATE_START_MS = 3000
const ERROR_VISIBLE_MS = 4000

/** Offset from the sample with the smallest round trip (least queueing noise). */
export function estimateOffset(samples: TimeSample[]): number {
  if (samples.length === 0) throw new Error('没有可用的时间样本。')
  let best = samples[0]!
  for (const s of samples) {
    if (s.t1 - s.t0 < best.t1 - best.t0) best = s
  }
  return best.server - (best.t0 + best.t1) / 2
}

/** Local clock reading at which server time `serverTime` happens. */
export function localTimeFor(serverTime: number, offset: number): number {
  return serverTime - offset
}

/** Measure the server clock offset with `n` sequential round trips. */
export async function measureOffset(n = 5): Promise<number> {
  const samples: TimeSample[] = []
  let lastError: unknown = null
  for (let i = 0; i < n; i++) {
    const t0 = Date.now()
    try {
      const { now } = await api.serverTime()
      const t1 = Date.now()
      samples.push({ t0, server: now, t1 })
    } catch (e) {
      lastError = e
    }
  }
  if (samples.length === 0) {
    throw lastError instanceof Error ? lastError : new Error('无法同步服务器时间，请检查网络。')
  }
  return estimateOffset(samples)
}

export type LivePlan =
  | { kind: 'ignore' }
  | { kind: 'pause'; tick: number }
  | { kind: 'start'; tick: number; speedPct: number; delayMs: number }

/**
 * What a client should do with a received state.
 * - stale (seq <= lastSeq): ignore.
 * - not playing: pause at the state's tick.
 * - playing: start at the state's tick when its startAt (local clock) arrives.
 *   Already past by less than LATE_START_MS: start now at the same tick (no catch-up).
 *   Later than that: ignore. The tick is not advanced, so joining late would
 *   otherwise start the song from the wrong place.
 */
export function planFor(state: LiveState, lastSeq: number, offsetMs: number, now: number): LivePlan {
  if (state.seq <= lastSeq) return { kind: 'ignore' }
  if (!state.playing) return { kind: 'pause', tick: state.tick }
  const localStart = localTimeFor(state.startAt, offsetMs)
  const late = now - localStart
  if (late >= LATE_START_MS) return { kind: 'ignore' }
  return {
    kind: 'start',
    tick: state.tick,
    speedPct: state.speedPct,
    delayMs: Math.max(0, -late),
  }
}

export interface LiveSync {
  state: LiveState | null
  connected: boolean
  isLeader: boolean
  offsetMs: number
  error: string | null
  take(): void
  release(): void
  play(): void
  pause(): void
  seek(tick: number): void
  speed(pct: number): void
}

export function useLiveSync(songId: string | null, myId: string | null, player: LivePlayer | null): LiveSync {
  const [state, setState] = useState<LiveState | null>(null)
  const appliedRef = useRef<LiveState | null>(null)
  const [connected, setConnected] = useState(false)
  const [offsetMs, setOffsetMs] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const offsetRef = useRef(0)
  const lastSeqRef = useRef(-1)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const playerRef = useRef<LivePlayer | null>(player)

  useEffect(() => {
    playerRef.current = player
  }, [player])

  const clearSchedule = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const showError = useCallback((e: unknown) => {
    setError(errorText(e))
    if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current)
    errorTimerRef.current = setTimeout(() => {
      errorTimerRef.current = null
      setError(null)
    }, ERROR_VISIBLE_MS)
  }, [])

  const applyState = useCallback(
    (s: LiveState) => {
      const prev = lastSeqRef.current
      // Same seq: only who is here changed (presence is not a transport change).
      if (s.seq === prev) {
        setState(s)
        return
      }
      const plan = planFor(s, prev, offsetRef.current, Date.now())
      if (s.seq < prev) return
      lastSeqRef.current = s.seq
      const before = appliedRef.current
      appliedRef.current = s
      setState(s)
      // A change of leader or of speed alone must not restart anybody's playback.
      if (
        before &&
        before.playing === s.playing &&
        before.tick === s.tick &&
        before.startAt === s.startAt
      ) {
        if (before.speedPct !== s.speedPct) playerRef.current?.setSpeed(s.speedPct)
        return
      }
      clearSchedule()
      const p = playerRef.current
      if (!p || plan.kind === 'ignore') return
      if (plan.kind === 'pause') {
        p.pause(plan.tick)
        return
      }
      if (plan.delayMs <= 0) {
        p.startAt(plan.tick, plan.speedPct)
        return
      }
      p.seek(plan.tick)
      p.setSpeed(plan.speedPct)
      timerRef.current = setTimeout(() => {
        timerRef.current = null
        playerRef.current?.startAt(plan.tick, plan.speedPct)
      }, plan.delayMs)
    },
    [clearSchedule],
  )

  // Open the live channel for the song; close it on unmount or song change.
  useEffect(() => {
    setState(null)
    setConnected(false)
    lastSeqRef.current = -1
    appliedRef.current = null
    if (!songId) return

    let cancelled = false
    let es: EventSource | null = null
    let everOpened = false

    const remeasure = () => {
      measureOffset()
        .then((o) => {
          if (cancelled) return
          offsetRef.current = o
          setOffsetMs(o)
        })
        .catch(() => {})
    }

    void (async () => {
      try {
        const o = await measureOffset()
        if (cancelled) return
        offsetRef.current = o
        setOffsetMs(o)
      } catch (e) {
        if (!cancelled) showError(e)
      }
      if (cancelled) return

      es = new EventSource(`/api/live/events?songId=${encodeURIComponent(songId)}`)
      es.onopen = () => {
        if (cancelled) return
        setConnected(true)
        if (everOpened) {
          // EventSource reconnected: the server may have restarted (seq reset),
          // so accept the next state and re-measure the clock offset.
          lastSeqRef.current = -1
          appliedRef.current = null
          remeasure()
        }
        everOpened = true
      }
      es.addEventListener('state', (ev) => {
        if (cancelled) return
        try {
          applyState(JSON.parse((ev as MessageEvent<string>).data) as LiveState)
        } catch {
          // Malformed event: ignore it, the next state corrects us.
        }
      })
      es.onerror = () => {
        if (cancelled || !es) return
        setConnected(false)
        if (es.readyState === EventSource.CLOSED) showError('实时连接已断开，请刷新页面。')
      }
    })()

    return () => {
      cancelled = true
      es?.close()
      clearSchedule()
      setConnected(false)
    }
  }, [songId, applyState, clearSchedule, showError])

  // Timers are cleared on unmount.
  useEffect(
    () => () => {
      clearSchedule()
      if (errorTimerRef.current !== null) clearTimeout(errorTimerRef.current)
    },
    [clearSchedule],
  )

  const send = (c: LiveCommand) => {
    api
      .liveCommand(c)
      .then((s) => applyState(s))
      .catch(showError)
  }

  const isLeader = myId !== null && state?.leaderId === myId

  return {
    state,
    connected,
    isLeader,
    offsetMs,
    error,
    take() {
      if (songId) send({ songId, type: 'lead', take: true })
    },
    release() {
      if (songId) send({ songId, type: 'lead', take: false })
    },
    play() {
      const p = playerRef.current
      if (songId && p) send({ songId, type: 'play', tick: p.currentTick(), speedPct: p.currentSpeed() })
    },
    pause() {
      const p = playerRef.current
      if (songId && p) send({ songId, type: 'pause', tick: p.currentTick() })
    },
    seek(tick: number) {
      if (songId) send({ songId, type: 'seek', tick })
    },
    speed(pct: number) {
      if (songId) send({ songId, type: 'speed', speedPct: pct })
    },
  }
}
