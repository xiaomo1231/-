// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  RehearsalClock,
  RehearsalCommand,
  RehearsalDevice,
  RehearsalLoop,
  RehearsalState,
} from '../src/songs/scoreServerTypes'
import {
  DEVICE_GRACE_MS,
  HEARTBEAT_MS,
  LEADER_GRACE_MS,
  PASS_GAP_MS,
  RehearsalHub,
  START_DELAY_MS,
  applyRehearsal,
  freshRehearsal,
  parseRehearsalBody,
  type Actor,
} from '../server/rehearsal'

const A: Actor = { userId: 'a', deviceId: 'dev-aaaaaaaa' }
const B: Actor = { userId: 'b', deviceId: 'dev-bbbbbbbb' }
const NOW = 1000
const ctx = (now = NOW) => ({ now, songExists: (id: string) => ['s1', 's2', 's3'].includes(id) })

const dev = (actor: Actor, over: Partial<RehearsalDevice> = {}): RehearsalDevice => ({
  deviceId: actor.deviceId,
  userId: actor.userId,
  label: actor.userId,
  ready: false,
  audible: false,
  latencyMs: 0,
  driftMs: null,
  ...over,
})

/** A room with A and B connected, nothing started. */
const room = (over: Partial<RehearsalState> = {}): RehearsalState => ({
  ...freshRehearsal(),
  devices: [dev(A), dev(B)],
  ...over,
})

/** A room started by A (leader on A's device) with songs s1, s2; `over` is applied afterwards. */
const started = (over: Partial<RehearsalState> = {}): RehearsalState => ({
  ...unwrap(applyRehearsal(room(), A, { type: 'start', setlist: ['s1', 's2'] }, ctx())),
  ...over,
})

function unwrap(r: ReturnType<typeof applyRehearsal>): RehearsalState {
  if ('error' in r) throw new Error(r.error)
  return r.state
}

function run(state: RehearsalState, actor: Actor, cmd: RehearsalCommand, now = NOW) {
  return applyRehearsal(state, actor, cmd, ctx(now))
}

function errOf(state: RehearsalState, actor: Actor, cmd: RehearsalCommand, now = NOW) {
  const r = run(state, actor, cmd, now)
  if (!('error' in r)) throw new Error('expected an error')
  return r
}

const loop = (over: Partial<RehearsalLoop> = {}): RehearsalLoop => ({
  startTick: 0,
  endTick: 960,
  startBar: 1,
  endBar: 2,
  passes: null,
  rampPct: 0,
  rampMaxPct: 175,
  ...over,
})

class FakeRes extends EventEmitter {
  status = 0
  headers: Record<string, string> = {}
  chunks: string[] = []
  ended = false
  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status
    this.headers = headers
    return this
  }
  write(chunk: string): boolean {
    this.chunks.push(chunk)
    return true
  }
  end(): void {
    this.ended = true
  }
}

function fakeStream(): { req: IncomingMessage; res: FakeRes } {
  return { req: new EventEmitter() as unknown as IncomingMessage, res: new FakeRes() }
}

/** The data of the last SSE event with this name written to a stream. */
function lastEvent<T>(res: FakeRes, name: string): T {
  const line = [...res.chunks].reverse().find((c) => c.startsWith(`event: ${name}\n`))
  if (!line) throw new Error(`no ${name} event`)
  return JSON.parse(line.split('\n')[1].slice('data: '.length)) as T
}

