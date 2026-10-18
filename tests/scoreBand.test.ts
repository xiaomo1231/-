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
  bandState,
  parseAddSong,
  parseReorder,
  parseRename,
  parseUpdateSong,
} from '../server/band'

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
    const state = bandState(store, [user('u1'), user('u2')], (p) => progressFor[p] ?? [])
    expect(state.name).toBe('我们的乐队')
    expect(state.songs.map((s) => s.id)).toEqual([a.id, b.id])
    expect(state.members.map((m) => m.id)).toEqual(['u1', 'u2'])
    expect(state.progress[a.id]).toEqual([{ userId: 'u1', totalSeconds: 60, maxSpeedPct: 100, lastAt: 5 }])
    expect(state.progress[b.id]).toBeUndefined()
  })
})
