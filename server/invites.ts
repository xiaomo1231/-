/**
 * Invites (邀请码 / 邀请链接) of the score server. An admin makes leader invites
 * (the person starts a band of his own) and a leader makes member invites of his
 * band. The code (XXXXX-XXXXX) is typed on the 注册 page or opened as a link; an
 * existing account can use one too, to join another band. Only a sha256 hash of
 * each code is stored (the code is shown once, at creation). Reserving a use,
 * confirming an account and releasing a use all run through one serial queue
 * and save atomically, like the other stores.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type {
  AcceptInviteBody,
  Instrument,
  InviteInfo,
  InviteKind,
  JoinInviteBody,
  NewInviteBody,
  NewInviteResult,
  NewUserBody,
} from '../src/songs/scoreServerTypes'
import { createSerialQueue, type ParseResult } from './favorites'
import { INSTRUMENTS } from './users'
import { writeFileAtomic } from './util'

export const INVITES_FILE = 'invites.json'
export const MAX_INVITES = 200

const INVITES_VERSION = 1
const DAY_MS = 86_400_000
const NOTE_MAX_CHARS = 100
const ID_RE = /^[0-9a-f]{12}$/
const HASH_RE = /^[0-9a-f]{64}$/
/** Old links' tokens (base64url) and the new codes (with or without the dash). */
const TOKEN_RE = /^[A-Za-z0-9_ -]{10,64}$/
const BAND_ID_RE = /^[0-9a-f]{12}$/
/** Crockford base32: no I, L, O, U. 10 characters = 50 bits. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'
const CODE_LENGTH = 10
const MAX_NAME_CHARS = 64
const MAX_PASSWORD_CHARS = 1024

const REASON_UNKNOWN = '这个邀请码不存在或已经失效。'
const REASON_REVOKED = '这个邀请码已经被作废了。'
const REASON_EXPIRED = '这个邀请码已经过期了。'
const REASON_USED_UP = '这个邀请码的名额已经用完了。'

/** An error the route can turn into an HTTP status and a Chinese message. */
export class InviteError extends Error {
  readonly status: number

  constructor(message: string, status = 400) {
    super(message)
    this.name = 'InviteError'
    this.status = status
  }
}

/** A stored invite: the public fields plus the token's hash. */
interface StoredInvite extends InviteInfo {
  tokenHash: string
}

type Items = readonly StoredInvite[]

const good = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const charLen = (s: string): number => [...s].length
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex')

/** A fresh code, shown as XXXXX-XXXXX. */
export function newCode(): string {
  const bytes = randomBytes(CODE_LENGTH)
  let out = ''
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[bytes[i]! % 32]
  return `${out.slice(0, 5)}-${out.slice(5)}`
}

/**
 * The stored form of a typed code: capitals, no dashes or spaces, and the letters
 * people mix up read as the digits they look like (O -> 0, I / L -> 1).
 */
export function normalizeCode(text: string): string {
  return text
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1')
}

/** Why an invite cannot be used now, or null when it can. */
function reasonFor(row: StoredInvite, now: number): string | null {
  if (row.revoked) return REASON_REVOKED
  if (row.expiresAt !== null && now >= row.expiresAt) return REASON_EXPIRED
  if (row.maxUses !== null && row.uses >= row.maxUses) return REASON_USED_UP
  return null
}

/** The page-facing shape: never the hash. */
function publicInvite(row: StoredInvite): InviteInfo {
  return {
    id: row.id,
    kind: row.kind,
    bandId: row.bandId,
    createdBy: row.createdBy,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    maxUses: row.maxUses,
    uses: row.uses,
    usedBy: [...row.usedBy],
    instrument: row.instrument,
    libraryAccess: row.libraryAccess,
    note: row.note,
    revoked: row.revoked,
  }
}

/** Drops the oldest unusable invites first, then the oldest, until the store is within MAX_INVITES. */
function trimRows(rows: Items, now: number): StoredInvite[] {
  const out = [...rows]
  while (out.length > MAX_INVITES) {
    const spent = out.findIndex((r) => reasonFor(r, now) !== null)
    out.splice(spent >= 0 ? spent : 0, 1)
  }
  return out
}

