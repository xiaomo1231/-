/**
 * 乐队 (band): one shared store over the band's setlist, members and progress,
 * the same shape as favorites.ts. Every change replaces the store with the
 * BandState the server returns, so the band page and the song pages stay in step.
 */
import { useEffect, useSyncExternalStore } from 'react'
import {
  api,
  errorText,
  type AddBandSongBody,
  type BandState,
  type SongStatus,
  type UpdateBandSongBody,
} from './api'

export const STATUS_LABELS: Record<SongStatus, string> = {
  learning: '在练',
  ready: '已熟',
  maybe: '待定',
}

let state: BandState | null = null
let error: string | null = null
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** Reads the band from the server; a request already in flight is shared. Never rejects. */
function refresh(): Promise<void> {
  if (!loading)
    loading = api
      .band()
      .then(
        (s) => {
          state = s
          error = null
        },
        (e: unknown) => {
          error = errorText(e)
        },
      )
      .finally(() => {
        loading = null
        emit()
      })
  return loading
}

/** The band (null until read), a read error if the last read failed, and a re-read. */
export function useBand(): { state: BandState | null; error: string | null; reload(): void } {
  useEffect(() => {
    void refresh()
  }, [])
  const s = useSyncExternalStore(subscribe, () => state)
  const e = useSyncExternalStore(subscribe, () => error)
  return { state: s, error: e, reload: () => void refresh() }
}

/** Re-reads the band (another member changed it: the rehearsal stream says so). */
export function reloadBand(): void {
  void refresh()
}

/** Sends a change and stores the band it returns. Rejects with a readable message. */
async function commit(request: Promise<BandState>): Promise<void> {
  try {
    state = await request
    error = null
    emit()
  } catch (e) {
    throw new Error(errorText(e))
  }
}

export const addSong = (b: AddBandSongBody) => commit(api.addBandSong(b))
export const updateSong = (b: UpdateBandSongBody) => commit(api.updateBandSong(b))
export const removeSong = (id: string) => commit(api.removeBandSong(id))
export const reorder = (ids: string[]) => commit(api.reorderBandSongs(ids))
export const rename = (name: string) => commit(api.renameBand(name))
export const setSetlist = (ids: string[]) => commit(api.setRehearsalSetlist(ids))
export const addComment = (songId: string, bar: number, text: string) =>
  commit(api.addComment({ songId, bar, text }))
export const removeComment = (songId: string, commentId: string) =>
  commit(api.removeComment(songId, commentId))
