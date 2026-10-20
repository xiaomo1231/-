import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { NewInviteBody } from '../src/songs/scoreServerTypes'
import {
  INVITES_FILE,
  InviteError,
  InviteStore,
  MAX_INVITES,
  newUserFromInvite,
  normalizeCode,
  parseAccept,
  parseJoin,
  parseNewInvite,
} from '../server/invites'

const NOW = 1_700_000_000_000
const DAY = 86_400_000

const BAND = 'aaaaaaaaaaaa'

const BODY: NewInviteBody = {
  kind: 'member',
  bandId: BAND,
  days: 7,
  maxUses: 1,
  instrument: null,
  libraryAccess: false,
  note: '给新鼓手',
}

let dir: string

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'invites-test-'))
})

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('creating and checking links', () => {
  it('creates a token that checks as usable', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create(BODY, 'admin1', NOW)
    expect(token).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/)
    expect(invite.kind).toBe('member')
    expect(invite.bandId).toBe(BAND)
    expect(invite.id).toMatch(/^[0-9a-f]{12}$/)
    expect(invite.expiresAt).toBe(NOW + 7 * DAY)
    expect(invite.uses).toBe(0)
    expect(store.check(token, NOW)).toEqual({
      invite: expect.objectContaining({ id: invite.id }),
      reason: null,
    })
  })

  it('stores only the hash, never the token', async () => {
    const store = await InviteStore.load(dir)
    const { token } = await store.create(BODY, 'admin1', NOW)
    const text = fs.readFileSync(path.join(dir, INVITES_FILE), 'utf8')
    expect(text).not.toContain(token)
    expect(text).toMatch(/"tokenHash":"[0-9a-f]{64}"/)
    expect(JSON.stringify(store.list())).not.toContain('tokenHash')
  })

  it('reports an unknown token', async () => {
    const store = await InviteStore.load(dir)
    await store.create(BODY, 'admin1', NOW)
    expect(store.check('x'.repeat(32), NOW).reason).toBe('这个邀请码不存在或已经失效。')
  })

  it('expires after the chosen days', async () => {
    const store = await InviteStore.load(dir)
    const { token } = await store.create({ ...BODY, days: 1 }, 'admin1', NOW)
    expect(store.check(token, NOW + DAY - 1).reason).toBeNull()
    expect(store.check(token, NOW + DAY).reason).toBe('这个邀请码已经过期了。')
  })

  it('never expires with days null', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create({ ...BODY, days: null }, 'admin1', NOW)
    expect(invite.expiresAt).toBeNull()
    expect(store.check(token, NOW + 365 * DAY).reason).toBeNull()
  })

  it('survives a reload from disk', async () => {
    const store = await InviteStore.load(dir)
    const { token } = await store.create(BODY, 'admin1', NOW)
    const again = await InviteStore.load(dir)
    expect(again.check(token, NOW).reason).toBeNull()
  })
})

describe('uses', () => {
  it('reserve takes a use and refuses once the maximum is reached', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create(BODY, 'admin1', NOW)
    const taken = await store.reserve(token, NOW)
    expect(taken.uses).toBe(1)
    expect(store.check(token, NOW).reason).toBe('这个邀请码的名额已经用完了。')
    await expect(store.reserve(token, NOW)).rejects.toMatchObject({ status: 410 })
    expect(store.list()[0]?.id).toBe(invite.id)
  })

  it('release gives a use back', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create(BODY, 'admin1', NOW)
    await store.reserve(token, NOW)
    await store.release(invite.id)
    expect(store.check(token, NOW).reason).toBeNull()
    await expect(store.reserve(token, NOW)).resolves.toMatchObject({ uses: 1 })
  })

  it('confirm records the joiner, forgetUser removes it', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create({ ...BODY, maxUses: null }, 'admin1', NOW)
    await store.reserve(token, NOW)
    await store.confirm(invite.id, 'u1')
    await store.confirm(invite.id, 'u1')
    expect(store.list()[0]?.usedBy).toEqual(['u1'])
    await store.forgetUser('u1')
    expect(store.list()[0]?.usedBy).toEqual([])
  })

  it('unlimited links never run out', async () => {
    const store = await InviteStore.load(dir)
    const { token } = await store.create({ ...BODY, maxUses: null }, 'admin1', NOW)
    for (let i = 0; i < 3; i++) await store.reserve(token, NOW)
    expect(store.check(token, NOW).reason).toBeNull()
  })
})

