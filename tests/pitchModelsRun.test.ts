// @vitest-environment node
/**
 * The real models on a synthetic voice (skipped when public/models has not been
 * made: scripts/make-pitch-models.py).
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import * as ortNode from 'onnxruntime-node'
import { swiftWhole, to16k } from '@/audio/pitch/swiftF0'
import { RMVPE_RATE, rmvpeDecode, rmvpeFrames, rmvpeMel } from '@/audio/pitch/rmvpe'

const SWIFT = 'public/models/pitch-swiftf0.onnx'
const RMVPE = 'public/models/pitch-rmvpe-fp16.onnx'

/** A3 → E4 slide with vibrato between 0.3 s and 2.2 s (as tests/pitchModels.test.ts). */
function voice(rate: number): { x: Float32Array; midiAt: (t: number) => number } {
  const midiAt = (t: number) =>
    57 + 7 * Math.min(1, Math.max(0, (t - 0.3) / 1.9)) + 0.3 * Math.sin(2 * Math.PI * 5.5 * t)
  const n = Math.floor(2.5 * rate)
  const x = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / rate
    phase += (2 * Math.PI * 440 * 2 ** ((midiAt(t) - 69) / 12)) / rate
    let v = 0
    for (let k = 1; k <= 8; k++) v += Math.sin(k * phase) / k
    x[i] = t < 0.3 || t > 2.2 ? 0 : v * 0.2
  }
  return { x, midiAt }
}

const midi = (hz: number) => 69 + 12 * Math.log2(hz / 440)

describe.skipIf(!existsSync(SWIFT))('SwiftF0', () => {
  it('follows the voice and is silent in the gaps (48 kHz input resampled)', async () => {
    const session = await ortNode.InferenceSession.create(SWIFT)
    const { x, midiAt } = voice(48000)
    const runner = {
      run: async (audio: Float32Array, fmin: number, fmax: number) => {
        const out = await session.run({
          audio: new ortNode.Tensor('float32', audio, [1, audio.length]),
          fmin: new ortNode.Tensor('float32', new Float32Array([fmin]), []),
          fmax: new ortNode.Tensor('float32', new Float32Array([fmax]), []),
        })
        return {
          pitch: out.pitch!.data as Float32Array,
          conf: Float32Array.from(out.confidence!.data as Float32Array),
        }
      },
    }
    const { hz } = await swiftWhole(runner, to16k(x, 48000))
    let voiced = 0
    let worst = 0
    hz.forEach((f, i) => {
      const t = (i + 0.5) * 0.016
      if (t > 0.4 && t < 2.1) {
        if (f > 0) {
          voiced++
          worst = Math.max(worst, Math.abs(midi(f) - midiAt(t)))
        }
      } else if (t < 0.25 || t > 2.3) expect(f).toBe(0)
    })
    expect(voiced).toBeGreaterThan(0.95 * (1.7 / 0.016))
    expect(worst).toBeLessThan(0.5)
  })
})

describe.skipIf(!existsSync(RMVPE))('RMVPE', () => {
  it('float16-stored weights follow the test voice on the processor', async () => {
    const session = await ortNode.InferenceSession.create(RMVPE, { executionProviders: ['cpu'] })
    const { x, midiAt } = voice(RMVPE_RATE)
    const frames = rmvpeFrames(x.length)
    const padded = 32 * Math.ceil(frames / 32)
    const out = await session.run({
      [session.inputNames[0]!]: new ortNode.Tensor('float32', rmvpeMel(x, padded), [
        1,
        128,
        padded,
      ]),
    })
    const f0 = rmvpeDecode(out[session.outputNames[0]!]!.data as Float32Array, frames)
    let voiced = 0
    let worst = 0
    f0.forEach((f, i) => {
      const t = i * 0.01
      if (t > 0.35 && t < 2.15 && f > 0) {
        voiced++
        worst = Math.max(worst, Math.abs(midi(f) - midiAt(t)))
      }
    })
    expect(voiced).toBeGreaterThan(0.95 * 180)
    expect(worst).toBeLessThan(0.5)
  }, 60_000)
})
