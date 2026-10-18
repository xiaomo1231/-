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

export interface FavoriteItem {
  path: string
  format: FavoriteFormat
  pages: string[]
  title: string
  artist: string
  addedAt: number
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

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

/** The list with `item` at the front (an existing entry for the same path is replaced). */
export function upsertFavorite(list: FavoriteItem[], item: FavoriteItem): FavoriteItem[] {
  return [item, ...list.filter((f) => f.path !== item.path)].slice(0, MAX_FAVORITES)
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
    if (r.ok) out.push(r.value)
  }
  return out.slice(0, MAX_FAVORITES)
}

/** Reads the stored list once at startup. A missing file is an empty list; a damaged one is set aside. */
export async function loadFavorites(dataDir: string, inRoot: InRoot): Promise<FavoriteItem[]> {
  const file = path.join(dataDir, FAVORITE_FILE)
  let text: string
  try {
    text = await fs.promises.readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    // Keep the damaged file for the student to look at; start with an empty list.
    await fs.promises.rename(file, `${file}.broken-${Date.now()}`).catch(() => {})
    return []
  }
  return sanitizeFavorites(raw, inRoot)
}

/** Writes the list atomically (temp file, then rename), readable by the owner only. */
export async function saveFavorites(dataDir: string, list: FavoriteItem[]): Promise<void> {
  await writeFileAtomic(path.join(dataDir, FAVORITE_FILE), JSON.stringify(list))
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