describe('revoke', () => {
  it('makes a link unusable with the revoked reason', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create(BODY, 'admin1', NOW)
    await store.revoke(invite.id)
    expect(store.check(token, NOW).reason).toBe('这个邀请码已经被作废了。')
    expect(store.list()[0]?.revoked).toBe(true)
  })

  it('404 for an unknown id', async () => {
    const store = await InviteStore.load(dir)
    const err = await store.revoke('000000000000').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(InviteError)
    expect((err as InviteError).status).toBe(404)
  })
})

describe('storage', () => {
  it('moves a damaged file aside and starts empty', async () => {
    fs.writeFileSync(path.join(dir, INVITES_FILE), '{not json')
    const store = await InviteStore.load(dir)
    expect(store.list()).toEqual([])
    expect(fs.existsSync(path.join(dir, INVITES_FILE))).toBe(false)
    const broken = fs.readdirSync(dir).filter((n) => n.startsWith(`${INVITES_FILE}.broken-`))
    expect(broken).toHaveLength(1)
  })

  it('lists newest first', async () => {
    const store = await InviteStore.load(dir)
    const a = await store.create(BODY, 'admin1', NOW)
    const b = await store.create(BODY, 'admin1', NOW + 1)
    const c = await store.create(BODY, 'admin1', NOW + 2)
    expect(store.list().map((i) => i.id)).toEqual([c.invite.id, b.invite.id, a.invite.id])
  })

  it('trims to MAX_INVITES, dropping the oldest unusable link first', async () => {
    const store = await InviteStore.load(dir)
    const old = await store.create(BODY, 'admin1', NOW)
    await store.revoke(old.invite.id)
    for (let i = 1; i < MAX_INVITES + 1; i++)
      await store.create({ ...BODY, maxUses: null }, 'admin1', NOW + i)
    const ids = store.list().map((i) => i.id)
    expect(ids).toHaveLength(MAX_INVITES)
    expect(ids).not.toContain(old.invite.id)
  })

  it('trims the oldest usable link when nothing is spent', async () => {
    const store = await InviteStore.load(dir)
    const first = await store.create({ ...BODY, maxUses: null }, 'admin1', NOW)
    for (let i = 1; i < MAX_INVITES; i++)
      await store.create({ ...BODY, maxUses: null }, 'admin1', NOW + i)
    await store.create({ ...BODY, maxUses: null }, 'admin1', NOW + MAX_INVITES)
    const ids = store.list().map((i) => i.id)
    expect(ids).toHaveLength(MAX_INVITES)
    expect(ids).not.toContain(first.invite.id)
  })
})

describe('codes', () => {
  it('reads a typed code however it is written', async () => {
    const store = await InviteStore.load(dir)
    const { invite, token } = await store.create(BODY, 'admin1', NOW)
    const plain = token.replace('-', '')
    for (const typed of [token, plain, plain.toLowerCase(), ` ${token.slice(0, 5)} ${token.slice(6)} `])
      expect(store.check(typed, NOW).invite?.id).toBe(invite.id)
  })

  it('reads O as 0 and I / L as 1', () => {
    expect(normalizeCode('o1il-x')).toBe('0111X')
  })

  it('old link tokens keep working after the upgrade, and join the first band', async () => {
    const old = {
      id: 'abcdefabcdef',
      createdBy: 'admin1',
      createdAt: NOW,
      expiresAt: null,
      maxUses: null,
      uses: 0,
      usedBy: [],
      instrument: null,
      libraryAccess: false,
      note: '',
      revoked: false,
      // sha256 of 'oldTokenOldTokenOldToken'
      tokenHash: (await import('node:crypto')).createHash('sha256').update('oldTokenOldTokenOldToken').digest('hex'),
    }
    fs.writeFileSync(path.join(dir, INVITES_FILE), JSON.stringify({ version: 1, items: [old] }))
    const store = await InviteStore.load(dir, BAND)
    const hit = store.check('oldTokenOldTokenOldToken', NOW).invite
    expect(hit?.kind).toBe('member')
    expect(hit?.bandId).toBe(BAND)
  })

  it('counts the usable invites of their maker', async () => {
    const store = await InviteStore.load(dir)
    await store.create(BODY, 'lead1', NOW)
    const b = await store.create(BODY, 'lead1', NOW)
    await store.create(BODY, 'other', NOW)
    await store.revoke(b.invite.id)
    expect(store.usableBy('lead1', NOW)).toBe(1)
  })

  it('forgets the invites of a deleted band', async () => {
    const store = await InviteStore.load(dir)
    await store.create(BODY, 'lead1', NOW)
    await store.create({ ...BODY, kind: 'leader', bandId: null }, 'admin1', NOW)
    await store.forgetBand(BAND)
    expect(store.list().map((i) => i.kind)).toEqual(['leader'])
  })
})