function freshId(rows: Items): string {
  const taken = new Set(rows.map((r) => r.id))
  for (;;) {
    const id = randomBytes(6).toString('hex')
    if (!taken.has(id)) return id
  }
}

function sanitizeRow(raw: unknown, defaultBandId: string | null): StoredInvite | null {
  const r = asRecord(raw)
  if (!r) return null
  const id = r.id
  const expiresAt = r.expiresAt
  const maxUses = r.maxUses
  const instrument = r.instrument
  if (typeof id !== 'string' || !ID_RE.test(id)) return null
  if (typeof r.createdBy !== 'string' || typeof r.createdAt !== 'number') return null
  if (!Number.isFinite(r.createdAt)) return null
  if (expiresAt !== null && (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)))
    return null
  if (
    maxUses !== null &&
    (typeof maxUses !== 'number' || !Number.isSafeInteger(maxUses) || maxUses < 1)
  )
    return null
  if (typeof r.uses !== 'number' || !Number.isSafeInteger(r.uses) || r.uses < 0) return null
  if (!Array.isArray(r.usedBy) || !r.usedBy.every((u) => typeof u === 'string')) return null
  if (instrument !== null && !INSTRUMENTS.includes(instrument as Instrument)) return null
  if (typeof r.libraryAccess !== 'boolean' || typeof r.revoked !== 'boolean') return null
  if (typeof r.note !== 'string') return null
  if (typeof r.tokenHash !== 'string' || !HASH_RE.test(r.tokenHash)) return null
  // Rows saved before leader invites join the first band.
  const kind: InviteKind = r.kind === 'leader' ? 'leader' : 'member'
  const bandId =
    kind === 'leader'
      ? null
      : typeof r.bandId === 'string' && BAND_ID_RE.test(r.bandId)
        ? r.bandId
        : defaultBandId
  if (kind === 'member' && !bandId) return null
  return {
    id,
    kind,
    bandId,
    createdBy: r.createdBy,
    createdAt: r.createdAt,
    expiresAt,
    maxUses,
    uses: r.uses,
    usedBy: [...r.usedBy] as string[],
    instrument: instrument as Instrument | null,
    libraryAccess: r.libraryAccess,
    note: [...r.note].slice(0, NOTE_MAX_CHARS).join(''),
    revoked: r.revoked,
    tokenHash: r.tokenHash,
  }
}

/** Validates the body of POST /api/invites (admin). */
export function parseNewInvite(body: unknown): ParseResult<NewInviteBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  const { days, maxUses, instrument, libraryAccess, note } = b
  const kind = b.kind === undefined ? 'member' : b.kind
  if (kind !== 'leader' && kind !== 'member') return fail('邀请的类型不对。')
  const bandId = kind === 'leader' ? null : b.bandId
  if (kind === 'member' && !(typeof bandId === 'string' && BAND_ID_RE.test(bandId)))
    return fail('请选择要邀请加入的乐队。')
  if (days !== null && !(Number.isInteger(days) && (days as number) >= 1 && (days as number) <= 90))
    return fail('有效期只能是 1–90 天，或永不过期。')
  if (
    maxUses !== null &&
    !(Number.isInteger(maxUses) && (maxUses as number) >= 1 && (maxUses as number) <= 50)
  )
    return fail('可用次数只能是 1–50 次，或不限。')
  if (
    instrument !== null &&
    !(typeof instrument === 'string' && INSTRUMENTS.includes(instrument as Instrument))
  )
    return fail('乐器选择不对。')
  if (typeof libraryAccess !== 'boolean') return fail('谱库权限必须是是或否。')
  if (typeof note !== 'string') return fail('备注必须是文字。')
  const trimmed = note.trim()
  if (charLen(trimmed) > NOTE_MAX_CHARS) return fail('备注最多 100 个字符。')
  return good({
    kind,
    bandId: bandId as string | null,
    days: days as number | null,
    maxUses: maxUses as number | null,
    instrument: instrument as Instrument | null,
    libraryAccess,
    note: trimmed,
  })
}

