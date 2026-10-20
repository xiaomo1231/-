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
import { getBandId, onBandChange, setMe } from './session'

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

/** An answer for a band other than the current one (the user switched meanwhile) is dropped. */
const current = (s: BandState) => s.id === getBandId() || getBandId() === null

/** Reads the band from the server; a request already in flight is shared. Never rejects. */
function refresh(): Promise<void> {
  if (!loading)
    loading = api
      .band()
      .then(
        (s) => {
          if (!current(s)) return
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

// Another band chosen (or joined, or left): forget the old one and read the new one.
onBandChange(() => {
  state = null
  error = null
  emit()
  if (getBandId()) void refresh()
})

/** Reads the account again (its bands' names, who leads them). Never rejects. */
export async function reloadMe(): Promise<void> {
  try {
    setMe(await api.me())
  } catch {
    // The next page load corrects it.
  }
}

/** Sends a change and stores the band it returns. Rejects with a readable message. */
async function commit(request: Promise<BandState>): Promise<void> {
  try {
    const next = await request
    if (current(next)) state = next
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
export const rename = async (name: string) => {
  await commit(api.renameBand(name))
  await reloadMe()
}
/** The leader (or an admin) takes a member out of the band. */
export const removeMember = (userId: string) => commit(api.removeBandMember(userId) as Promise<BandState>)
/** 退出乐队: takes the account out of the current band. */
export async function leaveBand(myId: string): Promise<void> {
  try {
    await api.removeBandMember(myId)
  } catch (e) {
    throw new Error(errorText(e))
  }
  await reloadMe()
}
/** Hands the band over to another member. */
export const setLeader = async (userId: string) => {
  await commit(api.setBandLeader(userId))
  await reloadMe()
}
export const setSetlist = (ids: string[]) => commit(api.setRehearsalSetlist(ids))
export const addComment = (songId: string, bar: number, text: string) =>
  commit(api.addComment({ songId, bar, text }))
export const removeComment = (songId: string, commentId: string) =>
  commit(api.removeComment(songId, commentId))
