/**
 * Coming back to a list where it was left: each history entry keeps the page's
 * scroll position and small bits of its state (which songs were open, how many
 * rows were shown), so the back button returns to the same place instead of the top.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

type Saved = Record<string, unknown> & { y?: number }

const SAVE_EVERY_MS = 500

function current(): Saved {
  const s = window.history.state as unknown
  return s && typeof s === 'object' ? (s as Saved) : {}
}

function write(patch: Saved): void {
  try {
    window.history.replaceState({ ...current(), ...patch }, '')
  } catch {
    // Too many replaceState calls (Safari limits them): the next save catches up.
  }
}

/** Saves the scroll position into the current entry now (called before leaving the page). */
export function saveScroll(): void {
  write({ y: Math.round(window.scrollY) })
}

let timer: ReturnType<typeof setTimeout> | null = null

/** Keeps the scroll position of the current entry up to date (once per page load). */
export function startScrollMemory(): void {
  if ('scrollRestoration' in window.history) window.history.scrollRestoration = 'manual'
  window.addEventListener(
    'scroll',
    () => {
      if (timer) return
      timer = setTimeout(() => {
        timer = null
        saveScroll()
      }, SAVE_EVERY_MS)
    },
    { passive: true },
  )
  window.addEventListener('pagehide', saveScroll)
}

/**
 * Scrolls back to where this entry was left, once `ready` (the list is on screen).
 * A fresh visit has no saved position and stays at the top.
 */
export function useRestoreScroll(ready: boolean): void {
  const done = useRef(false)
  useLayoutEffect(() => {
    if (done.current || !ready) return
    done.current = true
    const y = current().y
    if (typeof y === 'number' && y > 0) {
      window.scrollTo(0, y)
      // Rows that lay themselves out a moment later (fonts, images) may shift it: try again.
      requestAnimationFrame(() => {
        if (Math.abs(window.scrollY - y) > 4) window.scrollTo(0, y)
      })
    }
  }, [ready])
}

/** useState whose value is kept in the current history entry under `key`. */
export function useHistoryState<T>(key: string, initial: T): [T, (v: T | ((old: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => {
    const saved = current()[key]
    return saved === undefined ? initial : (saved as T)
  })
  const ref = useRef(value)
  ref.current = value
  const set = useCallback(
    (v: T | ((old: T) => T)) => {
      const next = typeof v === 'function' ? (v as (old: T) => T)(ref.current) : v
      ref.current = next
      setValue(next)
      write({ [key]: next })
    },
    [key],
  )
  // A different entry (same page component, new route) starts from its own saved state.
  useEffect(() => {
    const onPop = () => {
      const saved = current()[key]
      setValue(saved === undefined ? initial : (saved as T))
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  return [value, set]
}
