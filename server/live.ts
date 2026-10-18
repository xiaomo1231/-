/**
 * 一起播放 (live rehearsal) of the score server: one in-memory room per band
 * song. The leader (主控) drives play / pause / seek / speed; every connected
 * member receives the shared transport over Server-Sent Events. The reducer
 * (`applyCommand`) is pure so the rules can be tested without HTTP.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { LiveCommand, LiveState } from '../src/songs/scoreServerTypes'
import type { ParseResult } from './favorites'

/** Time between a play command and the shared start, so every client receives it first. */
export const START_DELAY_MS = 1200
/** How long a leader may be absent before the lead is released. */
export const LEADER_GRACE_MS = 10000
/** Comment ping interval that keeps proxies from closing idle streams. */
export const HEARTBEAT_MS = 20000

const MAX_SONG_ID = 64
const MAX_TICK = 1e9
const MIN_SPEED = 15
const MAX_SPEED = 175
const LIVE_TYPES = ['lead', 'play', 'pause', 'seek', 'speed'] as const

const fail = <T>(error: string): ParseResult<T> => ({ ok: false, error })

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

/** Validates the body of POST /api/live/command. */
export function parseLiveCommand(body: unknown): ParseResult<LiveCommand> {
  if (!body || typeof body !== 'object') return fail('播放指令格式不对。')
  const rec = body as Record<string, unknown>
  const songId = rec.songId
  if (typeof songId !== 'string' || !songId || songId.length > MAX_SONG_ID)
    return fail('曲目编号不对。')
  const type = rec.type
  if (typeof type !== 'string' || !(LIVE_TYPES as readonly string[]).includes(type))
    return fail('播放指令不认识。')
  const tickOk = (v: unknown) => isInt(v, 0, MAX_TICK)
  const speedOk = (v: unknown) => isInt(v, MIN_SPEED, MAX_SPEED)
  switch (type as LiveCommand['type']) {
    case 'lead':
      if (typeof rec.take !== 'boolean') return fail('主控指令要说明是接管还是放弃。')
      return { ok: true, value: { songId, type: 'lead', take: rec.take } }
    case 'play':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      if (!speedOk(rec.speedPct)) return fail(`播放速度要在 ${MIN_SPEED}% 到 ${MAX_SPEED}% 之间。`)
      return {
        ok: true,
        value: { songId, type: 'play', tick: rec.tick as number, speedPct: rec.speedPct as number },
      }
    case 'pause':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      return { ok: true, value: { songId, type: 'pause', tick: rec.tick as number } }
    case 'seek':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      return { ok: true, value: { songId, type: 'seek', tick: rec.tick as number } }
    case 'speed':
      if (!speedOk(rec.speedPct)) return fail(`播放速度要在 ${MIN_SPEED}% 到 ${MAX_SPEED}% 之间。`)
      return { ok: true, value: { songId, type: 'speed', speedPct: rec.speedPct as number } }
  }
}

export function freshLiveState(songId: string): LiveState {
  return {
    songId,
    leaderId: null,
    playing: false,
    tick: 0,
    speedPct: 100,
    startAt: 0,
    seq: 0,
    present: [],
  }
}

export type ApplyResult = { state: LiveState } | { error: string; status: number }

/**
 * Applies one command to a room. `state.present` must already reflect the
 * connected members. Every successful command bumps `seq`.
 */
export function applyCommand(
  state: LiveState,
  userId: string,
  cmd: LiveCommand,
  now: number,
): ApplyResult {
  if (cmd.songId !== state.songId) return { error: '曲目不对。', status: 400 }

  const next = (patch: Partial<LiveState>): ApplyResult => ({
    state: { ...state, ...patch, seq: state.seq + 1 },
  })
  const leaderOnly = (): ApplyResult | null =>
    state.leaderId === userId ? null : { error: '只有主控可以控制播放。', status: 403 }

  switch (cmd.type) {
    case 'lead': {
      if (cmd.take) {
        const free =
          state.leaderId === null ||
          state.leaderId === userId ||
          !state.present.includes(state.leaderId)
        if (!free) return { error: '主控还在线，暂时不能接管。', status: 409 }
        return next({ leaderId: userId })
      }
      if (state.leaderId !== userId) return { error: '只有主控可以放弃主控。', status: 403 }
      return next({ leaderId: null })
    }
    case 'play': {
      const denied = leaderOnly()
      if (denied) return denied
      return next({
        playing: true,
        tick: cmd.tick,
        speedPct: cmd.speedPct,
        startAt: now + START_DELAY_MS,
      })
    }
    case 'pause': {
      const denied = leaderOnly()
      if (denied) return denied
      return next({ playing: false, tick: cmd.tick })
    }
    case 'seek': {
      const denied = leaderOnly()
      if (denied) return denied
      return next({
        tick: cmd.tick,
        ...(state.playing ? { startAt: now + START_DELAY_MS } : {}),
      })
    }
    case 'speed': {
      const denied = leaderOnly()
      if (denied) return denied
      return next({ speedPct: cmd.speedPct })
    }
  }
}

