/**
 * 排练 (rehearsal) of the score server: the band's one rehearsal room. One 音箱
 * device plays the shared transport, the 指挥 (leader) drives it, and every
 * connected device follows over Server-Sent Events. The reducer
 * (`applyRehearsal`) is pure so the rules can be tested without HTTP.
 */
import { randomBytes } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  RehearsalClock,
  RehearsalCommand,
  RehearsalCommandBody,
  RehearsalDevice,
  RehearsalLoop,
  RehearsalRequest,
  RehearsalState,
} from '../src/songs/scoreServerTypes'
import type { ParseResult } from './favorites'

/** Time between a play / seek command and the shared start, so every device receives it first. */
export const START_DELAY_MS = 1500
/** Gap between the end of one loop pass and the start of the next. */
export const PASS_GAP_MS = 1500
/** How long a leader may be absent before the lead is released. */
export const LEADER_GRACE_MS = 10000
/** How long a device whose last stream closed is kept before it is removed. */
export const DEVICE_GRACE_MS = 8000
/** Comment ping interval that keeps proxies from closing idle streams. */
export const HEARTBEAT_MS = 20000

const MAX_SONG_ID = 64
const MAX_TICK = 1e9
const MAX_BAR = 100000
const MAX_SETLIST = 50
const MAX_REQUESTS = 10
const MAX_CLOCK_MS = 1e8
const MAX_DRIFT_MS = 100000
const MIN_SPEED = 15
const MAX_SPEED = 175
const MAX_LATENCY = 1000
const MAX_LABEL = 20
const MAX_REQUEST_ID = 20
const DEVICE_ID = /^[A-Za-z0-9_-]{8,40}$/
const COMMAND_TYPES = [
  'start',
  'end',
  'lead',
  'speaker',
  'song',
  'play',
  'pause',
  'seek',
  'speed',
  'countIn',
  'loop',
  'passEnded',
  'clock',
  'device',
  'request',
  'dismiss',
] as const
/** Commands that work before the rehearsal has started (or while it is idle). */
const WITHOUT_ACTIVE: ReadonlyArray<string> = ['device', 'lead', 'speaker', 'start', 'clock']

const fail = <T>(error: string): ParseResult<T> => ({ ok: false, error })

const isInt = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max

const isNum = (v: unknown, min: number, max: number): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max

const isStr = (v: unknown, max: number): v is string =>
  typeof v === 'string' && v.length >= 1 && v.length <= max

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))

function parseSetlist(raw: unknown): ParseResult<string[]> {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_SETLIST)
    return fail(`歌单要有 1 到 ${MAX_SETLIST} 首歌。`)
  if (!raw.every((id) => isStr(id, MAX_SONG_ID))) return fail('歌单里的歌编号不对。')
  if (new Set(raw).size !== raw.length) return fail('歌单里有重复的歌。')
  return { ok: true, value: raw as string[] }
}

/** Validates a loop (or null = no loop). */
function parseLoop(raw: unknown): ParseResult<RehearsalLoop | null> {
  if (raw === null) return { ok: true, value: null }
  if (!raw || typeof raw !== 'object') return fail('循环设置不对。')
  const r = raw as Record<string, unknown>
  if (!isInt(r.startTick, 0, MAX_TICK) || !isInt(r.endTick, 0, MAX_TICK))
    return fail('循环的起止位置不对。')
  if ((r.startTick as number) >= (r.endTick as number)) return fail('循环的结束要在开始之后。')
  if (!isInt(r.startBar, 1, MAX_BAR) || !isInt(r.endBar, 1, MAX_BAR))
    return fail('循环的小节不对。')
  if ((r.startBar as number) > (r.endBar as number)) return fail('循环的结束小节要不早于开始小节。')
  if (r.passes !== null && !isInt(r.passes, 1, 99)) return fail('循环遍数要在 1 到 99 之间。')
  if (!isInt(r.rampPct, 0, 20)) return fail('每遍加速要在 0 到 20 之间。')
  if (!isInt(r.rampMaxPct, MIN_SPEED, MAX_SPEED))
    return fail(`加速上限要在 ${MIN_SPEED}% 到 ${MAX_SPEED}% 之间。`)
  return {
    ok: true,
    value: {
      startTick: r.startTick as number,
      endTick: r.endTick as number,
      startBar: r.startBar as number,
      endBar: r.endBar as number,
      passes: r.passes as number | null,
      rampPct: r.rampPct as number,
      rampMaxPct: r.rampMaxPct as number,
    },
  }
}

