/**
 * MP3 export (0.21.0) with lamejs (LGPL-3.0, the @breezystack ESM build).
 * Encodes in slices and yields between them so the page stays responsive.
 */

/** Float samples (−1…1) to 16-bit PCM, with light TPDF dither. */
export function toInt16(x: Float32Array): Int16Array {
  const out = new Int16Array(x.length)
  let seed = 22222
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0
    return seed / 4294967296
  }
  for (let i = 0; i < x.length; i++) {
    const v = Math.max(-1, Math.min(1, x[i]!)) * 32767 + (rnd() - rnd())
    out[i] = Math.max(-32768, Math.min(32767, Math.round(v)))
  }
  return out
}

/** Encode stereo (or mono) channels as MP3 bytes. `kbps` 128–320. */
export async function encodeMp3Bytes(channels: Float32Array[], sampleRate: number, kbps = 256, onProgress?: (ratio: number) => void): Promise<Uint8Array> {
  const { Mp3Encoder } = await import('@breezystack/lamejs')
  const stereo = channels.length > 1
  const enc = new Mp3Encoder(stereo ? 2 : 1, sampleRate, kbps)
  const left = toInt16(channels[0]!)
  const right = stereo ? toInt16(channels[1]!) : undefined
  const parts: Uint8Array[] = []
  const block = 1152 * 64
  for (let i = 0; i < left.length; i += block) {
    const l = left.subarray(i, i + block)
    const out = right ? enc.encodeBuffer(l, right.subarray(i, i + block)) : enc.encodeBuffer(l)
    if (out.length) parts.push(out.slice())
    if ((i / block) % 8 === 7) {
      onProgress?.(i / left.length)
      await new Promise((r) => setTimeout(r, 0))
    }
  }
  const tail = enc.flush()
  if (tail.length) parts.push(tail.slice())
  onProgress?.(1)
  const out = new Uint8Array(parts.reduce((t, p) => t + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

/** Encode as an MP3 file. */
export async function encodeMp3(channels: Float32Array[], sampleRate: number, kbps = 256, onProgress?: (ratio: number) => void): Promise<Blob> {
  return new Blob([(await encodeMp3Bytes(channels, sampleRate, kbps, onProgress)) as BlobPart], { type: 'audio/mpeg' })
}
