/**
 * Loads alphaTab (Guitar Pro reader, notation renderer and player) on demand.
 *
 * The standalone build lives in public/alphatab/ (copied by
 * scripts/copy-alphatab.mjs) and is added as a <script> the first time a sheet
 * is opened, so the rest of the site never downloads it. Loading it as a
 * classic script also lets alphaTab start its render / synth workers from the
 * same file, which bundling would break.
 */
import type * as AlphaTabNs from '@coderline/alphatab'

type AlphaTabModule = typeof AlphaTabNs

declare global {
  interface Window {
    alphaTab?: AlphaTabModule
  }
}

export function alphaTabBase(): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/'
  return `${base.endsWith('/') ? base : base + '/'}alphatab/`
}

/** Absolute URLs alphaTab needs (it starts workers from the script file). */
export function alphaTabUrls(): { script: string; fonts: string; soundFont: string } {
  const root = new URL(alphaTabBase(), window.location.href).href
  return { script: root + 'alphaTab.min.js', fonts: root + 'font/', soundFont: root + 'soundfont/sonivox.sf2' }
}

let loading: Promise<AlphaTabModule> | null = null

export function loadAlphaTab(): Promise<AlphaTabModule> {
  if (window.alphaTab) return Promise.resolve(window.alphaTab)
  if (loading) return loading
  loading = new Promise<AlphaTabModule>((resolve, reject) => {
    const urls = alphaTabUrls()
    // Tell alphaTab where its own files are before it initialises.
    ;(window as unknown as Record<string, string>).ALPHATAB_ROOT = urls.script
    ;(window as unknown as Record<string, string>).ALPHATAB_FONT = urls.fonts
    const el = document.createElement('script')
    el.src = urls.script
    el.async = true
    el.onload = () => (window.alphaTab ? resolve(window.alphaTab) : reject(new Error('乐谱组件加载后没有就绪。')))
    el.onerror = () => reject(new Error('乐谱组件没能加载。刷新页面再试；如果是离线状态，需要先联网打开一次。'))
    document.head.appendChild(el)
  }).catch((e) => {
    loading = null
    throw e
  })
  return loading
}
