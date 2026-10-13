/**
 * 歌曲库 (0.18.0): folders on this computer that the student chose, and the
 * songs in them. Uses the browser's folder access (Chrome / Edge): a folder is
 * picked once, its handle is kept in IndexedDB, and reading it again after a
 * restart needs one click to allow. Songs are never copied or uploaded; only
 * their names and tags are listed, and a song's file is read when it is used.
 */
import { uuid } from '@/infrastructure/crypto/crypto'
import { getDb } from '@/infrastructure/db/database'
import type { LibraryFolder, LibrarySong } from '@/entities/types'
import { HEAD_BYTES, TAIL_BYTES, parseTags } from '@/audio/library/tags'
import { artistKey, cleanFileName, decideName, tidyFileName, type SongTags } from '@/songs/libraryNames'

export const AUDIO_EXT = /\.(mp3|flac|m4a|aac|wav|ogg|opus|webm)$/i
/** Folders deeper than this are not searched (keeps a scan of a whole drive from running forever). */
const MAX_DEPTH = 6
const MAX_FILES = 5000

export type FolderAccess = 'granted' | 'prompt' | 'denied'

interface DirHandle {
  kind: 'directory'
  name: string
  values(): AsyncIterable<DirHandle | FileHandle>
  getDirectoryHandle(name: string): Promise<DirHandle>
  getFileHandle(name: string): Promise<FileHandle>
  queryPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(o: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  isSameEntry?(other: unknown): Promise<boolean>
}
interface FileHandle {
  kind: 'file'
  name: string
  getFile(): Promise<File>
  move?(name: string): Promise<void>
}

/** Handles of this session (tests use plain objects that do not survive IndexedDB). */
const live = new Map<string, DirHandle>()
const handleOf = (f: LibraryFolder) => live.get(f.id) ?? (f.handle as unknown as DirHandle)

export interface ScanResult {
  added: number
  updated: number
  removed: number
  total: number
}

async function walk(dir: DirHandle, prefix: string, depth: number, out: Array<{ path: string; handle: FileHandle; parent: string }>): Promise<void> {
  if (depth > MAX_DEPTH || out.length >= MAX_FILES) return
  for await (const entry of dir.values()) {
    if (out.length >= MAX_FILES) return
    if (entry.kind === 'file') {
      if (AUDIO_EXT.test(entry.name)) out.push({ path: prefix + entry.name, handle: entry, parent: dir.name })
    } else if (!entry.name.startsWith('.')) {
      await walk(entry, `${prefix}${entry.name}/`, depth + 1, out)
    }
  }
}

async function readEnds(file: File): Promise<{ head: Uint8Array; tail: Uint8Array }> {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer())
  const tail = file.size > HEAD_BYTES ? new Uint8Array(await file.slice(Math.max(HEAD_BYTES, file.size - TAIL_BYTES)).arrayBuffer()) : head
  return { head, tail }
}

