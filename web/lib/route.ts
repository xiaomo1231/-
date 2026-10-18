import { useEffect, useMemo, useState } from 'react'
import { parsePages } from './format'

/** The score viewer's route: the file, how it is shown, and the header texts. */
export interface ViewerRoute {
  kind: 'viewer'
  path: string
  format: string
  pages: string[]
  title: string
  artist: string
}

export type Route =
  | { kind: 'home' }
  | { kind: 'category'; id: string }
  | { kind: 'group'; id: string; name: string; noun: string }
  | { kind: 'artist'; id: string; name: string }
  | ViewerRoute

const ROUTE_EVENT = 'scores:route'
const enc = encodeURIComponent

function decode(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/** "#/g/<id>?n=…&k=…", "#/a/<id>?n=…", "#/c/<id>", "#/v?p=…" — anything else is home. */
export function parseHash(hash: string): Route {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash
  const q = raw.indexOf('?')
  const path = q >= 0 ? raw.slice(0, q) : raw
  const qs = new URLSearchParams(q >= 0 ? raw.slice(q + 1) : '')
  const m = /^\/(c|g|a)\/(.+)$/.exec(path)
  if (m) {
    const kind = m[1]
    const id = decode(m[2] ?? '')
    if (kind === 'c') return { kind: 'category', id }
    if (kind === 'g')
      return { kind: 'group', id, name: qs.get('n') ?? '', noun: qs.get('k') ?? '歌手' }
    return { kind: 'artist', id, name: qs.get('n') ?? '' }
  }
  if (path === '/v') {
    return {
      kind: 'viewer',
      path: qs.get('p') ?? '',
      format: qs.get('f') ?? '',
      pages: parsePages(qs.get('pages')),
      title: qs.get('title') ?? '',
      artist: qs.get('artist') ?? '',
    }
  }
  return { kind: 'home' }
}

export function hrefCategory(id: string): string {
  return `#/c/${enc(id)}`
}

export function hrefGroup(g: { id: string; name: string; noun: string }): string {
  return `#/g/${enc(g.id)}?n=${enc(g.name)}&k=${enc(g.noun)}`
}

export function hrefArtist(a: { id: string; name: string }): string {
  return `#/a/${enc(a.id)}?n=${enc(a.name)}`
}

export function hrefViewer(v: {
  path: string
  format: string
  pages?: string[]
  title: string
  artist: string
}): string {
  const parts = [`p=${enc(v.path)}`, `f=${enc(v.format)}`]
  if (v.pages && v.pages.length > 0) parts.push(`pages=${enc(JSON.stringify(v.pages))}`)
  parts.push(`title=${enc(v.title)}`, `artist=${enc(v.artist)}`)
  return `#/v?${parts.join('&')}`
}

/** Pushes a history entry (so the phone's back gesture returns here) and tells the router. */
export function navigate(hash: string): void {
  if (window.location.hash === hash) return
  window.history.pushState({ sv: 1 }, '', hash)
  window.dispatchEvent(new Event(ROUTE_EVENT))
}

/** Back: the previous history entry when the app made this one, otherwise the given page. */
export function goBack(fallback: string): void {
  const state = window.history.state as { sv?: number } | null
  if (state?.sv) window.history.back()
  else navigate(fallback)
}

/** The current route; updates on back / forward and on navigate(). */
export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash)
  useEffect(() => {
    const update = () => setHash(window.location.hash)
    window.addEventListener('popstate', update)
    window.addEventListener('hashchange', update)
    window.addEventListener(ROUTE_EVENT, update)
    return () => {
      window.removeEventListener('popstate', update)
      window.removeEventListener('hashchange', update)
      window.removeEventListener(ROUTE_EVENT, update)
    }
  }, [])
  return useMemo(() => parseHash(hash), [hash])
}
