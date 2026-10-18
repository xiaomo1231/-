/**
 * Accounts of the score server (谱库服务): scrypt password hashing, validation
 * of the account forms, the user store (SCORES_DATA/users.json) and signed
 * session tokens. Validation and token code are pure so they can be tested
 * directly; the store runs every write through one serial queue and saves
 * atomically, so a failed write leaves the accounts as they were.
 */
import { createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  Instrument,
  LoginBody,
  NewUserBody,
  Role,
  UpdateMeBody,
  UpdateUserBody,
  UserInfo,
} from '../src/songs/scoreServerTypes'
import { createSerialQueue, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

// ---------------------------------------------------------------------------
// passwords
// ---------------------------------------------------------------------------

const SCRYPT_N = 16384
const SCRYPT_R = 8
const SCRYPT_P = 1
const SCRYPT_KEYLEN = 32
const SALT_BYTES = 16
const SCRYPT_MAXMEM = 64 * 1024 * 1024

const scryptAsync = (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: { N: number; r: number; p: number; maxmem: number },
): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  )

/** `scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>` — a fresh random salt on every call. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES)
  const hash = await scryptAsync(password, salt, SCRYPT_KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
    maxmem: SCRYPT_MAXMEM,
  })
  return `scrypt$${SCRYPT_N}$${SCRYPT_R}$${SCRYPT_P}$${salt.toString('hex')}$${hash.toString('hex')}`
}

const HEX_EVEN_RE = /^(?:[0-9a-f]{2})+$/

/** True when `password` matches the stored hash. Malformed stored values are simply false. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const N = Number(parts[1])
  const r = Number(parts[2])
  const p = Number(parts[3])
  if (![N, r, p].every((n) => Number.isSafeInteger(n) && n > 0)) return false
  const saltHex = parts[4] ?? ''
  const hashHex = parts[5] ?? ''
  if (!HEX_EVEN_RE.test(saltHex) || !HEX_EVEN_RE.test(hashHex)) return false
  const expected = Buffer.from(hashHex, 'hex')
  try {
    const actual = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length, {
      N,
      r,
      p,
      maxmem: SCRYPT_MAXMEM,
    })
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** A hash of a random string, computed once: checked against when a login name is unknown, so timing stays similar. */
let decoy: Promise<string> | undefined
const decoyHash = (): Promise<string> =>
  (decoy ??= hashPassword(randomBytes(16).toString('hex')))

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

/** A stored account: never sent to the page (use publicUser). */
export interface StoredUser extends UserInfo {
  passwordHash: string
  /** Bumped on a password change; a session carrying an older version is no longer valid. */
  sessionVersion: number
}

export const INSTRUMENTS: readonly Instrument[] = ['guitar', 'bass', 'drums', 'keys', 'vocal', 'other']
const ROLES: readonly Role[] = ['admin', 'member']
const USERNAME_RE = /^[\p{L}\p{N}_-]+$/u
const ID_RE = /^[0-9a-f]{12}$/
const USERS_FILE = 'users.json'
const STORE_VERSION = 1
const BOOTSTRAP_ADMIN = 'admin'

/** What the page may know about an account (drops the password hash and session version). */
export function publicUser(u: StoredUser): UserInfo {
  return {
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    libraryAccess: u.role === 'admin' ? true : u.libraryAccess,
    instrument: u.instrument,
    createdAt: u.createdAt,
  }
}

/** An error the route can show as is: the message is Chinese, `status` is the HTTP code. */
export class UserError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'UserError'
    this.status = status
  }
}

const good = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const charLen = (s: string): number => [...s].length
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const adminCount = (users: readonly StoredUser[]): number =>
  users.filter((u) => u.role === 'admin').length

const USERNAME_HINT = '用户名需要 2–32 个字符，只能包含字母、数字、下划线、连字符或汉字。'
const PASSWORD_HINT = '密码需要 6–128 个字符。'

