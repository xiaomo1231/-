// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MemberProgress, UserInfo } from '../src/songs/scoreServerTypes'
import { inRootOf } from '../server/favorites'
import {
  BandError,
  BandStore,
  MAX_COMMENTS_PER_SONG,
  bandState,
  parseAddComment,
  parseAddSong,
  parseFill,
  parseReorder,
  parseRename,
  parseSetlist,
  parseUpdateSong,
} from '../server/band'
import type { FillConfig } from '../src/songs/scoreServerTypes'

const ROOT = path.resolve(os.tmpdir(), 'gl-band-root')
const inRoot = inRootOf(ROOT)
const isUser = (id: string) => id === 'u1' || id === 'u2'

const user = (id: string): UserInfo => ({
  id,
  username: id,
  displayName: id,
  role: 'member',
  libraryAccess: true,
  instrument: null,
  createdAt: 0,
  invitedBy: null,
  disabled: false,
})

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gl-band-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
  vi.restoreAllMocks()
})

const readFile = () => JSON.parse(fs.readFileSync(path.join(dir, 'band.json'), 'utf8'))

describe('parseAddSong', () => {
  it('accepts a score inside the library', () => {
    const r = parseAddSong({ path: 'rock/song.GP5', title: '曲名', artist: '歌手' }, inRoot)
    expect(r).toEqual({ ok: true, value: { path: 'rock/song.GP5', title: '曲名', artist: '歌手' } })
  })

  it.each(['a.gp', 'a.gp3', 'a.gp4', 'a.gp5', 'a.gpx', 'a.musicxml', 'a.xml', 'a.mxl'])('accepts %s', (p) => {
    expect(parseAddSong({ path: p, title: '', artist: '' }, inRoot).ok).toBe(true)
  })

  it('rejects a path outside the library', () => {
    expect(parseAddSong({ path: '../secret.gp5', title: '', artist: '' }, inRoot).ok).toBe(false)
    expect(parseAddSong({ path: '/etc/a.gp5', title: '', artist: '' }, inRoot).ok).toBe(false)
  })

  it('rejects a non-score extension', () => {
    const r = parseAddSong({ path: 'a.mp3', title: '', artist: '' }, inRoot)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/乐谱/)
  })

  it('rejects a missing or non-string path', () => {
    expect(parseAddSong({ title: '', artist: '' }, inRoot).ok).toBe(false)
    expect(parseAddSong({ path: 5, title: '', artist: '' }, inRoot).ok).toBe(false)
    expect(parseAddSong({ path: '', title: '', artist: '' }, inRoot).ok).toBe(false)
  })

  it('rejects an over-long or non-string title / artist', () => {
    expect(parseAddSong({ path: 'a.gp5', title: 'x'.repeat(301), artist: '' }, inRoot).ok).toBe(false)
    expect(parseAddSong({ path: 'a.gp5', title: '', artist: 3 }, inRoot).ok).toBe(false)
    expect(parseAddSong({ path: 'a.gp5', title: 'x'.repeat(300), artist: '' }, inRoot).ok).toBe(true)
  })
})

describe('parseUpdateSong', () => {
  it('returns only the fields that are present', () => {
    const r = parseUpdateSong({ id: 'abc' }, isUser)
    expect(r).toEqual({ ok: true, value: { id: 'abc' } })
  })

  it('needs an id', () => {
    expect(parseUpdateSong({}, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: '' }, isUser).ok).toBe(false)
  })

  it('checks status', () => {
    for (const s of ['learning', 'ready', 'maybe'])
      expect(parseUpdateSong({ id: 'a', status: s }, isUser).ok).toBe(true)
    expect(parseUpdateSong({ id: 'a', status: 'done' }, isUser).ok).toBe(false)
  })

  it('checks parts keys and users', () => {
    const good = parseUpdateSong({ id: 'a', parts: { '0': 'u1', '63': 'u2' } }, isUser)
    expect(good).toEqual({ ok: true, value: { id: 'a', parts: { '0': 'u1', '63': 'u2' } } })
    expect(parseUpdateSong({ id: 'a', parts: { '64': 'u1' } }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: { '01': 'u1' } }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: { x: 'u1' } }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: { '1': 'ghost' } }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: { '1': 7 } }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: [] }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', parts: null }, isUser).ok).toBe(false)
  })

  it('caps parts at 64 entries', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 64; i++) many[String(i)] = 'u1'
    expect(parseUpdateSong({ id: 'a', parts: many }, isUser).ok).toBe(true)
    // 65 entries cannot all be valid keys, so the count check is what rejects them.
    expect(parseUpdateSong({ id: 'a', parts: { ...many, '64': 'u1' } }, isUser).ok).toBe(false)
  })

  it('checks note length', () => {
    expect(parseUpdateSong({ id: 'a', note: '好'.repeat(2000) }, isUser).ok).toBe(true)
    expect(parseUpdateSong({ id: 'a', note: '好'.repeat(2001) }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', note: 4 }, isUser).ok).toBe(false)
  })

  it('checks rehearsal speed: null, or an integer 15–175', () => {
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: null }, isUser)).toEqual({
      ok: true,
      value: { id: 'a', rehearsalSpeedPct: null },
    })
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: 15 }, isUser).ok).toBe(true)
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: 175 }, isUser).ok).toBe(true)
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: 14 }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: 176 }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: 100.5 }, isUser).ok).toBe(false)
    expect(parseUpdateSong({ id: 'a', rehearsalSpeedPct: '100' }, isUser).ok).toBe(false)
  })
})

