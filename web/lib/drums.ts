/**
 * 鼓谱 on the web side: load the saved part (shared through a small module cache,
 * so the viewer and the editor see the latest save), the template styles, and save / remove.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'
import { api, errorText } from './api'
import { useLoad } from './useLoad'
import type { DrumPart, DrumStyleInfo } from '@/songs/drumTypes'

/** The latest known part per path (null = no saved part). Absent = never read. */
const known = new Map<string, DrumPart | null>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function publish(path: string, part: DrumPart | null): void {
  known.set(path, part)
  for (const l of listeners) l()
}

/** The latest part this page session knows for a path (undefined = not read yet). */
export function knownDrumPart(path: string): DrumPart | null | undefined {
  return known.get(path)
}

export interface DrumPartState {
  part: DrumPart | null
  /** True once the server has answered (or failed) for this path. */
  loaded: boolean
  error: string | null
  reload: () => void
}

/** The saved 鼓谱 of a score file; re-reads when the path changes or reload() is called. */
export function useDrumPart(path: string): DrumPartState {
  const [nonce, setNonce] = useState(0)
  const [fetched, setFetched] = useState<{
    path: string
    part: DrumPart | null
    error: string | null
  } | null>(null)

  const shared = useSyncExternalStore(
    subscribe,
    () => known.get(path),
    () => undefined,
  )

  useEffect(() => {
    let cancelled = false
    api.drums(path).then(
      (part) => {
        if (cancelled) return
        publish(path, part)
        setFetched({ path, part, error: null })
      },
      (e: unknown) => {
        if (!cancelled) setFetched({ path, part: null, error: errorText(e) })
      },
    )
    return () => {
      cancelled = true
    }
  }, [path, nonce])

  const reload = useCallback(() => setNonce((n) => n + 1), [])
  const own = fetched?.path === path ? fetched : null
  const part = shared !== undefined ? shared : (own?.part ?? null)
  return {
    part,
    loaded: shared !== undefined || own !== null,
    error: own?.error ?? null,
    reload,
  }
}

export interface DrumStylesState {
  styles: DrumStyleInfo[]
  loaded: boolean
  error: string | null
  reload: () => void
}

/** The template styles for the picker. */
export function useDrumStyles(): DrumStylesState {
  const [nonce, setNonce] = useState(0)
  const state = useLoad((signal) => api.drumStyles(signal), `drum-styles-${nonce}`)
  return {
    styles: state.status === 'ready' ? state.data : [],
    loaded: state.status !== 'loading',
    error: state.status === 'error' ? state.message : null,
    reload: () => setNonce((n) => n + 1),
  }
}

/** Saves the part on the server and refreshes the shared cache. */
export async function saveDrumPart(part: DrumPart): Promise<DrumPart> {
  const saved = await api.saveDrums(part)
  publish(saved.path, saved)
  return saved
}

/** Deletes the saved part (the score file is never touched). */
export async function removeDrumPart(path: string): Promise<void> {
  await api.removeDrums(path)
  publish(path, null)
}
