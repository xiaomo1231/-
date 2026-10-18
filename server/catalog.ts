/**
 * Search filters and the "most versions" ranking of the score server. Pure:
 * the filters work on the search index / library data before the 200-song
 * limit of the search function applies.
 */
import type { ScoreFormat, ScoreSong } from '../src/songs/scoreLibraryTypes'
import type { ScoreLibraryData, SearchIndex } from '../src/songs/scoreLibrary'

export const SORTS = ['rel', 'ver', 'name'] as const
export type SearchSort = (typeof SORTS)[number]

export const SCORE_FORMATS: readonly ScoreFormat[] = [
  'score',
  'legacy',
  'image',
  'pdf',
  'text',
  'midi',
  'audio',
  'video',
  'other',
]

export interface CatalogFilter {
  fmt?: ScoreFormat
  /** Category id such as `1-华语`. */
  cat?: string
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string }

/** Reads `fmt`, `cat` and `sort` from a query string; empty values mean "no filter". */
export function parseCatalogParams(
  params: URLSearchParams,
): ParseResult<CatalogFilter & { sort: SearchSort }> {
  const fmtText = (params.get('fmt') ?? '').trim()
  let fmt: ScoreFormat | undefined
  if (fmtText) {
    if (!(SCORE_FORMATS as readonly string[]).includes(fmtText))
      return { ok: false, error: '不认识的文件格式。' }
    fmt = fmtText as ScoreFormat
  }
  const cat = (params.get('cat') ?? '').trim()
  if (cat && (cat.length > 100 || /[/\\0]/.test(cat) || cat === '.' || cat === '..'))
    return { ok: false, error: '不认识的分类。' }
  const sortText = (params.get('sort') ?? '').trim() || 'rel'
  if (!(SORTS as readonly string[]).includes(sortText))
    return { ok: false, error: '不认识的排序方式。' }
  return { ok: true, value: { fmt, cat: cat || undefined, sort: sortText as SearchSort } }
}

/** A song restricted to the versions of one format (null when none is left). */
function songWithFormat(song: ScoreSong, fmt: ScoreFormat | undefined): ScoreSong | null {
  if (!fmt) return song
  const versions = song.versions.filter((v) => v.file.format === fmt)
  if (versions.length === 0) return null
  return versions.length === song.versions.length ? song : { ...song, versions }
}

const inCategory = (id: string, cat: string) => id === cat || id.startsWith(cat + '/')

/**
 * The search index narrowed by the filters: songs must have a version of
 * `fmt` (and keep only those versions); the category keeps songs whose artist
 * is in it and artists whose group is in it. Returns `index` when no filter is set.
 */
export function narrowIndex(index: SearchIndex, filter: CatalogFilter): SearchIndex {
  if (!filter.fmt && !filter.cat) return index
  const cat = filter.cat
  const artists = cat
    ? index.artists.filter((a) => inCategory(a.artist.groupId, cat))
    : index.artists
  const songs: SearchIndex['songs'] = []
  for (const s of index.songs) {
    if (cat && !inCategory(s.song.artistId, cat)) continue
    const kept = songWithFormat(s.song, filter.fmt)
    if (!kept) continue
    songs.push(kept === s.song ? s : { ...s, song: kept })
  }
  return { artists, songs }
}

/** Sorts search songs in place by `sort` (`rel` keeps the search order). */
export function sortResultSongs<T extends { song: ScoreSong }>(list: T[], sort: SearchSort): T[] {
  if (sort === 'ver')
    return list.sort(
      (a, b) =>
        b.song.versions.length - a.song.versions.length ||
        a.song.title.localeCompare(b.song.title, 'zh-Hans-CN'),
    )
  if (sort === 'name')
    return list.sort((a, b) => a.song.title.localeCompare(b.song.title, 'zh-Hans-CN'))
  return list
}

export interface RankedSong {
  song: ScoreSong
  artistName: string
}

/** Every song with a known title, most versions first (then by title). */
export function rankByVersions(lib: ScoreLibraryData): RankedSong[] {
  const out: RankedSong[] = []
  for (const [artistId, list] of lib.songs) {
    const artistName = lib.artistById.get(artistId)?.name ?? ''
    for (const song of list) if (!song.unknownTitle) out.push({ song, artistName })
  }
  return out.sort(
    (a, b) =>
      b.song.versions.length - a.song.versions.length ||
      a.song.title.localeCompare(b.song.title, 'zh-Hans-CN'),
  )
}

/** The top `limit` of a ranking after the filters; `moreSongs` says whether more matched. */
export function topSongs(
  ranked: RankedSong[],
  filter: CatalogFilter,
  limit: number,
): { songs: Array<RankedSong & { song: ScoreSong }>; moreSongs: boolean } {
  const songs: Array<RankedSong & { song: ScoreSong }> = []
  let more = false
  for (const r of ranked) {
    if (filter.cat && !inCategory(r.song.artistId, filter.cat)) continue
    const kept = songWithFormat(r.song, filter.fmt)
    if (!kept) continue
    if (songs.length < limit) songs.push({ artistName: r.artistName, song: kept })
    else {
      more = true
      break
    }
  }
  return { songs, moreSongs: more }
}

/** `limit` from a query string: an integer clamped to 1–200 (default 50). */
export function parseTopLimit(text: string | null): number {
  const n = Number((text ?? '').trim())
  if (!Number.isFinite(n) || (text ?? '').trim() === '') return 50
  return Math.min(200, Math.max(1, Math.trunc(n)))
}
