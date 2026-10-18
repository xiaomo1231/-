// @vitest-environment node
import { EventEmitter } from 'node:events'
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LiveCommand, LiveState } from '../src/songs/scoreServerTypes'
import {
  HEARTBEAT_MS,
  LEADER_GRACE_MS,
  LiveHub,
  START_DELAY_MS,
  applyCommand,
  parseLiveCommand,
} from '../server/live'

const base = (over: Partial<LiveState> = {}): LiveState => ({
  songId: 's1',
  leaderId: null,
  playing: false,
  tick: 0,
  speedPct: 100,
  startAt: 0,
  seq: 0,
  present: ['a', 'b'],
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

/** The state carried by the last `event: state` line written to a stream. */
function lastState(res: FakeRes): LiveState {
  const line = [...res.chunks].reverse().find((c) => c.startsWith('event: state'))
  if (!line) throw new Error('no state event')
  return JSON.parse(line.split('\n')[1].slice('data: '.length)) as LiveState
}

describe('parseLiveCommand', () => {
  it('accepts well-formed commands', () => {
    expect(parseLiveCommand({ songId: 's1', type: 'lead', take: true })).toEqual({
      ok: true,
      value: { songId: 's1', type: 'lead', take: true },
    })
    expect(parseLiveCommand({ songId: 's1', type: 'play', tick: 0, speedPct: 15 }).ok).toBe(true)
    expect(parseLiveCommand({ songId: 's1', type: 'pause', tick: 1e9 }).ok).toBe(true)
    expect(parseLiveCommand({ songId: 's1', type: 'seek', tick: 42 }).ok).toBe(true)
    expect(parseLiveCommand({ songId: 's1', type: 'speed', speedPct: 175 }).ok).toBe(true)
  })

  it('rejects bad song ids, types and bodies', () => {
    expect(parseLiveCommand(null).ok).toBe(false)
    expect(parseLiveCommand({ type: 'pause', tick: 0 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: '', type: 'pause', tick: 0 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 'x'.repeat(65), type: 'pause', tick: 0 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'stop' }).ok).toBe(false)
  })

  it('rejects bad ticks and speeds', () => {
    expect(parseLiveCommand({ songId: 's1', type: 'seek', tick: -1 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'seek', tick: 1.5 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'seek', tick: 1e9 + 1 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'seek' }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'play', tick: 0, speedPct: 14 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'play', tick: 0, speedPct: 176 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'speed', speedPct: 99.5 }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'play', tick: 0 }).ok).toBe(false)
  })

  it('requires a boolean take for lead', () => {
    expect(parseLiveCommand({ songId: 's1', type: 'lead' }).ok).toBe(false)
    expect(parseLiveCommand({ songId: 's1', type: 'lead', take: 'yes' }).ok).toBe(false)
  })
})

