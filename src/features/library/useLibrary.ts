import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LibraryFolder, LibrarySong } from '@/entities/types'
import { LibraryService, type FolderAccess, type ScanResult } from '@/services/libraryService'
import { titleKey } from '@/songs/libraryNames'

export interface ArtistGroup {
  artist: string
  /** Same title (any spacing / brackets) = versions of one song. */
  titles: Array<{ key: string; title: string; versions: LibrarySong[] }>
}

/** Songs grouped by singer (未知歌手 last) and by title, sorted for Chinese. */
export function groupSongs(songs: readonly LibrarySong[]): ArtistGroup[] {
  const byArtist = new Map<string, LibrarySong[]>()
  for (const s of songs) {
    const a = s.artist.trim()
    byArtist.set(a, [...(byArtist.get(a) ?? []), s])
  }
  const zh = (a: string, b: string) => a.localeCompare(b, 'zh-Hans-CN')
  return [...byArtist.entries()]
    .sort(([a], [b]) => (a === '' ? 1 : b === '' ? -1 : zh(a, b)))
    .map(([artist, list]) => {
      const byTitle = new Map<string, LibrarySong[]>()
      for (const s of list) byTitle.set(titleKey(s.title), [...(byTitle.get(titleKey(s.title)) ?? []), s])
      return {
        artist,
        titles: [...byTitle.entries()].map(([key, versions]) => ({ key, title: versions[0]!.title, versions: versions.sort((x, y) => zh(x.fileName, y.fileName)) })).sort((x, y) => zh(x.title, y.title)),
      }
    })
}

export function matchesSearch(s: LibrarySong, q: string): boolean {
  const t = q.trim().toLowerCase()
  if (!t) return true
  return [s.title, s.artist, s.album ?? '', s.fileName].some((x) => x.toLowerCase().includes(t))
}

/**
 * The library's folders, songs and folder access, with scanning. With
 * `watch`, folders that are allowed are rescanned every few seconds while the
 * page is visible, so newly downloaded songs show up by themselves.
 */
export function useLibrary(opts: { watch?: boolean; onNew?: (r: ScanResult, folder: LibraryFolder) => void } = {}) {
  const [folders, setFolders] = useState<LibraryFolder[]>([])
  const [songs, setSongs] = useState<LibrarySong[]>([])
  const [access, setAccess] = useState<Record<string, FolderAccess>>({})
  const [scanning, setScanning] = useState<string | null>(null)
  const [loaded, setLoaded] = useState(false)
  const busy = useRef(false)
  const onNew = useRef(opts.onNew)
  onNew.current = opts.onNew

  const reload = useCallback(async () => {
    const [f, s] = await Promise.all([LibraryService.folders(), LibraryService.songs()])
    setFolders(f)
    setSongs(s)
    const a: Record<string, FolderAccess> = {}
    for (const x of f) a[x.id] = await LibraryService.access(x).catch(() => 'denied' as const)
    setAccess(a)
    setLoaded(true)
    return { folders: f, access: a }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const scan = useCallback(
    async (folder: LibraryFolder, quiet = false) => {
      if (busy.current) return null
      busy.current = true
      if (!quiet) setScanning(folder.id)
      try {
        const r = await LibraryService.scan(folder)
        if (folder.kind === 'lyrics') {
          if (r.added + r.updated + r.removed > 0 || !quiet) setFolders(await LibraryService.folders())
        } else if (r.added + r.updated + r.removed > 0 || !quiet) setSongs(await LibraryService.songs())
        if (r.added > 0) onNew.current?.(r, folder)
        return r
      } finally {
        busy.current = false
        if (!quiet) setScanning(null)
      }
    },
    [],
  )

  /** Ask for access (needs the click that calls this), then scan. */
  const allow = useCallback(
    async (folder: LibraryFolder) => {
      const state = await LibraryService.access(folder, true)
      setAccess((a) => ({ ...a, [folder.id]: state }))
      if (state === 'granted') await scan(folder)
      return state
    },
    [scan],
  )

  const addFolder = useCallback(async (kind: 'songs' | 'lyrics' = 'songs') => {
    const f = await LibraryService.pickFolder(kind)
    if (!f) return null
    await reload()
    await scan(f)
    return f
  }, [reload, scan])

  const removeFolder = useCallback(
    async (id: string) => {
      await LibraryService.removeFolder(id)
      await reload()
    },
    [reload],
  )

  const rename = useCallback(async (id: string, patch: { title?: string; artist?: string }) => {
    const next = await LibraryService.rename(id, patch)
    if (next) setSongs((all) => all.map((s) => (s.id === id ? next : s)))
  }, [])

  const replaceSong = useCallback((oldId: string, next: LibrarySong) => setSongs((all) => all.map((s) => (s.id === oldId ? next : s))), [])

  // Watch: quiet rescans while visible.
  const watch = opts.watch ?? false
  useEffect(() => {
    if (!watch) return
    const t = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      for (const f of folders) if (access[f.id] === 'granted') void scan(f, true)
    }, 8000)
    return () => clearInterval(t)
  }, [watch, folders, access, scan])

  const groups = useMemo(() => groupSongs(songs), [songs])
  return { folders, songs, groups, access, scanning, loaded, reload, scan, allow, addFolder, removeFolder, rename, replaceSong }
}
