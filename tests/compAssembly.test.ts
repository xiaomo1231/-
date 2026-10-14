import { describe, expect, it } from 'vitest'
import { assembleComp, compWindows, voicedSpan, type CompPiece } from '@/songs/compAssembly'

const R = 16000

/** A recording placed at `startMs`, lasting `lenMs`, with a tone in the given song-time spans. */
function piece(
  startMs: number,
  lenMs: number,
  spans: Array<[number, number, number]>,
  phrase: [number, number],
): CompPiece {
  const x = new Float32Array(Math.round((lenMs / 1000) * R))
  for (let i = 0; i < x.length; i++) {
    const t = startMs + (i / R) * 1000
    x[i] = 0.0005 * Math.sin(i * 1.7) // noise floor
    for (const [a, b, f] of spans)
      if (t >= a && t < b) x[i]! += 0.3 * Math.sin((2 * Math.PI * f * i) / R)
  }
  return { samples: x, sampleRate: R, startMs, phraseStartMs: phrase[0], phraseEndMs: phrase[1] }
}

const rms = (x: Float32Array, fromMs: number, toMs: number) => {
  let s = 0
  const a = Math.round((fromMs / 1000) * R)
  const b = Math.round((toMs / 1000) * R)
  for (let i = a; i < b; i++) s += x[i]! * x[i]!
  return Math.sqrt(s / Math.max(1, b - a))
}

describe('拼最好的几句', () => {
  it('finds where the singing is', () => {
    const p = piece(700, 3000, [[1000, 3100, 220]], [1000, 3000])
    const s = voicedSpan(p)!
    expect(Math.abs(s.fromMs - 1000)).toBeLessThanOrEqual(20)
    expect(Math.abs(s.toMs - 3100)).toBeLessThanOrEqual(20)
  })

  it("drops the next take's carried-over words and keeps each phrase's own ending", () => {
    // Phrase 1 sung 1000–3100 (its tail runs a little long); the take for phrase 2 starts in its
    // lead-in at 2900 where the singer was still finishing phrase 1 (2900–3150), then sings 3400–5000.
    const a = piece(700, 3000, [[1000, 3100, 220]], [1000, 3000])
    const b = piece(
      2900,
      2400,
      [
        [2900, 3150, 330],
        [3400, 5000, 247],
      ],
      [3400, 5000],
    )
    const [wa, wb] = compWindows([a, b])
    expect(wa!.toMs).toBeGreaterThan(3100) // phrase 1's ending survives
    expect(wb!.fromMs).toBeGreaterThan(3150) // phrase 2's take lost the carried-over words
    expect(wb!.fromMs).toBeLessThan(3400)
    const out = assembleComp([a, b], 5500, R)
    // Around 3050 only phrase 1 sounds (one tone, not two stacked).
    const both = rms(out, 3000, 3080)
    const one = rms(a.samples, ((3000 - 700) / 1000) * 1000, ((3080 - 700) / 1000) * 1000)
    expect(both).toBeLessThan(one * 1.1)
    // The quiet gap stays quiet; both phrases are there.
    expect(rms(out, 3250, 3330)).toBeLessThan(0.01)
    expect(rms(out, 1500, 2500)).toBeGreaterThan(0.1)
    expect(rms(out, 3600, 4800)).toBeGreaterThan(0.1)
  })

  it('crossfades where the two phrases are sung right into each other', () => {
    const a = piece(700, 2800, [[1000, 3300, 220]], [1000, 3200])
    const b = piece(2900, 2400, [[3200, 5000, 247]], [3200, 5000])
    const [wa, wb] = compWindows([a, b])
    expect(wa!.toMs).toBeGreaterThan(wb!.fromMs) // overlapping fade
    expect(wa!.fadeOutMs).toBe(80)
  })
})
