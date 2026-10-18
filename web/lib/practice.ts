/**
 * 练习记录: one shared store over the server's practice records, the same shape as
 * favorites.ts so the home page, the favourites list and the viewer stay in step.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { api, type PracticeRecord, type PracticeUpdate } from './api'

/** Most playback one save may add, in seconds (the server caps it the same way). */
const MAX_ADD_SECONDS = 600

let items: PracticeRecord[] = []
let loaded = false
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

const byRecent = (a: PracticeRecord, b: PracticeRecord) => b.lastAt - a.lastAt

function put(rec: PracticeRecord): void {
  items = [rec, ...items.filter((p) => p.path !== rec.path)].sort(byRecent)
  emit()
}

/** Fetches the records; a request already in flight is shared, never doubled. Never rejects. */
function load(): Promise<void> {
  if (!loading)
    loading = api
      .practice()
      .then((list) => {
        // A save still on its way (sent on leaving a score) is newer than the server's copy.
        const mine = new Map(items.map((r) => [r.path, r]))
        items = list
          .map((r) => {
            const local = mine.get(r.path)
            return local && local.lastAt > r.lastAt ? local : r
          })
          .concat(items.filter((r) => !list.some((x) => x.path === r.path) && !loaded))
          .sort(byRecent)
        loaded = true
        emit()
      })
      .catch(() => undefined)
      .finally(() => {
        loading = null
      })
  return loading
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** All practice records (most recent first) and whether they have been read yet. Each mount (visit) reads the server once. */
export function usePractice(): { items: PracticeRecord[]; loaded: boolean } {
  useEffect(() => {
    void load()
  }, [])
  const list = useSyncExternalStore(subscribe, () => items)
  return { items: list, loaded: useSyncExternalStore(subscribe, () => loaded) }
}

/** The stored record for one path (undefined if none, or not loaded yet). */
export function practiceFor(path: string): PracticeRecord | undefined {
  return items.find((p) => p.path === path)
}

/** Reads the records again (another device may have practised since) and resolves the one for path. Never rejects. */
export async function loadPracticeFor(path: string): Promise<PracticeRecord | undefined> {
  await load()
  return practiceFor(path)
}

/** Sends an update and replaces the record in the store. Never throws; resolves null on error. */
export async function savePractice(u: PracticeUpdate): Promise<PracticeRecord | null> {
  try {
    const rec = await api.savePractice(u)
    put(rec)
    return rec
  } catch {
    return null
  }
}

/** The record this update would leave behind, computed locally (the server's answer comes later). */
function optimistic(u: PracticeUpdate): PracticeRecord {
  const prev = practiceFor(u.path)
  const now = Date.now()
  const add = Math.min(Math.max(u.addSeconds ?? 0, 0), MAX_ADD_SECONDS)
  return {
    path: u.path,
    title: u.title,
    artist: u.artist,
    speedPct: u.speedPct ?? prev?.speedPct ?? 100,
    loopBars: u.loopBars !== undefined ? u.loopBars : (prev?.loopBars ?? null),
    muted: u.muted ?? prev?.muted ?? [],
    totalSeconds: (prev?.totalSeconds ?? 0) + add,
    maxSpeedPct: Math.max(prev?.maxSpeedPct ?? 0, u.playedSpeedPct ?? 0),
    firstAt: prev?.firstAt ?? now,
    lastAt: now,
  }
}

/**
 * Fire-and-forget save for page unload. Uses navigator.sendBeacon, which sends the same
 * request as call() in api.ts: a JSON body (Content-Type application/json) and the session
 * cookie, with no custom header (api.ts adds none, so a beacon is enough). Falls back to
 * fetch with keepalive when sendBeacon is missing or refuses the body. The store is updated
 * optimistically.
 */
export function savePracticeOnExit(u: PracticeUpdate): void {
  put(optimistic(u))
  const json = JSON.stringify(u)
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      const ok = navigator.sendBeacon(
        '/api/practice',
        new Blob([json], { type: 'application/json' }),
      )
      if (ok) return
    }
  } catch {
    // fall through to fetch
  }
  try {
    void fetch('/api/practice', {
      method: 'POST',
      credentials: 'same-origin',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: json,
    }).catch(() => undefined)
  } catch {
    // unload path: nothing more can be done
  }
}

/** "12 分钟", "1 小时 5 分", "不到 1 分钟" */
export function fmtDuration(seconds: number): string {
  const s = Number.isFinite(seconds) ? Math.max(0, seconds) : 0
  const minutes = Math.floor(s / 60)
  if (minutes < 1) return '不到 1 分钟'
  if (minutes < 60) return `${minutes} 分钟`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} 小时` : `${h} 小时 ${m} 分`
}

/** Short line like "上次 75% · 第 12–16 小节 · 共练 25 分钟". */
export function practiceLine(r: PracticeRecord): string {
  const parts = [`上次 ${r.speedPct}%`]
  if (r.loopBars) {
    const [a, b] = r.loopBars
    parts.push(a === b ? `第 ${a} 小节` : `第 ${a}–${b} 小节`)
  }
  if (r.totalSeconds >= 60) parts.push(`共练 ${fmtDuration(r.totalSeconds)}`)
  return parts.join(' · ')
}
