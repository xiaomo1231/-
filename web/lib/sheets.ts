/**
 * 简谱 / 歌词谱 uploaded for a song: one module cache per score path, the same
 * shape as band.ts. Every change replaces the list with what the server returns.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, errorText, type SheetUpload } from './api'

interface Entry {
  items: SheetUpload[]
  loaded: boolean
  error: string | null
  inflight: Promise<void> | null
}

const EMPTY: Entry = { items: [], loaded: false, error: null, inflight: null }

const cache = new Map<string, Entry>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

const entryOf = (path: string): Entry => cache.get(path) ?? EMPTY

/** Replaces one path's entry with a new object (so the snapshot changes) and tells listeners. */
function patch(path: string, change: Partial<Omit<Entry, 'inflight'>>): void {
  const prev = entryOf(path)
  cache.set(path, { ...prev, ...change })
  emit()
}

/** Reads one song's sheets from the server; a request already in flight is shared. Never rejects. */
function load(path: string): Promise<void> {
  const prev = entryOf(path)
  if (prev.inflight) return prev.inflight
  const request = api
    .sheets(path)
    .then((items) => patch(path, { items, loaded: true, error: null }))
    .catch((e: unknown) => patch(path, { loaded: true, error: errorText(e) }))
    .finally(() => {
      cache.set(path, { ...entryOf(path), inflight: null })
      emit()
    })
  cache.set(path, { ...prev, inflight: request })
  emit()
  return request
}

/** The song's uploaded sheets, in page order. Reads from the server each time the path is shown. */
export function useSheets(path: string): {
  items: SheetUpload[]
  loaded: boolean
  error: string | null
  reload: () => void
} {
  const snap = useSyncExternalStore(subscribe, () => entryOf(path))
  useEffect(() => {
    if (path) void load(path)
  }, [path])
  return {
    items: snap.items,
    loaded: snap.loaded,
    error: snap.error,
    reload: () => {
      if (path) void load(path)
    },
  }
}

/**
 * Uploads files one after another. `onProgress(done, total)` is called before the
 * first file (done = 0) and after each finished file. Stops at the first failure;
 * the files already uploaded stay in the list.
 */
export async function uploadSheets(
  path: string,
  files: File[],
  label: string,
  onProgress?: (done: number, total: number) => void,
): Promise<void> {
  const total = files.length
  onProgress?.(0, total)
  for (let i = 0; i < total; i++) {
    const file = files[i]
    try {
      const items = await api.uploadSheet({ path, label, name: file.name }, file)
      patch(path, { items, loaded: true, error: null })
    } catch (e) {
      throw new Error(`「${file.name}」上传失败（第 ${i + 1} / ${total} 个）：${errorText(e)}`)
    }
    onProgress?.(i + 1, total)
  }
}

/** Deletes one sheet (the uploader or an admin only; the server checks). */
export async function removeSheet(path: string, id: string): Promise<void> {
  const items = await api.removeSheet(id)
  patch(path, { items, loaded: true, error: null })
}

/** Moves one sheet up (dir -1) or down (dir 1) in page order. Does nothing at the ends. */
export async function moveSheet(path: string, id: string, dir: -1 | 1): Promise<void> {
  const items = entryOf(path).items
  const index = items.findIndex((s) => s.id === id)
  const target = index + dir
  if (index < 0 || target < 0 || target >= items.length) return
  const ids = items.map((s) => s.id)
  ids[index] = items[target].id
  ids[target] = id
  const next = await api.reorderSheets(path, ids)
  patch(path, { items: next, loaded: true, error: null })
}