describe('parseRehearsalBody', () => {
  const body = (command: unknown, deviceId = 'dev-aaaaaaaa') => ({ deviceId, command })

  it('accepts well-formed commands', () => {
    expect(parseRehearsalBody(body({ type: 'start', setlist: ['s1', 's2'] })).ok).toBe(true)
    expect(parseRehearsalBody(body({ type: 'end' })).ok).toBe(true)
    expect(parseRehearsalBody(body({ type: 'play', tick: 0, speedPct: 15 })).ok).toBe(true)
    expect(parseRehearsalBody(body({ type: 'speaker', take: false })).ok).toBe(true)
    expect(parseRehearsalBody(body({ type: 'loop', loop: null })).ok).toBe(true)
    expect(
      parseRehearsalBody(body({ type: 'loop', loop: loop({ passes: 3, rampPct: 5 }) })).ok,
    ).toBe(true)
    expect(parseRehearsalBody(body({ type: 'request', bar: 1, tick: 0 })).ok).toBe(true)
    expect(parseRehearsalBody(body({ type: 'dismiss', requestId: 'abc' })).ok).toBe(true)
  })

  it('keeps the parsed command and trims the device label', () => {
    const r = parseRehearsalBody(body({ type: 'device', label: '  iPad  ', latencyMs: 40 }))
    expect(r).toEqual({
      ok: true,
      value: {
        deviceId: 'dev-aaaaaaaa',
        command: { type: 'device', label: 'iPad', latencyMs: 40 },
      },
    })
  })

  it('clamps the drift and keeps null', () => {
    const big = parseRehearsalBody(body({ type: 'device', driftMs: 1e9 }))
    expect(big.ok && big.value.command).toEqual({ type: 'device', driftMs: 100000 })
    const none = parseRehearsalBody(body({ type: 'device', driftMs: null }))
    expect(none.ok && none.value.command).toEqual({ type: 'device', driftMs: null })
  })

  it('rejects bad devices, types and bodies', () => {
    expect(parseRehearsalBody(null)).toEqual({ ok: false, error: '排练指令格式不对。' })
    expect(parseRehearsalBody(body({ type: 'end' }, 'short'))).toEqual({
      ok: false,
      error: '设备编号不对。',
    })
    expect(parseRehearsalBody(body({ type: 'stop' }))).toEqual({
      ok: false,
      error: '排练指令不认识。',
    })
    expect(parseRehearsalBody(body(null))).toEqual({ ok: false, error: '排练指令格式不对。' })
  })

  it('rejects bad setlists', () => {
    expect(parseRehearsalBody(body({ type: 'start', setlist: [] })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'start', setlist: ['s1', 's1'] }))).toEqual({
      ok: false,
      error: '歌单里有重复的歌。',
    })
    expect(parseRehearsalBody(body({ type: 'start', setlist: Array(51).fill('s') })).ok).toBe(false)
  })

  it('rejects bad ticks, speeds and loops', () => {
    expect(parseRehearsalBody(body({ type: 'seek', tick: 1.5 })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'play', tick: 0, speedPct: 14 })).ok).toBe(false)
    expect(
      parseRehearsalBody(body({ type: 'loop', loop: loop({ startTick: 960, endTick: 960 }) })).ok,
    ).toBe(false)
    expect(
      parseRehearsalBody(body({ type: 'loop', loop: loop({ startBar: 3, endBar: 2 }) })).ok,
    ).toBe(false)
    expect(parseRehearsalBody(body({ type: 'loop', loop: loop({ passes: 100 }) })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'loop', loop: loop({ rampPct: 21 }) })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'loop', loop: loop({ rampMaxPct: 14 }) })).ok).toBe(
      false,
    )
    expect(parseRehearsalBody(body({ type: 'loop' })).ok).toBe(false)
  })

  it('rejects clocks, empty device updates, bad requests and dismissals', () => {
    expect(parseRehearsalBody(body({ type: 'clock', seq: 1, pass: 0, timeMs: 5, at: 10 })).ok).toBe(
      false,
    )
    expect(
      parseRehearsalBody(body({ type: 'clock', seq: 1, pass: 1, timeMs: 1e8 + 1, at: 10 })).ok,
    ).toBe(false)
    expect(parseRehearsalBody(body({ type: 'clock', seq: 1, pass: 1, timeMs: 5, at: 0 })).ok).toBe(
      false,
    )
    expect(parseRehearsalBody(body({ type: 'device' })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'device', latencyMs: 1001 })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'device', label: 'x'.repeat(21) })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'request', bar: 0, tick: 0 })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'dismiss', requestId: '' })).ok).toBe(false)
    expect(parseRehearsalBody(body({ type: 'dismiss', requestId: 'x'.repeat(21) })).ok).toBe(false)
  })
})

