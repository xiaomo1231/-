/**
 * Bundles the read-only score server (server/main.ts) into one file,
 * server-dist/server.mjs, for Node 20+ on the Mac mini. Pinyin and the
 * traditional-to-simplified tables are bundled in, so the Mac only needs Node.
 * The web UI is built separately into server-dist/web (npm run build:web).
 */
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

await build({
  entryPoints: [path.join(root, 'server/main.ts')],
  outfile: path.join(root, 'server-dist', 'server.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  alias: { '@': path.join(root, 'src') },
  // Bundled CommonJS code may call require(); give it one in an ES module.
  banner: {
    js: "import { createRequire as __gl_createRequire } from 'node:module'; const require = __gl_createRequire(import.meta.url);",
  },
  logLevel: 'warning',
})
console.log('server-dist/server.mjs ready')