/** Validates the body of POST /api/invite/accept. Username and password rules are checked by UserStore. */
export function parseAccept(body: unknown): ParseResult<AcceptInviteBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(REASON_UNKNOWN)
  if (typeof b.username !== 'string' || charLen(b.username) > MAX_NAME_CHARS)
    return fail('用户名不对。')
  if (typeof b.displayName !== 'string' || charLen(b.displayName) > MAX_NAME_CHARS)
    return fail('显示名称需要 1–32 个字符。')
  if (typeof b.password !== 'string' || b.password.length > MAX_PASSWORD_CHARS)
    return fail('密码需要 6–128 个字符。')
  const instrument = b.instrument === undefined ? null : b.instrument
  if (
    instrument !== null &&
    !(typeof instrument === 'string' && INSTRUMENTS.includes(instrument as Instrument))
  )
    return fail('乐器选择不对。')
  const bandName = parseBandName(b.bandName)
  if (!bandName.ok) return bandName
  return good({
    token: b.token,
    username: b.username,
    displayName: b.displayName,
    password: b.password,
    instrument: instrument as Instrument | null,
    ...(bandName.value ? { bandName: bandName.value } : {}),
  })
}

/** An optional new band's name: absent, or 1-40 characters. */
function parseBandName(v: unknown): ParseResult<string | null> {
  if (v === undefined || v === null || v === '') return good(null)
  if (typeof v !== 'string') return fail('乐队名要在 1–40 个字符之间。')
  const t = v.trim()
  if (charLen(t) < 1 || charLen(t) > 40) return fail('乐队名要在 1–40 个字符之间。')
  return good(t)
}

/** Validates the body of POST /api/invite/join (signed in). */
export function parseJoin(body: unknown): ParseResult<JoinInviteBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  if (typeof b.token !== 'string' || !TOKEN_RE.test(b.token)) return fail(REASON_UNKNOWN)
  const bandName = parseBandName(b.bandName)
  if (!bandName.ok) return bandName
  return good({ token: b.token, ...(bandName.value ? { bandName: bandName.value } : {}) })
}

/**
 * The account an accepted invite creates: always a member, with the instrument the
 * person picked (the form starts from the invite's default; 不选 means none). Library
 * access, when the invite gives it, is granted once the account is in its band.
 */
export function newUserFromInvite(body: AcceptInviteBody): NewUserBody {
  return {
    username: body.username,
    displayName: body.displayName,
    password: body.password,
    role: 'member',
    libraryAccess: false,
    instrument: body.instrument,
  }
}

export class InviteStore {
  private rows: StoredInvite[]
  private readonly dataDir: string
  private readonly queue = createSerialQueue()

  private constructor(dataDir: string, rows: StoredInvite[]) {
    this.dataDir = dataDir
    this.rows = rows
  }