describe('applyCommand', () => {
  const now = 5000
  const lead = (take: boolean): LiveCommand => ({ songId: 's1', type: 'lead', take })

  it('lets a user take a free lead and release it', () => {
    const took = applyCommand(base(), 'a', lead(true), now)
    expect('state' in took && took.state.leaderId).toBe('a')
    expect('state' in took && took.state.seq).toBe(1)

    const released = applyCommand(base({ leaderId: 'a', seq: 3 }), 'a', lead(false), now)
    expect('state' in released && released.state.leaderId).toBe(null)
    expect('state' in released && released.state.seq).toBe(4)
  })

  it('lets a user take over an absent leader', () => {
    const r = applyCommand(base({ leaderId: 'b', present: ['a'] }), 'a', lead(true), now)
    expect('state' in r && r.state.leaderId).toBe('a')
  })

  it('refuses to take over a present leader', () => {
    const r = applyCommand(base({ leaderId: 'b' }), 'a', lead(true), now)
    expect(r).toEqual({ error: '主控还在线，暂时不能接管。', status: 409 })
  })

  it('refuses a release from anyone but the leader', () => {
    const r = applyCommand(base({ leaderId: 'b' }), 'a', lead(false), now)
    expect('status' in r && r.status).toBe(403)
  })

  it('refuses play, pause, seek and speed from a non-leader', () => {
    const cmds: LiveCommand[] = [
      { songId: 's1', type: 'play', tick: 0, speedPct: 100 },
      { songId: 's1', type: 'pause', tick: 0 },
      { songId: 's1', type: 'seek', tick: 0 },
      { songId: 's1', type: 'speed', speedPct: 80 },
    ]
    for (const cmd of cmds) {
      const r = applyCommand(base({ leaderId: 'b' }), 'a', cmd, now)
      expect(r).toEqual({ error: '只有主控可以控制播放。', status: 403 })
    }
  })

  it('play sets the transport and schedules the shared start', () => {
    const r = applyCommand(
      base({ leaderId: 'a', seq: 7 }),
      'a',
      { songId: 's1', type: 'play', tick: 300, speedPct: 120 },
      now,
    )
    expect('state' in r && r.state).toMatchObject({
      playing: true,
      tick: 300,
      speedPct: 120,
      startAt: now + START_DELAY_MS,
      seq: 8,
    })
  })

  it('pause stops playing at the given tick', () => {
    const r = applyCommand(
      base({ leaderId: 'a', playing: true, tick: 10, startAt: 99, seq: 2 }),
      'a',
      { songId: 's1', type: 'pause', tick: 480 },
      now,
    )
    expect('state' in r && r.state).toMatchObject({ playing: false, tick: 480, seq: 3 })
  })

  it('seek restarts the shared start only while playing', () => {
    const playing = applyCommand(
      base({ leaderId: 'a', playing: true, startAt: 1 }),
      'a',
      { songId: 's1', type: 'seek', tick: 64 },
      now,
    )
    expect('state' in playing && playing.state).toMatchObject({
      tick: 64,
      startAt: now + START_DELAY_MS,
    })

    const paused = applyCommand(
      base({ leaderId: 'a', playing: false, startAt: 1 }),
      'a',
      { songId: 's1', type: 'seek', tick: 64 },
      now,
    )
    expect('state' in paused && paused.state).toMatchObject({ tick: 64, startAt: 1 })
  })

  it('speed stores the speed without touching the start time', () => {
    const r = applyCommand(
      base({ leaderId: 'a', playing: true, startAt: 77, seq: 4 }),
      'a',
      { songId: 's1', type: 'speed', speedPct: 60 },
      now,
    )
    expect('state' in r && r.state).toMatchObject({ speedPct: 60, startAt: 77, seq: 5 })
  })

  it('rejects a command for another song', () => {
    const r = applyCommand(base({ leaderId: 'a' }), 'a', { songId: 's2', type: 'pause', tick: 0 }, now)
    expect('status' in r && r.status).toBe(400)
  })

  it('bumps seq once per successful command', () => {
    let s = base()
    s = (applyCommand(s, 'a', lead(true), now) as { state: LiveState }).state
    s = (
      applyCommand(s, 'a', { songId: 's1', type: 'play', tick: 0, speedPct: 100 }, now) as {
        state: LiveState
      }
    ).state
    s = (applyCommand(s, 'a', { songId: 's1', type: 'pause', tick: 5 }, now) as { state: LiveState })
      .state
    expect(s.seq).toBe(3)
  })
})

