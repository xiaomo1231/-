/**
 * 组合乐队谱 (combined band score) data: cached version scores for the browser,
 * the song's recipes, and the route helper for the combine page.
 */
import { useState } from 'react'
import type { Score } from '../viewer/alphaTab'
import { loadAlphaTab, chooseEncoding } from '../viewer/alphaTab'
import { api, fetchBytes, fileUrl, type ComboRecipe } from './api'
import { hrefViewer } from './route'
import { useLoad, type Loaded } from './useLoad'

const enc = encodeURIComponent

/** Parses one library file with alphaTab (no cache). Every call gives a fresh Score. */
export async function loadVersionScoreFresh(path: string): Promise<Score> {
  const at = await loadAlphaTab()
  const bytes = await fetchBytes(fileUrl(path))
  const settings = new at.Settings()
  settings.importer.encoding = chooseEncoding(at, bytes)
  return at.importer.ScoreLoader.loadScoreFromBytes(bytes, settings)
}

const cache = new Map<string, Promise<Score>>()

/**
 * A version's parsed score, cached per path for the page's lifetime. Do not
 * mutate the result (use loadVersionScoreFresh when a function will change it).
 * A failed read is not cached, so a retry works.
 */
export function loadVersionScore(path: string): Promise<Score> {
  let hit = cache.get(path)
  if (!hit) {
    hit = loadVersionScoreFresh(path)
    cache.set(path, hit)
    hit.catch(() => {
      if (cache.get(path) === hit) cache.delete(path)
    })
  }
  return hit
}

/** The recipes of one song (list reloads with reload()). */
export function useSongCombos(path: string): { state: Loaded<ComboRecipe[]>; reload: () => void } {
  const [tick, setTick] = useState(0)
  const state = useLoad((signal) => api.combos(path, signal), `${path}\u0000${tick}`)
  return { state, reload: () => setTick((t) => t + 1) }
}

/** The combine page's route: `#/combine?p=<song file>` to make one, `&id=` to edit a recipe. */
export function hrefCombine(path: string, id?: string): string {
  return `#/combine?p=${enc(path)}${id ? `&id=${enc(id)}` : ''}`
}

/** The viewer link that shows a recipe (the viewer loads it by id). */
export function hrefComboViewer(recipe: Pick<ComboRecipe, 'id' | 'base' | 'title' | 'artist'>): string {
  return (
    hrefViewer({ path: recipe.base, format: 'score', title: recipe.title, artist: recipe.artist }) +
    `&combo=${enc(recipe.id)}`
  )
}