  /** Reads invites.json once. Missing is empty; damaged is set aside and the store starts empty. Old rows join `defaultBandId`. */
  static async load(dataDir: string, defaultBandId: string | null = null): Promise<InviteStore> {
    const file = path.join(dataDir, INVITES_FILE)
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new InviteStore(dataDir, [])
      throw err
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    const rec = asRecord(raw)
    if (!rec || rec.version !== INVITES_VERSION || !Array.isArray(rec.items)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] 邀请链接数据文件损坏，已改名保留并从空开始：${file}`)
      return new InviteStore(dataDir, [])
    }
    const seen = new Set<string>()
    const rows: StoredInvite[] = []
    for (const item of rec.items) {
      const row = sanitizeRow(item, defaultBandId)
      if (!row || seen.has(row.id)) continue
      seen.add(row.id)
      rows.push(row)
    }
    return new InviteStore(dataDir, rows)
  }

  /**
   * The stored row for this code (as typed) or old link token, found by comparing
   * hashes in constant time.
   */
  private find(token: string): StoredInvite | undefined {
    if (typeof token !== 'string') return undefined
    const wants = [hashToken(token), hashToken(normalizeCode(token))].map((h) => Buffer.from(h, 'hex'))
    let found: StoredInvite | undefined
    for (const row of this.rows) {
      const have = Buffer.from(row.tokenHash, 'hex')
      for (const want of wants) if (timingSafeEqual(have, want)) found = row
    }
    return found
  }

  /** A new invite. The code is returned here only; it is never stored. */
  create(body: NewInviteBody, creatorId: string, now: number): Promise<NewInviteResult> {
    return this.queue(async () => {
      const token = newCode()
      const row: StoredInvite = {
        id: freshId(this.rows),
        kind: body.kind,
        bandId: body.kind === 'leader' ? null : body.bandId,
        createdBy: creatorId,
        createdAt: now,
        expiresAt: body.days === null ? null : now + body.days * DAY_MS,
        maxUses: body.maxUses,
        uses: 0,
        usedBy: [],
        instrument: body.instrument,
        libraryAccess: body.libraryAccess,
        note: body.note,
        revoked: false,
        tokenHash: hashToken(normalizeCode(token)),
      }
      await this.commit(trimRows([...this.rows, row], now))
      return { invite: publicInvite(row), token }
    })
  }

  /** Every invite, newest first (no hashes). */
  list(): InviteInfo[] {
    return this.rows.slice().reverse().map(publicInvite)
  }

  /** One invite (no hash). */
  get(id: string): InviteInfo | undefined {
    const row = this.rows.find((r) => r.id === id)
    return row ? publicInvite(row) : undefined
  }

  /** How many invites made by this account can still be used. */
  usableBy(creatorId: string, now: number): number {
    return this.rows.filter((r) => r.createdBy === creatorId && reasonFor(r, now) === null).length
  }

  /** A band was deleted: its invites go with it. */
  forgetBand(bandId: string): Promise<void> {
    return this.queue(async () => {
      if (!this.rows.some((r) => r.bandId === bandId)) return
      await this.commit(this.rows.filter((r) => r.bandId !== bandId))
    })
  }

  /** Marks an invite as revoked. */
  revoke(id: string): Promise<void> {
    return this.queue(async () => {
      const row = this.rows.find((r) => r.id === id)
      if (!row) throw new InviteError('找不到这个邀请码。', 404)
      await this.commit(this.rows.map((r) => (r === row ? { ...r, revoked: true } : r)))
    })
  }

  /**
   * Whether a token still works. `invite` is set only when it is usable (the
   * page needs the band's defaults then); `reason` (Chinese) says why not.
   */
  check(token: string, now: number): { invite: InviteInfo | null; reason: string | null } {
    const row = this.find(token)
    if (!row) return { invite: null, reason: REASON_UNKNOWN }
    const reason = reasonFor(row, now)
    return reason ? { invite: null, reason } : { invite: publicInvite(row), reason: null }
  }

  /** Re-checks and takes one use before an account is created. Throws InviteError(410) when unusable. */
  reserve(token: string, now: number): Promise<InviteInfo> {
    return this.queue(async () => {
      const row = this.find(token)
      if (!row) throw new InviteError(REASON_UNKNOWN, 410)
      const reason = reasonFor(row, now)
      if (reason) throw new InviteError(reason, 410)
      const updated: StoredInvite = { ...row, uses: row.uses + 1 }
      await this.commit(this.rows.map((r) => (r === row ? updated : r)))
      return publicInvite(updated)
    })
  }

  /** Records the new account as having joined with this invite. */
  confirm(id: string, userId: string): Promise<void> {
    return this.queue(async () => {
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.usedBy.includes(userId)) return
      const updated: StoredInvite = { ...row, usedBy: [...row.usedBy, userId] }
      await this.commit(this.rows.map((r) => (r === row ? updated : r)))
    })
  }

  /** Gives back a use taken by reserve() when the account could not be created. */
  release(id: string): Promise<void> {
    return this.queue(async () => {
      const row = this.rows.find((r) => r.id === id)
      if (!row || row.uses === 0) return
      const updated: StoredInvite = { ...row, uses: row.uses - 1 }
      await this.commit(this.rows.map((r) => (r === row ? updated : r)))
    })
  }

  /** An account was deleted: drop it from every invite's list of joiners. */
  forgetUser(userId: string): Promise<void> {
    return this.queue(async () => {
      if (!this.rows.some((r) => r.usedBy.includes(userId))) return
      await this.commit(
        this.rows.map((r) =>
          r.usedBy.includes(userId) ? { ...r, usedBy: r.usedBy.filter((u) => u !== userId) } : r,
        ),
      )
    })
  }

  /** Writes the new state first; only then does it replace the in-memory one. */
  private async commit(next: StoredInvite[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, INVITES_FILE),
      JSON.stringify({ version: INVITES_VERSION, items: next }),
    )
    this.rows = next
  }
}
