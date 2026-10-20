import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ArrangementStore, MAX_PER_USER, parseSave, parseTracks } from '../server/arrangements'
import { configOf, describeConfig, mixOf, sameConfig } from '../src/songs/arrangement'
import { GM_NAMES, INSTRUMENT_GROUPS, instrumentName } from '../src/songs/gmInstruments'

const NOW = 1_700_000_000_000
const inRoot = (p: string) => p.length > 0 && !p.startsWith('/') && !p.includes('..')
const BODY = {
  id: null,
  name: '换成钢琴',
  path: 'a/b.gp',
  title: '夜曲',
  artist: '周杰伦',
  tracks: { '0': { program: 0 }, '2': { volume: 80, mute: true } },
  transpose: 2,
  trackCount: 4,
}

let dir: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arr-test-'))
})
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('parsing', () => {
  it('accepts a valid body and drops no-op fields', () => {
    const r = parseSave({ ...BODY, tracks: { '0': { program: 0, volume: 100, mute: false }, '1': {} } }, inRoot)
    expect(r.ok && r.value.tracks).toEqual({ '0': { program: 0 } })
  })
  it('refuses bad values', () => {
    expect(parseSave({ ...BODY, name: ' ' }, inRoot).ok).toBe(false)
    expect(parseSave({ ...BODY, path: '../x' }, inRoot).ok).toBe(false)
    expect(parseSave({ ...BODY, transpose: 7 }, inRoot).ok).toBe(false)
    expect(parseSave({ ...BODY, trackCount: 0 }, inRoot).ok).toBe(false)
    expect(parseSave({ ...BODY, tracks: { '4': { program: 1 } } }, inRoot).ok).toBe(false)
    expect(parseTracks({ '0': { program: 128 } }).ok).toBe(false)
    expect(parseTracks({ '0': { volume: 151 } }).ok).toBe(false)
    expect(parseTracks({ '64': {} }).ok).toBe(false)
    expect(parseTracks({ '01': {} }).ok).toBe(false)
  })
})

describe('ArrangementStore', () => {
  it('saves, reloads, renames and removes, each only for its owner', async () => {
    const store = await ArrangementStore.load(dir)
    const a = await store.save(parseOk(BODY), 'u1', NOW)
    expect(a.owner).toBe('u1')
    expect(store.get(a.id, 'u2')).toBeUndefined()
    expect(store.listOf('u2')).toEqual([])
    const again = await ArrangementStore.load(dir)
    expect(again.get(a.id, 'u1')).toEqual(a)
    await expect(again.save({ ...parseOk(BODY), id: a.id }, 'u2', NOW)).rejects.toThrow('找不到')
    const renamed = await again.rename(a.id, 'u1', ' 新名字 ', NOW + 1)
    expect(renamed.name).toBe('新名字')
    await expect(again.remove(a.id, 'u2')).rejects.toThrow('找不到')
    await again.remove(a.id, 'u1')
    expect(again.listOf('u1')).toEqual([])
  })

  it('updates in place and lists newest first', async () => {
    const store = await ArrangementStore.load(dir)
    const a = await store.save(parseOk(BODY), 'u1', NOW)
    const b = await store.save(parseOk({ ...BODY, name: 'B' }), 'u1', NOW + 1)
    await store.save({ ...parseOk(BODY), id: a.id, name: 'A2' }, 'u1', NOW + 2)
    expect(store.listOf('u1').map((x) => x.name)).toEqual(['A2', 'B'])
    expect(store.get(a.id, 'u1')?.createdAt).toBe(NOW)
    expect(b.id).not.toBe(a.id)
  })

  it('limits each account and forgets a deleted one', async () => {
    const store = await ArrangementStore.load(dir)
    for (let i = 0; i < MAX_PER_USER; i++) await store.save(parseOk(BODY), 'u1', NOW)
    await expect(store.save(parseOk(BODY), 'u1', NOW)).rejects.toThrow('最多')
    await store.save(parseOk(BODY), 'u2', NOW)
    await store.dropUser('u1')
    expect(store.listOf('u1')).toEqual([])
    expect(store.listOf('u2')).toHaveLength(1)
  })

  it('sets a damaged file aside', async () => {
    fs.writeFileSync(path.join(dir, 'arrangements.json'), '{nope')
    const store = await ArrangementStore.load(dir)
    expect(store.listOf('u1')).toEqual([])
    expect(fs.readdirSync(dir).some((f) => f.startsWith('arrangements.json.broken-'))).toBe(true)
  })
})

function parseOk(b: unknown) {
  const r = parseSave(b, inRoot)
  if (!r.ok) throw new Error(r.error)
  return r.value
}

describe('arrangement on the page', () => {
  const mix = { programs: [0, null, null, null], volumes: [100, 100, 80], mute: new Set([2]), transpose: 2 }
  it('turns the viewer state into changes and back', () => {
    const config = configOf(mix, 4)
    expect(config).toEqual({ tracks: { '0': { program: 0 }, '2': { volume: 80, mute: true } }, transpose: 2 })
    const back = mixOf(config, 4)
    expect(back.programs).toEqual([0, null, null, null])
    expect(back.volumes).toEqual([100, 100, 80, 100])
    expect([...back.mute]).toEqual([2])
  })
  it('ignores tracks past the count (hidden helper tracks)', () => {
    expect(configOf({ ...mix, mute: new Set([5]) }, 4).tracks['5']).toBeUndefined()
  })
  it('compares and describes', () => {
    const c = configOf(mix, 4)
    expect(sameConfig(c, { tracks: { '2': { mute: true, volume: 80 }, '0': { program: 0 } }, transpose: 2 })).toBe(true)
    expect(sameConfig(c, { ...c, transpose: 0 })).toBe(false)
    expect(sameConfig({ tracks: { '1': {} }, transpose: 0 }, { tracks: {}, transpose: 0 })).toBe(true)
    expect(describeConfig(c)).toBe('1 条轨换了乐器 · 1 条轨调了音量 · 1 条轨静音 · 移调 +2')
    expect(describeConfig({ tracks: {}, transpose: 0 })).toBe('没有改动')
  })
})

describe('instrument names', () => {
  it('names all 128 programs and groups only real ones', () => {
    expect(GM_NAMES).toHaveLength(128)
    expect(instrumentName(30)).toBe('失真吉他')
    for (const g of INSTRUMENT_GROUPS) for (const p of g.programs) expect(p >= 0 && p < 128).toBe(true)
  })
})
