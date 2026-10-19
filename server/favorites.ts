/**
 * Favourites (收藏) of the score server: a short list of scores the student
 * starred, kept in SCORES_DATA/favorites.json. Validation and list updates are
 * pure so they can be tested; the file helpers write atomically.
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveInside, writeFileAtomic } from './util'

export const FAVORITE_FILE = 'favorites.json'
export const MAX_FAVORITES = 2000
export const MAX_FAVORITE_PAGES = 200
export const MAX_TEXT_CHARS = 300

export const FAVORITE_FORMATS = [
  'score',
  'legacy',
  'image',
  'pdf',
  'text',
  'midi',
  'audio',
  'video',
  'other',
] as const

export type FavoriteFormat = (typeof FAVORITE_FORMATS)[number]

export const MAX_ALIAS_CHARS = 60
export const MAX_RENAME_PATHS = 500

export interface FavoriteItem {
  path: string
  format: FavoriteFormat
  pages: string[]
  title: string
  artist: string
  addedAt: number
  /** This user's name for the file (private to the account). */
  alias?: string
  /** This user's name for the song heading the file is listed under. */
  songAlias?: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Which of the two private names a rename changes. */
export type AliasField = 'alias' | 'songAlias'

const ALIAS_ERROR = '名字要在 1–60 个字之间。'

/**
 * A user's name for a file or song: trimmed, 1–60 code points. null or an empty
 * (or blank) string means "no name" and yields null.
 */
export function parseAlias(v: unknown): ParseResult<string | null> {
  if (v === null) return { ok: true, value: null }
  if (typeof v !== 'string') return { ok: false, error: ALIAS_ERROR }
  const t = v.trim()
  if (t === '') return { ok: true, value: null }
  if ([...t].length > MAX_ALIAS_CHARS) return { ok: false, error: ALIAS_ERROR }
  return { ok: true, value: t }
}

/** True when `rel` is a relative path that stays inside the score root. */
export type InRoot = (rel: string) => boolean

/** A root-bound checker built on the lexical safe-path helper. */
export const inRootOf =
  (root: string): InRoot =>
  (rel) =>
    resolveInside(root, rel) !== null

const isFormat = (v: unknown): v is FavoriteFormat =>
  typeof v === 'string' && (FAVORITE_FORMATS as readonly string[]).includes(v)

export const textOk = (v: unknown): v is string => typeof v === 'string' && [...v].length <= MAX_TEXT_CHARS

/** Validates the body of POST /api/favorites. */
export function parseFavoriteInput(
  body: Record<string, unknown>,
  inRoot: InRoot,
  now: number,
): ParseResult<FavoriteItem> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p))
    return { ok: false, error: '收藏的文件不在谱库里。' }
  if (!isFormat(body.format)) return { ok: false, error: '收藏的文件格式不对。' }
  const pages = body.pages
  if (!Array.isArray(pages) || pages.length > MAX_FAVORITE_PAGES)
    return { ok: false, error: `收藏的页数不对（最多 ${MAX_FAVORITE_PAGES} 页）。` }
  for (const page of pages)
    if (typeof page !== 'string' || !inRoot(page))
      return { ok: false, error: '收藏的页面不在谱库里。' }
  if (!textOk(body.title) || !textOk(body.artist))
    return { ok: false, error: `曲名或歌手名太长（最多 ${MAX_TEXT_CHARS} 个字符）。` }
  return {
    ok: true,
    value: {
      path: p,
      format: body.format,
      pages: [...(pages as string[])],
      title: body.title,
      artist: body.artist,
      addedAt: now,
    },
  }
}