function checkUsername(v: unknown, existing: readonly StoredUser[]): ParseResult<string> {
  if (typeof v !== 'string') return fail(USERNAME_HINT)
  const s = v.trim()
  const n = charLen(s)
  if (n < 2 || n > 32 || !USERNAME_RE.test(s)) return fail(USERNAME_HINT)
  const lower = s.toLowerCase()
  if (existing.some((u) => u.username.toLowerCase() === lower))
    return fail('这个用户名已经有人用了。')
  return good(s)
}

function checkDisplayName(v: unknown): ParseResult<string> {
  if (typeof v !== 'string') return fail('显示名称需要 1–32 个字符。')
  const s = v.trim()
  const n = charLen(s)
  if (n < 1 || n > 32) return fail('显示名称需要 1–32 个字符。')
  return good(s)
}

function checkPassword(v: unknown): ParseResult<string> {
  if (typeof v !== 'string' || v.length > 512) return fail(PASSWORD_HINT)
  const n = charLen(v)
  if (n < 6 || n > 128) return fail(PASSWORD_HINT)
  return good(v)
}

function checkRole(v: unknown): ParseResult<Role> {
  if (typeof v === 'string' && (ROLES as readonly string[]).includes(v)) return good(v as Role)
  return fail('账号类型只能是管理员或成员。')
}

function checkInstrument(v: unknown): ParseResult<Instrument | null> {
  if (v === null) return good(null)
  if (typeof v === 'string' && (INSTRUMENTS as readonly string[]).includes(v))
    return good(v as Instrument)
  return fail('乐器选择不对。')
}

function checkBool(v: unknown, label: string): ParseResult<boolean> {
  return typeof v === 'boolean' ? good(v) : fail(`${label}必须是是或否。`)
}

/** Validates the body of POST /api/users (admin). Admins always get library access. */
export function parseNewUser(
  body: unknown,
  existing: readonly StoredUser[],
): ParseResult<NewUserBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  const username = checkUsername(b.username, existing)
  if (!username.ok) return username
  const displayName = checkDisplayName(b.displayName)
  if (!displayName.ok) return displayName
  const password = checkPassword(b.password)
  if (!password.ok) return password
  const role = checkRole(b.role)
  if (!role.ok) return role
  const library = checkBool(b.libraryAccess, '谱库权限')
  if (!library.ok) return library
  const instrument = checkInstrument(b.instrument)
  if (!instrument.ok) return instrument
  return good({
    username: username.value,
    displayName: displayName.value,
    password: password.value,
    role: role.value,
    libraryAccess: role.value === 'admin' ? true : library.value,
    instrument: instrument.value,
  })
}

/** Validates the body of POST /api/users/update (admin): only the fields given are returned. */
export function parseUpdateUser(
  body: unknown,
  existing: readonly StoredUser[],
): ParseResult<UpdateUserBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  const id = b.id
  const target = typeof id === 'string' ? existing.find((u) => u.id === id) : undefined
  if (!target) return fail('找不到这个账号。')
  const out: UpdateUserBody = { id: target.id }
  if (b.displayName !== undefined) {
    const r = checkDisplayName(b.displayName)
    if (!r.ok) return r
    out.displayName = r.value
  }
  if (b.role !== undefined) {
    const r = checkRole(b.role)
    if (!r.ok) return r
    out.role = r.value
  }
  if (b.libraryAccess !== undefined) {
    const r = checkBool(b.libraryAccess, '谱库权限')
    if (!r.ok) return r
    out.libraryAccess = r.value
  }
  if (b.instrument !== undefined) {
    const r = checkInstrument(b.instrument)
    if (!r.ok) return r
    out.instrument = r.value
  }
  if (b.password !== undefined) {
    const r = checkPassword(b.password)
    if (!r.ok) return r
    out.password = r.value
  }
  if ((out.role ?? target.role) === 'admin') out.libraryAccess = true
  return good(out)
}

