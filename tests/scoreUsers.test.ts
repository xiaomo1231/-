// @vitest-environment node
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createSession,
  hashPassword,
  parseLogin,
  parseNewUser,
  parseUpdateMe,
  parseUpdateUser,
  publicUser,
  UserError,
  UserStore,
  verifyPassword,
  verifySession,
  type StoredUser,
} from '../server/users'
import type { NewUserBody } from '../src/songs/scoreServerTypes'

const SECRET = Buffer.from('test-secret-for-sessions-0123456789')
const DAY = 24 * 60 * 60 * 1000

let root: string
let counter = 0

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'scores-users-'))
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
  fs.rmSync(root, { recursive: true, force: true })
})

/** A fresh, empty data directory for each store test. */
function newDir(): string {
  const dir = path.join(root, `d${counter++}`)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

const member = (over: Partial<NewUserBody> = {}): NewUserBody => ({
  username: 'alice',
  displayName: 'Alice',
  password: 'secret1',
  role: 'member',
  libraryAccess: false,
  instrument: 'guitar',
  ...over,
})

/** A stored user for the pure validators. */
function stored(over: Partial<StoredUser> = {}): StoredUser {
  return {
    id: '0123456789ab',
    username: 'bob',
    displayName: 'Bob',
    role: 'member',
    libraryAccess: false,
    instrument: null,
    createdAt: 1,
    invitedBy: null,
    disabled: false,
    passwordHash: 'scrypt$16384$8$1$00$00',
    sessionVersion: 0,
    ...over,
  }
}

describe('password hashing', () => {
  it('hashes in the documented format and verifies only the right password', async () => {
    const h = await hashPassword('correct horse')
    expect(h.startsWith('scrypt$16384$8$1$')).toBe(true)
    expect(h.split('$')).toHaveLength(6)
    expect(await verifyPassword('correct horse', h)).toBe(true)
    expect(await verifyPassword('wrong horse', h)).toBe(false)
  })

  it('uses a fresh salt every time', async () => {
    const a = await hashPassword('same-password')
    const b = await hashPassword('same-password')
    expect(a).not.toBe(b)
  })

  it('returns false for malformed stored values', async () => {
    expect(await verifyPassword('x', '')).toBe(false)
    expect(await verifyPassword('x', 'bcrypt$10$abc')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$16384$8$1$zz$00')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$16384$8$1$00$0')).toBe(false)
    expect(await verifyPassword('x', 'scrypt$0$8$1$00$00')).toBe(false)
  })
})

describe('validation', () => {
  it('accepts a valid new user and normalizes it', () => {
    const r = parseNewUser({ ...member(), displayName: '  Alice  ', username: ' 张三_1 ' }, [])
    expect(r).toEqual({
      ok: true,
      value: { ...member(), displayName: 'Alice', username: '张三_1' },
    })
  })

  it('rejects bad usernames', () => {
    for (const username of ['a', 'a'.repeat(33), 'a b', 'a.b', 'x@y', '']) {
      expect(parseNewUser({ ...member(), username }, []).ok).toBe(false)
    }
  })

  it('rejects a username already taken, ignoring case', () => {
    const existing = [stored({ username: 'Alice' })]
    expect(parseNewUser(member({ username: 'alice' }), existing).ok).toBe(false)
  })

  it('rejects an empty display name after trimming', () => {
    expect(parseNewUser({ ...member(), displayName: '   ' }, []).ok).toBe(false)
    expect(parseNewUser({ ...member(), displayName: 'a'.repeat(33) }, []).ok).toBe(false)
  })

  it('checks password length 6–128', () => {
    expect(parseNewUser({ ...member(), password: '12345' }, []).ok).toBe(false)
    expect(parseNewUser({ ...member(), password: '123456' }, []).ok).toBe(true)
    expect(parseNewUser({ ...member(), password: 'p'.repeat(128) }, []).ok).toBe(true)
    expect(parseNewUser({ ...member(), password: 'p'.repeat(129) }, []).ok).toBe(false)
  })

  it('checks role and instrument values', () => {
    expect(parseNewUser({ ...member(), role: 'root' }, []).ok).toBe(false)
    expect(parseNewUser({ ...member(), instrument: 'trumpet' }, []).ok).toBe(false)
    expect(parseNewUser({ ...member(), instrument: null }, []).ok).toBe(true)
  })

  it('forces library access for admins', () => {
    const r = parseNewUser({ ...member(), role: 'admin', libraryAccess: false }, [])
    expect(r.ok && r.value.libraryAccess).toBe(true)
  })

  it('validates update bodies and returns only the given fields', () => {
    const existing = [stored({ role: 'admin' })]
    const r = parseUpdateUser({ id: '0123456789ab', displayName: ' Robert ', libraryAccess: false }, existing)
    expect(r).toEqual({
      ok: true,
      value: { id: '0123456789ab', displayName: 'Robert', libraryAccess: true },
    })
    expect(parseUpdateUser({ id: 'ffffffffffff' }, existing).ok).toBe(false)
    expect(parseUpdateUser({ id: '0123456789ab', password: '1' }, existing).ok).toBe(false)
  })

  it('requires the old password with a new one in parseUpdateMe', () => {
    expect(parseUpdateMe({ newPassword: 'newpass1' }).ok).toBe(false)
    expect(parseUpdateMe({ newPassword: 'newpass1', oldPassword: '' }).ok).toBe(false)
    expect(parseUpdateMe({ displayName: 'Z', instrument: 'keys' })).toEqual({
      ok: true,
      value: { displayName: 'Z', instrument: 'keys' },
    })
  })

  it('checks login bodies', () => {
    expect(parseLogin({ username: '', password: 'x' }).ok).toBe(false)
    expect(parseLogin({ username: 'a', password: '' }).ok).toBe(false)
    expect(parseLogin({ username: ' a ', password: 'x' })).toEqual({
      ok: true,
      value: { username: 'a', password: 'x' },
    })
  })

  it('publicUser drops the secrets', () => {
    const u = publicUser(stored({ role: 'admin', libraryAccess: false }))
    expect(Object.keys(u).sort()).toEqual(
      [
        'createdAt',
        'disabled',
        'displayName',
        'id',
        'instrument',
        'invitedBy',
        'libraryAccess',
        'role',
        'username',
      ].sort(),
    )
    expect(u.libraryAccess).toBe(true)
  })
})