/** Validates one rehearsal command. */
function parseCommand(raw: unknown): ParseResult<RehearsalCommand> {
  if (!raw || typeof raw !== 'object') return fail('排练指令格式不对。')
  const rec = raw as Record<string, unknown>
  const type = rec.type
  if (typeof type !== 'string' || !(COMMAND_TYPES as readonly string[]).includes(type))
    return fail('排练指令不认识。')
  const tickOk = (v: unknown): v is number => isInt(v, 0, MAX_TICK)
  const speedOk = (v: unknown): v is number => isInt(v, MIN_SPEED, MAX_SPEED)
  const speedMsg = `播放速度要在 ${MIN_SPEED}% 到 ${MAX_SPEED}% 之间。`
  switch (type as RehearsalCommand['type']) {
    case 'start': {
      const setlist = parseSetlist(rec.setlist)
      if (!setlist.ok) return fail(setlist.error)
      return { ok: true, value: { type: 'start', setlist: setlist.value } }
    }
    case 'end':
      return { ok: true, value: { type: 'end' } }
    case 'lead':
      if (typeof rec.take !== 'boolean') return fail('指挥要说明是接管还是放下。')
      return { ok: true, value: { type: 'lead', take: rec.take } }
    case 'speaker':
      if (typeof rec.take !== 'boolean') return fail('音箱要说明是接管还是放下。')
      return { ok: true, value: { type: 'speaker', take: rec.take } }
    case 'song':
      if (!isStr(rec.songId, MAX_SONG_ID)) return fail('曲目编号不对。')
      return { ok: true, value: { type: 'song', songId: rec.songId } }
    case 'play':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      if (!speedOk(rec.speedPct)) return fail(speedMsg)
      return { ok: true, value: { type: 'play', tick: rec.tick, speedPct: rec.speedPct } }
    case 'pause':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      return { ok: true, value: { type: 'pause', tick: rec.tick } }
    case 'seek':
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      return { ok: true, value: { type: 'seek', tick: rec.tick } }
    case 'speed':
      if (!speedOk(rec.speedPct)) return fail(speedMsg)
      return { ok: true, value: { type: 'speed', speedPct: rec.speedPct } }
    case 'countIn':
      if (typeof rec.on !== 'boolean') return fail('预备拍要说明是开还是关。')
      return { ok: true, value: { type: 'countIn', on: rec.on } }
    case 'loop': {
      const loop = parseLoop(rec.loop)
      if (!loop.ok) return fail(loop.error)
      return { ok: true, value: { type: 'loop', loop: loop.value } }
    }
    case 'passEnded':
      if (!isInt(rec.seq, 0, Number.MAX_SAFE_INTEGER) || !isInt(rec.pass, 1, MAX_TICK))
        return fail('播放进度不对。')
      return { ok: true, value: { type: 'passEnded', seq: rec.seq, pass: rec.pass } }
    case 'clock':
      if (
        !isInt(rec.seq, 0, Number.MAX_SAFE_INTEGER) ||
        !isInt(rec.pass, 1, MAX_TICK) ||
        !isNum(rec.timeMs, 0, MAX_CLOCK_MS) ||
        typeof rec.at !== 'number' ||
        !Number.isFinite(rec.at) ||
        rec.at <= 0
      )
        return fail('播放位置报告不对。')
      return {
        ok: true,
        value: {
          type: 'clock',
          seq: rec.seq,
          pass: rec.pass,
          timeMs: rec.timeMs,
          at: rec.at,
        },
      }
    case 'device': {
      const out: Extract<RehearsalCommand, { type: 'device' }> = { type: 'device' }
      if (rec.ready !== undefined) {
        if (typeof rec.ready !== 'boolean') return fail('“准备好了”要说明是或否。')
        out.ready = rec.ready
      }
      if (rec.audible !== undefined) {
        if (typeof rec.audible !== 'boolean') return fail('“出声”要说明是或否。')
        out.audible = rec.audible
      }
      if (rec.latencyMs !== undefined) {
        if (!isInt(rec.latencyMs, 0, MAX_LATENCY)) return fail('延迟要在 0 到 1000 毫秒之间。')
        out.latencyMs = rec.latencyMs
      }
      if (rec.label !== undefined) {
        if (typeof rec.label !== 'string' || rec.label.trim().length > MAX_LABEL)
          return fail(`设备名字最多 ${MAX_LABEL} 个字。`)
        out.label = rec.label.trim()
      }
      if (rec.driftMs !== undefined) {
        if (rec.driftMs === null) out.driftMs = null
        else if (typeof rec.driftMs === 'number' && Number.isFinite(rec.driftMs))
          out.driftMs = clamp(rec.driftMs, -MAX_DRIFT_MS, MAX_DRIFT_MS)
        else return fail('偏差时间要是数字。')
      }
      if (Object.keys(out).length === 1) return fail('设备状态要至少说明一项。')
      return { ok: true, value: out }
    }
    case 'request':
      if (!isInt(rec.bar, 1, MAX_BAR)) return fail('小节号不对。')
      if (!tickOk(rec.tick)) return fail('播放位置不对。')
      return { ok: true, value: { type: 'request', bar: rec.bar, tick: rec.tick } }
    case 'dismiss':
      if (!isStr(rec.requestId, MAX_REQUEST_ID)) return fail('请求编号不对。')
      return { ok: true, value: { type: 'dismiss', requestId: rec.requestId } }
  }
}

