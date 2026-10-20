/**
 * The bands (乐队) of the score server: who leads each band, who is in it, and its
 * size limits (SCORES_DATA/bands.json). Each band's setlist lives in its own
 * BandStore file (SCORES_DATA/bands/<id>.json). An account may be in several
 * bands. Changes run through one serial queue and are written before they show.
 *
 * Upgrading from one band: the first load turns the old band.json into the first
 * band, led by the first admin, with every existing account as a member.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { BandBrief, BandLimits } from '../src/songs/scoreServerTypes'
import { BAND_FILE, BandStore, DEFAULT_BAND_NAME } from './band'
import { createSerialQueue, type InRoot } from './favorites'
import { writeFileAtomic } from './util'

export const BANDS_FILE = 'bands.json'
export const BANDS_DIR = 'bands'
export const DEFAULT_LIMITS: BandLimits = { maxMembers: 20, storageBytes: 2 * 1024 ** 3 }
export const MAX_MEMBERS_LIMIT = 200
export const MAX_STORAGE_LIMIT = 200 * 1024 ** 3
const VERSION = 1
const ID_RE = /^[0-9a-f]{12}$/

export class BandsError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'BandsError'
    this.status = status
  }
}

export interface BandMember {
  userId: string
  joinedAt: number
}

export interface BandMeta {
  id: string
  leaderId: string
  createdBy: string
  createdAt: number
  members: BandMember[]
  limits: BandLimits
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const isCount = (v: unknown, max: number): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 1 && v <= max

/** Checks admin-given limits; only the fields present are returned. */
export function parseLimits(raw: unknown): { ok: true; value: Partial<BandLimits> } | { ok: false; error: string } {
  const r = asRecord(raw)
  if (!r) return { ok: false, error: '限制的格式不对。' }
  const out: Partial<BandLimits> = {}
  if (r.maxMembers !== undefined) {
    if (!isCount(r.maxMembers, MAX_MEMBERS_LIMIT))
      return { ok: false, error: `人数上限要在 1–${MAX_MEMBERS_LIMIT} 之间。` }
    out.maxMembers = r.maxMembers
  }
  if (r.storageBytes !== undefined) {
    if (!isCount(r.storageBytes, MAX_STORAGE_LIMIT))
      return { ok: false, error: '上传空间上限不对（最多 200 GB）。' }
    out.storageBytes = r.storageBytes
  }
  return { ok: true, value: out }
}

function sanitizeMeta(raw: unknown): BandMeta | null {
  const r = asRecord(raw)
  if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null
  if (typeof r.leaderId !== 'string' || !r.leaderId) return null
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const members: BandMember[] = []
  const seen = new Set<string>()
  if (Array.isArray(r.members))
    for (const m of r.members) {
      const mr = asRecord(m)
      if (!mr || typeof mr.userId !== 'string' || !mr.userId || seen.has(mr.userId)) continue
      seen.add(mr.userId)
      members.push({ userId: mr.userId, joinedAt: num(mr.joinedAt) })
    }
  if (!seen.has(r.leaderId)) members.unshift({ userId: r.leaderId, joinedAt: num(r.createdAt) })
  const lim = asRecord(r.limits)
  return {
    id: r.id,
    leaderId: r.leaderId,
    createdBy: typeof r.createdBy === 'string' ? r.createdBy : r.leaderId,
    createdAt: num(r.createdAt),
    members,
    limits: {
      maxMembers: isCount(lim?.maxMembers, MAX_MEMBERS_LIMIT) ? lim.maxMembers : DEFAULT_LIMITS.maxMembers,
      storageBytes: isCount(lim?.storageBytes, MAX_STORAGE_LIMIT)
        ? lim.storageBytes
        : DEFAULT_LIMITS.storageBytes,
    },
  }
}

const freshId = (taken: ReadonlySet<string>): string => {
  for (;;) {
    const id = randomBytes(6).toString('hex')
    if (!taken.has(id)) return id
  }
}

const copyMeta = (b: BandMeta): BandMeta => ({
  ...b,
  members: b.members.map((m) => ({ ...m })),
  limits: { ...b.limits },
})

export class BandRegistry {
  private metas: BandMeta[]
  private readonly stores = new Map<string, BandStore>()
  private readonly queue = createSerialQueue()

  private constructor(
    private readonly dataDir: string,
    private readonly inRoot: InRoot,
    metas: BandMeta[],
  ) {
    this.metas = metas
  }

