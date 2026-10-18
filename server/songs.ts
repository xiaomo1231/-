/**
 * The song a score file belongs to (歌曲标识 and its playable versions), read
 * from the library in memory. Pure: no file is opened. The index is built once
 * per library object and cached, so each request is a map lookup.
 */
import type { ScoreSong } from '../src/songs/scoreLibraryTypes'
import type { SongInfo } from '../src/songs/scoreServerTypes'
import type { LoadedLibrary } from './library'

export interface SongHit {
  song: ScoreSong
  artistName: string
}

export interface SongIndex {
  /** The song that owns this library path (a version file or an image page), or null. */
  songOf(path: string): SongHit | null
}

const indexes = new WeakMap<LoadedLibrary, SongIndex>()

/** Maps every version file (and image page) path to its song. Cached per library object. */
export function buildSongIndex(lib: LoadedLibrary): SongIndex {
  const cached = indexes.get(lib)
  if (cached) return cached
  const byPath = new Map<string, SongHit>()
  for (const [artistId, songs] of lib.lib.songs) {
    const artistName = lib.lib.artistById.get(artistId)?.name ?? ''
    for (const song of songs) {
      for (const version of song.versions) {
        for (const f of [version.file, ...(version.pages ?? [])]) {
          if (!byPath.has(f.path)) byPath.set(f.path, { song, artistName })
        }
      }
    }
  }
  const index: SongIndex = { songOf: (p) => byPath.get(p) ?? null }
  indexes.set(lib, index)
  return index
}

/**
 * GET /api/song?path=: the song a file belongs to, with its score-format
 * versions in the library's order. Null when the path is not in the library.
 */
export function songInfo(index: SongIndex, path: string): SongInfo | null {
  const hit = index.songOf(path)
  if (!hit) return null
  const { song, artistName } = hit
  return {
    songKey: song.id,
    title: song.title,
    artist: artistName,
    versions: song.versions
      .filter((v) => v.file.format === 'score')
      .map((v) => ({ path: v.file.path, label: v.label, tags: [...v.tags], size: v.size })),
  }
}
