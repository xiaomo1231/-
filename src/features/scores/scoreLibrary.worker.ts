/**
 * 谱库: builds the library and its search index off the page's thread (a
 * scan of ~110,000 files takes a couple of seconds to sort into songs) and
 * answers the page's questions about it. The unmerged library is kept, so the
 * student's artist merges can be applied again without a new scan.
 */
import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import {
  applyMerges,
  buildLibrary,
  buildSearchIndex,
  search,
  type ScoreLibraryData,
  type SearchIndex,
  type TextTools,
} from '@/songs/scoreLibrary'

const toSimplified = OpenCC.Converter({ from: 't', to: 'cn' })
const tools: TextTools = {
  toSimplified: (s) => toSimplified(s),
  pinyin: (s) => pinyin(s, { toneType: 'none', type: 'array', v: true }),
}

/** Artists suggested as merge targets. */
const LIKE_LIMIT = 10

export type WorkerRequest =
  | { id: number; type: 'build'; files: Array<[string, number]>; merges: Array<[string, string]> }
  | { id: number; type: 'merges'; merges: Array<[string, string]> }
  | { id: number; type: 'artists'; groupId: string }
  | { id: number; type: 'songs'; artistId: string }
  | { id: number; type: 'search'; query: string }
  | { id: number; type: 'artistsLike'; artistId: string }

/** The library as scanned, before the student's merges. */
let unmerged: ScoreLibraryData | null = null
let lib: ScoreLibraryData | null = null
let index: SearchIndex | null = null

function applyAll(merges: Array<[string, string]>): unknown {
  if (!unmerged) throw new Error('谱库还没有建好。')
  lib = applyMerges(unmerged, merges, tools)
  index = buildSearchIndex(lib, tools)
  return { categories: lib.categories, files: lib.files }
}

function answer(req: WorkerRequest): unknown {
  if (req.type === 'build') {
    unmerged = buildLibrary(req.files, tools)
    return applyAll(req.merges)
  }
  if (req.type === 'merges') return applyAll(req.merges)
  if (!lib || !index) throw new Error('谱库还没有建好。')
  if (req.type === 'artists') return lib.artists.get(req.groupId) ?? []
  if (req.type === 'songs') return lib.songs.get(req.artistId) ?? []
  if (req.type === 'artistsLike') {
    const self = lib.artistById.get(req.artistId)
    if (!self) return []
    return search(lib, index, self.name, tools)
      .artists.filter((a) => a.id !== self.id)
      .slice(0, LIKE_LIMIT)
  }
  return search(lib, index, req.query, tools)
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  try {
    self.postMessage({ id: e.data.id, ok: true, value: answer(e.data) })
  } catch (err) {
    self.postMessage({
      id: e.data.id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
