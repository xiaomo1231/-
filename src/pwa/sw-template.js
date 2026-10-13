/* GrooveLab service worker (generated at build time from src/pwa/sw-template.js).
 *
 * - The build inlines { version, files } below: every
 *   built file. Install caches all of it, so lessons, drills and the studio
 *   work offline. A new build changes this file, which triggers an update.
 * - Page navigations go to the network first and fall back to the cached app.
 * - Google Fonts and the optional sampled piano are cached as they are used.
 * - Nothing else is touched: AI requests (POST, other hosts) always go to the
 *   network and are never cached.
 */
/* global self, caches, fetch, Response, URL */
const PRECACHE = __PRECACHE__
const SHELL = `groovelab-shell-${PRECACHE.version}`
const RUNTIME = 'groovelab-runtime'
const RUNTIME_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com', 'tonejs.github.io']

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(PRECACHE.files)))
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys()
      await Promise.all(keys.filter((k) => k.startsWith('groovelab-shell-') && k !== SHELL).map((k) => caches.delete(k)))
      await self.clients.claim()
    })(),
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return
  const url = new URL(req.url)

  if (url.origin === self.location.origin) {
    if (req.mode === 'navigate') {
      event.respondWith(fetch(req).catch(async () => (await caches.match('/index.html', { cacheName: SHELL })) ?? Response.error()))
      return
    }
    event.respondWith(caches.match(req, { cacheName: SHELL }).then((hit) => hit ?? fetch(req)))
    return
  }

  if (RUNTIME_HOSTS.includes(url.hostname)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME)
        const hit = await cache.match(req)
        if (hit) return hit
        const res = await fetch(req)
        if (res.ok || res.type === 'opaque') await cache.put(req, res.clone())
        return res
      })(),
    )
  }
})
