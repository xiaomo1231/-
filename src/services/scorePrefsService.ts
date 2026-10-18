/**
 * 谱库 (0.31.0): the student's own bookkeeping about the score library —
 * starred scores, recently opened scores, and artist folders that are the
 * same person (周杰伦 / Jay Chou). Nothing here touches the folder on disk.
 */
import { getDb } from '@/infrastructure/db/database'
import type { ScoreFavoriteRow, ScoreRecentRow } from '@/entities/types'

/** Recently opened scores kept (the oldest are dropped). */
export const RECENT_KEEP = 100

type Listener = () => void
const listeners = new Set<Listener>()
let version = 0

/** Bumps on every write, so pages can re-read what they show. */
export function scorePrefsVersion(): number {
  return version
}

export function subscribeScorePrefs(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function changed(): void {
  version++
  for (const l of listeners) l()
}

export type FavoriteInput = Pick<ScoreFavoriteRow, 'path' | 'title' | 'artist'> & {
  pages?: string[]
}
export type RecentInput = Omit<ScoreRecentRow, 'openedAt'>

/** Optional fields are only stored when they have content. */
function withPages<T extends { path: string; title: string; artist: string; pages?: string[] }>(
  row: T,
): Pick<T, 'path' | 'title' | 'artist'> & { pages?: string[] } {
  const base = { path: row.path, title: row.title, artist: row.artist }
  return row.pages && row.pages.length > 0 ? { ...base, pages: [...row.pages] } : base
}

export const ScorePrefs = {
  /** Starred scores, newest first. */
  async favorites(): Promise<ScoreFavoriteRow[]> {
    const rows = await getDb().scoreFavorites.toArray()
    return rows.sort((a, b) => b.addedAt - a.addedAt)
  },

  async isFavorite(path: string): Promise<boolean> {
    return !!(await getDb().scoreFavorites.get(path))
  },

  /** Stars or un-stars the score; resolves to whether it is starred now. */
  async toggleFavorite(row: FavoriteInput): Promise<boolean> {
    const db = getDb()
    const starred = await db.transaction('rw', db.scoreFavorites, async () => {
      const cur = await db.scoreFavorites.get(row.path)
      if (cur) {
        await db.scoreFavorites.delete(row.path)
        return false
      }
      await db.scoreFavorites.put({ ...withPages(row), addedAt: Date.now() })
      return true
    })
    changed()
    return starred
  },

  /** Most recently opened first. */
  async recent(limit = 30): Promise<ScoreRecentRow[]> {
    return getDb().scoreRecent.orderBy('openedAt').reverse().limit(limit).toArray()
  },

  /** One row per path (re-opening moves it to the top); at most RECENT_KEEP rows. */
  async recordOpen(row: RecentInput): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.scoreRecent, async () => {
      await db.scoreRecent.put({ ...withPages(row), openedAt: Date.now() })
      const n = await db.scoreRecent.count()
      if (n > RECENT_KEEP) {
        const oldest = await db.scoreRecent
          .orderBy('openedAt')
          .limit(n - RECENT_KEEP)
          .primaryKeys()
        await db.scoreRecent.bulkDelete(oldest)
      }
    })
    changed()
  },

  /** Every merge as [from, to]. */
  async merges(): Promise<Array<[string, string]>> {
    const rows = await getDb().artistMerges.toArray()
    return rows.map((r) => [r.from, r.to])
  },

  /**
   * Shows artist `from` as part of artist `to`; `to === null` separates it
   * again. A target that is itself merged is followed to its final artist.
   * A merge that would make a cycle is refused.
   */
  async setMerge(from: string, to: string | null): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.artistMerges, async () => {
      if (to === null || to === from) {
        await db.artistMerges.delete(from)
        return
      }
      const map = new Map((await db.artistMerges.toArray()).map((r) => [r.from, r.to]))
      const seen = new Set<string>()
      let final = to
      while (map.has(final) && !seen.has(final)) {
        seen.add(final)
        final = map.get(final)!
      }
      if (final === from || seen.has(from)) {
        throw new Error('不能合并到这位歌手：他已经合并到当前歌手里了。')
      }
      await db.artistMerges.put({ from, to: final })
    })
    changed()
  },
}
