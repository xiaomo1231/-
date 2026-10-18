/**
 * 组合乐队谱 on the score server: a recipe that copies chosen tracks from several
 * versions of one song onto a base version (the base gives bars, tempo and
 * sections). Recipes are kept in SCORES_DATA/combos.json; the score files are
 * never changed. Validation takes the caller's checks (path in the library, a
 * version of the song) as functions so it stays pure and testable.
 */
import { randomBytes } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { ComboPart, ComboRecipe, SaveComboBody, UserInfo } from '../src/songs/scoreServerTypes'
import { createSerialQueue, MAX_TEXT_CHARS, textOk, type InRoot, type ParseResult } from './favorites'
import { writeFileAtomic } from './util'

export const COMBOS_FILE = 'combos.json'
export const COMBOS_VERSION = 1
export const MAX_COMBOS = 2000
export const MAX_COMBO_PARTS = 16
const MAX_NAME_CHARS = 40
const MAX_OFFSET_BARS = 64
const MAX_TRANSPOSE = 12
const MAX_TRACK = 63

/** A version of a song: true when `path` is one of the files of `songKey`. */
export type IsVersionOf = (path: string, songKey: string) => boolean

/** A recipe as validated from a request: the body of SaveComboBody. */
export type ComboRecipeInput = SaveComboBody['recipe']

export class ComboError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'ComboError'
    this.status = status
  }
}

const codePoints = (s: string) => [...s].length
const isInteger = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v)
const isComboId = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{12}$/.test(v)

const isObject = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v)

/** Validates one part. `ok` carries the normalized part (name trimmed). */
function parsePart(
  raw: unknown,
  songKey: string,
  inRoot: InRoot,
  isVersionOf: IsVersionOf,
): ParseResult<ComboPart> {
  const bad = (error: string): ParseResult<ComboPart> => ({ ok: false, error })
  if (!isObject(raw)) return bad('组合谱的声部格式不对。')
  const p = raw.path
  if (typeof p !== 'string' || !p || !inRoot(p) || !isVersionOf(p, songKey))
    return bad('组合谱的声部必须来自同一首歌的乐谱文件。')
  if (!isInteger(raw.track) || raw.track < 0 || raw.track > MAX_TRACK)
    return bad('声部编号必须是 0–63 之间的整数。')
  if (typeof raw.name !== 'string') return bad(`声部名要在 1–${MAX_NAME_CHARS} 个字符之间。`)
  const name = raw.name.trim()
  if (codePoints(name) < 1 || codePoints(name) > MAX_NAME_CHARS)
    return bad(`声部名要在 1–${MAX_NAME_CHARS} 个字符之间。`)
  if (!isInteger(raw.offsetBars) || Math.abs(raw.offsetBars) > MAX_OFFSET_BARS)
    return bad(`错开的小节数必须是 −${MAX_OFFSET_BARS} 到 ${MAX_OFFSET_BARS} 之间的整数。`)
  if (!isInteger(raw.transpose) || Math.abs(raw.transpose) > MAX_TRANSPOSE)
    return bad(`移调必须是 −${MAX_TRANSPOSE} 到 ${MAX_TRANSPOSE} 之间的整数。`)
  if (typeof raw.unrollRepeats !== 'boolean') return bad('展开反复设置不对。')
  return {
    ok: true,
    value: {
      path: p,
      track: raw.track,
      name,
      offsetBars: raw.offsetBars,
      transpose: raw.transpose,
      unrollRepeats: raw.unrollRepeats,
    },
  }
}

/** The recipe checks shared by requests (isVersionOf real) and stored rows (isVersionOf lenient). */
function parseRecipe(
  raw: unknown,
  inRoot: InRoot,
  isVersionOf: IsVersionOf,
): ParseResult<ComboRecipeInput> {
  const bad = (error: string): ParseResult<ComboRecipeInput> => ({ ok: false, error })
  if (!isObject(raw)) return bad('组合谱的内容格式不对。')
  const songKey = raw.songKey
  if (typeof songKey !== 'string' || codePoints(songKey) < 1 || codePoints(songKey) > MAX_TEXT_CHARS)
    return bad(`歌曲标识不对（1–${MAX_TEXT_CHARS} 个字符）。`)
  if (!textOk(raw.title) || !textOk(raw.artist))
    return bad(`曲名或歌手名太长（最多 ${MAX_TEXT_CHARS} 个字符）。`)
  const base = raw.base
  if (typeof base !== 'string' || !base || !inRoot(base) || !isVersionOf(base, songKey))
    return bad('基础乐谱必须是这首歌的乐谱文件。')
  if (typeof raw.baseUnrollRepeats !== 'boolean') return bad('展开反复设置不对。')
  if (!Array.isArray(raw.parts) || raw.parts.length < 1 || raw.parts.length > MAX_COMBO_PARTS)
    return bad(`组合谱的声部数要在 1–${MAX_COMBO_PARTS} 之间。`)
  const parts: ComboPart[] = []
  for (const entry of raw.parts) {
    const r = parsePart(entry, songKey, inRoot, isVersionOf)
    if (!r.ok) return bad(r.error)
    parts.push(r.value)
  }
  if (raw.id !== undefined && raw.id !== null && !isComboId(raw.id)) return bad('组合谱编号不对。')
  return {
    ok: true,
    value: {
      id: (raw.id as string | null | undefined) ?? null,
      songKey,
      title: raw.title,
      artist: raw.artist,
      base,
      baseUnrollRepeats: raw.baseUnrollRepeats,
      parts,
    },
  }
}

