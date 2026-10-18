/**
 * The bridge the page sees as `window.groovelab` (types: src/app/desktop.ts).
 * Only these calls cross over; the page gets no Node or Electron access.
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('groovelab', {
  isApp: true,
  version: ipcRenderer.sendSync('app:version') as string,
  mdx: {
    init: () => ipcRenderer.invoke('mdx:init'),
    run: (left: Float32Array[], right: Float32Array[]) =>
      ipcRenderer.invoke('mdx:run', left, right),
    dispose: () => ipcRenderer.invoke('mdx:dispose'),
  },
  pitch: {
    available: () => ipcRenderer.invoke('pitch:available'),
    rmvpe: (mel: Float32Array, frames: number) => ipcRenderer.invoke('pitch:rmvpe', mel, frames),
    swift: (audio: Float32Array, fmin: number, fmax: number) =>
      ipcRenderer.invoke('pitch:swift', audio, fmin, fmax),
  },
  monitor: {
    devices: () => ipcRenderer.invoke('monitor:devices'),
    start: (s: unknown) => ipcRenderer.invoke('monitor:start', s),
    update: (s: unknown) => ipcRenderer.invoke('monitor:update', s),
    stats: () => ipcRenderer.invoke('monitor:stats'),
    stop: () => ipcRenderer.invoke('monitor:stop'),
    onInput: (cb: (data: Float32Array, rate: number) => void) => {
      const h = (_e: unknown, data: Float32Array, rate: number) => cb(data, rate)
      ipcRenderer.on('monitor:input', h)
      return () => {
        ipcRenderer.removeListener('monitor:input', h)
      }
    },
  },
  print: {
    exportPdf: (o: { query: string; fileName: string }) => ipcRenderer.invoke('print:exportPdf', o),
    /** The print page: alphaTab is painted (or failed with `error`). */
    ready: (error?: string) => ipcRenderer.send('print:ready', error),
  },
  scores: {
    root: () => ipcRenderer.invoke('scores:root'),
    pickRoot: () => ipcRenderer.invoke('scores:pickRoot'),
    cached: () => ipcRenderer.invoke('scores:cached'),
    scan: () => ipcRenderer.invoke('scores:scan'),
    read: (rel: string) => ipcRenderer.invoke('scores:read', rel),
    openExternal: (rel: string) => ipcRenderer.invoke('scores:openExternal', rel),
    reveal: (rel: string) => ipcRenderer.invoke('scores:reveal', rel),
    onProgress: (cb: (files: number) => void) => {
      const h = (_e: unknown, files: number) => cb(files)
      ipcRenderer.on('scores:progress', h)
      return () => {
        ipcRenderer.removeListener('scores:progress', h)
      }
    },
  },
})
