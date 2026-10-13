import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Runs the service-worker template in a simulated worker scope: a fake
 * Cache Storage, fetch that can go offline, and captured event listeners.
 */
type Listener = (e: { request?: Request; data?: unknown; waitUntil?: (p: Promise<unknown>) => void; respondWith?: (p: Promise<Response> | Response) => void }) => void

function setup(files: string[]) {
  const stores = new Map<string, Map<string, Response>>()
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map())
    const m = stores.get(name)!
    const key = (r: Request | string) => new URL(typeof r === 'string' ? r : r.url, 'http://app.test').pathname + (typeof r === 'string' ? '' : new URL(r.url).search) || '/'
    return {
      addAll: async (urls: string[]) => urls.forEach((u) => m.set(key(u), new Response(`cached:${u}`))),
      put: async (r: Request, res: Response) => void m.set(new URL(r.url).href, res),
      match: async (r: Request | string) => m.get(key(r)) ?? m.get(typeof r === 'string' ? r : r.url),
    }
  }
  const caches = {
    open,
    keys: async () => [...stores.keys()],
    delete: async (k: string) => stores.delete(k),
    match: async (r: Request | string, opts?: { cacheName?: string }) => (opts?.cacheName ? (await open(opts.cacheName)).match(r) : undefined),
  }
  let online = true
  const fetched: string[] = []
  const fetchFn = async (r: Request | string) => {
    const url = typeof r === 'string' ? r : r.url
    fetched.push(url)
    if (!online) throw new TypeError('Failed to fetch')
    return new Response(`net:${url}`)
  }
  const listeners: Record<string, Listener> = {}
  const self = {
    location: { origin: 'http://app.test' },
    addEventListener: (type: string, fn: Listener) => (listeners[type] = fn),
    clients: { claim: async () => undefined },
    skipWaiting: () => undefined,
  }
  const template = readFileSync(resolve(__dirname, '../src/pwa/sw-template.js'), 'utf8').replace('const PRECACHE = __PRECACHE__', `const PRECACHE = ${JSON.stringify({ version: 'v1', files })}`)
  new Function('self', 'caches', 'fetch', 'Response', 'URL', template)(self, caches, fetchFn, Response, URL)

  async function dispatch(type: string, request?: Request): Promise<Response | undefined> {
    let waited: Promise<unknown> | undefined
    let responded: Promise<Response> | Response | undefined
    listeners[type]!({ ...(request ? { request } : {}), waitUntil: (p) => (waited = p), respondWith: (p) => (responded = p) })
    await waited
    return responded ? await responded : undefined
  }
  return { stores, dispatch, setOnline: (v: boolean) => (online = v), fetched }
}

const nav = (url: string) => {
  const r = new Request(url)
  Object.defineProperty(r, 'mode', { value: 'navigate' })
  return r
}

describe('service worker', () => {
  it('precaches the app and serves it offline', async () => {
    const sw = setup(['/', '/index.html', '/assets/app-abc.js'])
    await sw.dispatch('install')
    await sw.dispatch('activate')
    expect([...sw.stores.keys()]).toEqual(['groovelab-shell-v1'])

    // Online: navigations go to the network.
    expect(await (await sw.dispatch('fetch', nav('http://app.test/camp')))!.text()).toBe('net:http://app.test/camp')
    // Offline: the cached app shell answers any route.
    sw.setOnline(false)
    expect(await (await sw.dispatch('fetch', nav('http://app.test/studio')))!.text()).toBe('cached:/index.html')
    // Hashed assets come from the cache without the network.
    expect(await (await sw.dispatch('fetch', new Request('http://app.test/assets/app-abc.js')))!.text()).toBe('cached:/assets/app-abc.js')
  })

  it('never touches AI requests and caches samples for later', async () => {
    const sw = setup(['/'])
    await sw.dispatch('install')
    expect(await sw.dispatch('fetch', new Request('https://api.deepseek.com/v1/chat/completions', { method: 'POST', body: '{}' }))).toBeUndefined()
    expect(await sw.dispatch('fetch', new Request('https://api.deepseek.com/v1/models'))).toBeUndefined()
    const sample = 'https://tonejs.github.io/audio/salamander/C4.mp3'
    expect(await (await sw.dispatch('fetch', new Request(sample)))!.text()).toBe(`net:${sample}`)
    sw.setOnline(false)
    expect(await (await sw.dispatch('fetch', new Request(sample)))!.text()).toBe(`net:${sample}`)
  })

  it('a new version removes the old shell', async () => {
    const sw = setup(['/'])
    sw.stores.set('groovelab-shell-old', new Map())
    sw.stores.set('groovelab-runtime', new Map())
    await sw.dispatch('install')
    await sw.dispatch('activate')
    expect([...sw.stores.keys()].sort()).toEqual(['groovelab-runtime', 'groovelab-shell-v1'])
  })
})
