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
  // Magenta's MusicVAE reads its checkpoint with node-fetch. Drumify reads the
  // files from disk instead, and nothing may go to the network, so node-fetch
  // is replaced by a local-file reader (same behaviour as localFetch in server/drumify.ts).
  plugins: [
    {
      name: 'local-node-fetch',
      setup(b) {
        b.onResolve({ filter: /^node-fetch$/ }, () => ({ path: 'node-fetch', namespace: 'local-node-fetch' }))
        b.onLoad({ filter: /.*/, namespace: 'local-node-fetch' }, () => ({
          contents: `const fs = require('node:fs');
module.exports = async function localFetch(url) {
  if (/^https?:/i.test(url)) throw new Error('Drumify 不访问网络');
  const file = url.startsWith('file:') ? new URL(url) : url;
  const buf = await fs.promises.readFile(file);
  const bytes = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return { ok: true, status: 200, statusText: 'OK',
    json: async () => JSON.parse(buf.toString('utf8')), text: async () => buf.toString('utf8'),
    arrayBuffer: async () => bytes };
};`,
          loader: 'js',
        }))
      },
    },
  ],
  logLevel: 'warning',
})
console.log('server-dist/server.mjs ready')