describe('parseReorder', () => {
  const current = ['a', 'b', 'c']

  it('accepts a permutation', () => {
    expect(parseReorder({ ids: ['c', 'a', 'b'] }, current)).toEqual({ ok: true, value: ['c', 'a', 'b'] })
  })

  it('rejects a missing, duplicated, extra or unknown id', () => {
    expect(parseReorder({ ids: ['a', 'b'] }, current).ok).toBe(false)
    expect(parseReorder({ ids: ['a', 'a', 'b'] }, current).ok).toBe(false)
    expect(parseReorder({ ids: ['a', 'b', 'c', 'd'] }, current).ok).toBe(false)
    expect(parseReorder({ ids: ['a', 'b', 'x'] }, current).ok).toBe(false)
    expect(parseReorder({ ids: ['a', 'b', 3] }, current).ok).toBe(false)
    expect(parseReorder({}, current).ok).toBe(false)
  })
})

describe('parseRename', () => {
  it('trims and accepts 1–40 characters', () => {
    expect(parseRename({ name: '  周五排练  ' })).toEqual({ ok: true, value: '周五排练' })
    expect(parseRename({ name: '字'.repeat(40) }).ok).toBe(true)
  })

  it('rejects empty, too long or non-string names', () => {
    expect(parseRename({ name: '   ' }).ok).toBe(false)
    expect(parseRename({ name: '字'.repeat(41) }).ok).toBe(false)
    expect(parseRename({ name: 1 }).ok).toBe(false)
    expect(parseRename({}).ok).toBe(false)
  })
})