describe('applyRehearsal: start and end', () => {
  it('needs a started rehearsal for transport commands', () => {
    expect(errOf(room(), A, { type: 'pause', tick: 0 })).toEqual({
      error: '排练还没开始。',
      status: 409,
    })
  })

  it('starts with the first song and makes the starter the leader', () => {
    const s = started()
    expect(s).toMatchObject({
      active: true,
      songId: 's1',
      leaderId: 'a',
      leaderDevice: A.deviceId,
      playing: false,
      tick: 0,
      speedPct: 100,
      startedAt: NOW,
      seq: 1,
    })
    expect(s.devices.map((d) => d.ready)).toEqual([false, false])
  })

  it('refuses a second start and songs that are gone', () => {
    expect(errOf(started(), A, { type: 'start', setlist: ['s1'] })).toEqual({
      error: '排练已经开始了。',
      status: 409,
    })
    expect(errOf(room(), A, { type: 'start', setlist: ['s1', 'gone'] })).toEqual({
      error: '歌单里有歌已经不在乐队歌单里了。',
      status: 404,
    })
  })

  it('ends the rehearsal for the leader and keeps devices and speaker', () => {
    const s = started({ speakerDevice: B.deviceId, devices: [dev(A, { ready: true }), dev(B)] })
    const r = run(s, A, { type: 'end' })
    expect('state' in r && r.kind).toBe('transport')
    const ended = unwrap(r)
    expect(ended).toMatchObject({
      active: false,
      leaderId: null,
      speakerDevice: B.deviceId,
      seq: s.seq + 1,
    })
    expect(ended.devices.map((d) => d.ready)).toEqual([false, false])
  })

  it('refuses end from a member while the leader is present', () => {
    expect(errOf(started(), B, { type: 'end' })).toEqual({
      error: '只有指挥可以控制排练。',
      status: 403,
    })
  })

  it('lets anyone end when the leader has no device left', () => {
    const s = started({ devices: [dev(B)] })
    expect(unwrap(run(s, B, { type: 'end' })).active).toBe(false)
  })
})

describe('applyRehearsal: lead and speaker', () => {
  it('refuses to take a present leader and lets a member take an absent one', () => {
    const s = room({ active: true, leaderId: 'a', leaderDevice: A.deviceId })
    expect(errOf(s, B, { type: 'lead', take: true })).toEqual({
      error: '指挥还在，暂时不能接管。',
      status: 409,
    })
    const absent = { ...s, devices: [dev(B)] }
    const took = unwrap(run(absent, B, { type: 'lead', take: true }))
    expect(took).toMatchObject({ leaderId: 'b', leaderDevice: B.deviceId, seq: s.seq })
  })

  it('releases the lead only for the leader', () => {
    const s = started()
    expect(errOf(s, B, { type: 'lead', take: false }).status).toBe(403)
    expect(unwrap(run(s, A, { type: 'lead', take: false }))).toMatchObject({
      leaderId: null,
      leaderDevice: null,
    })
  })

  it('lets a speaker take the speaker role and pauses playback', () => {
    const s = started({ playing: true, tick: 300 })
    const took = unwrap(run(s, B, { type: 'speaker', take: true }))
    expect(took).toMatchObject({ speakerDevice: B.deviceId, playing: false, tick: 300 })
    expect(took.seq).toBe(s.seq + 1)
  })

  it('releases the speaker only from the current speaker device', () => {
    const s = started({ speakerDevice: B.deviceId })
    expect(errOf(s, A, { type: 'speaker', take: false })).toEqual({
      error: '只有当前音箱可以取消。',
      status: 403,
    })
    expect(unwrap(run(s, B, { type: 'speaker', take: false })).speakerDevice).toBe(null)
  })
})

