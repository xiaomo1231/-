import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync, statSync } from 'node:fs'

/**
 * Files in public/ that should be available offline (relative URLs). The
 * onnxruntime build for stem separation (public/ort, ~27 MB) is left out:
 * it loads only when a student separates a song.
 */
function publicFiles(dir: string, base = ''): string[] {
  return readdirSync(dir).flatMap((name) => {
    // ort (~27 MB) and the vocals model (~33 MB) load only when a song is separated.
    if (!base && (name === 'ort' || name === 'models')) return []
    const full = path.join(dir, name)
    const url = `${base}/${name}`
    return statSync(full).isDirectory() ? publicFiles(full, url) : [url]
  })
}

/**
 * Build-time service worker: inlines the list of every built file (and a
 * version hash of it) into src/pwa/sw-template.js and emits /sw.js. Hashed
 * asset names change with their content, so the version changes whenever
 * anything does. Development has no service worker.
 */
function serviceWorker(): Plugin {
  return {
    name: 'groovelab-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const built = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && f !== 'sw.js')
        .map((f) => `/${f}`)
      const files = Array.from(new Set(['/', '/index.html', ...built, ...publicFiles(path.resolve(__dirname, 'public'))])).sort()
      const index = bundle['index.html']
      const indexSource = index && index.type === 'asset' ? String(index.source) : ''
      const version = createHash('sha256').update(files.join('\n')).update(indexSource).digest('hex').slice(0, 12)
      const template = readFileSync(path.resolve(__dirname, 'src/pwa/sw-template.js'), 'utf8')
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: template.replace('const PRECACHE = __PRECACHE__', `const PRECACHE = ${JSON.stringify({ version, files })}`) })
    },
  }
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  resolve: { alias: { '@': path.resolve(__dirname, './src') } },
  server: {
    // Fixed origin: IndexedDB is scoped per origin, so a silent port fallback
    // would look like "all my progress disappeared".
    port: 5174,
    strictPort: true,
    host: true,
  },
  preview: {
    // Same origin as the dev server, so both see the same data.
    port: 5174,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-audio': ['tone'],
          'vendor-notation': ['vexflow'],
          'vendor-db': ['dexie'],
        },
      },
    },
  },
})
