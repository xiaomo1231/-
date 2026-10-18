/**
 * 谱库: the page's view of the library (implementation: scoreLibraryClient.ts,
 * which builds the index in a worker from the app's folder scan). Only the
 * desktop app can read the folder; in the browser `state()` is 'no-app'.
 */
import type { ScoreFavoriteRow, ScoreRecentRow } from '@/entities/types'
import type { FavoriteInput, RecentInput } from '@/services/scorePrefsService'
import type {
  ScoreArtist,
  ScoreCategory,
  ScoreSearchResult,
  ScoreSong,
} from '@/songs/scoreLibraryTypes'

export type LibraryState =
  | { kind: 'no-app' }
  | { kind: 'no-root' }
  | { kind: 'not-scanned'; root: string }
  | { kind: 'ready'; root: string; scannedAt: number; files: number; categories: ScoreCategory[] }

export interface ScoreLibraryApi {
  state(): Promise<LibraryState>
  /** Ask for the folder (the system's folder picker); the state after it. */
  pickRoot(): Promise<LibraryState>
  /** Read the folder again (the first time takes a while: `onProgress` gets the files found so far). */
  rescan(onProgress?: (files: number) => void): Promise<LibraryState>
  /** A group's artists / works, most files first. */
  artists(groupId: string): Promise<ScoreArtist[]>
  /** An artist's songs, by title (unknown titles last); each with all its versions. */
  songs(artistId: string): Promise<ScoreSong[]>
  search(query: string): Promise<ScoreSearchResult>
  /** The bytes of a file in the library. */
  read(path: string): Promise<Uint8Array>
  /** Open with the computer's own program (Guitar Pro, TuxGuitar, image viewer…). Rejects with a readable message. */
  openExternal(path: string): Promise<void>
  /** Show the file in Explorer. */
  reveal(path: string): Promise<void>
  /** The absolute path, for display. */
  fullPath(path: string): string

  /** Shows artist `from` as part of artist `to` (`null` separates it again); the library state after it. */
  mergeArtist(from: string, to: string | null): Promise<LibraryState>
  /** Artists that may be the same person as this one (merge suggestions), at most 10. */
  artistsLike(artistId: string): Promise<ScoreArtist[]>
  /** Starred scores, newest first. */
  favorites(): Promise<ScoreFavoriteRow[]>
  /** Stars or un-stars a score; resolves to whether it is starred now. */
  toggleFavorite(row: FavoriteInput): Promise<boolean>
  isFavorite(path: string): Promise<boolean>
  /** Recently opened scores, newest first. */
  recent(): Promise<ScoreRecentRow[]>
  recordOpen(row: RecentInput): Promise<void>
}