describe('applyRehearsal: transport timing', () => {
  it('play starts the shared start after START_DELAY_MS', () => {
    const s = unwrap(run(started(), A, { type: 'play', tick: 480, speedPct: 80 }, 5000))
    expect(s).toMatchObject({
      playing: true,
      tick: 480,
      speedPct: 80,
      startAt: 5000 + START_DELAY_MS,
      pass: 1,
    })
  })

  it('play and other transport commands are refused for members', () => {
    const s = started()
    for (const cmd of [
      { type: 'play', tick: 0, speedPct: 100 },
      { type: 'pause', tick: 0 },
      { type: 'seek', tick: 0 },
      { type: 'speed', speedPct: 90 },
      { type: 'countIn', on: false },
      { type: 'song', songId: 's2' },
    ] as RehearsalCommand[]) {
      expect(errOf(s, B, cmd).status).toBe(403)
    }
  })

  it('pause stops at the given tick', () => {
    const s = unwrap(run(started({ playing: true }), A, { type: 'pause', tick: 240 }))
    expect(s).toMatchObject({ playing: false, tick: 240 })
  })

  it('seek restarts the shared start only while playing', () => {
    const playing = unwrap(
      run(started({ playing: true, pass: 3 }), A, { type: 'seek', tick: 64 }, 2000),
    )
    expect(playing).toMatchObject({ tick: 64, startAt: 2000 + START_DELAY_MS, pass: 1 })
    const paused = unwrap(run(started({ startAt: 7 }), A, { type: 'seek', tick: 64 }))
    expect(paused).toMatchObject({ tick: 64, startAt: 7 })
  })

  it('speed and countIn store the value without a new start time', () => {
    const s = started({ playing: true, startAt: 77 })
    expect(unwrap(run(s, A, { type: 'speed', speedPct: 60 }))).toMatchObject({
      speedPct: 60,
      startAt: 77,
    })
    expect(unwrap(run(s, A, { type: 'countIn', on: false }))).toMatchObject({ countIn: false })
  })

  it('a loop sets the tick and restarts the pass; play outside the loop jumps to its start', () => {
    const s = started({ playing: true })
    const looped = unwrap(
      run(s, A, { type: 'loop', loop: loop({ startTick: 480, endTick: 960 }) }, 3000),
    )
    expect(looped).toMatchObject({ tick: 480, pass: 1, startAt: 3000 + START_DELAY_MS })
    expect(looped.loop).toMatchObject({ startTick: 480, endTick: 960 })

    const jumped = unwrap(run(looped, A, { type: 'play', tick: 0, speedPct: 100 }))
    expect(jumped.tick).toBe(480)
    const inside = unwrap(run(looped, A, { type: 'play', tick: 700, speedPct: 100 }))
    expect(inside.tick).toBe(700)
  })

  it('clearing the loop keeps the position', () => {
    const s = started({ loop: loop(), pass: 2, tick: 100 })
    expect(unwrap(run(s, A, { type: 'loop', loop: null }))).toMatchObject({
      loop: null,
      pass: 1,
      tick: 100,
    })
  })
})

