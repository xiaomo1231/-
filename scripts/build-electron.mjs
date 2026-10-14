/**
 * Bundles the app's own code (electron/) into electron-dist/: main, preload
 * and the two worker threads, as CommonJS for Electron. The native modules
 * (onnxruntime-node, audify) stay outside the bundle.
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const entries = {
  main: 'electron/main.ts',
  preload: 'electron/preload.ts',
  separator: 'electron/separator.worker.ts',
  monitor: 'electron/monitor.worker.ts',
  pitch: 'electron/pitch.worker.ts',
}

await Promise.all(
  Object.entries(entries).map(([name, entry]) =>
    build({
      entryPoints: [path.join(root, entry)],
      outfile: path.join(root, 'electron-dist', `${name}.cjs`),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      target: 'node22',
      external: ['electron', 'onnxruntime-node', 'audify'],
      alias: { '@': path.join(root, 'src') },
      logLevel: 'warning',
    }),
  ),
)
console.log('electron-dist ready')
