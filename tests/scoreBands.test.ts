import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { BAND_FILE } from '../server/band'
import { BANDS_DIR, BANDS_FILE, BandRegistry, BandsError, DEFAULT_LIMITS, parseLimits } from '../server/bands'
import type { InRoot } from '../server/favorites'

const NOW = 1_700_000_000_000
const inRoot: InRoot = (p) => typeof p === 'string' && p.length > 0 && !p.startsWith('/') && !p.includes('..')

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bands-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

const load = () => BandRegistry.load(dir, inRoot, 'admin', ['admin', 'u1', 'u2'], NOW)

describe('upgrading from one band', () => {
  it('turns the old band.json into the first band, led by the admin, with everyone in it', async () => {
    const old = {
      version: 1,
      name: '夜行者',
      songs: [{ id: 's1', path: 'a/b.gp', title: 'B', artist: 'A', status: 'ready', parts: {}, note: '' }],
      rehearsalSetlist: ['s1'],
    }
    fs.writeFileSync(path.join(dir, BAND_FILE), JSON.stringify(old))
    const reg = await load()
    const [first] = reg.list()
    expect(first?.leaderId).toBe('admin')
    expect(first?.members.map((m) => m.userId)).toEqual(['admin', 'u1', 'u2'])
    expect(first?.limits).toEqual(DEFAULT_LIMITS)
    const store = reg.store(first!.id)!
    expect(store.name()).toBe('夜行者')
    expect(store.songs().map((s) => s.id)).toEqual(['s1'])
    expect(store.setlist()).toEqual(['s1'])
    // The old file is kept under another name and no longer read.
    expect(fs.existsSync(path.join(dir, BAND_FILE))).toBe(false)
    expect(fs.existsSync(path.join(dir, `${BAND_FILE}.migrated`))).toBe(true)
    expect(fs.existsSync(path.join(dir, BANDS_DIR, `${first!.id}.json`))).toBe(true)
  })

  it('a new install gets one empty band for the admin', async () => {
    const reg = await load()
    expect(reg.list()).toHaveLength(1)
    expect(reg.firstId()).toBe(reg.list()[0]!.id)
  })

  it('later loads read bands.json and do not migrate again', async () => {
    const a = await load()
    const id = a.firstId()
    const b = await BandRegistry.load(dir, inRoot, 'admin', ['admin', 'u9'], NOW + 1)
    expect(b.firstId()).toBe(id)
    expect(b.isMember(id!, 'u9')).toBe(false)
  })

  it('a damaged bands.json stops the start instead of resetting who is in which band', async () => {
    fs.writeFileSync(path.join(dir, BANDS_FILE), '{oops')
    await expect(load()).rejects.toThrow(/已损坏/)
  })
})

describe('bands and members', () => {
  it('a new band has its leader as the only member, with its own setlist file', async () => {
    const reg = await load()
    const b = await reg.create({ name: '第二支', leaderId: 'u1', createdBy: 'admin' }, NOW)
    expect(b.members.map((m) => m.userId)).toEqual(['u1'])
    expect(reg.store(b.id)?.name()).toBe('第二支')
    expect(reg.isLeader(b.id, 'u1')).toBe(true)
    expect(reg.bandIdsOf('u1')).toEqual([reg.firstId(), b.id])
    const briefs = reg.briefsOf('u1')
    expect(briefs.map((x) => [x.name, x.leader])).toEqual([
      [expect.any(String), false],
      ['第二支', true],
    ])
    // Reloads the same.
    const again = await load()
    expect(again.store(b.id)?.name()).toBe('第二支')
  })

  it('one account can be in several bands; joining twice is refused', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    await reg.addMember(b.id, 'u2', NOW)
    expect(reg.isMember(b.id, 'u2')).toBe(true)
    expect(reg.isMember(reg.firstId()!, 'u2')).toBe(true)
    const err = await reg.addMember(b.id, 'u2', NOW).catch((e) => e)
    expect(err).toBeInstanceOf(BandsError)
    expect(err.status).toBe(409)
  })

  it('a full band takes nobody else', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    await reg.setLimits(b.id, { maxMembers: 2 })
    await reg.addMember(b.id, 'u2', NOW)
    const err = await reg.addMember(b.id, 'u3', NOW).catch((e) => e)
    expect(err.status).toBe(409)
    expect(err.message).toContain('满员')
  })

  it('removing a member also clears their parts; the leader cannot be removed', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    await reg.addMember(b.id, 'u2', NOW)
    const store = reg.store(b.id)!
    const song = await store.add({ path: 'x/y.gp', title: 'Y', artist: 'X' }, 'u1', NOW)
    await store.update({ id: song.id, parts: { '0': 'u2', '1': 'u1' } }, NOW)
    await reg.removeMember(b.id, 'u2')
    expect(reg.isMember(b.id, 'u2')).toBe(false)
    expect(store.get(song.id)?.parts).toEqual({ '1': 'u1' })
    expect((await reg.removeMember(b.id, 'u1').catch((e) => e)).status).toBe(400)
  })

  it('hands over the leader only to a member', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    expect((await reg.setLeader(b.id, 'u2').catch((e) => e)).status).toBe(400)
    await reg.addMember(b.id, 'u2', NOW)
    await reg.setLeader(b.id, 'u2')
    expect(reg.get(b.id)?.leaderId).toBe('u2')
  })

  it('deleting an account takes it out of every band, but not while it leads one', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    await reg.addMember(b.id, 'u2', NOW)
    await reg.dropUser('u2')
    expect(reg.bandIdsOf('u2')).toEqual([])
    expect((await reg.dropUser('u1').catch((e) => e)).message).toContain('队长')
  })

  it('deleting a band keeps its file under another name', async () => {
    const reg = await load()
    const b = await reg.create({ name: 'B', leaderId: 'u1', createdBy: 'admin' }, NOW)
    await reg.remove(b.id)
    expect(reg.get(b.id)).toBeUndefined()
    expect(reg.store(b.id)).toBeUndefined()
    const left = fs.readdirSync(path.join(dir, BANDS_DIR))
    expect(left.some((f) => f.startsWith(`${b.id}.json.deleted-`))).toBe(true)
  })
})

describe('parseLimits', () => {
  it('keeps the given fields in range and refuses the rest', () => {
    expect(parseLimits({ maxMembers: 5 })).toEqual({ ok: true, value: { maxMembers: 5 } })
    expect(parseLimits({ storageBytes: 1024 })).toEqual({ ok: true, value: { storageBytes: 1024 } })
    expect(parseLimits({ maxMembers: 0 }).ok).toBe(false)
    expect(parseLimits({ maxMembers: 1.5 }).ok).toBe(false)
    expect(parseLimits({ storageBytes: -1 }).ok).toBe(false)
    expect(parseLimits(null).ok).toBe(false)
  })
})