/**
 * Validates the body of POST /api/combos/save: `{ recipe }`. `id` null means a
 * new recipe; a 12-hex id names one to replace (existence is checked by the store).
 */
export function parseSaveCombo(
  body: Record<string, unknown>,
  inRoot: InRoot,
  isVersionOf: IsVersionOf,
): ParseResult<SaveComboBody['recipe']> {
  return parseRecipe(body.recipe, inRoot, isVersionOf)
}

/** Edit right: the creator of a recipe, or an admin. */
export function canEditCombo(item: Pick<ComboRecipe, 'createdBy'>, user: Pick<UserInfo, 'id' | 'role'>): boolean {
  return user.role === 'admin' || item.createdBy === user.id
}

/** Keeps the newest `max` recipes (by updatedAt). */
function capItems(items: ComboRecipe[], max: number): ComboRecipe[] {
  if (items.length <= max) return items
  return [...items].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, max)
}

const freshId = (taken: readonly ComboRecipe[]): string => {
  for (;;) {
    const id = randomBytes(6).toString('hex')
    if (!taken.some((r) => r.id === id)) return id
  }
}

/** The saved 组合谱 recipes. Writes are serialized and atomic. */
export class ComboStore {
  private readonly file: string
  private readonly queue = createSerialQueue()

  private constructor(
    private readonly dataDir: string,
    private items: ComboRecipe[],
  ) {
    this.file = path.join(dataDir, COMBOS_FILE)
  }

  /** Reads combos.json once at startup. Missing is empty; damaged is set aside; bad entries are dropped. */
  static async load(dataDir: string, inRoot: InRoot): Promise<ComboStore> {
    const file = path.join(dataDir, COMBOS_FILE)
    const empty = () => new ComboStore(dataDir, [])
    let text: string
    try {
      text = await fs.promises.readFile(file, 'utf8')
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return empty()
      console.warn(`[组合谱] 组合谱数据读取失败，已当作空：${(err as Error).message}`)
      return empty()
    }
    let raw: unknown
    try {
      raw = JSON.parse(text)
    } catch {
      raw = undefined
    }
    if (!isObject(raw) || raw.version !== COMBOS_VERSION || !Array.isArray(raw.items)) {
      // Keep the damaged file for a look; start empty.
      await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
      console.warn(`[组合谱] 组合谱数据文件损坏，已改名保留并从空开始：${file}`)
      return empty()
    }
    const seen = new Set<string>()
    const items: ComboRecipe[] = []
    for (const entry of raw.items) {
      if (!isObject(entry)) continue
      // Paths are only checked against the library root here; versions are checked when saving.
      const r = parseRecipe(entry, inRoot, () => true)
      if (!r.ok || !isComboId(entry.id) || seen.has(entry.id)) continue
      if (typeof entry.createdBy !== 'string' || !entry.createdBy) continue
      const updatedAt = typeof entry.updatedAt === 'number' && Number.isFinite(entry.updatedAt) ? entry.updatedAt : 0
      seen.add(entry.id)
      items.push({ ...r.value, id: entry.id, createdBy: entry.createdBy, updatedAt })
    }
    return new ComboStore(dataDir, capItems(items, MAX_COMBOS))
  }

  /** The recipes of one song, newest first. */
  list(songKey: string): ComboRecipe[] {
    return this.items
      .filter((r) => r.songKey === songKey)
      .sort((a, b) => b.updatedAt - a.updatedAt)
  }

  get(id: string): ComboRecipe | undefined {
    return this.items.find((r) => r.id === id)
  }

  /**
   * Stores a recipe. A null id creates one (new id, createdBy = userId); a known
   * id replaces that recipe and keeps its createdBy; an unknown id is a 404.
   * Edit rights are the caller's check (see canEditCombo).
   */
  save(recipe: ComboRecipeInput, userId: string, now: number): Promise<ComboRecipe> {
    return this.queue(async () => {
      let stored: ComboRecipe
      if (recipe.id === null) {
        stored = { ...recipe, id: freshId(this.items), createdBy: userId, updatedAt: now }
      } else {
        const old = this.items.find((r) => r.id === recipe.id)
        if (!old) throw new ComboError(404, '找不到这个组合谱，可能已被删除。')
        stored = { ...recipe, id: old.id, createdBy: old.createdBy, updatedAt: now }
      }
      const next = [...this.items.filter((r) => r.id !== stored.id), stored]
      await this.write(capItems(next, MAX_COMBOS))
      return stored
    })
  }

  /** Removes a recipe; false when there was none. */
  remove(id: string): Promise<boolean> {
    return this.queue(async () => {
      if (!this.items.some((r) => r.id === id)) return false
      await this.write(this.items.filter((r) => r.id !== id))
      return true
    })
  }

  /** Writes the new list first; only then does it replace the in-memory one. */
  private async write(items: ComboRecipe[]): Promise<void> {
    await fs.promises.mkdir(this.dataDir, { recursive: true })
    await writeFileAtomic(this.file, JSON.stringify({ version: COMBOS_VERSION, items }))
    this.items = items
  }
}