describe('BandStore', () => {
  it('starts with the default band when the file is missing', async () => {
    const store = await BandStore.load(dir, inRoot)
    expect(store.name()).toBe('我们的乐队')
    expect(store.songs()).toEqual([])
  })

  it('add appends a learning song with no parts, and rejects a duplicate path', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: 'X' }, 'u1', 100)
    expect(a).toMatchObject({
      path: 'a.gp5',
      title: 'A',
      artist: 'X',
      status: 'learning',
      parts: {},
      note: '',
      rehearsalSpeedPct: null,
      addedBy: 'u1',
      addedAt: 100,
      updatedAt: 100,
    })
    expect(a.id).toMatch(/^[0-9a-f]{10}$/)
    const b = await store.add({ path: 'b.gp5', title: 'B', artist: 'Y' }, 'u2', 200)
    expect(store.songs().map((s) => s.id)).toEqual([a.id, b.id])
    expect(readFile()).toMatchObject({ version: 1, name: '我们的乐队' })

    const dup = await store.add({ path: 'a.gp5', title: 'again', artist: '' }, 'u2', 300).catch((e) => e)
    expect(dup).toBeInstanceOf(BandError)
    expect(dup.status).toBe(409)
    expect(dup.message).toBe('这首歌已经在歌单里了。')
    expect(store.songs()).toHaveLength(2)
  })

  it('update merges fields, replaces parts wholesale and bumps updatedAt', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 100)
    await store.update({ id: a.id, parts: { '0': 'u1', '2': 'u2' }, note: '慢一点' }, 150)
    const u = await store.update({ id: a.id, status: 'ready', parts: { '1': 'u2' } }, 200)
    expect(u).toMatchObject({
      status: 'ready',
      parts: { '1': 'u2' },
      note: '慢一点',
      rehearsalSpeedPct: null,
      updatedAt: 200,
      addedAt: 100,
    })
    const s = await store.update({ id: a.id, rehearsalSpeedPct: 90 }, 210)
    expect(s.rehearsalSpeedPct).toBe(90)
    const cleared = await store.update({ id: a.id, rehearsalSpeedPct: null }, 220)
    expect(cleared.rehearsalSpeedPct).toBeNull()
    expect(store.get(a.id)?.status).toBe('ready')
  })

  it('update of an unknown id is a 404', async () => {
    const store = await BandStore.load(dir, inRoot)
    const err = await store.update({ id: 'nope' }, 1).catch((e) => e)
    expect(err).toBeInstanceOf(BandError)
    expect(err.status).toBe(404)
  })

  it('reorder applies a permutation and rejects anything else', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: '', artist: '' }, 'u1', 2)
    const c = await store.add({ path: 'c.gp5', title: '', artist: '' }, 'u1', 3)
    await store.reorder([c.id, a.id, b.id])
    expect(store.songs().map((s) => s.id)).toEqual([c.id, a.id, b.id])
    const bad = await store.reorder([a.id, b.id]).catch((e) => e)
    expect(bad).toBeInstanceOf(BandError)
    expect(bad.status).toBe(400)
    expect(store.songs().map((s) => s.id)).toEqual([c.id, a.id, b.id])
  })

  it('rename trims, saves and rejects bad names', async () => {
    const store = await BandStore.load(dir, inRoot)
    await store.rename('  新名字 ')
    expect(store.name()).toBe('新名字')
    expect(readFile().name).toBe('新名字')
    const err = await store.rename('   ').catch((e) => e)
    expect(err).toBeInstanceOf(BandError)
    expect(store.name()).toBe('新名字')
  })

  it('remove deletes a song and 404s on an unknown id', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: '', artist: '' }, 'u1', 2)
    await store.remove(a.id)
    expect(store.songs().map((s) => s.id)).toEqual([b.id])
    const err = await store.remove('nope').catch((e) => e)
    expect(err.status).toBe(404)
  })

  it('dropUser removes that user from every song parts', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: '', artist: '' }, 'u1', 2)
    await store.update({ id: a.id, parts: { '0': 'u1', '1': 'u2' } }, 3)
    await store.update({ id: b.id, parts: { '4': 'u1' } }, 4)
    await store.dropUser('u1')
    expect(store.get(a.id)?.parts).toEqual({ '1': 'u2' })
    expect(store.get(b.id)?.parts).toEqual({})
    expect(readFile().songs.find((s: { id: string }) => s.id === a.id).parts).toEqual({ '1': 'u2' })
  })

  it('hasPath reports whether a library path is in the setlist', async () => {
    const store = await BandStore.load(dir, inRoot)
    expect(store.hasPath('a.gp5')).toBe(false)
    await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    expect(store.hasPath('a.gp5')).toBe(true)
    expect(store.hasPath('b.gp5')).toBe(false)
  })

  it('reloads what was saved', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 1)
    await store.update({ id: a.id, note: '备注', parts: { '0': 'u2' } }, 2)
    await store.rename('重开')
    const again = await BandStore.load(dir, inRoot)
    expect(again.name()).toBe('重开')
    expect(again.get(a.id)).toMatchObject({ note: '备注', parts: { '0': 'u2' } })
  })

  it('load drops songs whose path is no longer inside the library', async () => {
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [
          { id: 'ok1', path: 'a.gp5', title: 'A', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, addedBy: 'u1', addedAt: 1, updatedAt: 1 },
          { id: 'bad', path: '../escape.gp5', title: '', artist: '', status: 'learning', parts: {}, note: '', rehearsalSpeedPct: null, addedBy: 'u1', addedAt: 1, updatedAt: 1 },
        ],
      }),
    )
    const store = await BandStore.load(dir, inRoot)
    expect(store.name()).toBe('乐队')
    expect(store.songs().map((s) => s.id)).toEqual(['ok1'])
  })

  it('load of a corrupt file renames it aside and starts empty', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    fs.writeFileSync(path.join(dir, 'band.json'), '{ not json')
    const store = await BandStore.load(dir, inRoot)
    expect(store.songs()).toEqual([])
    expect(store.name()).toBe('我们的乐队')
    expect(warn).toHaveBeenCalled()
    const broken = fs.readdirSync(dir).filter((f) => f.startsWith('band.json.broken-'))
    expect(broken).toHaveLength(1)
    expect(fs.existsSync(path.join(dir, 'band.json'))).toBe(false)
  })
})