describe('applyRehearsal: passEnded', () => {
  /** A playing loop of two passes with a ramp, reported by the reference (A's device). */
  const looping = (over: Partial<RehearsalLoop> = {}) =>
    unwrap(
      run(started({ loop: loop({ passes: 2, rampPct: 10, rampMaxPct: 120, ...over }) }), A, {
        type: 'play',
        tick: 0,
        speedPct: 100,
      }),
    )

  it('starts the next pass with the ramped speed after PASS_GAP_MS', () => {
    const s = looping()
    const next = unwrap(run(s, A, { type: 'passEnded', seq: s.seq, pass: 1 }, 9000))
    expect(next).toMatchObject({
      pass: 2,
      tick: 0,
      speedPct: 110,
      startAt: 9000 + PASS_GAP_MS,
      playing: true,
      seq: s.seq + 1,
    })
  })

  it('caps the ramp at rampMaxPct and never lowers the speed', () => {
    const s = looping({ rampPct: 20, rampMaxPct: 115 })
    const next = unwrap(run(s, A, { type: 'passEnded', seq: s.seq, pass: 1 }))
    expect(next.speedPct).toBe(115)

    const high = { ...s, speedPct: 150 }
    expect(unwrap(run(high, A, { type: 'passEnded', seq: s.seq, pass: 1 })).speedPct).toBe(150)
  })

  it('stops after the last pass and returns to the loop start', () => {
    const s = looping()
    const second = unwrap(run(s, A, { type: 'passEnded', seq: s.seq, pass: 1 }))
    const stopped = unwrap(run(second, A, { type: 'passEnded', seq: second.seq, pass: 2 }))
    expect(stopped).toMatchObject({ playing: false, pass: 1, tick: 0 })
  })

  it('runs until stopped when passes is null', () => {
    const s = looping({ passes: null })
    let cur = s
    for (let pass = 1; pass <= 5; pass++) {
      cur = unwrap(run(cur, A, { type: 'passEnded', seq: cur.seq, pass }))
      expect(cur.playing).toBe(true)
      expect(cur.pass).toBe(pass + 1)
    }
  })

  it('ignores a stale seq or pass without an error', () => {
    const s = looping()
    const stale = run(s, A, { type: 'passEnded', seq: s.seq - 1, pass: 1 })
    expect(stale).toEqual({ state: s, kind: 'none' })
    const wrongPass = run(s, A, { type: 'passEnded', seq: s.seq, pass: 2 })
    expect(wrongPass).toEqual({ state: s, kind: 'none' })
  })

  it('ignores a pass report while paused', () => {
    const s = { ...looping(), playing: false }
    expect(run(s, A, { type: 'passEnded', seq: s.seq, pass: 1 })).toEqual({
      state: s,
      kind: 'none',
    })
  })

  it('refuses pass reports from a device that is not the reference', () => {
    const s = looping()
    expect(errOf(s, B, { type: 'passEnded', seq: s.seq, pass: 1 })).toEqual({
      error: '只有音箱可以报告播放进度。',
      status: 403,
    })
  })

  it('uses the speaker device as the reference once one is set', () => {
    const taken = unwrap(run(looping(), B, { type: 'speaker', take: true }))
    const s = unwrap(run(taken, A, { type: 'play', tick: 0, speedPct: 100 }))
    expect(errOf(s, A, { type: 'passEnded', seq: s.seq, pass: 1 }).status).toBe(403)
    expect(run(s, B, { type: 'passEnded', seq: s.seq, pass: 1 })).toMatchObject({
      kind: 'transport',
    })
  })
})

describe('applyRehearsal: clock', () => {
  it('accepts the position from the reference device and returns it', () => {
    const s = unwrap(run(started(), A, { type: 'play', tick: 0, speedPct: 100 }))
    const clock = { type: 'clock' as const, seq: s.seq, pass: 1, timeMs: 1234, at: 5000 }
    const r = run(s, A, clock)
    expect(r).toEqual({
      state: s,
      kind: 'none',
      clock: { seq: s.seq, pass: 1, timeMs: 1234, at: 5000 } satisfies RehearsalClock,
    })
  })

  it('returns no clock for a stale report or when paused', () => {
    const s = unwrap(run(started(), A, { type: 'play', tick: 0, speedPct: 100 }))
    expect(run(s, A, { type: 'clock', seq: s.seq - 1, pass: 1, timeMs: 1, at: 1 })).toEqual({
      state: s,
      kind: 'none',
    })
    const paused = { ...s, playing: false }
    expect(run(paused, A, { type: 'clock', seq: s.seq, pass: 1, timeMs: 1, at: 1 })).toEqual({
      state: paused,
      kind: 'none',
    })
  })

  it('refuses clocks from a non-reference device', () => {
    const s = unwrap(run(started(), A, { type: 'play', tick: 0, speedPct: 100 }))
    expect(errOf(s, B, { type: 'clock', seq: s.seq, pass: 1, timeMs: 1, at: 1 }).status).toBe(403)
  })
})

