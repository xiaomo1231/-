/**
 * 最近看过: the scores opened on this device (kept in this browser only, newest
 * first). The viewer records an open; the home page lists them.
 */
import type { ViewerRoute } from './route'

export interface RecentItem {
  path: string
  format: string
  pages: string[]
  title: string
  artist: string
  at: number
}

const KEY = 'groovelab:scores:recent'
const MAX = 12

export function readRecent(): RecentItem[] {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v)
      ? v.filter(
          (r): r is RecentItem =>
            typeof r === 'object' && r !== null && typeof (r as RecentItem).path === 'string',
        )
      : []
  } catch {
    return []
  }
}

export function recordRecent(route: ViewerRoute): void {
  if (!route.path) return
  const item: RecentItem = {
    path: route.path,
    format: route.format,
    pages: route.pages,
    title: route.title,
    artist: route.artist,
    at: Date.now(),
  }
  try {
    const next = [item, ...readRecent().filter((r) => r.path !== route.path)].slice(0, MAX)
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // storage blocked (private mode): nothing is remembered
  }
}

export function clearRecent(): void {
  try {
    localStorage.removeItem(KEY)
  } catch {
    // storage blocked
  }
}
