// Copies the alphaTab runtime (standalone script, Bravura font, Sonivox
// soundfont) from node_modules into public/alphatab/, where the sheet viewer
// loads it on demand. Run after upgrading @coderline/alphatab:
//   node scripts/copy-alphatab.mjs
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = join(root, 'node_modules', '@coderline', 'alphatab')
const dist = join(pkg, 'dist')
const out = join(root, 'public', 'alphatab')
const files = [
  ['alphaTab.min.js', 'alphaTab.min.js'],
  ['font/Bravura.woff2', 'font/Bravura.woff2'],
  ['font/Bravura.woff', 'font/Bravura.woff'],
  ['font/Bravura-OFL.txt', 'font/Bravura-OFL.txt'],
  ['soundfont/sonivox.sf2', 'soundfont/sonivox.sf2'],
  ['soundfont/LICENSE', 'soundfont/LICENSE.txt'],
]
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true })
  copyFileSync(join(dist, from), join(out, to))
}
copyFileSync(join(pkg, 'LICENSE'), join(out, 'LICENSE.txt'))
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
writeFileSync(join(out, 'VERSION.txt'), version + '\n')
console.log(`alphaTab ${version} copied to public/alphatab/`)
