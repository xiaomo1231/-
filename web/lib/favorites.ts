/**
 * 收藏: the starred scores, kept on the server. One shared store, so every star
 * button and the favourites list stay in step.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, errorText, type FavoriteItem } from './api'

let items: FavoriteItem[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function load(): Promise<void> {
  if (!loading)
    loading = api
      .favorites()
      .then((list) => {
        items = list
        loaded = true
        emit()
      })
      .catch(() => {
        loading = null
      })
  return loading
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** The favourites (newest first) and whether they have been read yet. */
export function useFavorites(): { items: FavoriteItem[]; loaded: boolean } {
  useEffect(() => {
    void load()
  }, [])
  const list = useSyncExternalStore(subscribe, () => items)
  return { items: list, loaded: useSyncExternalStore(subscribe, () => loaded) }
}

export function isFavorite(path: string): boolean {
  return items.some((f) => f.path === path)
}

/** Sets (or with null clears) this user's name for one starred file. Rejects with a readable message. */
export async function renameFavorite(path: string, alias: string | null): Promise<void> {
  try {
    items = await api.renameFavorite(path, alias)
    loaded = true
    emit()
  } catch (e) {
    throw new Error(errorText(e))
  }
}

/** Sets (or with null clears) this user's name for the song heading of the listed files. */
export async function renameFavoriteSong(paths: string[], songAlias: string | null): Promise<void> {
  try {
    items = await api.renameFavoriteSong(paths, songAlias)
    loaded = true
    emit()
  } catch (e) {
    throw new Error(errorText(e))
  }
}

/** Stars or un-stars a score; resolves to whether it is starred now. Rejects with a readable message. */
export async function toggleFavorite(item: Omit<FavoriteItem, 'addedAt'>): Promise<boolean> {
  const was = isFavorite(item.path)
  try {
    items = was ? await api.removeFavorite(item.path) : await api.addFavorite(item)
    loaded = true
    emit()
    return !was
  } catch (e) {
    throw new Error(errorText(e))
  }
}
