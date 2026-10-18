/**
 * 谱库: the page's side (ScoreLibraryApi). The app's main process lists the
 * folder (app/desktop.ts `scores`), a worker sorts the list into the library
 * and searches it; files are read straight from the folder when opened.
 */
import { desktop } from '@/app/desktop'
import { ScorePrefs } from '@/services/scorePrefsService'
import type {
  ScoreArtist,
  ScoreScan,
  ScoreSearchResult,
  ScoreSong,
} from '@/songs/scoreLibraryTypes'
import type { LibraryState, ScoreLibraryApi } from './scoreLibraryApi'
import type { WorkerRequest } from './scoreLibrary.worker'

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

let worker: Worker | null = null
let seq = 0
const pending = new Map<number, Pending>()

/** A request without its id (spread over the union's members). */
type Request = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, 'id'>
    : never
  : never

function ask<T>(req: Request): Promise<T> {
  if (!worker) {
    worker = new Worker(new URL('./scoreLibrary.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (
      e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>,
    ) => {
      const p = pending.get(e.data.id)
      if (!p) return
      pending.delete(e.data.id)
      if (e.data.ok) p.resolve(e.data.value)
      else p.reject(new Error(e.data.error ?? '谱库出错了。'))
    }
  }
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    worker!.postMessage({ ...req, id })
  })
}

/** The scan the worker holds now (one build per scan). */
let built: { scan: ScoreScan; state: LibraryState & { kind: 'ready' } } | null = null
let rootPath = ''

async function fromScan(scan: ScoreScan): Promise<LibraryState> {
  if (built?.scan === scan) return built.state
  const r = await ask<{
    categories: (LibraryState & { kind: 'ready' })['categories']
    files: number
  }>({ type: 'build', files: scan.files, merges: await ScorePrefs.merges() })
  const state = {
    kind: 'ready' as const,
    root: scan.root,
    scannedAt: scan.scannedAt,
    files: r.files,
    categories: r.categories,
  }
  built = { scan, state }
  return state
}

/** The main process's error without Electron's "Error invoking remote method…" wrapping. */
function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  if (/ENOENT/.test(msg))
    return '找不到这个文件：可能被移动、改名或删除了。点「重新扫描」更新谱库。'
  if (/EACCES|EPERM/.test(msg)) return '没有权限读取这个文件。'
  if (/EBUSY/.test(msg)) return '这个文件正被别的程序占用。'
  return msg.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

const bridge = () => {
  const d = desktop()
  if (!d?.scores) throw new Error('谱库要在应用版里用。')
  return d.scores
}

export const ScoreLibrary: ScoreLibraryApi = {
  async state() {
    const d = desktop()
    if (!d?.scores) return { kind: 'no-app' }
    const root = await d.scores.root()
    if (!root) return { kind: 'no-root' }
    rootPath = root
    if (built && built.scan.root === root) return built.state
    const cached = await d.scores.cached()
    if (!cached) return { kind: 'not-scanned', root }
    return fromScan(cached)
  },
  async pickRoot() {
    const root = await bridge().pickRoot()
    if (root && root !== rootPath) built = null
    return ScoreLibrary.state()
  },
  async rescan(onProgress) {
    const scores = bridge()
    const off = onProgress ? scores.onProgress(onProgress) : () => undefined
    try {
      const scan = await scores.scan()
      rootPath = scan.root
      return await fromScan(scan)
    } finally {
      off()
    }
  },
  artists: (groupId) => ask<ScoreArtist[]>({ type: 'artists', groupId }),
  songs: (artistId) => ask<ScoreSong[]>({ type: 'songs', artistId }),
  search: (query) => ask<ScoreSearchResult>({ type: 'search', query }),
  async read(path) {
    try {
      return await bridge().read(path)
    } catch (e) {
      throw new Error(readableError(e))
    }
  },
  async openExternal(path) {
    const err = await bridge().openExternal(path)
    if (err) throw new Error(`打不开：${err}`)
  },
  reveal: (path) => bridge().reveal(path),
  fullPath: (path) =>
    rootPath ? `${rootPath.replace(/[\\/]+$/, '')}\\${path.replace(/\//g, '\\')}` : path,

  async mergeArtist(from, to) {
    await ScorePrefs.setMerge(from, to)
    if (!built) return ScoreLibrary.state()
    const r = await ask<{
      categories: (LibraryState & { kind: 'ready' })['categories']
      files: number
    }>({ type: 'merges', merges: await ScorePrefs.merges() })
    built = {
      scan: built.scan,
      state: { ...built.state, categories: r.categories, files: r.files },
    }
    return built.state
  },
  artistsLike: (artistId) => ask<ScoreArtist[]>({ type: 'artistsLike', artistId }),
  favorites: () => ScorePrefs.favorites(),
  toggleFavorite: (row) => ScorePrefs.toggleFavorite(row),
  isFavorite: (path) => ScorePrefs.isFavorite(path),
  recent: () => ScorePrefs.recent(),
  recordOpen: (row) => ScorePrefs.recordOpen(row),
}
