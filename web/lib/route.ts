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
  /** Opened from the band's setlist: that band song's id (parts, rehearsal speed, 一起播放). */
  band: string
  /** Opened from the drum editor (试听): show the drum part right away. */
  drums: boolean
  /** A 组合乐队谱 recipe id: the parts it lists are put onto this (base) file. */
  combo: string
}

export type Route =
  | { kind: 'home' }
  | { kind: 'category'; id: string }
  | { kind: 'group'; id: string; name: string; noun: string }
  | { kind: 'artist'; id: string; name: string }
  | { kind: 'search'; q: string }
  | { kind: 'favorites' }
  | { kind: 'band' }
  | { kind: 'bandSong'; id: string }
  | { kind: 'ensembles'; q: string; need: string }
  | { kind: 'account' }
  | { kind: 'users' }
  | { kind: 'drums'; path: string; title: string; artist: string }
  | { kind: 'combine'; path: string; id: string }
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

/** "#/g/<id>?n=…&k=…", "#/a/<id>?n=…", "#/c/<id>", "#/s?q=…", "#/f", "#/v?p=…" — anything else is home. */
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
  if (path === '/s') return { kind: 'search', q: qs.get('q') ?? '' }
  if (path === '/f') return { kind: 'favorites' }
  if (path === '/b') return { kind: 'band' }
  const bs = /^\/b\/s\/(.+)$/.exec(path)
  if (bs) return { kind: 'bandSong', id: decode(bs[1] ?? '') }
  if (path === '/e') return { kind: 'ensembles', q: qs.get('q') ?? '', need: qs.get('need') ?? '' }
  if (path === '/me') return { kind: 'account' }
  if (path === '/users') return { kind: 'users' }
  if (path === '/combine') return { kind: 'combine', path: qs.get('p') ?? '', id: qs.get('id') ?? '' }
  if (path === '/d')
    return {
      kind: 'drums',
      path: qs.get('p') ?? '',
      title: qs.get('title') ?? '',
      artist: qs.get('artist') ?? '',
    }
  if (path === '/v') {
    return {
      kind: 'viewer',
      path: qs.get('p') ?? '',
      format: qs.get('f') ?? '',
      pages: parsePages(qs.get('pages')),
      title: qs.get('title') ?? '',
      artist: qs.get('artist') ?? '',
      band: qs.get('b') ?? '',
      drums: qs.get('drums') === '1',
      combo: qs.get('combo') ?? '',
    }
  }
  return { kind: 'home' }
}

/** 搜索谱, optionally with a query. */
export function hrefSearch(q = ''): string {
  return q ? `#/s?q=${enc(q)}` : '#/s'
}

export const HREF_FAVORITES = '#/f'
export const HREF_BAND = '#/b'
export const HREF_ACCOUNT = '#/me'
export const HREF_USERS = '#/users'

export function hrefBandSong(id: string): string {
  return `#/b/s/${enc(id)}`
}

/** 找乐队谱, optionally searched and filtered (need: comma list such as "guitar2,keys"). */
export function hrefEnsembles(q = '', need = ''): string {
  const parts = [q && `q=${enc(q)}`, need && `need=${enc(need)}`].filter(Boolean)
  return parts.length ? `#/e?${parts.join('&')}` : '#/e'
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
  /** Band song id when opened from the setlist. */
  band?: string
}): string {
  const parts = [`p=${enc(v.path)}`, `f=${enc(v.format)}`]
  if (v.pages && v.pages.length > 0) parts.push(`pages=${enc(JSON.stringify(v.pages))}`)
  parts.push(`title=${enc(v.title)}`, `artist=${enc(v.artist)}`)
  if (v.band) parts.push(`b=${enc(v.band)}`)
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

/** 编辑鼓谱 for a score file. */
export function hrefDrums(v: { path: string; title: string; artist: string }): string {
  return `#/d?p=${enc(v.path)}&title=${enc(v.title)}&artist=${enc(v.artist)}`
}
