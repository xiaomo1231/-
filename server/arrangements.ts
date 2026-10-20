/**
 * 改编谱 of the score server: a member's own instruments, volumes, mutes and
 * transposition for a score, kept in SCORES_DATA/arrangements.json. Only the
 * changes are stored (never the file), and each is private to its owner.
 * Validation is pure; the store writes atomically through one serial queue.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Arrangement, ArrangementTrack, SaveArrangementBody } from '../src/songs/scoreServerTypes'
import { createSerialQueue, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const ARRANGEMENTS_FILE = 'arrangements.json'
export const MAX_PER_USER = 300
export const MAX_NAME = 60
const VERSION = 1
const ID_RE = /^[0-9a-f]{12}$/
/** Track index as a string key: "0".."63", no leading zeros. */
const TRACK_KEY = /^(?:0|[1-9]|[1-5]\d|6[0-3])$/

export class ArrangementError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ArrangementError'
    this.status = status
  }
}

const good = <T>(value: T): ParseResult<T> => ({ ok: true, value })
const fail = (error: string): { ok: false; error: string } => ({ ok: false, error })
const asRecord = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
const isInt = (v: unknown, lo: number, hi: number): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
const cut = (s: string, n: number) => [...s].slice(0, n).join('')

/** The tracks map: only well-formed keys and fields; empty entries are dropped. */
export function parseTracks(raw: unknown): ParseResult<Record<string, ArrangementTrack>> {
  const r = asRecord(raw)
  if (!r) return fail('音轨设置的格式不对。')
  const out: Record<string, ArrangementTrack> = {}
  for (const [key, value] of Object.entries(r)) {
    if (!TRACK_KEY.test(key)) return fail('音轨编号不对。')
    const t = asRecord(value)
    if (!t) return fail('音轨设置的格式不对。')
    const one: ArrangementTrack = {}
    if (t.program !== undefined) {
      if (!isInt(t.program, 0, 127)) return fail('乐器编号要在 0–127 之间。')
      one.program = t.program
    }
    if (t.volume !== undefined) {
      if (!isInt(t.volume, 0, 150)) return fail('音量要在 0–150% 之间。')
      if (t.volume !== 100) one.volume = t.volume
    }
    if (t.mute !== undefined) {
      if (typeof t.mute !== 'boolean') return fail('静音必须是是或否。')
      if (t.mute) one.mute = true
    }
    if (Object.keys(one).length > 0) out[key] = one
  }
  return good(out)
}

/** Validates POST /api/arrangements/save; `inRoot` checks the score path. */
export function parseSave(body: unknown, inRoot: (p: string) => boolean): ParseResult<SaveArrangementBody> {
  const b = asRecord(body)
  if (!b) return fail('请求内容不对。')
  const id = b.id === null || b.id === undefined ? null : b.id
  if (id !== null && !(typeof id === 'string' && ID_RE.test(id))) return fail('改编谱编号不对。')
  if (typeof b.name !== 'string') return fail(`名字要在 1–${MAX_NAME} 个字之间。`)
  const name = b.name.trim()
  if ([...name].length < 1 || [...name].length > MAX_NAME) return fail(`名字要在 1–${MAX_NAME} 个字之间。`)
  if (typeof b.path !== 'string' || !inRoot(b.path)) return fail('找不到这个谱子。')
  const tracks = parseTracks(b.tracks)
  if (!tracks.ok) return tracks
  if (!isInt(b.transpose ?? 0, -6, 6)) return fail('移调要在 −6 到 +6 半音之间。')
  if (!isInt(b.trackCount, 1, 64)) return fail('音轨数不对。')
  for (const k of Object.keys(tracks.value))
    if (Number(k) >= (b.trackCount as number)) return fail('音轨编号超出了谱子的音轨数。')
  return good({
    id,
    name,
    path: b.path,
    title: typeof b.title === 'string' ? cut(b.title.trim(), 200) : '',
    artist: typeof b.artist === 'string' ? cut(b.artist.trim(), 200) : '',
    tracks: tracks.value,
    transpose: (b.transpose as number | undefined) ?? 0,
    trackCount: b.trackCount as number,
  })
}

function sanitize(raw: unknown): Arrangement | null {
  const r = asRecord(raw)
  if (!r || typeof r.id !== 'string' || !ID_RE.test(r.id)) return null
  if (typeof r.owner !== 'string' || !r.owner || typeof r.path !== 'string' || !r.path) return null
  if (typeof r.name !== 'string' || !r.name.trim()) return null
  const tracks = parseTracks(r.tracks)
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return {
    id: r.id,
    owner: r.owner,
    name: cut(r.name.trim(), MAX_NAME),
    path: r.path,
    title: typeof r.title === 'string' ? r.title : '',
    artist: typeof r.artist === 'string' ? r.artist : '',
    tracks: tracks.ok ? tracks.value : {},
    transpose: isInt(r.transpose, -6, 6) ? r.transpose : 0,
    trackCount: isInt(r.trackCount, 1, 64) ? r.trackCount : 1,
    createdAt: num(r.createdAt),
    updatedAt: num(r.updatedAt),
  }
}

