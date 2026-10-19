/**
 * 快速预览: one score (or other file) shown in a side panel / bottom sheet without
 * leaving the list. A tiny shared store; the panel itself is PreviewHost.
 */
import { useSyncExternalStore } from 'react'

export interface PreviewItem {
  path: string
  /** 'score' | 'pdf' | 'image' | 'text' | other (ScoreFormat). */
  format: string
  /** Image pages (empty otherwise). */
  pages: string[]
  title: string
  artist: string
  /** The version label / file name shown in the panel. */
  label: string
}

interface PreviewState {
  item: PreviewItem | null
  siblings: PreviewItem[]
  index: number
}

const EMPTY: PreviewState = { item: null, siblings: [], index: 0 }
let state: PreviewState = EMPTY
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Opens `item` in the preview panel (replacing any other). `siblings` = the song's versions. */
export function openPreview(item: PreviewItem, siblings?: PreviewItem[]): void {
  const list = siblings && siblings.length > 0 ? siblings : [item]
  const index = Math.max(
    0,
    list.findIndex((s) => s.path === item.path),
  )
  state = { item, siblings: list, index }
  emit()
}

export function closePreview(): void {
  if (state.item === null) return
  state = EMPTY
  emit()
}

export function usePreview(): { item: PreviewItem | null; siblings: PreviewItem[]; index: number } {
  return useSyncExternalStore(subscribe, () => state)
}

const SEEN_KEY = 'gl-seen'
const SEEN_MAX = 500

function readSeen(): string[] {
  try {
    const raw = window.sessionStorage.getItem(SEEN_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

let seen: ReadonlySet<string> = new Set(readSeen())

/** Paths opened (viewer or preview) in this browser session, for the "看过" mark. */
export function markSeen(path: string): void {
  if (seen.has(path)) return
  const list = [...seen, path].slice(-SEEN_MAX)
  seen = new Set(list)
  try {
    window.sessionStorage.setItem(SEEN_KEY, JSON.stringify(list))
  } catch {
    // Storage may be blocked; the mark then lasts for this page only.
  }
  listeners.forEach((l) => l())
}

export function useSeen(): ReadonlySet<string> {
  return useSyncExternalStore(subscribe, () => seen)
}