/** Validates the body of POST /api/me/update: a member's own name, instrument and password change. */
export function parseUpdateMe(body: unknown): ParseResult<UpdateMeBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  const out: UpdateMeBody = {}
  if (b.displayName !== undefined) {
    const r = checkDisplayName(b.displayName)
    if (!r.ok) return r
    out.displayName = r.value
  }
  if (b.instrument !== undefined) {
    const r = checkInstrument(b.instrument)
    if (!r.ok) return r
    out.instrument = r.value
  }
  if (b.newPassword !== undefined) {
    const r = checkPassword(b.newPassword)
    if (!r.ok) return r
    if (typeof b.oldPassword !== 'string' || b.oldPassword === '')
      return fail('修改密码需要填写原密码。')
    out.newPassword = r.value
    out.oldPassword = b.oldPassword
  }
  return good(out)
}

/** Validates the body of POST /api/login. */
export function parseLogin(body: unknown): ParseResult<LoginBody> {
  const b = asRecord(body)
  if (!b) return fail('请输入用户名和密码。')
  const u = b.username
  const p = b.password
  if (typeof u !== 'string' || u.trim() === '' || u.length > 64) return fail('请输入用户名和密码。')
  if (typeof p !== 'string' || p === '' || p.length > 1024) return fail('请输入用户名和密码。')
  return good({ username: u.trim(), password: p })
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

const corruptError = (file: string): Error =>
  new Error(
    `账号文件 ${file} 已损坏或格式不对，无法读取。服务不会自动重置账号，` +
      '请检查该文件或从备份恢复后再启动。',
  )

function isStoredUser(v: unknown): v is StoredUser {
  if (!v || typeof v !== 'object') return false
  const u = v as Record<string, unknown>
  return (
    typeof u.id === 'string' &&
    ID_RE.test(u.id) &&
    typeof u.username === 'string' &&
    typeof u.displayName === 'string' &&
    (u.role === 'admin' || u.role === 'member') &&
    typeof u.libraryAccess === 'boolean' &&
    (u.instrument === null || INSTRUMENTS.includes(u.instrument as Instrument)) &&
    typeof u.createdAt === 'number' &&
    Number.isFinite(u.createdAt) &&
    typeof u.passwordHash === 'string' &&
    u.passwordHash.startsWith('scrypt$') &&
    typeof u.sessionVersion === 'number' &&
    Number.isSafeInteger(u.sessionVersion) &&
    u.sessionVersion >= 0
  )
}

/** Reads and checks users.json; any problem throws (accounts are never silently reset). */
function parseStoreText(text: string, file: string): StoredUser[] {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw corruptError(file)
  }
  const obj = asRecord(raw)
  if (!obj || obj.version !== STORE_VERSION || !Array.isArray(obj.users)) throw corruptError(file)
  const list: unknown[] = obj.users
  if (!list.every(isStoredUser)) throw corruptError(file)
  const users = list as StoredUser[]
  const ids = new Set<string>()
  const names = new Set<string>()
  for (const u of users) {
    const lower = u.username.toLowerCase()
    if (ids.has(u.id) || names.has(lower)) throw corruptError(file)
    ids.add(u.id)
    names.add(lower)
  }
  if (!users.some((u) => u.role === 'admin')) throw corruptError(file)
  return users
}

async function saveUsers(dir: string, users: readonly StoredUser[]): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
  const data = { version: STORE_VERSION, users }
  await writeFileAtomic(path.join(dir, USERS_FILE), JSON.stringify(data))
}

/** A 12-hex-char id not used by any account yet. */
function freshId(users: readonly StoredUser[]): string {
  const taken = new Set(users.map((u) => u.id))
  for (;;) {
    const id = randomBytes(6).toString('hex')
    if (!taken.has(id)) return id
  }
}

export class UserStore {
  private users: StoredUser[]
  private readonly dir: string
  private readonly enqueue = createSerialQueue()

  private constructor(dir: string, users: StoredUser[]) {
    this.dir = dir
    this.users = users
  }

