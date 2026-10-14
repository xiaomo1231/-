/**
 * Port of Airwindows ADClip8 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * Loudness-maximising clipper: boost into up to 8 cascaded soft-clip stages, scaled to a ceiling.
 * Latency: floor(sampleRate / 44100) samples per stage (stage count follows Mode).
 */
import type { AirwindowsEffect, AirwindowsInfo, AirwindowsParam } from './types'

const f2 = (v: number) => v.toFixed(2)
const MODES = ['Normal', 'Atten', 'Clips', 'Afterbr', 'Explode', 'Nuke', 'Apocaly', 'Apothes']
const G = 1.618033988749894
const H = 0.618033988749894
const S = 0.381966011250105

const params: AirwindowsParam[] = [
  { name: 'Boost', default: 0, display: (v) => `${f2(v * 18)} dB` },
  { name: 'Ceiling', default: 0.883, display: f2 },
  { name: 'Mode', default: 0, display: (v) => MODES[Math.trunc(v * 7.999)] ?? '' },
]

export const ADClip8: AirwindowsInfo = {
  name: 'ADClip8',
  params,
  create(sampleRate: number): AirwindowsEffect {
    const overallscale = sampleRate / 44100
    let spacing = Math.floor(overallscale)
    if (spacing < 1) spacing = 1
    if (spacing > 16) spacing = 16
    let A = 0
    let B = 0.883
    let C = 0

    const lastSampleL = new Float64Array(8)
    const lastSampleR = new Float64Array(8)
    // intermediate[x][stage] flattened as x * 8 + stage
    const intermediateL = new Float64Array(16 * 8)
    const intermediateR = new Float64Array(16 * 8)
    const wasPosClipL = new Uint8Array(8)
    const wasNegClipL = new Uint8Array(8)
    const wasPosClipR = new Uint8Array(8)
    const wasNegClipR = new Uint8Array(8)

    return {
      setParams(v) {
        if (v[0] !== undefined) A = v[0]
        if (v[1] !== undefined) B = v[1]
        if (v[2] !== undefined) C = v[2]
      },
      reset() {
        lastSampleL.fill(0)
        lastSampleR.fill(0)
        intermediateL.fill(0)
        intermediateR.fill(0)
        wasPosClipL.fill(0)
        wasNegClipL.fill(0)
        wasPosClipR.fill(0)
        wasNegClipR.fill(0)
      },
      process(left, right, n) {
        let inputGain = Math.pow(10, (A * 18) / 20)
        const ceiling = (1 + B * 0.23594733) * 0.5
        const mode = Math.trunc(C * 7.999) + 1
        let stageSetting = mode - 2
        if (stageSetting < 1) stageSetting = 1
        inputGain = (inputGain - 1) / stageSetting + 1

        for (let i = 0; i < n; i++) {
          let inputSampleL = left[i]
          let inputSampleR = right[i]
          let overshootL = 0
          let overshootR = 0
          inputSampleL *= G
          inputSampleR *= G

          for (let stage = 0; stage < stageSetting; stage++) {
            if (inputGain !== 1) {
              inputSampleL *= inputGain
              inputSampleR *= inputGain
            }
            if (stage === 0) {
              overshootL = Math.abs(inputSampleL) - G
              if (overshootL < 0) overshootL = 0
              overshootR = Math.abs(inputSampleR) - G
              if (overshootR < 0) overshootR = 0
            }
            if (inputSampleL > 4) inputSampleL = 4
            if (inputSampleL < -4) inputSampleL = -4
            if (inputSampleL - lastSampleL[stage] > H) inputSampleL = lastSampleL[stage] + H
            if (inputSampleL - lastSampleL[stage] < -H) inputSampleL = lastSampleL[stage] - H
            if (inputSampleR > 4) inputSampleR = 4
            if (inputSampleR < -4) inputSampleR = -4
            if (inputSampleR - lastSampleR[stage] > H) inputSampleR = lastSampleR[stage] + H
            if (inputSampleR - lastSampleR[stage] < -H) inputSampleR = lastSampleR[stage] - H

            if (wasPosClipL[stage]) {
              if (inputSampleL < lastSampleL[stage]) lastSampleL[stage] = 1 + inputSampleL * S
              else lastSampleL[stage] = H + lastSampleL[stage] * H
            }
            wasPosClipL[stage] = 0
            if (inputSampleL > G) {
              wasPosClipL[stage] = 1
              inputSampleL = 1 + lastSampleL[stage] * S
            }
            if (wasNegClipL[stage]) {
              if (inputSampleL > lastSampleL[stage]) lastSampleL[stage] = -1 + inputSampleL * S
              else lastSampleL[stage] = -H + lastSampleL[stage] * H
            }
            wasNegClipL[stage] = 0
            if (inputSampleL < -G) {
              wasNegClipL[stage] = 1
              inputSampleL = -1 + lastSampleL[stage] * S
            }
            intermediateL[spacing * 8 + stage] = inputSampleL
            inputSampleL = lastSampleL[stage]
            for (let x = spacing; x > 0; x--)
              intermediateL[(x - 1) * 8 + stage] = intermediateL[x * 8 + stage]
            lastSampleL[stage] = intermediateL[stage]

            if (wasPosClipR[stage]) {
              if (inputSampleR < lastSampleR[stage]) lastSampleR[stage] = 1 + inputSampleR * S
              else lastSampleR[stage] = H + lastSampleR[stage] * H
            }
            wasPosClipR[stage] = 0
            if (inputSampleR > G) {
              wasPosClipR[stage] = 1
              inputSampleR = 1 + lastSampleR[stage] * S
            }
            if (wasNegClipR[stage]) {
              if (inputSampleR > lastSampleR[stage]) lastSampleR[stage] = -1 + inputSampleR * S
              else lastSampleR[stage] = -H + lastSampleR[stage] * H
            }
            wasNegClipR[stage] = 0
            if (inputSampleR < -G) {
              wasNegClipR[stage] = 1
              inputSampleR = -1 + lastSampleR[stage] * S
            }
            intermediateR[spacing * 8 + stage] = inputSampleR
            inputSampleR = lastSampleR[stage]
            for (let x = spacing; x > 0; x--)
              intermediateR[(x - 1) * 8 + stage] = intermediateR[x * 8 + stage]
            lastSampleR[stage] = intermediateR[stage]
          }

          if (mode === 2) {
            inputSampleL /= inputGain
            inputSampleR /= inputGain
          } else if (mode === 3) {
            inputSampleL = overshootL
            inputSampleR = overshootR
          }
          inputSampleL *= ceiling
          inputSampleR *= ceiling

          left[i] = inputSampleL
          right[i] = inputSampleR
        }
      },
    }
  },
}
