/** Lyric files in the student's lyrics folders that could belong to a song (0.22.0). */
import { useCallback, useEffect, useState } from 'react'
import type { LibraryFolder } from '@/entities/types'
import { LibraryService, type LyricsLookup } from '@/services/libraryService'

/** Lyrics folders, the files matching this song, and folders that need a click to be read. */
export function useLyricLookup(title: string, artist: string) {
  const [lookup, setLookup] = useState<LyricsLookup | null>(null)
  const [hasFolders, setHasFolders] = useState(false)
  const [locked, setLocked] = useState<LibraryFolder[]>([])

  const refresh = useCallback(async () => {
    const folders = (await LibraryService.folders()).filter((f) => f.kind === 'lyrics')
    setHasFolders(folders.length > 0)
    if (!folders.length || !title.trim()) {
      setLookup(null)
      setLocked([])
      return
    }
    setLocked(await LibraryService.lyricFoldersNeedingAccess())
    setLookup(await LibraryService.findLyrics({ title, artist }))
  }, [title, artist])

  useEffect(() => {
    const t = setTimeout(() => void refresh(), 250)
    return () => clearTimeout(t)
  }, [refresh])

  /** Ask for the locked folders (needs the click that calls this) and rescan them. */
  const allow = useCallback(async () => {
    for (const f of locked)
      if ((await LibraryService.access(f, true)) === 'granted') await LibraryService.scanLyrics(f)
    await refresh()
  }, [locked, refresh])

  return { lookup, hasFolders, locked, allow, refresh }
}