describe('comboId on band songs', () => {
  const ID = 'a1b2c3d4e5f6'

  it('parseUpdateSong accepts null or a 12-hex id, and leaves the field out when absent', () => {
    expect(parseUpdateSong({ id: 'a', comboId: ID }, isUser)).toEqual({ ok: true, value: { id: 'a', comboId: ID } })
    expect(parseUpdateSong({ id: 'a', comboId: null }, isUser)).toEqual({ ok: true, value: { id: 'a', comboId: null } })
    const none = parseUpdateSong({ id: 'a', status: 'ready' }, isUser)
    expect(none.ok && 'comboId' in none.value).toBe(false)
  })

  it.each(['', 'a1b2c3d4e5', 'A1B2C3D4E5F6', 'a1b2c3d4e5f6a', 'g1b2c3d4e5f6', 7])('parseUpdateSong rejects comboId %j', (c) => {
    expect(parseUpdateSong({ id: 'a', comboId: c }, isUser).ok).toBe(false)
  })

  it('a new song has comboId null, and update sets and clears it', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: 'X' }, 'u1', 100)
    expect(a.comboId).toBeNull()
    const set = await store.update({ id: a.id, comboId: ID }, 200)
    expect(set.comboId).toBe(ID)
    expect(readFile().songs[0].comboId).toBe(ID)
    const cleared = await store.update({ id: a.id, comboId: null }, 300)
    expect(cleared.comboId).toBeNull()
    const kept = await store.update({ id: a.id, note: '备注' }, 400)
    expect(kept.comboId).toBeNull()
  })

  it('an update without comboId keeps the stored one', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: 'X' }, 'u1', 100)
    await store.update({ id: a.id, comboId: ID }, 200)
    const next = await store.update({ id: a.id, status: 'ready' }, 300)
    expect(next.comboId).toBe(ID)
  })

  it('load treats a row without comboId (or with a bad one) as null', async () => {
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [
          { id: 'old', path: 'a.gp5', title: 'A', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, addedBy: 'u1', addedAt: 1, updatedAt: 1 },
          { id: 'odd', path: 'b.gp5', title: 'B', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, comboId: 'nope', addedBy: 'u1', addedAt: 1, updatedAt: 1 },
          { id: 'new', path: 'c.gp5', title: 'C', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, comboId: ID, addedBy: 'u1', addedAt: 1, updatedAt: 1 },
        ],
      }),
    )
    const store = await BandStore.load(dir, inRoot)
    expect(store.songs().map((s) => [s.id, s.comboId])).toEqual([
      ['old', null],
      ['odd', null],
      ['new', ID],
    ])
  })
})

const META = { id: 'b1', leaderId: 'u1', limits: { maxMembers: 20, storageBytes: 1000 }, storageUsed: 0 }

describe('bandState', () => {
  it('lists songs in setlist order with members and progress keyed by song id', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: 'B', artist: '' }, 'u1', 2)
    const progressFor: Record<string, MemberProgress[]> = {
      'a.gp5': [
        { userId: 'u1', totalSeconds: 60, maxSpeedPct: 100, lastAt: 5 },
        { userId: 'gone', totalSeconds: 9, maxSpeedPct: 80, lastAt: 6 },
      ],
    }
    const state = bandState(store, META, [user('u1'), user('u2')], (p) => progressFor[p] ?? [])
    expect(state.name).toBe('我们的乐队')
    expect(state.songs.map((s) => s.id)).toEqual([a.id, b.id])
    expect(state.members.map((m) => m.id)).toEqual(['u1', 'u2'])
    expect(state.progress[a.id]).toEqual([{ userId: 'u1', totalSeconds: 60, maxSpeedPct: 100, lastAt: 5 }])
    expect(state.progress[b.id]).toBeUndefined()
  })

  it('includes the rehearsal setlist', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 1)
    await store.setSetlist([a.id])
    expect(bandState(store, META, [], () => []).rehearsalSetlist).toEqual([a.id])
  })
})

