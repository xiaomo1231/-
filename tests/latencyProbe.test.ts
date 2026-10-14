import { describe, expect, it } from 'vitest'
import { findOnsets, summarize } from '@/audio/latencyProbe'

const RATE = 48000

/** Noise plus a tone burst `delay` s after each beep. */
function recording(beeps: number[], delay: (i: number) => number, noise = 0.003): Float32Array {
  const x = new Float32Array(Math.ceil((beeps.at(-1)! + 1) * RATE))
  let seed = 1
  for (let i = 0; i < x.length; i++) {
    seed = (seed * 16807) % 2147483647
    x[i] = (seed / 2147483647 - 0.5) * 2 * noise
  }
  beeps.forEach((b, k) => {
    const s = Math.round((b + delay(k)) * RATE)
    for (let i = 0; i < 0.04 * RATE && s + i < x.length; i++)
      x[s + i]! += 0.3 * Math.exp(-i / (0.01 * RATE)) * Math.sin((2 * Math.PI * 1320 * i) / RATE)
  })
  return x
}

describe('latency probe', () => {
  const beeps = Array.from({ length: 10 }, (_, i) => 0.2 + i * 0.6)

  it('finds a Bluetooth-like delay to within a few ms', () => {
    const onsets = findOnsets(
      recording(beeps, () => 0.183),
      RATE,
      beeps,
      0.002,
      0.5,
    )
    const r = summarize(onsets, 7)
    expect(r.found).toBe(10)
    expect(Math.abs(r.ms! - 183)).toBeLessThanOrEqual(4)
    expect(r.spreadMs).toBeLessThanOrEqual(4)
  })

  it('takes the median when singing wobbles, and fails with too few hits', () => {
    const wobble = [0.15, 0.2, 0.17, 0.19, 0.18, 0.22, 0.16, 0.18, 0.18, 0.21]
    const r = summarize(
      findOnsets(
        recording(beeps, (i) => wobble[i]!),
        RATE,
        beeps,
        -0.12,
        0.55,
      ),
      6,
    )
    expect(Math.abs(r.ms! - 180)).toBeLessThanOrEqual(10)
    const silent = summarize(
      findOnsets(recording([], () => 0).subarray(0, 0), RATE, beeps, 0.002, 0.5),
      7,
    )
    expect(silent.ms).toBeNull()
  })
})