  /**
   * Reads bands.json and every band's setlist. Without bands.json (a new install, or
   * one from before several bands) it makes the first band: the old band.json's
   * setlist, led by `firstAdminId`, with every account in `userIds` as a member.
   */
  static async load(
    dataDir: string,
    inRoot: InRoot,
    firstAdminId: string,
    userIds: readonly string[],
    now: number,
  ): Promise<BandRegistry> {
    const file = path.join(dataDir, BANDS_FILE)
    let metas: BandMeta[] | null = null
    let text: string | null = null
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
    }
    if (text !== null) {
      let raw: unknown
      try {
        raw = JSON.parse(text)
      } catch {
        raw = undefined
      }
      const rec = asRecord(raw)
      // Membership decides who sees what: never start over silently.
      if (!rec || rec.version !== VERSION || !Array.isArray(rec.bands))
        throw new Error(`乐队文件 ${file} 已损坏或格式不对，请检查该文件或从备份恢复后再启动。`)
      metas = []
      const seen = new Set<string>()
      for (const row of rec.bands) {
        const m = sanitizeMeta(row)
        if (!m || seen.has(m.id)) continue
        seen.add(m.id)
        metas.push(m)
      }
    }
    const reg = new BandRegistry(dataDir, inRoot, metas ?? [])
    if (metas === null) {
      const id = freshId(new Set())
      const members = [firstAdminId, ...userIds.filter((u) => u !== firstAdminId)].map((userId) => ({
        userId,
        joinedAt: now,
      }))
      await fs.promises.mkdir(reg.dir, { recursive: true })
      const old = path.join(dataDir, BAND_FILE)
      if (fs.existsSync(old)) await fs.promises.copyFile(old, path.join(reg.dir, `${id}.json`))
      await reg.commit([
        { id, leaderId: firstAdminId, createdBy: firstAdminId, createdAt: now, members, limits: { ...DEFAULT_LIMITS } },
      ])
      // Kept for going back to an older version; no longer read.
      if (fs.existsSync(old)) await fs.promises.rename(old, `${old}.migrated`).catch(() => {})
      console.log('[谱库] 已把原来的乐队升级为多乐队数据（第一支乐队）。')
    }
    for (const m of reg.metas) reg.stores.set(m.id, await BandStore.load(reg.dir, reg.inRoot, `${m.id}.json`))
    return reg
  }

  private get dir(): string {
    return path.join(this.dataDir, BANDS_DIR)
  }

  /** Every band, oldest first. */
  list(): BandMeta[] {
    return this.metas.map(copyMeta)
  }

  get(id: string): BandMeta | undefined {
    const m = this.metas.find((b) => b.id === id)
    return m ? copyMeta(m) : undefined
  }

  /** The setlist store of a band. */
  store(id: string): BandStore | undefined {
    return this.stores.get(id)
  }

  /** The oldest band (rows saved before several bands belong to it). */
  firstId(): string | null {
    return this.metas[0]?.id ?? null
  }

  isMember(bandId: string, userId: string): boolean {
    return this.metas.some((b) => b.id === bandId && b.members.some((m) => m.userId === userId))
  }

  isLeader(bandId: string, userId: string): boolean {
    return this.metas.some((b) => b.id === bandId && b.leaderId === userId)
  }

  /** Ids of the bands an account is in, oldest first. */
  bandIdsOf(userId: string): string[] {
    return this.metas.filter((b) => b.members.some((m) => m.userId === userId)).map((b) => b.id)
  }

  /** The bands of an account, as the page shows them. */
  briefsOf(userId: string): BandBrief[] {
    return this.metas
      .filter((b) => b.members.some((m) => m.userId === userId))
      .map((b) => ({
        id: b.id,
        name: this.stores.get(b.id)?.name() ?? DEFAULT_BAND_NAME,
        leaderId: b.leaderId,
        leader: b.leaderId === userId,
        members: b.members.length,
      }))
  }

  /** A new band led by `leaderId` (its first member). */
  create(body: { name: string; leaderId: string; createdBy: string }, now: number): Promise<BandMeta> {
    return this.queue(async () => {
      const id = freshId(new Set(this.metas.map((b) => b.id)))
      await fs.promises.mkdir(this.dir, { recursive: true })
      const store = await BandStore.load(this.dir, this.inRoot, `${id}.json`)
      await store.rename(body.name)
      const meta: BandMeta = {
        id,
        leaderId: body.leaderId,
        createdBy: body.createdBy,
        createdAt: now,
        members: [{ userId: body.leaderId, joinedAt: now }],
        limits: { ...DEFAULT_LIMITS },
      }
      try {
        await this.commit([...this.metas, meta])
      } catch (err) {
        await fs.promises.rm(path.join(this.dir, `${id}.json`), { force: true }).catch(() => {})
        throw err
      }
      this.stores.set(id, store)
      return copyMeta(meta)
    })
  }

  /** Checks that a band can take one more member (for an invite, before the account is made). */
  canAdd(bandId: string, userId: string | null): void {
    const b = this.metas.find((x) => x.id === bandId)
    if (!b) throw new BandsError(404, '这个乐队已经不存在了。')
    if (userId && b.members.some((m) => m.userId === userId)) throw new BandsError(409, '你已经在这个乐队里了。')
    if (b.members.length >= b.limits.maxMembers)
      throw new BandsError(409, `这个乐队已经满员了（最多 ${b.limits.maxMembers} 人），请联系队长。`)
  }

  addMember(bandId: string, userId: string, now: number): Promise<void> {
    return this.queue(async () => {
      this.canAdd(bandId, userId)
      await this.commit(
        this.metas.map((b) => (b.id === bandId ? { ...b, members: [...b.members, { userId, joinedAt: now }] } : b)),
      )
    })
  }

  /** Takes someone out of a band (also their parts in its songs). The leader cannot be removed. */
  removeMember(bandId: string, userId: string): Promise<void> {
    return this.queue(async () => {
      const b = this.metas.find((x) => x.id === bandId)
      if (!b) throw new BandsError(404, '找不到这个乐队。')
      if (b.leaderId === userId) throw new BandsError(400, '队长不能离开乐队，请先把队长交给别人。')
      if (!b.members.some((m) => m.userId === userId)) throw new BandsError(404, '这个人不在乐队里。')
      await this.commit(
        this.metas.map((x) => (x.id === bandId ? { ...x, members: x.members.filter((m) => m.userId !== userId) } : x)),
      )
      await this.stores.get(bandId)?.dropUser(userId)
    })
  }

  /** Makes another member the leader. */
  setLeader(bandId: string, userId: string): Promise<void> {
    return this.queue(async () => {
      const b = this.metas.find((x) => x.id === bandId)
      if (!b) throw new BandsError(404, '找不到这个乐队。')
      if (!b.members.some((m) => m.userId === userId)) throw new BandsError(400, '新队长必须是乐队成员。')
      await this.commit(this.metas.map((x) => (x.id === bandId ? { ...x, leaderId: userId } : x)))
    })
  }

  setLimits(bandId: string, limits: Partial<BandLimits>): Promise<void> {
    return this.queue(async () => {
      const b = this.metas.find((x) => x.id === bandId)
      if (!b) throw new BandsError(404, '找不到这个乐队。')
      await this.commit(this.metas.map((x) => (x.id === bandId ? { ...x, limits: { ...x.limits, ...limits } } : x)))
    })
  }

  /** Deletes a band and its setlist file (its uploads and recordings are the caller's). */
  remove(bandId: string): Promise<void> {
    return this.queue(async () => {
      if (!this.metas.some((b) => b.id === bandId)) throw new BandsError(404, '找不到这个乐队。')
      await this.commit(this.metas.filter((b) => b.id !== bandId))
      this.stores.delete(bandId)
      const file = path.join(this.dir, `${bandId}.json`)
      await fs.promises.rename(file, `${file}.deleted-${Date.now()}`).catch(() => {})
    })
  }

  /** An account was deleted: out of every band. Refused while it leads one. */
  dropUser(userId: string): Promise<void> {
    return this.queue(async () => {
      const led = this.metas.find((b) => b.leaderId === userId)
      if (led)
        throw new BandsError(
          400,
          `这个账号是「${this.stores.get(led.id)?.name() ?? '乐队'}」的队长，请先把队长交给别人或删除那个乐队。`,
        )
      const ids = this.metas.filter((b) => b.members.some((m) => m.userId === userId)).map((b) => b.id)
      if (ids.length === 0) return
      await this.commit(
        this.metas.map((b) =>
          ids.includes(b.id) ? { ...b, members: b.members.filter((m) => m.userId !== userId) } : b,
        ),
      )
      for (const id of ids) await this.stores.get(id)?.dropUser(userId)
    })
  }

  private async commit(next: BandMeta[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(path.join(this.dataDir, BANDS_FILE), JSON.stringify({ version: VERSION, bands: next }))
    this.metas = next
  }
}