describe('applyRehearsal: devices', () => {
  it('updates the actor device without bumping seq', () => {
    const s = started()
    const r = unwrap(run(s, B, { type: 'device', ready: true, latencyMs: 35, driftMs: -4 }))
    const b = r.devices.find((d) => d.deviceId === B.deviceId)
    expect(b).toMatchObject({ ready: true, latencyMs: 35, driftMs: -4, audible: false })
    expect(r.seq).toBe(s.seq)
  })

  it('works before the rehearsal starts', () => {
    const r = run(room(), A, { type: 'device', audible: true })
    expect('state' in r && r.kind).toBe('other')
  })

  it('refuses a device that is not connected', () => {
    expect(
      errOf(room(), { userId: 'c', deviceId: 'dev-cccccccc' }, { type: 'device', ready: true }),
    ).toEqual({ error: '这个设备还没连上排练，请刷新页面。', status: 409 })
  })
})

describe('applyRehearsal: requests', () => {
  it('replaces the previous request of the same user', () => {
    let s = started()
    s = unwrap(run(s, B, { type: 'request', bar: 5, tick: 480 }))
    s = unwrap(run(s, B, { type: 'request', bar: 9, tick: 960 }))
    expect(s.requests).toHaveLength(1)
    expect(s.requests[0]).toMatchObject({ userId: 'b', bar: 9, tick: 960, at: NOW })
    expect(s.requests[0].id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('keeps the newest ten requests', () => {
    let s = started()
    for (let i = 0; i < 12; i++) {
      const actor: Actor = { userId: `u${i}`, deviceId: `dev-${i}aaaaaaa` }
      s = unwrap(
        run({ ...s, devices: [...s.devices, dev(actor)] }, actor, {
          type: 'request',
          bar: i + 1,
          tick: 0,
        }),
      )
    }
    expect(s.requests).toHaveLength(10)
    expect(s.requests[0].bar).toBe(3)
    expect(s.requests[9].bar).toBe(12)
  })

  it('lets the leader or the requester dismiss a request', () => {
    const s = unwrap(run(started(), B, { type: 'request', bar: 5, tick: 0 }))
    const id = s.requests[0].id
    const other: Actor = { userId: 'c', deviceId: 'dev-cccccccc' }
    expect(errOf(s, other, { type: 'dismiss', requestId: id }).status).toBe(403)
    expect(unwrap(run(s, B, { type: 'dismiss', requestId: id })).requests).toEqual([])
    expect(unwrap(run(s, A, { type: 'dismiss', requestId: id })).requests).toEqual([])
  })

  it('reports a missing request as gone', () => {
    expect(errOf(started(), A, { type: 'dismiss', requestId: 'nope' })).toEqual({
      error: '这个请求已经没有了。',
      status: 404,
    })
  })
})

describe('applyRehearsal: song change', () => {
  it('resets readiness, requests and loop, and checks the song exists', () => {
    const s = started({
      loop: loop(),
      pass: 2,
      playing: true,
      devices: [dev(A, { ready: true }), dev(B, { ready: true })],
      requests: [{ id: 'abcdef12', userId: 'b', bar: 1, tick: 0, at: NOW }],
    })
    const next = unwrap(run(s, A, { type: 'song', songId: 's2' }))
    expect(next).toMatchObject({
      songId: 's2',
      playing: false,
      tick: 0,
      loop: null,
      pass: 1,
      requests: [],
    })
    expect(next.devices.every((d) => !d.ready)).toBe(true)
    expect(errOf(s, A, { type: 'song', songId: 'gone' })).toEqual({
      error: '这首歌已经不在乐队歌单里了。',
      status: 404,
    })
  })
})

describe('RehearsalHub', () => {
  let hub: RehearsalHub | null = null

  afterEach(() => {
    hub?.close()
    hub = null
    vi.useRealTimers()
  })

  it('sends the state to a new stream with the proper SSE headers', () => {
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    expect(a.res.status).toBe(200)
    expect(a.res.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(a.res.headers['X-Accel-Buffering']).toBe('no')
    expect(a.res.chunks[0].startsWith('event: rehearsal\ndata: ')).toBe(true)
    expect(lastEvent<RehearsalState>(a.res, 'rehearsal').devices).toEqual([
      expect.objectContaining({ deviceId: A.deviceId, userId: 'a', label: 'iPad' }),
    ])
  })

  it('counts a device once even with several streams, and removes it after the grace period', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a1 = fakeStream()
    const a2 = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a1.req, a1.res as never)
    hub.subscribe('a', A.deviceId, 'iPad', a2.req, a2.res as never)
    expect(hub.state().devices).toHaveLength(1)

    a1.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS * 2)
    expect(hub.state().devices).toHaveLength(1)

    a2.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS - 1)
    expect(hub.state().devices).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(hub.state().devices).toEqual([])
  })

  it('a device that reconnects inside the grace period keeps its place', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.command(A, { type: 'start', setlist: ['s1'] }, ctx())
    a.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS / 2)
    const back = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', back.req, back.res as never)
    vi.advanceTimersByTime(DEVICE_GRACE_MS * 2)
    expect(hub.state().devices).toHaveLength(1)
    expect(hub.state().leaderId).toBe('a')
  })

  it('broadcasts accepted commands to every device and sends clocks', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.subscribe('b', B.deviceId, 'phone', b.req, b.res as never)

    const begun = hub.command(A, { type: 'start', setlist: ['s1'] }, ctx())
    expect('state' in begun).toBe(true)
    hub.command(A, { type: 'play', tick: 0, speedPct: 100 }, ctx())
    const seen = lastEvent<RehearsalState>(b.res, 'rehearsal')
    expect(seen).toMatchObject({ active: true, playing: true, leaderId: 'a', seq: 2 })
    expect(lastEvent<RehearsalState>(a.res, 'rehearsal')).toEqual(seen)

    const clock = hub.command(A, { type: 'clock', seq: 2, pass: 1, timeMs: 500, at: 99 }, ctx())
    expect('clock' in clock && clock.clock).toEqual({ seq: 2, pass: 1, timeMs: 500, at: 99 })
    expect(lastEvent<RehearsalClock>(b.res, 'clock')).toEqual({
      seq: 2,
      pass: 1,
      timeMs: 500,
      at: 99,
    })
  })

  it('does not broadcast refused commands', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const b = fakeStream()
    hub.subscribe('b', B.deviceId, 'phone', b.req, b.res as never)
    const before = b.res.chunks.length
    const r = hub.command(B, { type: 'end' }, ctx())
    expect('status' in r && r.status).toBe(409)
    expect(b.res.chunks.length).toBe(before)
  })

  it('releases the lead when the leader is gone past the grace period', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.subscribe('b', B.deviceId, 'phone', b.req, b.res as never)
    hub.command(A, { type: 'start', setlist: ['s1'] }, ctx())

    a.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS)
    expect(hub.state().leaderId).toBe('a')

    vi.advanceTimersByTime(LEADER_GRACE_MS - 1)
    expect(hub.state().leaderId).toBe('a')
    vi.advanceTimersByTime(1)
    expect(hub.state().leaderId).toBe(null)
    expect(lastEvent<RehearsalState>(b.res, 'rehearsal')).toMatchObject({
      leaderId: null,
      leaderDevice: null,
    })
  })

  it('the leader coming back on a new device gets the lead and its device back', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.command(A, { type: 'start', setlist: ['s1'] }, ctx())
    a.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS)
    expect(hub.state().devices).toEqual([])

    const newDevice = 'dev-newnewnew'
    const back = fakeStream()
    hub.subscribe('a', newDevice, 'iPad', back.req, back.res as never)
    vi.advanceTimersByTime(LEADER_GRACE_MS * 2)
    expect(hub.state()).toMatchObject({ leaderId: 'a', leaderDevice: newDevice })
  })

  it('removing the speaker device stops playback and frees the speaker', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const b = fakeStream()
    hub.subscribe('b', B.deviceId, 'phone', b.req, b.res as never)
    hub.command(B, { type: 'start', setlist: ['s1'] }, ctx())
    hub.command(B, { type: 'speaker', take: true }, ctx())
    hub.command(B, { type: 'play', tick: 0, speedPct: 100 }, ctx())
    b.req.emit('close')
    vi.advanceTimersByTime(DEVICE_GRACE_MS)
    expect(hub.state()).toMatchObject({ speakerDevice: null, playing: false })
  })

  it('sends a heartbeat comment on the interval', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    const before = a.res.chunks.length
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(a.res.chunks.slice(before)).toEqual([': ping\n\n'])
  })

  it('notifyBand sends a numbered band event to every stream', () => {
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.notifyBand()
    hub.notifyBand()
    expect(a.res.chunks.slice(-2)).toEqual([
      'event: band\ndata: {"v":1}\n\n',
      'event: band\ndata: {"v":2}\n\n',
    ])
  })

  it('state() returns a copy', () => {
    hub = new RehearsalHub()
    const copy = hub.state()
    copy.active = true
    expect(hub.state().active).toBe(false)
  })

  it('close() ends every stream, clears timers and forgets the room', () => {
    vi.useFakeTimers()
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', A.deviceId, 'iPad', a.req, a.res as never)
    hub.command(A, { type: 'start', setlist: ['s1'] }, ctx())
    a.req.emit('close')
    hub.close()
    expect(a.res.ended).toBe(true)
    expect(hub.state()).toEqual(freshRehearsal())
    const before = a.res.chunks.length
    vi.advanceTimersByTime(HEARTBEAT_MS * 3 + LEADER_GRACE_MS + DEVICE_GRACE_MS)
    expect(a.res.chunks.length).toBe(before)
  })
})

