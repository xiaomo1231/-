/**
 * Port of Airwindows ClipOnly2 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * Transparent ceiling clipper: samples over about -0.2 dB are softened with a one-sample look-back.
 * Latency: floor(sampleRate / 44100) samples (1 at 44.1/48 kHz, 2 at 88.2/96 kHz). No parameters.
 */
import type { AirwindowsEffect, AirwindowsInfo } from './types'

export const ClipOnly2: AirwindowsInfo = {
  name: 'ClipOnly2',
  params: [],
  create(sampleRate: number): AirwindowsEffect {
    const overallscale = sampleRate / 44100
    let spacing = Math.floor(overallscale)
    if (spacing < 1) spacing = 1
    if (spacing > 16) spacing = 16

    let lastSampleL = 0
    let lastSampleR = 0
    const intermediateL = new Float64Array(16)
    const intermediateR = new Float64Array(16)
    let wasPosClipL = false
    let wasNegClipL = false
    let wasPosClipR = false
    let wasNegClipR = false

    return {
      setParams() {},
      reset() {
        lastSampleL = lastSampleR = 0
        intermediateL.fill(0)
        intermediateR.fill(0)
        wasPosClipL = wasNegClipL = wasPosClipR = wasNegClipR = false
      },
      process(left, right, n) {
        for (let i = 0; i < n; i++) {
          let inputSampleL = left[i]
          let inputSampleR = right[i]

          if (inputSampleL > 4) inputSampleL = 4
          if (inputSampleL < -4) inputSampleL = -4
          if (wasPosClipL) {
            if (inputSampleL < lastSampleL) lastSampleL = 0.7058208 + inputSampleL * 0.2609148
            else lastSampleL = 0.2491717 + lastSampleL * 0.7390851
          }
          wasPosClipL = false
          if (inputSampleL > 0.9549925859) {
            wasPosClipL = true
            inputSampleL = 0.7058208 + lastSampleL * 0.2609148
          }
          if (wasNegClipL) {
            if (inputSampleL > lastSampleL) lastSampleL = -0.7058208 + inputSampleL * 0.2609148
            else lastSampleL = -0.2491717 + lastSampleL * 0.7390851
          }
          wasNegClipL = false
          if (inputSampleL < -0.9549925859) {
            wasNegClipL = true
            inputSampleL = -0.7058208 + lastSampleL * 0.2609148
          }
          intermediateL[spacing] = inputSampleL
          inputSampleL = lastSampleL
          for (let x = spacing; x > 0; x--) intermediateL[x - 1] = intermediateL[x]
          lastSampleL = intermediateL[0]

          if (inputSampleR > 4) inputSampleR = 4
          if (inputSampleR < -4) inputSampleR = -4
          if (wasPosClipR) {
            if (inputSampleR < lastSampleR) lastSampleR = 0.7058208 + inputSampleR * 0.2609148
            else lastSampleR = 0.2491717 + lastSampleR * 0.7390851
          }
          wasPosClipR = false
          if (inputSampleR > 0.9549925859) {
            wasPosClipR = true
            inputSampleR = 0.7058208 + lastSampleR * 0.2609148
          }
          if (wasNegClipR) {
            if (inputSampleR > lastSampleR) lastSampleR = -0.7058208 + inputSampleR * 0.2609148
            else lastSampleR = -0.2491717 + lastSampleR * 0.7390851
          }
          wasNegClipR = false
          if (inputSampleR < -0.9549925859) {
            wasNegClipR = true
            inputSampleR = -0.7058208 + lastSampleR * 0.2609148
          }
          intermediateR[spacing] = inputSampleR
          inputSampleR = lastSampleR
          for (let x = spacing; x > 0; x--) intermediateR[x - 1] = intermediateR[x]
          lastSampleR = intermediateR[0]

          left[i] = inputSampleL
          right[i] = inputSampleR
        }
      },
    }
  },
}