const copy = (a: Arrangement): Arrangement => ({
  ...a,
  tracks: Object.fromEntries(Object.entries(a.tracks).map(([k, v]) => [k, { ...v }])),
})

export class ArrangementStore {
  private items: Arrangement[]
  private readonly queue = createSerialQueue()

  private constructor(
    private readonly dataDir: string,
    items: Arrangement[],
  ) {
    this.items = items
  }

  /** Reads arrangements.json once. Missing is empty; damaged is set aside. */
  static async load(dataDir: string): Promise<ArrangementStore> {
    const file = path.join(dataDir, ARRANGEMENTS_FILE)
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      return new ArrangementStore(dataDir, [])
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    const rec = asRecord(raw)
    if (!rec || rec.version !== VERSION || !Array.isArray(rec.items)) {
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[谱库] 改编谱数据文件损坏，已改名保留并从空开始：${file}`)
      return new ArrangementStore(dataDir, [])
    }
    const seen = new Set<string>()
    const items: Arrangement[] = []
    for (const row of rec.items) {
      const a = sanitize(row)
      if (!a || seen.has(a.id)) continue
      seen.add(a.id)
      items.push(a)
    }
    return new ArrangementStore(dataDir, items)
  }

  /** An account's arrangements, newest change first. */
  listOf(owner: string): Arrangement[] {
    return this.items
      .filter((a) => a.owner === owner)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .map(copy)
  }

  /** One arrangement, only for its owner. */
  get(id: string, owner: string): Arrangement | undefined {
    const a = this.items.find((x) => x.id === id && x.owner === owner)
    return a ? copy(a) : undefined
  }

  /** Creates (id null) or replaces one of the owner's arrangements. */
  save(body: SaveArrangementBody, owner: string, now: number): Promise<Arrangement> {
    return this.queue(async () => {
      if (body.id === null) {
        if (this.items.filter((a) => a.owner === owner).length >= MAX_PER_USER)
          throw new ArrangementError(409, `改编谱最多 ${MAX_PER_USER} 个，先删掉一些。`)
        const taken = new Set(this.items.map((a) => a.id))
        let id = randomBytes(6).toString('hex')
        while (taken.has(id)) id = randomBytes(6).toString('hex')
        const item: Arrangement = { ...body, id, owner, createdAt: now, updatedAt: now }
        await this.commit([...this.items, item])
        return copy(item)
      }
      const old = this.items.find((a) => a.id === body.id && a.owner === owner)
      if (!old) throw new ArrangementError(404, '找不到这个改编谱。')
      const item: Arrangement = { ...body, id: old.id, owner, createdAt: old.createdAt, updatedAt: now }
      await this.commit(this.items.map((a) => (a === old ? item : a)))
      return copy(item)
    })
  }

  rename(id: string, owner: string, name: string, now: number): Promise<Arrangement> {
    return this.queue(async () => {
      const old = this.items.find((a) => a.id === id && a.owner === owner)
      if (!old) throw new ArrangementError(404, '找不到这个改编谱。')
      const t = name.trim()
      if ([...t].length < 1 || [...t].length > MAX_NAME)
        throw new ArrangementError(400, `名字要在 1–${MAX_NAME} 个字之间。`)
      const item = { ...old, name: t, updatedAt: now }
      await this.commit(this.items.map((a) => (a === old ? item : a)))
      return copy(item)
    })
  }

  remove(id: string, owner: string): Promise<void> {
    return this.queue(async () => {
      if (!this.items.some((a) => a.id === id && a.owner === owner))
        throw new ArrangementError(404, '找不到这个改编谱。')
      await this.commit(this.items.filter((a) => a.id !== id))
    })
  }

  /** An account was deleted: its arrangements go too. */
  dropUser(owner: string): Promise<void> {
    return this.queue(async () => {
      if (!this.items.some((a) => a.owner === owner)) return
      await this.commit(this.items.filter((a) => a.owner !== owner))
    })
  }

  private async commit(next: Arrangement[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(
      path.join(this.dataDir, ARRANGEMENTS_FILE),
      JSON.stringify({ version: VERSION, items: next }),
    )
    this.items = next
  }
}