  /**
   * Opens the store. A missing file creates the first admin (password = the
   * bootstrap password). A damaged file throws; it is never reset.
   */
  static async load(dataDir: string, bootstrapPassword: string): Promise<UserStore> {
    const file = path.join(dataDir, USERS_FILE)
    let text: string | null
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      text = null
    }
    if (text === null) {
      const admin: StoredUser = {
        id: freshId([]),
        username: BOOTSTRAP_ADMIN,
        displayName: '管理员',
        role: 'admin',
        libraryAccess: true,
        instrument: null,
        createdAt: Date.now(),
        passwordHash: await hashPassword(bootstrapPassword),
        sessionVersion: 0,
      }
      await saveUsers(dataDir, [admin])
      console.log(
        '已创建管理员账号：用户名 admin，初始密码为环境变量 SCORES_PASSWORD 的值。请登录后尽快修改密码。',
      )
      return new UserStore(dataDir, [admin])
    }
    return new UserStore(dataDir, parseStoreText(text, file))
  }

  /** All accounts (no secrets), in creation order. */
  list(): UserInfo[] {
    return this.sorted().map(publicUser)
  }

  /** The stored account with this id, including its password hash. */
  get(id: string): StoredUser | undefined {
    return this.users.find((u) => u.id === id)
  }

  /** Id of the first administrator. */
  adminId(): string {
    const admin = this.sorted().find((u) => u.role === 'admin')
    if (!admin) throw new Error('账号文件里没有管理员账号。')
    return admin.id
  }

  /** The account for a login, or null. Username is case-insensitive; a wrong password gives null too. */
  async login(username: string, password: string): Promise<StoredUser | null> {
    const key = username.trim().toLowerCase()
    const user = this.users.find((u) => u.username.toLowerCase() === key)
    // Always run one scrypt check so an unknown name takes about as long as a known one.
    const stored = user ? user.passwordHash : await decoyHash()
    const ok = await verifyPassword(password, stored)
    return user && ok ? user : null
  }

  /** Admin: a new account. Throws UserError (400) on invalid input or a taken name. */
  async create(body: NewUserBody): Promise<UserInfo> {
    return this.mutate(async (current) => {
      const r = parseNewUser(body, current)
      if (!r.ok) throw new UserError(r.error, 400)
      const v = r.value
      const user: StoredUser = {
        id: freshId(current),
        username: v.username,
        displayName: v.displayName,
        role: v.role,
        libraryAccess: v.libraryAccess,
        instrument: v.instrument,
        createdAt: Date.now(),
        passwordHash: await hashPassword(v.password),
        sessionVersion: 0,
      }
      const next = [...current, user]
      return { next, result: publicUser(user) }
    })
  }

  /**
   * Admin: change fields of an account. A password change also bumps its
   * sessionVersion (signing it out everywhere). The last admin cannot be demoted.
   */
  async update(body: UpdateUserBody): Promise<UserInfo> {
    return this.mutate(async (current) => {
      const id = body && typeof body.id === 'string' ? body.id : ''
      const target = current.find((u) => u.id === id)
      if (!target) throw new UserError('找不到这个账号。', 404)
      const r = parseUpdateUser(body, current)
      if (!r.ok) throw new UserError(r.error, 400)
      const v = r.value
      const role = v.role ?? target.role
      if (target.role === 'admin' && role !== 'admin' && adminCount(current) <= 1)
        throw new UserError('不能降级最后一个管理员。', 400)
      const updated: StoredUser = {
        ...target,
        displayName: v.displayName ?? target.displayName,
        role,
        libraryAccess: role === 'admin' ? true : (v.libraryAccess ?? target.libraryAccess),
        instrument: v.instrument !== undefined ? v.instrument : target.instrument,
      }
      if (v.password !== undefined) {
        updated.passwordHash = await hashPassword(v.password)
        updated.sessionVersion = target.sessionVersion + 1
      }
      const next = current.map((u) => (u.id === target.id ? updated : u))
      return { next, result: publicUser(updated) }
    })
  }

  /** Admin: remove an account. The last admin cannot be removed. */
  async remove(id: string): Promise<void> {
    await this.mutate(async (current) => {
      const target = current.find((u) => u.id === id)
      if (!target) throw new UserError('找不到这个账号。', 404)
      if (target.role === 'admin' && adminCount(current) <= 1)
        throw new UserError('不能删除最后一个管理员。', 400)
      return { next: current.filter((u) => u.id !== id), result: undefined }
    })
  }

  /** A signed-in account's own name, instrument and password. A password change needs the old one and bumps sessionVersion. */
  async updateMe(id: string, body: UpdateMeBody): Promise<UserInfo> {
    return this.mutate(async (current) => {
      const target = current.find((u) => u.id === id)
      if (!target) throw new UserError('找不到这个账号。', 404)
      const r = parseUpdateMe(body)
      if (!r.ok) throw new UserError(r.error, 400)
      const v = r.value
      const updated: StoredUser = {
        ...target,
        displayName: v.displayName ?? target.displayName,
        instrument: v.instrument !== undefined ? v.instrument : target.instrument,
      }
      if (v.newPassword !== undefined) {
        const oldOk =
          v.oldPassword !== undefined && (await verifyPassword(v.oldPassword, target.passwordHash))
        if (!oldOk) throw new UserError('原密码不对。', 400)
        updated.passwordHash = await hashPassword(v.newPassword)
        updated.sessionVersion = target.sessionVersion + 1
      }
      const next = current.map((u) => (u.id === target.id ? updated : u))
      return { next, result: publicUser(updated) }
    })
  }

  private sorted(): StoredUser[] {
    return [...this.users].sort((a, b) => a.createdAt - b.createdAt)
  }

  /** Runs one write after the others: checks and builds the next list, saves it, then swaps it in. */
  private mutate<T>(
    task: (current: readonly StoredUser[]) => Promise<{ next: StoredUser[]; result: T }>,
  ): Promise<T> {
    return this.enqueue(async () => {
      const { next, result } = await task(this.users)
      await saveUsers(this.dir, next)
      this.users = next
      return result
    })
  }
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

