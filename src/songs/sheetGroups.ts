/**
 * "我的谱子" organisation (pure): sheets grouped by singer, and sheets with the
 * same title by the same singer folded into one song with several versions.
 */
import type { SongSheet } from '@/entities/types'
import { FORMAT_LABEL, normalizeTitle, type SheetFormat } from '@/import/gpImport'

export const UNKNOWN_ARTIST = '未填写演唱者'

export interface SongGroup {
  /** artistKey|titleKey */
  key: string
  title: string
  artist: string
  /** Most recently opened (or updated) first: the default version. */
  versions: SongSheet[]
  /** Latest activity in the group, for sorting. */
  lastActive: number
}

export interface ArtistGroup {
  key: string
  /** Display name ("未填写演唱者" when empty). */
  artist: string
  known: boolean
  songs: SongGroup[]
}

export type SheetSort = 'recent' | 'title' | 'created'

export function sheetFormat(s: SongSheet): SheetFormat {
  if (s.format) return s.format
  return s.source === 'gp' ? 'gp' : s.source
}

const activity = (s: SongSheet) => Math.max(s.lastOpenedAt ?? 0, s.lastPracticedAt ?? 0, s.updatedAt)

/** Sheets by singer → same-title songs → versions. Unknown singer comes last. */
export function groupSheets(sheets: readonly SongSheet[], sort: SheetSort = 'recent'): ArtistGroup[] {
  const artists = new Map<string, ArtistGroup>()
  for (const s of sheets) {
    const name = s.artist?.trim() ?? ''
    const aKey = normalizeTitle(name)
    let a = artists.get(aKey)
    if (!a) {
      a = { key: aKey || '~unknown', artist: name || UNKNOWN_ARTIST, known: Boolean(name), songs: [] }
      artists.set(aKey, a)
    }
    const tKey = normalizeTitle(s.title) || s.id
    const key = `${a.key}|${tKey}`
    let g = a.songs.find((x) => x.key === key)
    if (!g) {
      g = { key, title: s.title, artist: a.artist, versions: [], lastActive: 0 }
      a.songs.push(g)
    }
    g.versions.push(s)
    g.lastActive = Math.max(g.lastActive, activity(s))
  }
  const byTitle = (x: string, y: string) => x.localeCompare(y, 'zh-Hans-CN')
  const out = [...artists.values()]
  for (const a of out) {
    for (const g of a.songs) {
      g.versions.sort((x, y) => activity(y) - activity(x))
      g.title = g.versions[0]!.title
    }
    a.songs.sort((x, y) => {
      if (sort === 'title') return byTitle(x.title, y.title)
      if (sort === 'created') return Math.max(...y.versions.map((v) => v.createdAt)) - Math.max(...x.versions.map((v) => v.createdAt))
      return y.lastActive - x.lastActive
    })
  }
  return out.sort((x, y) => (x.known !== y.known ? (x.known ? -1 : 1) : byTitle(x.artist, y.artist)))
}

/** Label of one version in the picker: the student's name for it, else format · tabber · date. */
export function versionLabel(s: SongSheet): string {
  if (s.versionLabel) return s.versionLabel
  const d = new Date(s.createdAt)
  const date = `${d.getMonth() + 1} 月 ${d.getDate()} 日导入`
  return [FORMAT_LABEL[sheetFormat(s)], s.tabber ? `制谱 ${s.tabber}` : null, date].filter(Boolean).join(' · ')
}

/** Filter by a search string over title, singer, version name and tags. */
export function matchesSearch(s: SongSheet, q: string): boolean {
  const needle = normalizeTitle(q)
  if (!needle) return true
  return [s.title, s.artist ?? '', s.versionLabel ?? '', s.tabber ?? '', ...(s.tags ?? [])].some((t) => normalizeTitle(t).includes(needle))
}
