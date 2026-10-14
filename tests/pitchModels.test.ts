import { describe, expect, it } from 'vitest'
import fixture from './fixtures/rmvpe.json'
import { RMVPE_RATE, rmvpeDecode, rmvpeFrames, rmvpeMel, rmvpePieces } from '@/audio/pitch/rmvpe'

/** Same recipe as scripts/make-pitch-models.py test_signal(). */
function testSignal(): Float32Array {
  const n = Math.floor(2.5 * RMVPE_RATE)
  const x = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / RMVPE_RATE
    const midi =
      57 + 7 * Math.min(1, Math.max(0, (t - 0.3) / 1.9)) + 0.3 * Math.sin(2 * Math.PI * 5.5 * t)
    phase += (2 * Math.PI * 440 * 2 ** ((midi - 69) / 12)) / RMVPE_RATE
    let v = 0
    for (let k = 1; k <= 8; k++) v += Math.sin(k * phase) / k
    x[i] = t < 0.3 || t > 2.2 ? 0 : v * 0.2
  }
  return x
}

describe('RMVPE signal part', () => {
  it('reproduces the reference log-mel spectrogram', () => {
    const x = testSignal()
    const frames = rmvpeFrames(x.length)
    expect(frames).toBe(fixture.frames)
    const mel = rmvpeMel(x)
    let worst = 0
    for (const [f, ref] of Object.entries(fixture.melFrames)) {
      ref.forEach((v, m) => {
        worst = Math.max(worst, Math.abs(mel[m * frames + Number(f)]! - v))
      })
    }
    // float32 vs float64 and cumsum phase: small differences only.
    expect(worst).toBeLessThan(0.02)
  })

  it('decodes salience like RVC (weighted 9 bins, threshold)', () => {
    const hidden = new Float32Array(2 * 360)
    hidden[100] = 0.9 // frame 0: one bin → cents of bin 100
    hidden[360 + 50] = 0.02 // frame 1: below threshold
    const f0 = rmvpeDecode(hidden, 2)
    expect(f0[0]).toBeCloseTo(10 * 2 ** ((20 * 100 + 1997.3794084376191) / 1200), 3)
    expect(f0[1]).toBe(0)
  })

  it('splits long songs into overlapping pieces that cover every frame once', () => {
    const p = rmvpePieces(10000)
    expect(p[0]).toEqual({ from: 0, to: 4096 + 128, keepFrom: 0, keepTo: 4096 })
    const kept = p.reduce((a, q) => a + q.keepTo - q.keepFrom, 0)
    expect(kept).toBe(10000)
    expect(p.at(-1)!.to).toBe(10000)
  })
})
