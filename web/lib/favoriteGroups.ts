import type { FavoriteItem } from './api'

/** Pure grouping of starred scores by song (the folder under the artist / work folder). */

export interface SongFolder {
  /** The song folder's full library path (the group key). */
  key: string
  /** The song folder's name, e.g. 春日影. */
  name: string
  /** The artist / work folder above it, '' when there is none. */
  artist: string
}

export type FavoriteSort = 'added' | 'artist' | 'practiced'

export interface FavoriteGroup {
  key: string
  /** The song folder's name (the original, not renamed). */
  name: string
  artist: string
  /** This user's name for the song, from the first starred file that has one. */
  songAlias?: string
  /** The heading to show: the song alias when set, else the song name. */
  displayTitle: string
  /** The song folder's name, as in the library. */
  originalTitle: string
  /** Starred scores of this song, newest starred first. */
  items: FavoriteItem[]
}

const collator = new Intl.Collator('zh-Hans-u-co-pinyin', { numeric: true })

/**
 * Index (within the folder list, i.e. without the file name) of the song folder for the
 * known library layouts, keyed by the top-level category folder's name.
 */
function songIndexFor(folders: string[]): number | null {
  const top = folders[0] ?? ''
  if (top.includes('华语')) {
    // 1-华语/男歌手/<歌手>/<歌名>/…
    return folders[1] === '男歌手' || folders[1] === '女歌手' ? 3 : null
  }
  if (top.includes('欧美')) {
    // 2-欧美/<曲风>/<歌手>/<歌名>/…  and  2-欧美/未分曲风/<A-Z 或 0-9与符号>/<歌手>/<歌名>/…
    return folders[1] === '未分曲风' ? 4 : 3
  }
  if (top.includes('指弹演奏家') || top.includes('网友原创') || top.includes('动漫音乐')) {
    // 4-指弹演奏家/<演奏家>/<歌名>/…   8-网友原创/<作者>/<歌名>/…   6-动漫音乐/<作品>/<歌名>/…
    return 2
  }
  return null
}

/**
 * The song folder of a library path. Unknown layouts fall back to the immediate parent
 * folder; a file that sits directly in a category folder has no song folder of its own.
 */
export function songFolderOf(path: string): SongFolder {
  const segments = path.split('/').filter((s) => s !== '')
  const folders = segments.slice(0, -1)
  if (folders.length === 0) return { key: '', name: '', artist: '' }

  const index = songIndexFor(folders)
  const songIdx = index !== null && index < folders.length ? index : folders.length - 1
  return {
    key: folders.slice(0, songIdx + 1).join('/'),
    name: folders[songIdx] ?? '',
    artist: songIdx >= 1 ? (folders[songIdx - 1] ?? '') : '',
  }
}

/** The file name (last path segment). */
export function fileNameOf(path: string): string {
  const segments = path.split('/').filter((s) => s !== '')
  return segments[segments.length - 1] ?? path
}

/** NFKC + lower case, spaces removed: full-width / half-width and spacing do not matter. */
export function normalizeForSearch(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

function addedOf(items: FavoriteItem[]): number {
  return items.reduce((max, f) => Math.max(max, f.addedAt), 0)
}

/**
 * Groups starred scores by song folder. Items inside a group are newest first. Groups are
 * ordered by the sort mode: 'added' (newest starred item first), 'artist' (artist, then
 * song name), 'practiced' (most recently practised first, unpractised after by added).
 */
export function groupFavorites(
  items: FavoriteItem[],
  sort: FavoriteSort,
  practiceOf?: (path: string) => number | undefined,
): FavoriteGroup[] {
  const map = new Map<string, FavoriteGroup>()
  for (const item of items) {
    const folder = songFolderOf(item.path)
    const group = map.get(folder.key)
    if (group) group.items.push(item)
    else
      map.set(folder.key, {
        ...folder,
        displayTitle: folder.name,
        originalTitle: folder.name,
        items: [item],
      })
  }
  const groups = [...map.values()]
  for (const g of groups) {
    g.items.sort((a, b) => b.addedAt - a.addedAt)
    g.songAlias = g.items.find((f) => f.songAlias)?.songAlias
    g.displayTitle = g.songAlias ?? g.name
  }

  if (sort === 'artist') {
    return groups.sort(
      (a, b) =>
        collator.compare(a.artist || '未知歌手', b.artist || '未知歌手') ||
        collator.compare(a.name, b.name),
    )
  }
  if (sort === 'practiced') {
    const lastPracticed = (g: FavoriteGroup) =>
      g.items.reduce((max, f) => Math.max(max, practiceOf?.(f.path) ?? 0), 0)
    return groups.sort((a, b) => {
      const pa = lastPracticed(a)
      const pb = lastPracticed(b)
      if (pa !== pb) return pb - pa
      return addedOf(b.items) - addedOf(a.items)
    })
  }
  return groups.sort((a, b) => addedOf(b.items) - addedOf(a.items))
}

/**
 * Keeps the groups whose song name (or the user's song name) or artist matches the query,
 * and within other groups the items whose file name (or the user's file name) matches.
 * Empty query returns the groups unchanged.
 */
export function filterGroups(groups: FavoriteGroup[], query: string): FavoriteGroup[] {
  const q = normalizeForSearch(query)
  if (!q) return groups
  const hit = (s: string) => normalizeForSearch(s).includes(q)

  const out: FavoriteGroup[] = []
  for (const g of groups) {
    if (hit(g.name) || hit(g.artist) || (g.songAlias !== undefined && hit(g.songAlias))) {
      out.push(g)
      continue
    }
    const items = g.items.filter(
      (f) => hit(fileNameOf(f.path)) || (f.alias !== undefined && hit(f.alias)),
    )
    if (items.length > 0) out.push({ ...g, items })
  }
  return out
}