/** Validates the body of POST /api/rehearsal/command. */
export function parseRehearsalBody(body: unknown): ParseResult<RehearsalCommandBody> {
  if (!body || typeof body !== 'object') return fail('排练指令格式不对。')
  const rec = body as Record<string, unknown>
  if (typeof rec.deviceId !== 'string' || !DEVICE_ID.test(rec.deviceId))
    return fail('设备编号不对。')
  const command = parseCommand(rec.command)
  if (!command.ok) return fail(command.error)
  return { ok: true, value: { deviceId: rec.deviceId, command: command.value } }
}

export function freshRehearsal(): RehearsalState {
  return {
    active: false,
    songId: null,
    leaderId: null,
    leaderDevice: null,
    speakerDevice: null,
    playing: false,
    tick: 0,
    speedPct: 100,
    countIn: true,
    startAt: 0,
    loop: null,
    pass: 1,
    requests: [],
    devices: [],
    seq: 0,
    startedAt: 0,
  }
}

/** Who is acting: the signed-in user and the device (browser tab) they act from. */
export interface Actor {
  userId: string
  deviceId: string
}

export interface Ctx {
  now: number
  songExists: (id: string) => boolean
}

export type RehearsalResult =
  | { state: RehearsalState; kind: 'transport' | 'other' | 'none'; clock?: RehearsalClock }
  | { error: string; status: number }

const unready = (devices: RehearsalDevice[]): RehearsalDevice[] =>
  devices.map((d) => ({ ...d, ready: false }))

/**
 * Applies one command to the room. Pure: returns a new state (or the error).
 * `kind` tells the hub what changed: 'transport' (playback / song / loop, bumps seq),
 * 'other' (devices, requests, lead) or 'none' (ignored, nothing to send).
 */
