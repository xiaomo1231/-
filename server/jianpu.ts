/**
 * 简谱 matched to songs: the PDFs and images in the library's
 * `13-简谱/按歌手/<歌手>/…` folders, found by artist and title. Pure and
 * read-only: names only, no file is opened. The index is built once per loaded
 * library and cached. `13-简谱/未识别/…` is not indexed.
 */
import { normKey, type TextTools } from '../src/songs/scoreLibrary'
import type { ScoreSong } from '../src/songs/scoreLibraryTypes'
import type { LibraryJianpu } from '../src/songs/scoreServerTypes'
import type { LoadedLibrary } from './library'

const JIANPU_CATEGORY = /^\d+-简谱$/
const BY_ARTIST = '按歌手'

/** `13-简谱` (any number before it). */
export function isJianpuCategory(categoryId: string): boolean {
  return JIANPU_CATEGORY.test(categoryId)
}

/** A trailing bracketed version note: （简单版）, (钢琴版), 【伴奏】, [live]. Repeated while present. */
const TRAILING_NOTE = /\s*(?:（[^（）]*）|\([^()]*\)|【[^【】]*】|\[[^[\]]*\])\s*$/

/** The title without its trailing version notes (the whole title if nothing is left). */
export function stripVersionNote(title: string): string {
  let t = title.trim()
  for (;;) {
    const next = t.replace(TRAILING_NOTE, '').trim()
    if (next === t || next === '') break
    t = next
  }
  return t || title.trim()
}

const DUET_SEPARATOR = /\s*(?:\+|&|、|和)\s*/

/** "张学友+汤宝如" → [张学友, 汤宝如]; a single name → [name]. */
export function artistNamesOf(name: string): string[] {
  const pieces = name.split(DUET_SEPARATOR)
  if (pieces.length < 2 || pieces.some((p) => !p.trim())) return [name.trim()]
  return pieces.map((p) => p.trim())
}

/** Index keys of an artist name: the full name and, for a duet, each singer. */
function artistKeysOf(name: string, tools: TextTools): string[] {
  const keys = new Set<string>()
  for (const n of [name, ...artistNamesOf(name)]) {
    const k = normKey(n, tools)
    if (k) keys.add(k)
  }
  return [...keys]
}

export interface JianpuIndex {
  tools: TextTools
  /** `${artistKey}|${titleKey}` → the 简谱 files of that song. */
  byKey: Map<string, LibraryJianpu[]>
}

const cache = new WeakMap<LoadedLibrary, JianpuIndex>()

/** Every 简谱 file of an artist in `13-简谱/按歌手`, indexed by artist and title. Cached per loaded library. */
export function buildJianpuIndex(lib: LoadedLibrary, tools: TextTools): JianpuIndex {
  const hit = cache.get(lib)
  if (hit && hit.tools === tools) return hit

  const byKey = new Map<string, LibraryJianpu[]>()
  const add = (key: string, entry: LibraryJianpu) => {
    let list = byKey.get(key)
    if (!list) byKey.set(key, (list = []))
    if (!list.some((e) => e.path === entry.path)) list.push(entry)
  }

  for (const artist of lib.lib.artistById.values()) {
    const parts = artist.id.split('/')
    if (!isJianpuCategory(parts[0] ?? '') || parts[1] !== BY_ARTIST || !parts[2]) continue
    const artistKeys = artistKeysOf(artist.name, tools)
    if (artistKeys.length === 0) continue
    for (const song of lib.lib.songs.get(artist.id) ?? []) {
      if (song.unknownTitle || !song.title.trim()) continue
      const titleKey = normKey(stripVersionNote(song.title), tools)
      if (!titleKey) continue
      for (const v of song.versions) {
        const entry: LibraryJianpu = {
          path: v.file.path,
          title: song.title,
          artist: artist.name,
          label: v.label,
        }
        for (const ak of artistKeys) add(`${ak}|${titleKey}`, entry)
      }
    }
  }

  const index: JianpuIndex = { tools, byKey }
  cache.set(lib, index)
  return index
}

/** The 简谱 files of a song (by its artist name and title); never files of another artist. */
export function jianpuForSong(
  index: JianpuIndex,
  artistName: string,
  title: string,
): LibraryJianpu[] {
  const titleKey = normKey(stripVersionNote(title), index.tools)
  if (!titleKey) return []
  const out: LibraryJianpu[] = []
  const seen = new Set<string>()
  for (const ak of artistKeysOf(artistName, index.tools)) {
    for (const e of index.byKey.get(`${ak}|${titleKey}`) ?? []) {
      if (seen.has(e.path)) continue
      seen.add(e.path)
      out.push(e)
    }
  }
  return out
}

/**
 * Copies of `songs` with `jianpu` = how many 简谱 files match (only when above
 * zero). Songs of the 简谱 category themselves are returned without the field.
 */
export function annotateSongs(
  index: JianpuIndex,
  lib: LoadedLibrary,
  songs: ScoreSong[],
  artistNameOf: (artistId: string) => string,
): ScoreSong[] {
  return songs.map((song) => {
    const copy: ScoreSong = { ...song }
    delete copy.jianpu
    const artist = lib.lib.artistById.get(song.artistId)
    const categoryId = (artist?.id ?? song.artistId).split('/')[0] ?? ''
    if (isJianpuCategory(categoryId)) return copy
    const n = jianpuForSong(index, artistNameOf(song.artistId), song.title).length
    return n > 0 ? { ...copy, jianpu: n } : copy
  })
}