const fullFill = (): FillConfig => ({
  tracks: { '0': 'auto', '3': 'on', '12': 'off' },
  volumes: { '3': 120, drums: 0, '0': 150 },
  drums: 'on',
  drumSource: 'generated',
  drumStyle: 'rock-8th_2',
  metronome: true,
  countIn: false,
})

describe('parseFill', () => {
  it('accepts a full config and a null drum style', () => {
    expect(parseFill(fullFill())).toEqual({ ok: true, value: fullFill() })
    const nullStyle = { ...fullFill(), drumStyle: null, tracks: {}, volumes: {} }
    expect(parseFill(nullStyle)).toEqual({ ok: true, value: nullStyle })
  })

  it('accepts every drum source and fill mode', () => {
    for (const drumSource of ['auto', 'file', 'saved', 'generated', 'metronome'])
      expect(parseFill({ ...fullFill(), drumSource }).ok).toBe(true)
    for (const drums of ['auto', 'on', 'off']) expect(parseFill({ ...fullFill(), drums }).ok).toBe(true)
  })

  it('rejects a non-object or a missing field', () => {
    expect(parseFill(null).ok).toBe(false)
    expect(parseFill([]).ok).toBe(false)
    expect(parseFill('auto').ok).toBe(false)
    const { tracks: _omit, ...missing } = fullFill()
    void _omit
    const r = parseFill(missing)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('补位设置格式不对。')
    const noCountIn = parseFill({ ...fullFill(), countIn: undefined })
    expect(noCountIn.ok).toBe(false)
    if (!noCountIn.ok) expect(noCountIn.error).toBe('预备拍要是开或关。')
  })

  it('checks track keys and modes', () => {
    expect(parseFill({ ...fullFill(), tracks: { '64': 'on' } }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), tracks: { '01': 'on' } }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), tracks: { drums: 'on' } }).ok).toBe(false)
    const r = parseFill({ ...fullFill(), tracks: { '1': 'yes' } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('补位模式必须是 auto、on 或 off。')
    expect(parseFill({ ...fullFill(), tracks: [] }).ok).toBe(false)
  })

  it('caps the track entries at 64', () => {
    const many: Record<string, string> = {}
    for (let i = 0; i < 65; i++) many[String(i)] = 'auto'
    const r = parseFill({ ...fullFill(), tracks: many })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('声部补位设置最多 64 项。')
  })

  it('checks volumes: keys are track keys or drums, values integers 0–150', () => {
    expect(parseFill({ ...fullFill(), volumes: { drums: 0, '63': 150 } }).ok).toBe(true)
    for (const v of [-1, 151, 99.5, '100', null]) {
      const r = parseFill({ ...fullFill(), volumes: { '1': v } })
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.error).toBe('音量要在 0–150 之间。')
    }
    expect(parseFill({ ...fullFill(), volumes: { kick: 100 } }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), volumes: { '64': 100 } }).ok).toBe(false)
  })

  it('checks drum source, drum style, metronome and count-in', () => {
    expect(parseFill({ ...fullFill(), drumSource: 'loud' }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), drumStyle: '' }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), drumStyle: 'a b' }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), drumStyle: 'x'.repeat(41) }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), drumStyle: 3 }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), metronome: 'yes' }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), countIn: 1 }).ok).toBe(false)
    expect(parseFill({ ...fullFill(), drums: 'loud' }).ok).toBe(false)
  })
})