export const LibraryService = {
  /** Folder access exists in this browser (Chrome / Edge on a computer). */
  supported(): boolean {
    return typeof window !== 'undefined' && 'showDirectoryPicker' in window
  },

  async folders(): Promise<LibraryFolder[]> {
    return (await getDb().libraryFolders.toArray()).sort((a, b) => a.addedAt - b.addedAt)
  },

  async songs(): Promise<LibrarySong[]> {
    return getDb().librarySongs.toArray()
  },

  /** Ask the student for a folder (the browser's own picker). Null when they cancel. */
  async pickFolder(): Promise<LibraryFolder | null> {
    const picker = (window as unknown as { showDirectoryPicker(o?: unknown): Promise<DirHandle> }).showDirectoryPicker
    let handle: DirHandle
    try {
      handle = await picker({ id: 'groovelab-library', mode: 'read' })
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return null
      throw e
    }
    return this.addFolder(handle)
  },

  /** Keep a folder (the same folder twice is kept once). */
  async addFolder(handle: DirHandle): Promise<LibraryFolder> {
    for (const f of await this.folders()) {
      if (await handleOf(f).isSameEntry?.(handle).catch(() => false)) {
        live.set(f.id, handle)
        return f
      }
    }
    const row: LibraryFolder = { id: uuid(), name: handle.name, handle: handle as unknown as FileSystemDirectoryHandle, addedAt: Date.now() }
    live.set(row.id, handle)
    try {
      await getDb().libraryFolders.put(row)
    } catch {
      // A handle that cannot be stored (tests): keep it for this session.
      await getDb().libraryFolders.put({ ...row, handle: null as unknown as FileSystemDirectoryHandle })
    }
    return row
  },

  async removeFolder(id: string): Promise<void> {
    const db = getDb()
    await db.transaction('rw', db.libraryFolders, db.librarySongs, async () => {
      await db.librarySongs.where('folderId').equals(id).delete()
      await db.libraryFolders.delete(id)
    })
    live.delete(id)
  },

  /** Can the folder be read now? With `ask`, shows the browser's prompt (needs a click). */
  async access(folder: LibraryFolder, ask = false, mode: 'read' | 'readwrite' = 'read'): Promise<FolderAccess> {
    const h = handleOf(folder)
    if (!h) return 'denied'
    if (!h.queryPermission) return 'granted'
    const state = await h.queryPermission({ mode })
    if (state === 'granted' || !ask || !h.requestPermission) return state as FolderAccess
    return (await h.requestPermission({ mode })) as FolderAccess
  },

  /**
   * Bring a folder's list up to date: new and changed files get their tags
   * read and their names worked out; files that are gone are removed. Names the
   * student edited stay.
   */
  async scan(folder: LibraryFolder, onProgress?: (done: number, total: number) => void): Promise<ScanResult> {
    const db = getDb()
    const files: Array<{ path: string; handle: FileHandle; parent: string }> = []
    await walk(handleOf(folder), '', 0, files)
    const existing = new Map((await db.librarySongs.where('folderId').equals(folder.id).toArray()).map((s) => [s.id, s]))
    const seen = new Set<string>()
    const put: LibrarySong[] = []
    // Pass 1 reads tags; singers found anywhere in the library help split "歌名 - 歌手" in pass 2.
    const fresh: Array<{ f: (typeof files)[number]; file: File; tags: SongTags | null; old: LibrarySong | undefined }> = []
    for (const [i, f] of files.entries()) {
      const id = `${folder.id}/${f.path}`
      seen.add(id)
      const file = await f.handle.getFile()
      const old = existing.get(id)
      if (old && old.size === file.size && old.lastModified === file.lastModified) continue
      let tags: SongTags | null = null
      try {
        const { head, tail } = await readEnds(file)
        tags = parseTags(head, tail)
      } catch {
        // unreadable: name from the file name
      }
      fresh.push({ f, file, tags, old })
      if (i % 20 === 0) onProgress?.(i, files.length)
    }
    // Singer evidence across the library: tags and edited names count 3, every
    // "a - b" file name counts a as a singer (+1) and b as a title (−1), the
    // usual download layout. Files with the same two names (either order) do
    // not vote for each other: when they disagree nothing can be told, so they
    // keep the usual order and are marked for checking.
    const votes = new Map<string, number>()
    const byPair = new Map<string, Map<string, number>>()
    const orders = new Map<string, Set<string>>()
    const vote = (k: string, n: number, pair?: string) => {
      if (!k) return
      votes.set(k, (votes.get(k) ?? 0) + n)
      if (pair) {
        const m = byPair.get(pair) ?? new Map<string, number>()
        m.set(k, (m.get(k) ?? 0) + n)
        byPair.set(pair, m)
      }
    }
    const pairOf = new Map<string, { pair: string; order: string }>()
    for (const s of await db.librarySongs.where('folderId').notEqual(folder.id).toArray()) if (s.artist && s.source !== 'filename') vote(artistKey(s.artist), 3)
    for (const s of existing.values()) if (s.artist && s.source !== 'filename' && !fresh.some((x) => x.old?.id === s.id)) vote(artistKey(s.artist), 3)
    for (const x of fresh) {
      if (x.tags?.artist) vote(artistKey(x.tags.artist), 3)
      const parts = cleanFileName(x.file.name).split(/\s+[-–—]\s+/)
      if (parts.length >= 2) {
        const ka = artistKey(parts[0]!)
        const kb = artistKey(parts.slice(1).join(' - '))
        const pair = [ka, kb].sort().join('|')
        const order = `${ka}>${kb}`
        vote(ka, 1, pair)
        vote(kb, -1, pair)
        pairOf.set(x.f.path, { pair, order })
        orders.set(pair, (orders.get(pair) ?? new Set()).add(order))
      }
    }
    let added = 0
    let updated = 0
    for (const { f, file, tags, old } of fresh) {
      const id = `${folder.id}/${f.path}`
      const parent = f.path.includes('/') ? f.parent : undefined
      const mine = pairOf.get(f.path)
      const same = mine ? byPair.get(mine.pair) : undefined
      const score = (k: string) => (votes.get(k) ?? 0) - (same?.get(k) ?? 0)
      const decided = decideName(file.name, tags, parent, score)
      const conflicting = !tags?.title && mine !== undefined && (orders.get(mine.pair)?.size ?? 0) > 1
      const name = conflicting ? { ...decided, needsReview: true } : decided
      const row: LibrarySong = {
        id,
        folderId: folder.id,
        path: f.path,
        fileName: file.name,
        size: file.size,
        lastModified: file.lastModified,
        ...(old?.source === 'manual' ? { title: old.title, artist: old.artist, source: 'manual' as const, needsReview: false } : { title: name.title, artist: name.artist, source: name.source, needsReview: name.needsReview }),
        ...(tags?.album ? { album: tags.album } : {}),
        addedAt: old?.addedAt ?? Date.now(),
      }
      put.push(row)
      if (old) updated++
      else added++
    }
    const gone = [...existing.keys()].filter((id) => !seen.has(id))
    await db.transaction('rw', db.librarySongs, db.libraryFolders, async () => {
      if (put.length) await db.librarySongs.bulkPut(put)
      if (gone.length) await db.librarySongs.bulkDelete(gone)
      await db.libraryFolders.update(folder.id, { lastScanAt: Date.now() })
    })
    onProgress?.(files.length, files.length)
    return { added, updated, removed: gone.length, total: files.length }
  },

  /** The student's own name for a song (never overwritten by a rescan). */
  async rename(id: string, patch: { title?: string; artist?: string }): Promise<LibrarySong | undefined> {
    const db = getDb()
    const s = await db.librarySongs.get(id)
    if (!s) return undefined
    const next: LibrarySong = { ...s, ...(patch.title !== undefined ? { title: patch.title.trim() || s.title } : {}), ...(patch.artist !== undefined ? { artist: patch.artist.trim() } : {}), source: 'manual', needsReview: false }
    await db.librarySongs.put(next)
    return next
  },

  async fileHandle(song: LibrarySong): Promise<FileHandle> {
    const folder = await getDb().libraryFolders.get(song.folderId)
    if (!folder) throw new Error('这首歌所在的文件夹已经从歌曲库移除。')
    let dir = handleOf(folder)
    const parts = song.path.split('/')
    for (const p of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(p)
    return dir.getFileHandle(parts[parts.length - 1]!)
  },

  /** The song's file, read from disk now (the folder must be allowed). */
  async file(song: LibrarySong): Promise<File> {
    try {
      return await (await this.fileHandle(song)).getFile()
    } catch (e) {
      if (e instanceof DOMException && e.name === 'NotFoundError') throw new Error('找不到这个文件了，可能被移动或删除。请重新扫描歌曲库。')
      if (e instanceof DOMException && e.name === 'NotAllowedError') throw new Error('浏览器还没允许读取这个文件夹。请在歌曲库里点「允许访问」。')
      throw e
    }
  },

  /** Renaming files on disk is possible here (needs Chrome 111+ and write access). */
  canRenameOnDisk(): boolean {
    return typeof FileSystemHandle !== 'undefined' && 'move' in FileSystemHandle.prototype
  },

  /**
   * Write the tidy name back to the file on disk ("歌手 - 歌名.ext"). The
   * caller has asked the student first. Returns the updated row.
   */
  async renameOnDisk(song: LibrarySong): Promise<LibrarySong> {
    const db = getDb()
    const folder = await db.libraryFolders.get(song.folderId)
    if (!folder) throw new Error('这首歌所在的文件夹已经从歌曲库移除。')
    if ((await this.access(folder, true, 'readwrite')) !== 'granted') throw new Error('需要允许修改这个文件夹里的文件，才能改文件名。')
    const handle = await this.fileHandle(song)
    if (!handle.move) throw new Error('这个浏览器不支持直接改文件名（需要较新的 Chrome / Edge）。')
    const name = tidyFileName(song, song.fileName)
    if (name === song.fileName) return song
    await handle.move(name)
    const dirPath = song.path.slice(0, song.path.length - song.fileName.length)
    const file = await handle.getFile()
    const next: LibrarySong = { ...song, id: `${song.folderId}/${dirPath}${name}`, path: `${dirPath}${name}`, fileName: name, lastModified: file.lastModified, size: file.size }
    await db.transaction('rw', db.librarySongs, async () => {
      await db.librarySongs.delete(song.id)
      await db.librarySongs.put(next)
    })
    return next
  },
}
