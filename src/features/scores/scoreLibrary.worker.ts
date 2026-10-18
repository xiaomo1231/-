/**
 * 谱库: builds the library and its search index off the page's thread (a
 * scan of ~110,000 files takes a couple of seconds to sort into songs) and
 * answers the page's questions about it.
 */
import { pinyin } from 'pinyin-pro'
import * as OpenCC from 'opencc-js'
import {
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

export type WorkerRequest =
  | { id: number; type: 'build'; files: Array<[string, number]> }
  | { id: number; type: 'artists'; groupId: string }
  | { id: number; type: 'songs'; artistId: string }
  | { id: number; type: 'search'; query: string }

let lib: ScoreLibraryData | null = null
let index: SearchIndex | null = null

function answer(req: WorkerRequest): unknown {
  if (req.type === 'build') {
    lib = buildLibrary(req.files, tools)
    index = buildSearchIndex(lib, tools)
    return { categories: lib.categories, files: lib.files }
  }
  if (!lib || !index) throw new Error('谱库还没有建好。')
  if (req.type === 'artists') return lib.artists.get(req.groupId) ?? []
  if (req.type === 'songs') return lib.songs.get(req.artistId) ?? []
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