describe('parseUpdateSong with fill', () => {
  it('returns the fill when present and leaves it out when absent', () => {
    expect(parseUpdateSong({ id: 'a', fill: fullFill() }, isUser)).toEqual({
      ok: true,
      value: { id: 'a', fill: fullFill() },
    })
    expect(parseUpdateSong({ id: 'a' }, isUser)).toEqual({ ok: true, value: { id: 'a' } })
  })

  it('rejects a bad fill', () => {
    const r = parseUpdateSong({ id: 'a', fill: { tracks: {} } }, isUser)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toBe('补位设置格式不对。')
  })

  it('update stores the fill and keeps it when a later update leaves it out', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 1)
    expect(a.fill).toBeUndefined()
    const set = await store.update({ id: a.id, fill: fullFill() }, 2)
    expect(set.fill).toEqual(fullFill())
    expect(readFile().songs[0].fill).toEqual(fullFill())
    const kept = await store.update({ id: a.id, note: '备注' }, 3)
    expect(kept.fill).toEqual(fullFill())
  })

  it('load keeps a valid fill and drops an invalid one', () => {
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [
          { id: 'good', path: 'a.gp5', title: '', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, fill: fullFill(), addedBy: 'u1', addedAt: 1, updatedAt: 1 },
          { id: 'bad', path: 'b.gp5', title: '', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, fill: { tracks: 'x' }, addedBy: 'u1', addedAt: 1, updatedAt: 1 },
        ],
      }),
    )
    return BandStore.load(dir, inRoot).then((store) => {
      expect(store.get('good')?.fill).toEqual(fullFill())
      expect(store.get('bad')).toBeDefined()
      expect(store.get('bad')?.fill).toBeUndefined()
    })
  })
})