describe('LiveHub', () => {
  let hub: LiveHub | null = null

  afterEach(() => {
    hub?.close()
    hub = null
    vi.useRealTimers()
  })

  it('sends the current state as an SSE event on subscribe', () => {
    hub = new LiveHub()
    const { req, res } = fakeStream()
    hub.subscribe('s1', 'a', req as never, res as never)
    expect(res.status).toBe(200)
    expect(res.headers['Content-Type']).toBe('text/event-stream; charset=utf-8')
    expect(res.headers['Cache-Control']).toBe('no-cache, no-transform')
    expect(res.headers['X-Accel-Buffering']).toBe('no')
    expect(res.chunks[0].startsWith('event: state\ndata: ')).toBe(true)
    expect(res.chunks[0].endsWith('\n\n')).toBe(true)
    expect(lastState(res).present).toEqual(['a'])
    expect(hub.state('s1')).toMatchObject({ leaderId: null, speedPct: 100, seq: 0 })
  })

  it('counts presence once per member, even with several streams', () => {
    hub = new LiveHub()
    const a1 = fakeStream()
    const a2 = fakeStream()
    const b = fakeStream()
    hub.subscribe('s1', 'a', a1.req as never, a1.res as never)
    hub.subscribe('s1', 'a', a2.req as never, a2.res as never)
    hub.subscribe('s1', 'b', b.req as never, b.res as never)
    expect(hub.state('s1').present).toEqual(['a', 'b'])

    a1.req.emit('close')
    expect(hub.state('s1').present).toEqual(['a', 'b'])
    a2.req.emit('close')
    expect(hub.state('s1').present).toEqual(['b'])
    expect(lastState(b.res).present).toEqual(['b'])
  })

  it('broadcasts an accepted command to every member', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.subscribe('s1', 'a', a.req as never, a.res as never)
    hub.subscribe('s1', 'b', b.req as never, b.res as never)

    const took = hub.command('a', { songId: 's1', type: 'lead', take: true }, 1000)
    expect('state' in took && took.state.leaderId).toBe('a')

    const played = hub.command('a', { songId: 's1', type: 'play', tick: 8, speedPct: 90 }, 1000)
    expect('state' in played).toBe(true)
    const seen = lastState(b.res)
    expect(seen).toMatchObject({
      playing: true,
      tick: 8,
      speedPct: 90,
      startAt: 1000 + START_DELAY_MS,
      seq: 2,
      leaderId: 'a',
    })
    expect(lastState(a.res)).toEqual(seen)
  })

  it('refuses a non-leader command and sends nothing', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const b = fakeStream()
    hub.subscribe('s1', 'b', b.req as never, b.res as never)
    const before = b.res.chunks.length
    const r = hub.command('b', { songId: 's1', type: 'pause', tick: 0 }, 1000)
    expect('status' in r && r.status).toBe(403)
    expect(b.res.chunks.length).toBe(before)
  })

  it('releases an absent leader only after the grace period', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.subscribe('s1', 'a', a.req as never, a.res as never)
    hub.subscribe('s1', 'b', b.req as never, b.res as never)
    hub.command('a', { songId: 's1', type: 'lead', take: true }, 1000)

    a.req.emit('close')
    expect(lastState(b.res)).toMatchObject({ leaderId: 'a', present: ['b'] })

    vi.advanceTimersByTime(LEADER_GRACE_MS - 1)
    expect(hub.state('s1').leaderId).toBe('a')

    vi.advanceTimersByTime(1)
    expect(hub.state('s1').leaderId).toBe(null)
    expect(lastState(b.res)).toMatchObject({ leaderId: null, present: ['b'] })
  })

  it('keeps the lead when the leader comes back within the grace period', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const a = fakeStream()
    hub.subscribe('s1', 'a', a.req as never, a.res as never)
    hub.command('a', { songId: 's1', type: 'lead', take: true }, 1000)
    a.req.emit('close')
    vi.advanceTimersByTime(LEADER_GRACE_MS / 2)
    const back = fakeStream()
    hub.subscribe('s1', 'a', back.req as never, back.res as never)
    vi.advanceTimersByTime(LEADER_GRACE_MS * 2)
    expect(hub.state('s1').leaderId).toBe('a')
  })

  it('sends a heartbeat comment on the interval', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const a = fakeStream()
    hub.subscribe('s1', 'a', a.req as never, a.res as never)
    const before = a.res.chunks.length
    vi.advanceTimersByTime(HEARTBEAT_MS)
    expect(a.res.chunks.slice(before)).toEqual([': ping\n\n'])
  })

  it('returns a fresh default state for an unused song', () => {
    hub = new LiveHub()
    expect(hub.state('nobody')).toEqual({
      songId: 'nobody',
      leaderId: null,
      playing: false,
      tick: 0,
      speedPct: 100,
      startAt: 0,
      seq: 0,
      present: [],
    })
  })

  it('close() ends every stream and stops heartbeats', () => {
    vi.useFakeTimers()
    hub = new LiveHub()
    const a = fakeStream()
    const b = fakeStream()
    hub.subscribe('s1', 'a', a.req as never, a.res as never)
    hub.subscribe('s2', 'b', b.req as never, b.res as never)
    hub.close()
    expect(a.res.ended).toBe(true)
    expect(b.res.ended).toBe(true)
    const before = a.res.chunks.length
    vi.advanceTimersByTime(HEARTBEAT_MS * 2)
    expect(a.res.chunks.length).toBe(before)
    expect(hub.state('s1').present).toEqual([])
  })
})