export function applyRehearsal(
  state: RehearsalState,
  actor: Actor,
  cmd: RehearsalCommand,
  ctx: Ctx,
): RehearsalResult {
  const { now } = ctx
  const err = (error: string, status: number): RehearsalResult => ({ error, status })
  const done = (
    next: RehearsalState,
    kind: 'transport' | 'other' | 'none',
    clock?: RehearsalClock,
  ): RehearsalResult => (clock ? { state: next, kind, clock } : { state: next, kind })
  // Every transport change starts the drift measurements again.
  const bump = (patch: Partial<RehearsalState>): RehearsalState => ({
    ...state,
    ...patch,
    devices: (patch.devices ?? state.devices).map((d) =>
      d.driftMs === null ? d : { ...d, driftMs: null },
    ),
    seq: state.seq + 1,
  })
  const isLeader = state.leaderId === actor.userId
  const leaderHasDevice = (userId: string) => state.devices.some((d) => d.userId === userId)
  const referenceDevice = state.speakerDevice !== null ? state.speakerDevice : state.leaderDevice
  // Device ids are visible to everyone: a device-bound command must come from its owner.
  const listedDevice = state.devices.find((d) => d.deviceId === actor.deviceId)
  if (
    listedDevice &&
    listedDevice.userId !== actor.userId &&
    (cmd.type === 'speaker' || cmd.type === 'passEnded' || cmd.type === 'clock' || cmd.type === 'device')
  )
    return err('这个设备不是你的。', 403)
  const leaderOnly = (): RehearsalResult | null =>
    isLeader ? null : err('只有指挥可以控制排练。', 403)

  if (!WITHOUT_ACTIVE.includes(cmd.type) && !state.active) return err('排练还没开始。', 409)

  switch (cmd.type) {
    case 'start': {
      if (state.active) return err('排练已经开始了。', 409)
      if (!cmd.setlist.every((id) => ctx.songExists(id)))
        return err('歌单里有歌已经不在乐队歌单里了。', 404)
      return done(
        {
          ...freshRehearsal(),
          active: true,
          songId: cmd.setlist[0],
          leaderId: actor.userId,
          leaderDevice: actor.deviceId,
          speakerDevice: state.speakerDevice,
          devices: unready(state.devices).map((d) => ({ ...d, driftMs: null })),
          startedAt: now,
          seq: state.seq + 1,
        },
        'transport',
      )
    }
    case 'end': {
      const absentLeader = state.leaderId !== null && !leaderHasDevice(state.leaderId)
      if (!isLeader && !absentLeader) return err('只有指挥可以控制排练。', 403)
      return done(
        {
          ...freshRehearsal(),
          devices: unready(state.devices).map((d) => ({ ...d, driftMs: null })),
          speakerDevice: state.speakerDevice,
          seq: state.seq + 1,
        },
        'transport',
      )
    }
    case 'lead': {
      if (cmd.take) {
        const free = state.leaderId === null || isLeader || !leaderHasDevice(state.leaderId)
        if (!free) return err('指挥还在，暂时不能接管。', 409)
        return done({ ...state, leaderId: actor.userId, leaderDevice: actor.deviceId }, 'other')
      }
      if (!isLeader) return err('只有指挥可以放下指挥棒。', 403)
      return done({ ...state, leaderId: null, leaderDevice: null }, 'other')
    }
    case 'speaker': {
      if (cmd.take) {
        return done(bump({ speakerDevice: actor.deviceId, playing: false }), 'transport')
      }
      if (state.speakerDevice !== actor.deviceId) return err('只有当前音箱可以取消。', 403)
      return done(bump({ speakerDevice: null, playing: false }), 'transport')
    }
    case 'song': {
      const denied = leaderOnly()
      if (denied) return denied
      if (!ctx.songExists(cmd.songId)) return err('这首歌已经不在乐队歌单里了。', 404)
      return done(
        bump({
          songId: cmd.songId,
          playing: false,
          tick: 0,
          loop: null,
          pass: 1,
          requests: [],
          devices: unready(state.devices),
        }),
        'transport',
      )
    }
    case 'play': {
      const denied = leaderOnly()
      if (denied) return denied
      const loop = state.loop
      const outside = loop !== null && (cmd.tick < loop.startTick || cmd.tick >= loop.endTick)
      return done(
        bump({
          playing: true,
          tick: outside && loop ? loop.startTick : cmd.tick,
          speedPct: cmd.speedPct,
          pass: 1,
          startAt: now + START_DELAY_MS,
        }),
        'transport',
      )
    }
    case 'pause': {
      const denied = leaderOnly()
      if (denied) return denied
      return done(bump({ playing: false, tick: cmd.tick }), 'transport')
    }
    case 'seek': {
      const denied = leaderOnly()
      if (denied) return denied
      return done(
        bump({
          tick: cmd.tick,
          ...(state.playing ? { startAt: now + START_DELAY_MS, pass: 1 } : {}),
        }),
        'transport',
      )
    }
    case 'speed': {
      const denied = leaderOnly()
      if (denied) return denied
      return done(bump({ speedPct: cmd.speedPct }), 'transport')
    }
    case 'countIn': {
      const denied = leaderOnly()
      if (denied) return denied
      return done(bump({ countIn: cmd.on }), 'transport')
    }
    case 'loop': {
      const denied = leaderOnly()
      if (denied) return denied
      const loop = cmd.loop
      if (loop === null) return done(bump({ loop: null, pass: 1 }), 'transport')
      return done(
        bump({
          loop,
          pass: 1,
          tick: loop.startTick,
          ...(state.playing ? { startAt: now + START_DELAY_MS } : {}),
        }),
        'transport',
      )
    }
    case 'passEnded': {
      if (referenceDevice === null || referenceDevice !== actor.deviceId)
        return err('只有音箱可以报告播放进度。', 403)
      if (cmd.seq !== state.seq || cmd.pass !== state.pass || !state.playing)
        return done(state, 'none')
      const loop = state.loop
      if (loop && (loop.passes === null || state.pass < loop.passes)) {
        const ramped =
          loop.rampPct > 0
            ? Math.max(state.speedPct, Math.min(loop.rampMaxPct, state.speedPct + loop.rampPct))
            : state.speedPct
        return done(
          bump({
            pass: state.pass + 1,
            tick: loop.startTick,
            speedPct: ramped,
            startAt: now + PASS_GAP_MS,
          }),
          'transport',
        )
      }
      return done(bump({ playing: false, tick: loop ? loop.startTick : 0, pass: 1 }), 'transport')
    }
    case 'clock': {
      if (referenceDevice === null || referenceDevice !== actor.deviceId)
        return err('只有音箱可以报告播放进度。', 403)
      if (cmd.seq !== state.seq || cmd.pass !== state.pass || !state.playing)
        return done(state, 'none')
      return done(state, 'none', {
        seq: cmd.seq,
        pass: cmd.pass,
        timeMs: cmd.timeMs,
        at: cmd.at,
      })
    }
    case 'device': {
      const idx = state.devices.findIndex((d) => d.deviceId === actor.deviceId)
      if (idx < 0) return err('这个设备还没连上排练，请刷新页面。', 409)
      const patch: Partial<RehearsalDevice> = {}
      if (cmd.ready !== undefined) patch.ready = cmd.ready
      if (cmd.audible !== undefined) patch.audible = cmd.audible
      if (cmd.latencyMs !== undefined) patch.latencyMs = cmd.latencyMs
      if (cmd.label !== undefined) patch.label = cmd.label
      if (cmd.driftMs !== undefined) patch.driftMs = cmd.driftMs
      const devices = state.devices.map((d, i) => (i === idx ? { ...d, ...patch } : d))
      return done({ ...state, devices }, 'other')
    }
    case 'request': {
      const mine = state.requests.filter((r) => r.userId !== actor.userId)
      const request: RehearsalRequest = {
        id: randomBytes(4).toString('hex'),
        userId: actor.userId,
        bar: cmd.bar,
        tick: cmd.tick,
        at: now,
      }
      return done({ ...state, requests: [...mine, request].slice(-MAX_REQUESTS) }, 'other')
    }
    case 'dismiss': {
      const target = state.requests.find((r) => r.id === cmd.requestId)
      if (!target) return err('这个请求已经没有了。', 404)
      if (!isLeader && target.userId !== actor.userId)
        return err('只有指挥或提出请求的人可以撤掉这个请求。', 403)
      return done(
        { ...state, requests: state.requests.filter((r) => r.id !== cmd.requestId) },
        'other',
      )
    }
  }
}