describe('小节留言', () => {
  it('parseAddComment accepts a bar and trims the text', () => {
    expect(parseAddComment({ songId: 'a', bar: 12, text: '  慢一点  ' })).toEqual({
      ok: true,
      value: { songId: 'a', bar: 12, text: '慢一点' },
    })
    expect(parseAddComment({ songId: 'a', bar: 10000, text: '字'.repeat(200) }).ok).toBe(true)
  })

  it('parseAddComment rejects a bad song, bar or text', () => {
    expect(parseAddComment({ bar: 1, text: 'x' }).ok).toBe(false)
    expect(parseAddComment({ songId: '', bar: 1, text: 'x' }).ok).toBe(false)
    expect(parseAddComment({ songId: 'a', bar: 0, text: 'x' }).ok).toBe(false)
    expect(parseAddComment({ songId: 'a', bar: 10001, text: 'x' }).ok).toBe(false)
    expect(parseAddComment({ songId: 'a', bar: 1.5, text: 'x' }).ok).toBe(false)
    expect(parseAddComment({ songId: 'a', bar: '1', text: 'x' }).ok).toBe(false)
    const blank = parseAddComment({ songId: 'a', bar: 1, text: '   ' })
    expect(blank.ok).toBe(false)
    if (!blank.ok) expect(blank.error).toBe('留言要在 1–200 个字之间。')
    expect(parseAddComment({ songId: 'a', bar: 1, text: '字'.repeat(201) }).ok).toBe(false)
    expect(parseAddComment({ songId: 'a', bar: 1, text: 7 }).ok).toBe(false)
  })

  it('addComment appends with id, author and time, and bumps updatedAt', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: 'A', artist: '' }, 'u1', 1)
    const s = await store.addComment({ songId: a.id, bar: 4, text: '这里抢拍' }, 'u2', 50)
    expect(s.updatedAt).toBe(50)
    expect(s.comments).toHaveLength(1)
    expect(s.comments?.[0]).toMatchObject({ bar: 4, text: '这里抢拍', userId: 'u2', at: 50 })
    expect(s.comments?.[0].id).toMatch(/^[0-9a-f]{8}$/)
    expect(readFile().songs[0].comments).toHaveLength(1)
  })

  it('addComment of an unknown song is a 404', async () => {
    const store = await BandStore.load(dir, inRoot)
    const err = await store.addComment({ songId: 'nope', bar: 1, text: 'x' }, 'u1', 1).catch((e) => e)
    expect(err).toBeInstanceOf(BandError)
    expect(err.status).toBe(404)
  })

  it('addComment refuses a 201st comment with a 409', async () => {
    const song = {
      id: 'full',
      path: 'a.gp5',
      title: '',
      artist: '',
      status: 'ready',
      parts: {},
      note: '',
      rehearsalSpeedPct: null,
      addedBy: 'u1',
      addedAt: 1,
      updatedAt: 1,
      comments: Array.from({ length: MAX_COMMENTS_PER_SONG }, (_, i) => ({
        id: `c${i}`,
        bar: 1,
        text: 'x',
        userId: 'u1',
        at: i,
      })),
    }
    fs.writeFileSync(path.join(dir, 'band.json'), JSON.stringify({ version: 1, name: '乐队', songs: [song] }))
    const store = await BandStore.load(dir, inRoot)
    expect(store.get('full')?.comments).toHaveLength(MAX_COMMENTS_PER_SONG)
    const err = await store.addComment({ songId: 'full', bar: 1, text: 'y' }, 'u1', 2).catch((e) => e)
    expect(err).toBeInstanceOf(BandError)
    expect(err.status).toBe(409)
    expect(err.message).toBe('这首歌的留言太多了（最多 200 条），先删掉一些。')
    expect(store.get('full')?.comments).toHaveLength(MAX_COMMENTS_PER_SONG)
  })

  it('removeComment lets the author and admins delete, and refuses other members', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const c1 = await store.addComment({ songId: a.id, bar: 1, text: 'one' }, 'u1', 2)
    const id1 = c1.comments![0].id
    const c2 = await store.addComment({ songId: a.id, bar: 2, text: 'two' }, 'u1', 3)
    const id2 = c2.comments![1].id

    const denied = await store
      .removeComment(a.id, id1, { id: 'u2', moderator: false })
      .catch((e) => e)
    expect(denied).toBeInstanceOf(BandError)
    expect(denied.status).toBe(403)
    expect(denied.message).toBe('只有写留言的人、队长或管理员可以删除。')
    expect(store.get(a.id)?.comments).toHaveLength(2)

    const own = await store.removeComment(a.id, id1, { id: 'u1', moderator: false })
    expect(own.comments?.map((c) => c.id)).toEqual([id2])

    const byAdmin = await store.removeComment(a.id, id2, { id: 'u9', moderator: true })
    expect(byAdmin.comments).toEqual([])
    expect(readFile().songs[0].comments).toEqual([])
  })

  it('removeComment of an unknown song or comment is a 404', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const noSong = await store.removeComment('nope', 'x', { id: 'u1', moderator: true }).catch((e) => e)
    expect(noSong.status).toBe(404)
    const noComment = await store.removeComment(a.id, 'x', { id: 'u1', moderator: true }).catch((e) => e)
    expect(noComment.status).toBe(404)
  })

  it('dropUser keeps comments the user wrote', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    await store.update({ id: a.id, parts: { '0': 'u1' } }, 2)
    await store.addComment({ songId: a.id, bar: 3, text: '保留' }, 'u1', 3)
    await store.dropUser('u1')
    expect(store.get(a.id)?.parts).toEqual({})
    expect(store.get(a.id)?.comments).toMatchObject([{ text: '保留', userId: 'u1' }])
  })

  it('load drops invalid comments and caps the list at 200', () => {
    const good = (i: number) => ({ id: `g${i}`, bar: 1, text: '好', userId: 'u1', at: i })
    const comments = [
      good(1),
      { id: '', bar: 1, text: 'x', userId: 'u1', at: 1 },
      { id: 'b1', bar: 0, text: 'x', userId: 'u1', at: 1 },
      { id: 'b2', bar: 1, text: '   ', userId: 'u1', at: 1 },
      { id: 'b3', bar: 1, text: 'x', userId: '', at: 1 },
      { id: 'b4', bar: 1, text: 'x', userId: 'u1', at: 'now' },
      'junk',
      ...Array.from({ length: 250 }, (_, i) => good(i + 10)),
    ]
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [{ id: 's', path: 'a.gp5', title: '', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, comments, addedBy: 'u1', addedAt: 1, updatedAt: 1 }],
      }),
    )
    return BandStore.load(dir, inRoot).then((store) => {
      const kept = store.get('s')?.comments ?? []
      expect(kept).toHaveLength(MAX_COMMENTS_PER_SONG)
      expect(kept[0]).toEqual({ id: 'g1', bar: 1, text: '好', userId: 'u1', at: 1 })
      expect(kept.some((c) => c.id.startsWith('b'))).toBe(false)
    })
  })

  it('an old row without comments loads with an empty list', async () => {
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [{ id: 'old', path: 'a.gp5', title: '', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, addedBy: 'u1', addedAt: 1, updatedAt: 1 }],
      }),
    )
    const store = await BandStore.load(dir, inRoot)
    expect(store.get('old')?.comments ?? []).toEqual([])
  })
})

