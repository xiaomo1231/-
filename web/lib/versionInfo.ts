import { useEffect, useSyncExternalStore } from 'react'
import type { VersionInfo } from '@/songs/scoreServerTypes'
import { api } from './api'

/** A path whose info came back without bars (or not at all) may be asked again after this long. */
const RECHECK_MS = 30_000
/** Paths per request (the server accepts at most 400). */
const BATCH_MAX = 400

interface Known {
  info: VersionInfo | null
  at: number
}

/** Every answer of this page session, by path. */
const known = new Map<string, Known>()
const asked = new Set<string>()
let queue = new Set<string>()
let flushing = false
let version = 0
const listeners = new Set<() => void>()

const notify = () => {
  version += 1
  for (const l of listeners) l()
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** A complete answer (bars known) is final; anything else may be asked again later. */
const isFinal = (k: Known | undefined) => typeof k?.info?.bars === 'number' || k?.info?.unreadable === true

function needsAsk(path: string, now: number): boolean {
  if (asked.has(path)) return false
  const k = known.get(path)
  if (!k) return true
  return !isFinal(k) && now - k.at >= RECHECK_MS
}

async function flush(): Promise<void> {
  flushing = false
  const paths = [...queue]
  queue = new Set()
  for (let i = 0; i < paths.length; i += BATCH_MAX) {
    const batch = paths.slice(i, i + BATCH_MAX)
    try {
      const res = await api.versionInfo(batch)
      const at = Date.now()
      for (const p of batch) known.set(p, { info: res[p] ?? null, at })
    } catch {
      // Errors are ignored: the rows keep their fallback line and may ask again later.
    } finally {
      for (const p of batch) asked.delete(p)
    }
    notify()
  }
}

/** Asks the server for the paths not known yet, all in one request per tick. */
function request(paths: string[]): void {
  const now = Date.now()
  for (const p of paths) {
    if (!needsAsk(p, now)) continue
    asked.add(p)
    queue.add(p)
  }
  if (queue.size > 0 && !flushing) {
    flushing = true
    setTimeout(() => void flush(), 0)
  }
}

/**
 * Track list, tempo and bars of the given score files (找乐队谱 reader). Paths are
 * fetched in one batch and never again once their bars are known; rows whose info
 * is still missing show their fallback line. Pass only GP / score paths.
 */
export function useVersionInfo(paths: string[]): Record<string, VersionInfo> {
  const key = paths.join('\n')
  const ver = useSyncExternalStore(subscribe, () => version, () => version)

  useEffect(() => {
    const list = key ? key.split('\n') : []
    request(list)
    // The reader may still be working on the rest: look again later while mounted.
    if (!list.some((p) => !isFinal(known.get(p)))) return
    const timer = setTimeout(() => request(list), RECHECK_MS)
    return () => clearTimeout(timer)
  }, [key, ver])

  const out: Record<string, VersionInfo> = {}
  for (const p of key ? key.split('\n') : []) {
    const info = known.get(p)?.info
    if (info) out[p] = info
  }
  return out
}
