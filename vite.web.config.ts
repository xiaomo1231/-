import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import {
  copyFileSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import tailwindcss from 'tailwindcss'
import autoprefixer from 'autoprefixer'
import tailwindConfig from './tailwind.config'

/**
 * The phone-first score library web page (web/), served by the Mac mini
 * server. Built into server-dist/web; the server serves that folder.
 *   npx vite build --config vite.web.config.ts
 *   npx vite --config vite.web.config.ts        (port 5175, /api and /files proxied to 8790)
 */
const projectRoot = __dirname
const alphaPackage = path.join(projectRoot, 'node_modules', '@coderline', 'alphatab')
const alphaDist = path.join(alphaPackage, 'dist')
const outDir = path.join(projectRoot, 'server-dist', 'web')
/** Optional big sound fonts (gitignored); copied to /alphatab/soundfont/ when present. */
const SOUNDFONT_DIR = path.join(projectRoot, 'server-assets', 'soundfonts')
const SOUNDFONT_URL = '/alphatab/soundfont/'

/** Same files as scripts/copy-alphatab.mjs: [file in dist, path under /alphatab/]. */
const ALPHATAB_FILES: Array<[string, string]> = [
  ['alphaTab.min.js', 'alphaTab.min.js'],
  ['font/Bravura.woff2', 'font/Bravura.woff2'],
  ['font/Bravura.woff', 'font/Bravura.woff'],
  ['font/Bravura-OFL.txt', 'font/Bravura-OFL.txt'],
  ['soundfont/sonivox.sf2', 'soundfont/sonivox.sf2'],
  ['soundfont/LICENSE', 'soundfont/LICENSE.txt'],
]

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.sf2': 'application/octet-stream',
  '.sf3': 'application/octet-stream',
  '.txt': 'text/plain; charset=utf-8',
}

/** Regular files in SOUNDFONT_DIR, by file name. Empty when the folder does not exist. */
function soundfontFiles(): Map<string, string> {
  const files = new Map<string, string>()
  if (!existsSync(SOUNDFONT_DIR)) return files
  for (const entry of readdirSync(SOUNDFONT_DIR, { withFileTypes: true })) {
    if (entry.isFile()) files.set(entry.name, path.join(SOUNDFONT_DIR, entry.name))
  }
  return files
}

/** alphaTab's runtime under /alphatab/: served from node_modules in dev, copied on build. */
function alphaTabAssets(): Plugin {
  const served = new Map(
    ALPHATAB_FILES.map(([from, to]) => [`/alphatab/${to}`, path.join(alphaDist, from)]),
  )
  return {
    name: 'scores-web-alphatab',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = (req.url ?? '').split('?')[0] ?? ''
        const file = served.get(url)
        if (file) {
          res.setHeader('Content-Type', MIME[path.extname(file)] ?? 'application/octet-stream')
          res.end(readFileSync(file))
          return
        }
        if (url.startsWith(SOUNDFONT_URL)) {
          let name: string
          try {
            name = decodeURIComponent(url.slice(SOUNDFONT_URL.length))
          } catch {
            return next()
          }
          const sf = soundfontFiles().get(name)
          if (!sf) return next()
          res.setHeader('Content-Type', MIME[path.extname(sf)] ?? 'application/octet-stream')
          res.setHeader('Content-Length', statSync(sf).size)
          const stream = createReadStream(sf)
          stream.on('error', () => res.destroy())
          stream.pipe(res)
          return
        }
        next()
      })
    },
    closeBundle() {
      for (const [urlPath, file] of served) {
        const dest = path.join(outDir, urlPath)
        mkdirSync(path.dirname(dest), { recursive: true })
        copyFileSync(file, dest)
      }
      const soundDest = path.join(outDir, 'alphatab', 'soundfont')
      for (const [name, file] of soundfontFiles()) {
        mkdirSync(soundDest, { recursive: true })
        copyFileSync(file, path.join(soundDest, name))
      }
      const dest = path.join(outDir, 'alphatab')
      mkdirSync(dest, { recursive: true })
      copyFileSync(path.join(alphaPackage, 'LICENSE'), path.join(dest, 'LICENSE.txt'))
      const version = (
        JSON.parse(readFileSync(path.join(alphaPackage, 'package.json'), 'utf8')) as {
          version: string
        }
      ).version
      writeFileSync(path.join(dest, 'VERSION.txt'), version + '\n')
    },
  }
}

export default defineConfig({
  root: path.join(projectRoot, 'web'),
  base: '/',
  publicDir: false,
  plugins: [react(), alphaTabAssets()],
  resolve: { alias: { '@': path.join(projectRoot, 'src') } },
  css: {
    postcss: {
      plugins: [
        tailwindcss({ ...tailwindConfig, content: ['./web/**/*.{html,ts,tsx}'] }),
        autoprefixer(),
      ],
    },
  },
  server: {
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': 'http://127.0.0.1:8790',
      '/files': 'http://127.0.0.1:8790',
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: 'es2022',
    sourcemap: false,
  },
})
