/**
 * Minimal ZIP reader for .mxl (compressed MusicXML). Reads the central
 * directory and inflates entries with the browser's DecompressionStream.
 */
import { ImportError } from './midiImport'

interface Entry {
  name: string
  method: number
  compressedSize: number
  offset: number
}

function entries(b: Uint8Array): Entry[] {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  // End of central directory: search backwards for its signature.
  let eocd = -1
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (v.getUint32(i, true) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new ImportError('这个 .mxl 文件不是有效的压缩包。')
  const count = v.getUint16(eocd + 10, true)
  let p = v.getUint32(eocd + 16, true)
  const out: Entry[] = []
  for (let i = 0; i < count; i++) {
    if (v.getUint32(p, true) !== 0x02014b50) throw new ImportError('.mxl 压缩包的目录损坏。')
    const method = v.getUint16(p + 10, true)
    const compressedSize = v.getUint32(p + 20, true)
    const nameLen = v.getUint16(p + 28, true)
    const extraLen = v.getUint16(p + 30, true)
    const commentLen = v.getUint16(p + 32, true)
    const offset = v.getUint32(p + 42, true)
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nameLen))
    out.push({ name, method, compressedSize, offset })
    p += 46 + nameLen + extraLen + commentLen
  }
  return out
}

async function read(b: Uint8Array, e: Entry): Promise<Uint8Array> {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength)
  const nameLen = v.getUint16(e.offset + 26, true)
  const extraLen = v.getUint16(e.offset + 28, true)
  const start = e.offset + 30 + nameLen + extraLen
  const data = b.slice(start, start + e.compressedSize)
  if (e.method === 0) return data
  if (e.method !== 8) throw new ImportError('.mxl 使用了不支持的压缩方式。请导出未压缩的 .musicxml。')
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

/** The MusicXML text inside an .mxl file. */
export async function unzipMusicXml(b: Uint8Array): Promise<string> {
  const list = entries(b)
  const dec = new TextDecoder()
  let target: Entry | undefined
  const container = list.find((e) => e.name === 'META-INF/container.xml')
  if (container) {
    const xml = dec.decode(await read(b, container))
    const path = /full-path="([^"]+)"/.exec(xml)?.[1]
    target = list.find((e) => e.name === path)
  }
  target ??= list.find((e) => !e.name.startsWith('META-INF') && /\.(musicxml|xml)$/i.test(e.name))
  if (!target) throw new ImportError('.mxl 压缩包里没有找到乐谱文件。')
  return dec.decode(await read(b, target))
}