/** Validates the body of POST /api/favorites/remove. */
export function parseFavoritePath(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<string> {
  const p = body.path
  if (typeof p !== 'string' || !p || !inRoot(p))
    return { ok: false, error: '收藏的文件不在谱库里。' }
  return { ok: true, value: p }
}

/** Validates the body of POST /api/favorites/rename. */
export function parseRenameInput(
  body: Record<string, unknown>,
  inRoot: InRoot,
): ParseResult<{ path: string; alias: string | null }> {
  const p = parseFavoritePath(body, inRoot)
  if (!p.ok) return p
  const alias = parseAlias(body.alias)
  if (!alias.ok) return alias
  return { ok: true, value: { path: p.value, alias: alias.value } }
}

/** Validates the body of POST /api/favorites/renameSong. Unknown paths are ignored later. */
export function parseRenameSongInput(
  body: Record<string, unknown>,
): ParseResult<{ paths: string[]; songAlias: string | null }> {
  const paths = body.paths
  if (!Array.isArray(paths) || paths.length > MAX_RENAME_PATHS)
    return { ok: false, error: `要改名的谱不对（最多 ${MAX_RENAME_PATHS} 个）。` }
  for (const p of paths) if (typeof p !== 'string') return { ok: false, error: '要改名的谱不对。' }
  const songAlias = parseAlias(body.songAlias)
  if (!songAlias.ok) return songAlias
  return { ok: true, value: { paths: [...(paths as string[])], songAlias: songAlias.value } }
}

/** The list with `item` at the front (an existing entry for the same path is replaced; its names are kept). */
export function upsertFavorite(list: FavoriteItem[], item: FavoriteItem): FavoriteItem[] {
  const old = list.find((f) => f.path === item.path)
  const kept: FavoriteItem = { ...item }
  if (old?.alias) kept.alias = old.alias
  if (old?.songAlias) kept.songAlias = old.songAlias
  return [kept, ...list.filter((f) => f.path !== item.path)].slice(0, MAX_FAVORITES)
}

/**
 * The list with `field` set on the items whose path is in `paths` (null clears it).
 * Other items and other fields are unchanged.
 */
export function renameItems(
  list: FavoriteItem[],
  paths: string[],
  field: AliasField,
  value: string | null,
): FavoriteItem[] {
  const wanted = new Set(paths)
  return list.map((f) => {
    if (!wanted.has(f.path)) return f
    const next: FavoriteItem = { ...f }
    if (value === null) delete next[field]
    else next[field] = value
    return next
  })
}

/** The list without the entry for `path`. */
export function removeFavorite(list: FavoriteItem[], rel: string): FavoriteItem[] {
  return list.filter((f) => f.path !== rel)
}

/** Keeps only the entries of a stored file that still pass validation. */
export function sanitizeFavorites(raw: unknown, inRoot: InRoot): FavoriteItem[] {
  if (!Array.isArray(raw)) return []
  const out: FavoriteItem[] = []
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue
    const rec = e as Record<string, unknown>
    const added = typeof rec.addedAt === 'number' && Number.isFinite(rec.addedAt) ? rec.addedAt : 0
    const r = parseFavoriteInput(rec, inRoot, added)
    if (!r.ok) continue
    const item = r.value
    // A name that no longer validates is dropped, the favourite itself is kept.
    for (const field of ['alias', 'songAlias'] as const) {
      const name = parseAlias(rec[field])
      if (name.ok && name.value !== null) item[field] = name.value
    }
    out.push(item)
  }
  return out.slice(0, MAX_FAVORITES)
}

/** On-disk format version: `{ version, users: { [userId]: items[] } }`. */
export const FAVORITES_VERSION = 2

/** Each account's favourites, keyed by user id. */
export type FavoritesByUser = Map<string, FavoriteItem[]>

/**
 * Turns the parsed file into per-user lists. A plain array is the old
 * single-list format and belongs to `adminId`; the v2 object holds one list per
 * user. Anything else is an empty map.
 */
export function favoritesFromFile(raw: unknown, inRoot: InRoot, adminId: string): FavoritesByUser {
  const out: FavoritesByUser = new Map()
  if (Array.isArray(raw)) {
    out.set(adminId, sanitizeFavorites(raw, inRoot))
    return out
  }
  if (!raw || typeof raw !== 'object') return out
  const rec = raw as Record<string, unknown>
  if (rec.version !== FAVORITES_VERSION || !rec.users || typeof rec.users !== 'object') return out
  for (const [userId, list] of Object.entries(rec.users as Record<string, unknown>))
    out.set(userId, sanitizeFavorites(list, inRoot))
  return out
}

/**
 * Reads every account's favourites once at startup. A missing file is an empty
 * map; a damaged one is set aside. An old single-list file is migrated to
 * `adminId` and rewritten in the v2 format on the next save.
 */
export async function loadFavoritesByUser(
  dataDir: string,
  inRoot: InRoot,
  adminId: string,
): Promise<FavoritesByUser> {
  const file = path.join(dataDir, FAVORITE_FILE)
  let text: string
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return new Map()
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Keep the damaged file for the student to look at; start with an empty list.
    await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
    return new Map()
  }
  return favoritesFromFile(raw, inRoot, adminId)
}

/** Writes every account's favourites atomically (temp file, then rename), readable by the owner only. */
export async function saveFavoritesByUser(dataDir: string, byUser: FavoritesByUser): Promise<void> {
  const users: Record<string, FavoriteItem[]> = {}
  for (const [userId, list] of byUser) users[userId] = list
  await writeFileAtomic(
    path.join(dataDir, FAVORITE_FILE),
    JSON.stringify({ version: FAVORITES_VERSION, users }),
  )
}

/**
 * Runs read-modify-write steps one after another, so two requests cannot
 * overwrite each other's change. A failed step does not block later ones.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve()
  return <T>(task: () => Promise<T>) => {
    const run = tail.then(task, task)
    tail = run.catch(() => {})
    return run
  }
}