describe('parsing', () => {
  it('checks the join body and the new band name', () => {
    expect(parseJoin({ token: 'ABCDE-FGHJK' }).ok).toBe(true)
    expect(parseJoin({ token: 'ABCDE-FGHJK', bandName: '  夜行者 ' })).toEqual({
      ok: true,
      value: { token: 'ABCDE-FGHJK', bandName: '夜行者' },
    })
    expect(parseJoin({ token: 'ABCDE-FGHJK', bandName: 'x'.repeat(41) }).ok).toBe(false)
    expect(parseJoin({ token: '<script>' }).ok).toBe(false)
  })

  it('accepts a valid body and trims the note', () => {
    const r = parseNewInvite({
      kind: 'member',
      bandId: BAND,
      days: 30,
      maxUses: null,
      instrument: 'drums',
      libraryAccess: true,
      note: '  给鼓手 ',
    })
    expect(r).toEqual({
      ok: true,
      value: {
        kind: 'member',
        bandId: BAND,
        days: 30,
        maxUses: null,
        instrument: 'drums',
        libraryAccess: true,
        note: '给鼓手',
      },
    })
  })

  it('a leader invite has no band; a member invite needs one', () => {
    const base = { days: 7, maxUses: 1, instrument: null, libraryAccess: false, note: '' }
    const leader = parseNewInvite({ ...base, kind: 'leader', bandId: BAND })
    expect(leader.ok && leader.value.bandId).toBe(null)
    expect(parseNewInvite({ ...base, kind: 'member', bandId: null }).ok).toBe(false)
    expect(parseNewInvite({ ...base, kind: 'member', bandId: '../x' }).ok).toBe(false)
    expect(parseNewInvite({ ...base, kind: 'boss', bandId: BAND }).ok).toBe(false)
  })

  it('rejects out-of-range or wrong-typed fields', () => {
    const base = { kind: 'member', bandId: BAND, days: 7, maxUses: 1, instrument: null, libraryAccess: false, note: '' }
    expect(parseNewInvite(base).ok).toBe(true)
    expect(parseNewInvite({ ...base, days: 0 }).ok).toBe(false)
    expect(parseNewInvite({ ...base, days: 91 }).ok).toBe(false)
    expect(parseNewInvite({ ...base, days: 1.5 }).ok).toBe(false)
    expect(parseNewInvite({ ...base, days: '7' }).ok).toBe(false)
    expect(parseNewInvite({ ...base, maxUses: 51 }).ok).toBe(false)
    expect(parseNewInvite({ ...base, maxUses: 0 }).ok).toBe(false)
    expect(parseNewInvite({ ...base, instrument: 'piano' }).ok).toBe(false)
    expect(parseNewInvite({ ...base, libraryAccess: 'yes' }).ok).toBe(false)
    expect(parseNewInvite({ ...base, note: 'x'.repeat(101) }).ok).toBe(false)
    expect(parseNewInvite(null).ok).toBe(false)
  })

  it('checks the accept body shape', () => {
    const ok = {
      token: 'abcdefghijklmnop',
      username: 'drummer',
      displayName: '鼓手',
      password: '123456',
      instrument: null,
    }
    expect(parseAccept(ok).ok).toBe(true)
    expect(parseAccept({ ...ok, token: 'short' }).ok).toBe(false)
    expect(parseAccept({ ...ok, token: 'abc/def/ghi/jkl/mno' }).ok).toBe(false)
    expect(parseAccept({ ...ok, instrument: 'piano' }).ok).toBe(false)
    expect(parseAccept({ ...ok, username: 5 }).ok).toBe(false)
  })

  it('makes a member from an invite, with the instrument the person picked (none when 不选)', () => {
    const invite = {
      id: '000000000001',
      kind: 'member' as const,
      bandId: BAND,
      createdBy: 'admin1',
      createdAt: NOW,
      expiresAt: null,
      maxUses: null,
      uses: 0,
      usedBy: [],
      instrument: 'bass' as const,
      libraryAccess: true,
      note: '',
      revoked: false,
    }
    const body = {
      token: 'abcdefghijklmnop',
      username: 'b',
      displayName: 'B',
      password: '123456',
      instrument: null,
    }
    expect(newUserFromInvite(invite, body)).toEqual({
      username: 'b',
      displayName: 'B',
      password: '123456',
      role: 'member',
      libraryAccess: true,
      instrument: null,
    })
    expect(newUserFromInvite(invite, { ...body, instrument: 'keys' }).instrument).toBe('keys')
  })
})
