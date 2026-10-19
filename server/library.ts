/**
 * Scanning the score folder and building the library from it. The scan lists
 * file paths and sizes only (no file is opened). The result is cached in
 * SCORES_DATA so a restart does not have to walk ~110,000 files again.
 */
import fs from 'node:fs'
import path from 'node:path'
import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import {
  buildLibrary,
  buildSearchIndex,
  type ScoreLibraryData,
  type SearchIndex,
  type TextTools,
} from '../src/songs/scoreLibrary'
import { isInside, isSkippedName, mapLimit } from './util'

export const STAT_CONCURRENCY = 32

const CACHE_VERSION = 1
const CACHE_FILE = 'library-cache.json'

/** The app's text tools (same as the desktop worker): traditional → simplified, pinyin. */
const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' })
export const tools: TextTools = {
  toSimplified: (s) => toSimplified(s),
  pinyin: (s) => pinyin(s, { toneType: 'none', type: 'array', v: true }),
}

export type FileList = Array<[string, number]>

export interface LoadedLibrary {
  lib: ScoreLibraryData
  index: SearchIndex
  scannedAt: number
  files: FileList
}

/**
 * Walks `root` iteratively (no recursion, so deep trees cannot overflow the
 * stack). Symlinked folders are not followed; symlinked files are listed only
 * when they point inside the root. Unreadable folders are skipped.
 */
export async function scanFolder(
  root: string,
  log: (msg: string) => void = () => {},
): Promise<FileList> {
  const realRoot = await fs.promises.realpath(root)
  const stack: Array<{ abs: string; rel: string }> = [{ abs: root, rel: '' }]
  const pending: Array<{ abs: string; rel: string; link: boolean }> = []
  let dirs = 0

  while (stack.length) {
    const dir = stack.pop()!
    dirs++
    if (dirs % 5000 === 0) log(`扫描中：已检查 ${dirs} 个文件夹，找到 ${pending.length} 个文件…`)
    let handle: fs.Dir
    try {
      handle = await fs.promises.opendir(dir.abs)
    } catch {
      continue
    }
    try {
      for await (const ent of handle) {
        if (isSkippedName(ent.name)) continue
        const abs = path.join(dir.abs, ent.name)
        const rel = dir.rel ? `${dir.rel}/${ent.name}` : ent.name
        if (ent.isDirectory()) stack.push({ abs, rel })
        else if (ent.isFile()) pending.push({ abs, rel, link: false })
        else if (ent.isSymbolicLink()) pending.push({ abs, rel, link: true })
      }
    } catch {
      // The folder changed or became unreadable part way: keep what was listed.
    }
  }

  const found = await mapLimit(
    pending,
    STAT_CONCURRENCY,
    async (p): Promise<[string, number] | null> => {
      try {
        let target = p.abs
        if (p.link) {
          target = await fs.promises.realpath(p.abs)
          if (!isInside(realRoot, target)) return null
        }
        const st = await fs.promises.stat(target)
        if (!st.isFile()) return null
        return [p.rel, st.size]
      } catch {
        return null
      }
    },
  )
  const files = found.filter((f): f is [string, number] => f !== null)
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
  log(`扫描完成：${files.length} 个文件，${dirs} 个文件夹。`)
  return files
}

/** Folders that have their own page instead of the artist lists: 12-每日一练 (the practice program). */
const OWN_PAGE = /^\d+-每日一练\//

/** Builds the library and its search index from a file list. */
export function loadFromFiles(files: FileList, scannedAt: number): LoadedLibrary {
  const lib = buildLibrary(
    files.filter(([p]) => !OWN_PAGE.test(p)),
    tools,
  )
  const index = buildSearchIndex(lib, tools)
  return { lib, index, scannedAt, files }
}

interface CacheFile {
  version: number
  root: string
  scannedAt: number
  files: FileList
}

function isFileList(v: unknown): v is FileList {
  return (
    Array.isArray(v) &&
    v.every(
      (e) =>
        Array.isArray(e) && e.length === 2 && typeof e[0] === 'string' && typeof e[1] === 'number',
    )
  )
}

/** The cached scan, if it is for this root (otherwise null). */
export async function readCache(
  dataDir: string,
  root: string,
): Promise<{ scannedAt: number; files: FileList } | null> {
  try {
    const raw = JSON.parse(
      await fs.promises.readFile(path.join(dataDir, CACHE_FILE), 'utf8'),
    ) as CacheFile
    if (raw.version !== CACHE_VERSION || raw.root !== root || !isFileList(raw.files)) return null
    return { scannedAt: raw.scannedAt, files: raw.files }
  } catch {
    return null
  }
}

/** Writes the cache atomically (temp file, then rename). */
export async function writeCache(
  dataDir: string,
  root: string,
  scannedAt: number,
  files: FileList,
): Promise<void> {
  const body: CacheFile = { version: CACHE_VERSION, root, scannedAt, files }
  const target = path.join(dataDir, CACHE_FILE)
  const tmp = `${target}.tmp`
  await fs.promises.writeFile(tmp, JSON.stringify(body), { mode: 0o600 })
  await fs.promises.rename(tmp, target)
}
