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
})