describe('UserStore', () => {
  it('creates the bootstrap admin on first load and reloads it', async () => {
    const dir = newDir()
    const store = await UserStore.load(dir, 'boot-pass')
    const list = store.list()
    expect(list).toHaveLength(1)
    expect(list[0]).toMatchObject({ username: 'admin', displayName: '管理员', role: 'admin' })
    expect(store.adminId()).toBe(list[0]!.id)
    const file = fs.readFileSync(path.join(dir, 'users.json'), 'utf8')
    expect(file).not.toContain('boot-pass')
    expect(JSON.parse(file).version).toBe(1)

    const again = await UserStore.load(dir, 'other')
    expect(await again.login('admin', 'boot-pass')).not.toBeNull()
  })

  it('refuses a damaged users.json instead of resetting it', async () => {
    const dir = newDir()
    fs.writeFileSync(path.join(dir, 'users.json'), '{not json')
    await expect(UserStore.load(dir, 'x')).rejects.toThrow(/已损坏/)
    fs.writeFileSync(path.join(dir, 'users.json'), JSON.stringify({ version: 1, users: [] }))
    await expect(UserStore.load(dir, 'x')).rejects.toThrow(/已损坏/)
  })

  it('logs in case-insensitively and rejects wrong passwords and unknown names', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    await store.create(member({ username: 'Alice', password: 'secret1' }))
    expect((await store.login('alice', 'secret1'))?.username).toBe('Alice')
    expect((await store.login('ALICE', 'secret1'))?.username).toBe('Alice')
    expect(await store.login('alice', 'wrong-one')).toBeNull()
    expect(await store.login('nobody', 'secret1')).toBeNull()
  })

  it('rejects a duplicate username (case-insensitive) with a 400 UserError', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    await store.create(member({ username: 'alice' }))
    const err = await store.create(member({ username: 'ALICE' })).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(UserError)
    expect((err as UserError).status).toBe(400)
    expect(store.list()).toHaveLength(2)
  })

  it('create returns no secrets and keeps creation order', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const u = await store.create(member({ username: 'bob', displayName: 'Bob' }))
    expect(u).not.toHaveProperty('passwordHash')
    expect(store.list().map((x) => x.username)).toEqual(['admin', 'bob'])
    expect(JSON.stringify(store.list())).not.toContain('passwordHash')
  })

  it('a password change bumps sessionVersion and replaces the old password', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const u = await store.create(member())
    expect(store.get(u.id)?.sessionVersion).toBe(0)
    await store.update({ id: u.id, password: 'brand-new' })
    expect(store.get(u.id)?.sessionVersion).toBe(1)
    expect(await store.login('alice', 'secret1')).toBeNull()
    expect(await store.login('alice', 'brand-new')).not.toBeNull()
  })

  it('update of an unknown id is a 404', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const err = await store.update({ id: 'ffffffffffff', displayName: 'X' }).catch((e: unknown) => e)
    expect((err as UserError).status).toBe(404)
  })

  it('protects the last admin from demotion and removal', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const adminId = store.adminId()
    const demote = await store.update({ id: adminId, role: 'member' }).catch((e: unknown) => e)
    expect(demote).toBeInstanceOf(UserError)
    expect((demote as UserError).status).toBe(400)
    await expect(store.remove(adminId)).rejects.toBeInstanceOf(UserError)

    const second = await store.create(member({ username: 'second', role: 'admin' }))
    await store.update({ id: adminId, role: 'member' })
    expect(store.get(adminId)?.role).toBe('member')
    await expect(store.update({ id: second.id, role: 'member' })).rejects.toBeInstanceOf(UserError)
    await expect(store.remove(second.id)).rejects.toBeInstanceOf(UserError)
  })

  it('remove an unknown id is a 404 and a normal removal works', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const u = await store.create(member())
    await expect(store.remove('ffffffffffff')).rejects.toMatchObject({ status: 404 })
    await store.remove(u.id)
    expect(store.list().map((x) => x.username)).toEqual(['admin'])
  })

  it('updateMe checks the old password and bumps sessionVersion', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const u = await store.create(member())
    await expect(
      store.updateMe(u.id, { oldPassword: 'nope-nope', newPassword: 'newpass1' }),
    ).rejects.toMatchObject({ message: '原密码不对。', status: 400 })
    expect(store.get(u.id)?.sessionVersion).toBe(0)

    const me = await store.updateMe(u.id, {
      displayName: 'Alicia',
      instrument: 'keys',
      oldPassword: 'secret1',
      newPassword: 'newpass1',
    })
    expect(me).toMatchObject({ displayName: 'Alicia', instrument: 'keys' })
    expect(store.get(u.id)?.sessionVersion).toBe(1)
    expect(await store.login('alice', 'newpass1')).not.toBeNull()
  })

  it('updateMe without a password change does not bump sessionVersion', async () => {
    const store = await UserStore.load(newDir(), 'boot-pass')
    const u = await store.create(member())
    await store.updateMe(u.id, { displayName: 'Ali' })
    expect(store.get(u.id)?.sessionVersion).toBe(0)
  })
})

