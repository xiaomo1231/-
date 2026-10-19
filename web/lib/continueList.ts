/**
 * 继续练: one row per song the user practised or opened on this device, most recent
 * first. A song is the score's folder plus its title, so two files of one song (two
 * versions of 春日影) are one row. Pure: the caller passes the records and `now`.
 */
import type { FavoriteItem, PracticeRecord } from './api'
import type { RecentItem } from './recent'

export interface ContinueItem {
  key: string
  title: string
  artist: string
  /** The most recently used file of the song. */
  path: string
  format: string
  pages: string[]
  /** Epoch ms of the latest activity (practice or opening). */
  at: number
  /** 今天 / 昨天 / 周一…周日 / M 月 D 日 */
  when: string
  /** e.g. 上次 80% · 共练 7 分钟 · 已收藏 */
  line: string
  starred: boolean
}

export interface ContinueInput {
  practice: PracticeRecord[]
  recent: RecentItem[]
  favorites: FavoriteItem[]
  now: number
  limit?: number
}

const DAY_MS = 86_400_000
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

/** The song key: the folder the file sits in, then its title. */
export function songKey(path: string, title: string): string {
  const cut = path.lastIndexOf('/')
  const folder = cut >= 0 ? path.slice(0, cut) : ''
  return `${folder}|${title}`
}

/** Whole local calendar days from `from` to `to`. */
function calendarDays(from: number, to: number): number {
  const a = new Date(from)
  const b = new Date(to)
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / DAY_MS)
}

/** 今天 / 昨天 / 周一…周日 (the last 7 days) / M 月 D 日 in local time. */
export function whenLabel(at: number, now: number): string {
  const diff = calendarDays(at, now)
  if (diff <= 0) return '今天'
  if (diff === 1) return '昨天'
  if (diff < 7) return WEEKDAYS[new Date(at).getDay()]!
  const d = new Date(at)
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`
}

/** Practice time: 不到 1 分钟 under a minute, else whole minutes (rounded). */
function practiceTime(seconds: number): string {
  return seconds < 60 ? '不到 1 分钟' : `${Math.round(seconds / 60)} 分钟`
}

interface Activity {
  at: number
  path: string
  format: string
  pages: string[]
  title: string
  artist: string
}

export function buildContinueList(input: ContinueInput): ContinueItem[] {
  const limit = input.limit ?? 6

  // Latest recent entry per path: its format and pages describe how to open the file.
  const recentByPath = new Map<string, RecentItem>()
  for (const r of input.recent) {
    const prev = recentByPath.get(r.path)
    if (!prev || r.at > prev.at) recentByPath.set(r.path, r)
  }
  const favoriteByPath = new Map<string, FavoriteItem>()
  for (const f of input.favorites) favoriteByPath.set(f.path, f)

  const activities = new Map<string, Activity[]>()
  const practiceBySong = new Map<string, PracticeRecord[]>()
  const favoritesBySong = new Map<string, number>()
  const add = (key: string, a: Activity) => {
    const list = activities.get(key) ?? []
    list.push(a)
    activities.set(key, list)
  }

  for (const p of input.practice) {
    const key = songKey(p.path, p.title)
    const list = practiceBySong.get(key) ?? []
    list.push(p)
    practiceBySong.set(key, list)
    const r = recentByPath.get(p.path)
    const f = favoriteByPath.get(p.path)
    add(key, {
      at: p.lastAt,
      path: p.path,
      format: r?.format ?? f?.format ?? 'score',
      pages: r?.pages ?? f?.pages ?? [],
      title: p.title,
      artist: p.artist,
    })
  }
  for (const r of input.recent) {
    add(songKey(r.path, r.title), {
      at: r.at,
      path: r.path,
      format: r.format,
      pages: r.pages,
      title: r.title,
      artist: r.artist,
    })
  }
  for (const f of input.favorites) {
    const key = songKey(f.path, f.title)
    favoritesBySong.set(key, (favoritesBySong.get(key) ?? 0) + 1)
  }

  const rows: ContinueItem[] = []
  for (const [key, acts] of activities) {
    acts.sort((a, b) => b.at - a.at)
    const latest = acts[0]!
    const records = practiceBySong.get(key) ?? []
    const last = records.reduce<PracticeRecord | null>(
      (best, r) => (best === null || r.lastAt > best.lastAt ? r : best),
      null,
    )
    const seconds = records.reduce((sum, r) => sum + r.totalSeconds, 0)
    const parts = last
      ? [`上次 ${last.speedPct}%`, `共练 ${practiceTime(seconds)}`]
      : ['看过，还没练']
    const favs = favoritesBySong.get(key) ?? 0
    if (favs >= 2) parts.push(`收藏了 ${favs} 个版本`)
    else if (favs === 1) parts.push('已收藏')

    rows.push({
      key,
      title: latest.title,
      artist: latest.artist,
      path: latest.path,
      format: latest.format,
      pages: latest.pages,
      at: latest.at,
      when: whenLabel(latest.at, input.now),
      line: parts.join(' · '),
      starred: favs > 0,
    })
  }

  rows.sort((a, b) => b.at - a.at)
  return rows.slice(0, limit)
}