describe('RehearsalHub: accounts and devices', () => {
  let hub: RehearsalHub
  afterEach(() => {
    hub.close()
    vi.useRealTimers()
  })

  it('a device listed for one account is never taken over by another', () => {
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', 'dev-shared-1234', 'iPad', a.req, a.res as never)
    const b = fakeStream()
    hub.subscribe('b', 'dev-shared-1234', 'phone', b.req, b.res as never)
    expect(hub.state().devices.map((d) => d.userId)).toEqual(['a'])
    const r = hub.command({ userId: 'b', deviceId: 'dev-shared-1234' }, { type: 'speaker', take: true }, { now: 0, songExists: () => true })
    expect('error' in r && r.status).toBe(403)
  })

  it('an account taken out of the band leaves at once, and an empty rehearsal ends', () => {
    hub = new RehearsalHub()
    const a = fakeStream()
    hub.subscribe('a', 'dev-aaaa-1234', 'iPad', a.req, a.res as never)
    hub.command({ userId: 'a', deviceId: 'dev-aaaa-1234' }, { type: 'start', setlist: ['s1'] }, { now: 0, songExists: () => true })
    expect(hub.state().active).toBe(true)
    hub.evictUser('a')
    expect(hub.state()).toMatchObject({ active: false, leaderId: null, devices: [] })
  })
})
