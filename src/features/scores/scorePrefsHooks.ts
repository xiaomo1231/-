/**
 * 谱库 (0.31.0): what the library pages need from the student's bookkeeping:
 * a version number that changes on every write, and the set of starred paths
 * handed down to the score rows.
 */
import { createContext, useContext, useSyncExternalStore } from 'react'
import {
  scorePrefsVersion,
  subscribeScorePrefs,
  type FavoriteInput,
} from '@/services/scorePrefsService'

/** Changes whenever a star, an open or a merge is written. */
export function useScorePrefsVersion(): number {
  return useSyncExternalStore(subscribeScorePrefs, scorePrefsVersion, scorePrefsVersion)
}

export interface FavoritesValue {
  /** Paths of the starred scores. */
  paths: ReadonlySet<string>
  /** Stars or un-stars a score. */
  toggle: (row: FavoriteInput) => void
}

const EMPTY: FavoritesValue = { paths: new Set<string>(), toggle: () => undefined }

/** Provided by the library page; score rows read their star from it. */
export const FavoritesContext = createContext<FavoritesValue>(EMPTY)

export function useFavorites(): FavoritesValue {
  return useContext(FavoritesContext)
}
