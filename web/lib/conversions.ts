/**
 * PDF 转换版 (GP5 converted from a text tab PDF): one module cache per song path,
 * the same shape as sheets.ts. Every change replaces the list with what the server returns.
 */
import { useSyncExternalStore, useEffect } from 'react'
import type { ConversionRecord } from '@/songs/scoreServerTypes'
import { api, errorText } from './api'

interface Entry {
  items: ConversionRecord[]
  loaded: boolean
  error: string | null
  inflight: Promise<void> | null
  /** A conversion of this path is running (the server call can take about a minute). */
  converting: boolean
}

const EMPTY: Entry = { items: [], loaded: false, error: null, inflight: null, converting: false }

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

function patch(path: string, change: Partial<Omit<Entry, 'inflight'>>): void {
  const prev = entryOf(path)
  cache.set(path, { ...prev, ...change })
  emit()
}

/** Newest first. */
function sortNewest(items: ConversionRecord[]): ConversionRecord[] {
  return [...items].sort((a, b) => b.createdAt - a.createdAt)
}

/** Reads one song's conversions; a request already in flight is shared. Never rejects. */
function load(path: string): Promise<void> {
  const prev = entryOf(path)
  if (prev.inflight) return prev.inflight
  const request = api
    .conversions(path)
    .then((items) => patch(path, { items: sortNewest(items), loaded: true, error: null }))
    .catch((e: unknown) => patch(path, { loaded: true, error: errorText(e) }))
    .finally(() => {
      cache.set(path, { ...entryOf(path), inflight: null })
      emit()
    })
  cache.set(path, { ...prev, inflight: request })
  emit()
  return request
}

/** The song's conversions, newest first. Reads from the server each time the path is shown. */
export function useConversions(path: string): {
  items: ConversionRecord[]
  loaded: boolean
  error: string | null
  converting: boolean
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
    converting: snap.converting,
    reload: () => {
      if (path) void load(path)
    },
  }
}

/**
 * Converts this one PDF (never the whole song). Resolves with the new record and
 * puts it at the top of the list; rejects with the server's Chinese message.
 */
export async function convertPdf(path: string): Promise<ConversionRecord> {
  patch(path, { converting: true })
  try {
    const record = await api.startConversion(path)
    const others = entryOf(path).items.filter((c) => c.id !== record.id)
    patch(path, { items: sortNewest([record, ...others]), loaded: true, error: null })
    return record
  } finally {
    patch(path, { converting: false })
  }
}

/** Sets the signed-in user's stars (1–5) and replaces the record with the server's copy. */
export async function rate(path: string, id: string, stars: number): Promise<ConversionRecord> {
  const record = await api.rateConversion(id, stars)
  const items = entryOf(path).items.map((c) => (c.id === id ? record : c))
  patch(path, { items: sortNewest(items), loaded: true, error: null })
  return record
}

/** Deletes one conversion (its creator or an admin; the server checks). */
export async function remove(path: string, id: string): Promise<void> {
  await api.removeConversion(id)
  const items = entryOf(path).items.filter((c) => c.id !== id)
  patch(path, { items, loaded: true, error: null })
}