interface Conn {
  deviceId: string
  userId: string
  res: ServerResponse
  open: boolean
  heartbeat: ReturnType<typeof setInterval>
}

const copyState = (s: RehearsalState): RehearsalState => ({
  ...s,
  loop: s.loop ? { ...s.loop } : null,
  requests: s.requests.map((r) => ({ ...r })),
  devices: s.devices.map((d) => ({ ...d })),
})

/** The band's one rehearsal room: holds the state and the SSE streams of every device. */
export class RehearsalHub {
  private room: RehearsalState = freshRehearsal()
  private readonly conns = new Set<Conn>()
  private readonly deviceGraces = new Map<string, ReturnType<typeof setTimeout>>()
  private leaderGrace: ReturnType<typeof setTimeout> | null = null
  private leaderGraceFor: string | null = null
  private bandVersion = 0

  /** Opens an SSE stream for one device of a band member. */
  subscribe(
    userId: string,
    deviceId: string,
    label: string,
    req: IncomingMessage,
    res: ServerResponse,
  ): void {
    // A device listed for someone else is never taken over by another account.
    if (this.room.devices.some((d) => d.deviceId === deviceId && d.userId !== userId)) {
      res.writeHead(409, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: '设备编号冲突，请刷新页面。' }))
      return
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    })
    const conn: Conn = {
      deviceId,
      userId,
      res,
      open: true,
      heartbeat: setInterval(() => this.ping(conn), HEARTBEAT_MS),
    }
    conn.heartbeat.unref()
    this.conns.add(conn)
    this.attachDevice(userId, deviceId, label)
    this.reconcileLeaderGrace()
    this.broadcast()
    req.on('close', () => this.disconnect(conn))
  }

  /** Applies a command; on success stores the new state and broadcasts it. */
  command(actor: Actor, cmd: RehearsalCommand, ctx: Ctx): RehearsalResult {
    const result = applyRehearsal(this.room, actor, cmd, ctx)
    if ('error' in result) return result
    this.room = result.state
    this.reconcileLeaderGrace()
    if (result.kind !== 'none') this.broadcast()
    if (result.clock) this.send(`event: clock\ndata: ${JSON.stringify(result.clock)}\n\n`)
    return result
  }

  /** A copy of the current state. */
  state(): RehearsalState {
    return copyState(this.room)
  }

  /** Tells every stream that the band changed (event `band`, a counter the page compares). */
  notifyBand(): void {
    this.bandVersion += 1
    this.send(`event: band\ndata: ${JSON.stringify({ v: this.bandVersion })}\n\n`)
  }

  /**
   * Someone left the band (removed, deleted or stopped): their streams close and their
   * devices leave the room at once; a leader gives up the lead.
   */
  evictUser(userId: string): void {
    const gone = new Set<string>()
    for (const conn of [...this.conns])
      if (conn.userId === userId) {
        gone.add(conn.deviceId)
        this.closeConn(conn)
        this.conns.delete(conn)
      }
    for (const d of this.room.devices) if (d.userId === userId) gone.add(d.deviceId)
    for (const id of gone) {
      const pending = this.deviceGraces.get(id)
      if (pending) clearTimeout(pending)
      this.deviceGraces.delete(id)
      this.removeDevice(id)
    }
    if (this.room.leaderId === userId) {
      const s = this.room
      this.room =
        s.devices.length === 0 && s.active
          ? { ...freshRehearsal(), seq: s.seq + 1 }
          : { ...s, leaderId: null, leaderDevice: null }
      this.reconcileLeaderGrace()
      this.broadcast()
    }
  }

  /** Ends every stream and clears all timers (shutdown / tests). */
  close(): void {
    for (const timer of this.deviceGraces.values()) clearTimeout(timer)
    this.deviceGraces.clear()
    if (this.leaderGrace) clearTimeout(this.leaderGrace)
    this.leaderGrace = null
    this.leaderGraceFor = null
    for (const conn of this.conns) this.closeConn(conn)
    this.conns.clear()
    this.room = freshRehearsal()
  }

  /** Adds the device to the room (or refreshes it) and cancels its pending removal. */
  private attachDevice(userId: string, deviceId: string, label: string): void {
    const pending = this.deviceGraces.get(deviceId)
    if (pending) {
      clearTimeout(pending)
      this.deviceGraces.delete(deviceId)
    }
    const cleanLabel = label.trim().slice(0, MAX_LABEL)
    const known = this.room.devices.some((d) => d.deviceId === deviceId)
    const devices: RehearsalDevice[] = known
      ? this.room.devices.map((d) =>
          d.deviceId === deviceId ? { ...d, userId, label: cleanLabel } : d,
        )
      : [
          ...this.room.devices,
          {
            deviceId,
            userId,
            label: cleanLabel,
            ready: false,
            audible: false,
            latencyMs: 0,
            driftMs: null,
          },
        ]
    let leaderDevice = this.room.leaderDevice
    if (
      this.room.leaderId === userId &&
      (leaderDevice === null || !devices.some((d) => d.deviceId === leaderDevice))
    )
      leaderDevice = deviceId
    this.room = { ...this.room, devices, leaderDevice }
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

  private disconnect(conn: Conn): void {
    if (!conn.open) return
    this.closeConn(conn)
    this.conns.delete(conn)
    const stillOpen = [...this.conns].some((c) => c.deviceId === conn.deviceId)
    const listed = this.room.devices.some((d) => d.deviceId === conn.deviceId)
    if (stillOpen || !listed || this.deviceGraces.has(conn.deviceId)) return
    const timer = setTimeout(() => this.removeDevice(conn.deviceId), DEVICE_GRACE_MS)
    timer.unref()
    this.deviceGraces.set(conn.deviceId, timer)
  }

  /** Removes a device whose streams stayed closed through the grace period. */
  private removeDevice(deviceId: string): void {
    this.deviceGraces.delete(deviceId)
    if ([...this.conns].some((c) => c.deviceId === deviceId)) return
    const s = this.room
    if (!s.devices.some((d) => d.deviceId === deviceId)) return
    const devices = s.devices.filter((d) => d.deviceId !== deviceId)
    let next: RehearsalState = { ...s, devices }
    if (s.speakerDevice === deviceId)
      next = { ...next, speakerDevice: null, playing: false, seq: s.seq + 1 }
    if (s.leaderDevice === deviceId && s.leaderId !== null) {
      const other = devices.find((d) => d.userId === s.leaderId)
      if (other) next = { ...next, leaderDevice: other.deviceId }
    }
    // Everyone has gone and nobody leads it any more: the rehearsal ends.
    if (devices.length === 0 && s.active && s.leaderId === null)
      next = { ...freshRehearsal(), seq: s.seq + 1 }
    this.room = next
    this.reconcileLeaderGrace()
    this.broadcast()
  }

  private ping(conn: Conn): void {
    if (!conn.open) return
    try {
      conn.res.write(': ping\n\n')
    } catch {
      this.disconnect(conn)
    }
  }

  /** Starts (or restarts for a new leader) the grace timer while the leader has no device. */
  private reconcileLeaderGrace(): void {
    const leader = this.room.leaderId
    const absent = leader !== null && !this.room.devices.some((d) => d.userId === leader)
    if (!absent) {
      if (this.leaderGrace) clearTimeout(this.leaderGrace)
      this.leaderGrace = null
      this.leaderGraceFor = null
      return
    }
    if (this.leaderGrace && this.leaderGraceFor === leader) return
    if (this.leaderGrace) clearTimeout(this.leaderGrace)
    this.leaderGraceFor = leader
    const timer = setTimeout(() => {
      this.leaderGrace = null
      this.leaderGraceFor = null
      const s = this.room
      if (s.leaderId !== leader || s.devices.some((d) => d.userId === leader)) return
      // The leader did not come back; with nobody left the rehearsal ends.
      this.room =
        s.devices.length === 0 && s.active
          ? { ...freshRehearsal(), seq: s.seq + 1 }
          : { ...s, leaderId: null, leaderDevice: null }
      this.broadcast()
    }, LEADER_GRACE_MS)
    timer.unref()
    this.leaderGrace = timer
  }

  private broadcast(): void {
    this.send(`event: rehearsal\ndata: ${JSON.stringify(this.room)}\n\n`)
  }

  private send(line: string): void {
    for (const conn of [...this.conns]) {
      if (!conn.open) continue
      try {
        conn.res.write(line)
      } catch {
        this.disconnect(conn)
      }
    }
  }
}