interface Conn {
  userId: string
  res: ServerResponse
  open: boolean
  heartbeat: ReturnType<typeof setInterval>
}

interface Room {
  songId: string
  state: LiveState
  conns: Set<Conn>
  /** Pending lead release, and the leader it was scheduled for. */
  grace: ReturnType<typeof setTimeout> | null
  graceFor: string | null
}

const copyState = (s: LiveState): LiveState => ({ ...s, present: [...s.present] })

export class LiveHub {
  private readonly rooms = new Map<string, Room>()

  /** Opens an SSE stream for one member of a band song. */
  subscribe(songId: string, userId: string, req: IncomingMessage, res: ServerResponse): void {
    const room = this.roomFor(songId)
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const conn: Conn = {
      userId,
      res,
      open: true,
      heartbeat: setInterval(() => this.ping(songId, conn), HEARTBEAT_MS),
    }
    conn.heartbeat.unref()
    room.conns.add(conn)
    this.refreshPresence(room)
    this.reconcileGrace(room)
    // Everyone in the room (this new stream included) gets the current state.
    this.broadcast(room)
    req.on('close', () => this.disconnect(songId, conn))
  }

  /** Applies a command; on success stores the new state and broadcasts it. */
  command(userId: string, cmd: LiveCommand, now: number = Date.now()): ApplyResult {
    const room = this.roomFor(cmd.songId)
    const result = applyCommand(room.state, userId, cmd, now)
    if ('error' in result) {
      this.dropIfIdle(room)
      return result
    }
    room.state = result.state
    this.reconcileGrace(room)
    this.broadcast(room)
    return result
  }

  /** A copy of the current state of a song (a fresh default when nobody has used it). */
  state(songId: string): LiveState {
    const room = this.rooms.get(songId)
    return copyState(room ? room.state : freshLiveState(songId))
  }

  /** Ends every stream and clears all timers (shutdown / tests). */
  close(): void {
    for (const room of this.rooms.values()) {
      if (room.grace) clearTimeout(room.grace)
      room.grace = null
      for (const conn of room.conns) this.closeConn(conn)
      room.conns.clear()
    }
    this.rooms.clear()
  }

  private roomFor(songId: string): Room {
    let room = this.rooms.get(songId)
    if (!room) {
      room = {
        songId,
        state: freshLiveState(songId),
        conns: new Set(),
        grace: null,
        graceFor: null,
      }
      this.rooms.set(songId, room)
    }
    return room
  }

  private closeConn(conn: Conn): void {
    if (!conn.open) return
    conn.open = false
    clearInterval(conn.heartbeat)
    try {
      conn.res.end()
    } catch {
      // The socket is already gone.
    }
  }

  private disconnect(songId: string, conn: Conn): void {
    if (!conn.open) return
    this.closeConn(conn)
    const room = this.rooms.get(songId)
    if (!room) return
    room.conns.delete(conn)
    this.refreshPresence(room)
    this.reconcileGrace(room)
    this.broadcast(room)
    this.dropIfIdle(room)
  }

  private ping(songId: string, conn: Conn): void {
    if (!conn.open) return
    try {
      conn.res.write(': ping\n\n')
    } catch {
      this.disconnect(songId, conn)
    }
  }

  /** Presence = members with at least one open stream (several streams count once). */
  private refreshPresence(room: Room): void {
    const present = [...new Set([...room.conns].map((c) => c.userId))]
    room.state = { ...room.state, present }
  }

  /** Starts (or restarts for a new leader) the grace timer while the leader is absent. */
  private reconcileGrace(room: Room): void {
    const leader = room.state.leaderId
    const absent = leader !== null && !room.state.present.includes(leader)
    if (!absent) {
      if (room.grace) clearTimeout(room.grace)
      room.grace = null
      room.graceFor = null
      return
    }
    if (room.grace && room.graceFor === leader) return
    if (room.grace) clearTimeout(room.grace)
    room.graceFor = leader
    const timer = setTimeout(() => {
      room.grace = null
      room.graceFor = null
      const current = room.state.leaderId
      if (current !== leader || room.state.present.includes(leader)) return
      room.state = { ...room.state, leaderId: null, seq: room.state.seq + 1 }
      this.broadcast(room)
      this.dropIfIdle(room)
    }, LEADER_GRACE_MS)
    timer.unref()
    room.grace = timer
  }

  private broadcast(room: Room): void {
    const line = `event: state\ndata: ${JSON.stringify(room.state)}\n\n`
    for (const conn of [...room.conns]) {
      if (!conn.open) continue
      try {
        conn.res.write(line)
      } catch {
        this.disconnect(room.songId, conn)
      }
    }
  }

  /** Forgets a room nobody is in and nobody leads. */
  private dropIfIdle(room: Room): void {
    if (room.conns.size > 0 || room.state.leaderId !== null || room.grace) return
    if (this.rooms.get(room.songId) === room) this.rooms.delete(room.songId)
  }
}