describe('今天的排练歌单', () => {
  it('parseSetlist accepts unique known ids, in order', () => {
    expect(parseSetlist({ ids: ['b', 'a'] }, ['a', 'b', 'c'])).toEqual({ ok: true, value: ['b', 'a'] })
    expect(parseSetlist({ ids: [] }, ['a']).ok).toBe(true)
  })

  it('parseSetlist rejects non-arrays, duplicates, unknown ids and more than 50 songs', () => {
    expect(parseSetlist({ ids: 'a' }, ['a']).ok).toBe(false)
    expect(parseSetlist({ ids: ['a', 3] }, ['a']).ok).toBe(false)
    expect(parseSetlist({}, ['a']).ok).toBe(false)
    expect(parseSetlist({ ids: ['a', 'a'] }, ['a']).ok).toBe(false)
    const unknown = parseSetlist({ ids: ['a', 'x'] }, ['a'])
    expect(unknown.ok).toBe(false)
    if (!unknown.ok) expect(unknown.error).toBe('今天的歌单里有歌已经不在乐队歌单里了。')
    const ids = Array.from({ length: 51 }, (_, i) => `s${i}`)
    const many = parseSetlist({ ids }, ids)
    expect(many.ok).toBe(false)
    if (!many.ok) expect(many.error).toBe('今天的歌单最多 50 首。')
  })

  it('setSetlist saves and reloads the setlist', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: '', artist: '' }, 'u1', 2)
    expect(store.setlist()).toEqual([])
    await store.setSetlist([b.id, a.id])
    expect(store.setlist()).toEqual([b.id, a.id])
    expect(readFile().rehearsalSetlist).toEqual([b.id, a.id])
    await store.rename('新名字')
    expect(store.setlist()).toEqual([b.id, a.id])
  })

  it('setSetlist refuses unknown ids and leaves the setlist alone', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    await store.setSetlist([a.id])
    const err = await store.setSetlist([a.id, 'ghost']).catch((e) => e)
    expect(err).toBeInstanceOf(BandError)
    expect(err.status).toBe(400)
    expect(store.setlist()).toEqual([a.id])
  })

  it('removing a song also takes it off today\'s setlist', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    const b = await store.add({ path: 'b.gp5', title: '', artist: '' }, 'u1', 2)
    await store.setSetlist([a.id, b.id])
    await store.remove(a.id)
    expect(store.setlist()).toEqual([b.id])
    expect(readFile().rehearsalSetlist).toEqual([b.id])
  })

  it('load drops setlist ids that are not songs, and an old file has none', async () => {
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({
        version: 1,
        name: '乐队',
        songs: [{ id: 'a', path: 'a.gp5', title: '', artist: '', status: 'ready', parts: {}, note: '', rehearsalSpeedPct: null, addedBy: 'u1', addedAt: 1, updatedAt: 1 }],
        rehearsalSetlist: ['gone', 'a'],
      }),
    )
    expect((await BandStore.load(dir, inRoot)).setlist()).toEqual(['a'])
    fs.writeFileSync(
      path.join(dir, 'band.json'),
      JSON.stringify({ version: 1, name: '乐队', songs: [] }),
    )
    expect((await BandStore.load(dir, inRoot)).setlist()).toEqual([])
  })

  it('bandState reports the setlist', async () => {
    const store = await BandStore.load(dir, inRoot)
    const a = await store.add({ path: 'a.gp5', title: '', artist: '' }, 'u1', 1)
    await store.setSetlist([a.id])
    expect(bandState(store, META, [user('u1')], () => []).rehearsalSetlist).toEqual([a.id])
  })
})

describe('band file round trip', () => {
  it('a store written by one instance loads fully in another', async () => {
    const writer = await BandStore.load(dir, inRoot)
    const a = await writer.add({ path: 'a.gp5', title: 'A', artist: 'X' }, 'u1', 1)
    const b = await writer.add({ path: 'b.gp5', title: 'B', artist: 'Y' }, 'u2', 2)
    await writer.update({ id: a.id, fill: fullFill(), parts: { '0': 'u1' } }, 3)
    await writer.addComment({ songId: a.id, bar: 5, text: '慢' }, 'u2', 4)
    await writer.setSetlist([b.id, a.id])
    await writer.rename('往返')

    const reader = await BandStore.load(dir, inRoot)
    expect(reader.name()).toBe('往返')
    expect(reader.setlist()).toEqual([b.id, a.id])
    expect(reader.get(a.id)).toMatchObject({
      fill: fullFill(),
      parts: { '0': 'u1' },
      comments: [{ bar: 5, text: '慢', userId: 'u2', at: 4 }],
    })
    expect(reader.get(b.id)?.fill).toBeUndefined()
  })
})