describe('sessions', () => {
  const user = { id: '0123456789ab', sessionVersion: 3 }

  it('creates a token that verifies to the same user and version', () => {
    const token = createSession(SECRET, user, 1000, DAY)
    expect(token.split('.')).toHaveLength(5)
    expect(verifySession(token, SECRET, 1000)).toEqual({ userId: user.id, version: 3 })
  })

  it('rejects a tampered token', () => {
    const token = createSession(SECRET, user, 1000, DAY)
    const flipped = token.slice(0, -1) + (token.endsWith('0') ? '1' : '0')
    expect(verifySession(flipped, SECRET, 1000)).toBeNull()
    const otherUser = '1' + token.slice(1)
    expect(verifySession(otherUser, SECRET, 1000)).toBeNull()
    const bumpedVersion = token.replace('.3.', '.4.')
    expect(verifySession(bumpedVersion, SECRET, 1000)).toBeNull()
  })

  it('rejects an expired token', () => {
    const token = createSession(SECRET, user, 1000, DAY)
    expect(verifySession(token, SECRET, 1000 + DAY - 1)).not.toBeNull()
    expect(verifySession(token, SECRET, 1000 + DAY)).toBeNull()
  })

  it('rejects a token signed with another secret', () => {
    const token = createSession(Buffer.from('another-secret'), user, 1000, DAY)
    expect(verifySession(token, SECRET, 1000)).toBeNull()
  })

  it('rejects missing and malformed tokens', () => {
    expect(verifySession(undefined, SECRET, 0)).toBeNull()
    expect(verifySession('', SECRET, 0)).toBeNull()
    expect(verifySession('abc.def', SECRET, 0)).toBeNull()
    expect(verifySession(createSession(SECRET, user, 1000, DAY) + 'x', SECRET, 1000)).toBeNull()
  })

  it('refuses to create a token for a bad id', () => {
    expect(() => createSession(SECRET, { id: 'bad', sessionVersion: 0 }, 0, DAY)).toThrow()
  })
})
