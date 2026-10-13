// Renders the GrooveLab favicon design into PNG app icons (no dependencies).
// Usage: node scripts/make-icons.mjs  → public/icons/*.png
import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(out, { recursive: true })

const BG = [0x0b, 0x0f, 0x17]
const AMBER = [0xf5, 0xa5, 0x24]
const CYAN = [0x2d, 0xd4, 0xe5]
// The favicon path on a 64-unit grid.
const LINE = [[10, 40], [18, 40], [22, 26], [28, 46], [34, 20], [40, 44], [44, 34], [54, 34]]
const DOT = { x: 54, y: 34, r: 3.5 }
const STROKE = 4

function segDist(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

function insideRounded(x, y, size, r) {
  const cx = Math.min(Math.max(x, r), size - r)
  const cy = Math.min(Math.max(y, r), size - r)
  return Math.hypot(x - cx, y - cy) <= r
}

/** Colour at a point in 64-unit space, or null for transparent. */
function sample(u, v, maskable) {
  // Maskable icons fill the square and keep the artwork inside the 80 % safe zone.
  if (maskable) {
    const k = 0.8
    const gu = (u - 32) / k + 32
    const gv = (v - 32) / k + 32
    return shade(gu, gv) ?? BG
  }
  if (!insideRounded(u, v, 64, 16)) return null
  return shade(u, v) ?? BG
}

function shade(u, v) {
  if (Math.hypot(u - DOT.x, v - DOT.y) <= DOT.r) return CYAN
  for (let i = 0; i < LINE.length - 1; i++) if (segDist(u, v, LINE[i], LINE[i + 1]) <= STROKE / 2) return AMBER
  return null
}

function render(size, maskable) {
  const ss = 4
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const u = ((x + (sx + 0.5) / ss) / size) * 64
          const v = ((y + (sy + 0.5) / ss) / size) * 64
          const c = sample(u, v, maskable)
          if (c) {
            r += c[0]
            g += c[1]
            b += c[2]
            a += 255
          }
        }
      }
      const n = ss * ss
      const o = (y * size + x) * 4
      const alpha = a / n
      px[o] = alpha ? Math.round((r / n) * (255 / alpha)) : 0
      px[o + 1] = alpha ? Math.round((g / n) * (255 / alpha)) : 0
      px[o + 2] = alpha ? Math.round((b / n) * (255 / alpha)) : 0
      px[o + 3] = Math.round(alpha)
    }
  }
  return png(size, size, px)
}

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(buf) {
  let c = 0xffffffff
  for (const byte of buf) c = CRC[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(td))
  return Buffer.concat([len, td, crc])
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((w * 4 + 1) * h)
  for (let y = 0; y < h; y++) rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))])
}

for (const [name, size, maskable] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['apple-touch-icon.png', 180, true],
]) {
  writeFileSync(join(out, name), render(size, maskable))
  console.log('wrote', name)
}