const SESSION_RE = /^([0-9a-f]{12})\.(\d{1,16})\.(\d{1,16})\.([0-9a-f]{32})\.([0-9a-f]{64})$/

const sessionMac = (secret: Buffer, body: string): string =>
  createHmac('sha256', secret).update(body, 'utf8').digest('hex')

/**
 * A signed session token: `<userId>.<sessionVersion>.<expiresMs>.<16 random bytes hex>.<hmac>`,
 * where hmac = HMAC-SHA256(secret, everything before the last dot).
 */
export function createSession(
  secret: Buffer,
  user: { id: string; sessionVersion: number },
  now: number,
  maxAgeMs: number,
): string {
  if (!ID_RE.test(user.id)) throw new Error('账号编号不对，无法创建登录状态。')
  if (!Number.isSafeInteger(user.sessionVersion) || user.sessionVersion < 0)
    throw new Error('账号版本不对，无法创建登录状态。')
  const expires = Math.trunc(now + maxAgeMs)
  if (!Number.isSafeInteger(expires)) throw new Error('登录有效期不对。')
  const body = [user.id, String(user.sessionVersion), String(expires), randomBytes(16).toString('hex')].join('.')
  return `${body}.${sessionMac(secret, body)}`
}

/**
 * Checks a session token: format, signature (constant time), then expiry.
 * Returns the user id and the version it was issued for, or null. The caller
 * still checks that the account exists and that the version is current.
 */
export function verifySession(
  token: string | undefined,
  secret: Buffer,
  now: number,
): { userId: string; version: number } | null {
  if (!token) return null
  const m = SESSION_RE.exec(token)
  if (!m) return null
  const userId = m[1] ?? ''
  const versionText = m[2] ?? ''
  const expiresText = m[3] ?? ''
  const mac = m[5] ?? ''
  const body = token.slice(0, token.lastIndexOf('.'))
  const expected = Buffer.from(sessionMac(secret, body), 'hex')
  if (!timingSafeEqual(Buffer.from(mac, 'hex'), expected)) return null
  const version = Number(versionText)
  const expires = Number(expiresText)
  if (!Number.isSafeInteger(version) || !Number.isSafeInteger(expires)) return null
  if (now >= expires) return null
  return { userId, version }
}
