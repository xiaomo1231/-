import { describe, expect, it } from 'vitest'
import { encodeMp3Bytes, toInt16 } from '@/export/mp3'

describe('MP3 export', () => {
  it('converts to 16-bit with clipping', () => {
    const y = toInt16(Float32Array.from([0, 1, -1, 2, -2]))
    expect(Math.abs(y[0]!)).toBeLessThanOrEqual(1)
    expect(y[1]).toBeGreaterThan(32760)
    expect(y[4]).toBeLessThan(-32760)
  })
  it('encodes a stereo tone to a plausible MP3', async () => {
    const sr = 44100
    const n = sr * 2
    const l = Float32Array.from({ length: n }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / sr))
    const bytes = await encodeMp3Bytes([l, l], sr, 192)
    // ~2 s at 192 kbps ≈ 48 kB
    expect(bytes.length).toBeGreaterThan(30000)
    expect(bytes.length).toBeLessThan(70000)
    // MPEG frame sync
    expect(bytes[0]).toBe(0xff)
    expect((bytes[1]! & 0xe0) === 0xe0).toBe(true)
  })
})
