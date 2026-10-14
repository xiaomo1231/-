/**
 * Port of Airwindows DeBess by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * De-esser: senses sibilance as sharp "slews of slews" and pulls only the high-passed part of the signal down.
 */
import type { AirwindowsEffect, AirwindowsInfo, AirwindowsParam } from './types'

const f2 = (v: number) => v.toFixed(2)

const params: AirwindowsParam[] = [
  { name: 'Intense', default: 0, display: f2 },
  { name: 'Sharp', default: 0.5, display: f2 },
  { name: 'Depth', default: 0.5, display: f2 },
  { name: 'Filter', default: 0.5, display: f2 },
  { name: 'Sense', default: 0, display: (v) => `${f2(v)} ${v > 0.499999 ? 'Vox' : 'Ess'}` },
]

export const DeBess: AirwindowsInfo = {
  name: 'DeBess',
  params,
  create(sampleRate: number): AirwindowsEffect {
    const overallscale = sampleRate / 44100
    let A = 0
    let B = 0.5
    let C = 0.5
    let D = 0.5
    let E = 0

    const sL = new Float64Array(41)
    const mL = new Float64Array(41)
    const sR = new Float64Array(41)
    const mR = new Float64Array(41)
    let ratioAL = 1
    let ratioBL = 1
    let iirSampleAL = 0
    let iirSampleBL = 0
    let ratioAR = 1
    let ratioBR = 1
    let iirSampleAR = 0
    let iirSampleBR = 0
    let flip = false

    return {
      setParams(v) {
        if (v[0] !== undefined) A = v[0]
        if (v[1] !== undefined) B = v[1]
        if (v[2] !== undefined) C = v[2]
        if (v[3] !== undefined) D = v[3]
        if (v[4] !== undefined) E = v[4]
      },
      reset() {
        sL.fill(0)
        mL.fill(0)
        sR.fill(0)
        mR.fill(0)
        ratioAL = ratioBL = ratioAR = ratioBR = 1
        iirSampleAL = iirSampleBL = iirSampleAR = iirSampleBR = 0
        flip = false
      },
      process(left, right, n) {
        const intensity = Math.pow(A, 5) * (8192 / overallscale)
        let sharpness = B * 40
        if (sharpness < 2) sharpness = 2
        const speed = 0.1 / sharpness
        const depth = 1 / (C + 0.0001)
        const iirAmount = D
        const monitoring = Math.fround(E)
        const sh = Math.trunc(sharpness)

        for (let i = 0; i < n; i++) {
          const inL = left[i]
          const inR = right[i]
          let inputSampleL = inL
          let inputSampleR = inR

          sL[0] = inputSampleL
          sR[0] = inputSampleR
          for (let x = sh; x > 0; x--) {
            sL[x] = sL[x - 1]
            sR[x] = sR[x - 1]
          }

          mL[1] = (sL[1] - sL[2]) * ((sL[1] - sL[2]) / 1.3)
          mR[1] = (sR[1] - sR[2]) * ((sR[1] - sR[2]) / 1.3)
          for (let x = Math.trunc(sharpness - 1); x > 1; x--) {
            mL[x] = (sL[x] - sL[x + 1]) * ((sL[x - 1] - sL[x]) / 1.3)
            mR[x] = (sR[x] - sR[x + 1]) * ((sR[x - 1] - sR[x]) / 1.3)
          }

          let senseL = Math.abs(mL[1] - mL[2]) * sharpness * sharpness
          let senseR = Math.abs(mR[1] - mR[2]) * sharpness * sharpness
          for (let x = Math.trunc(sharpness - 1); x > 0; x--) {
            const multL = Math.abs(mL[x] - mL[x + 1]) * sharpness * sharpness
            if (multL < 1) senseL *= multL
            const multR = Math.abs(mR[x] - mR[x + 1]) * sharpness * sharpness
            if (multR < 1) senseR *= multR
          }

          senseL = 1 + intensity * intensity * senseL
          if (senseL > intensity) senseL = intensity
          senseR = 1 + intensity * intensity * senseR
          if (senseR > intensity) senseR = intensity

          if (flip) {
            iirSampleAL = iirSampleAL * (1 - iirAmount) + inputSampleL * iirAmount
            iirSampleAR = iirSampleAR * (1 - iirAmount) + inputSampleR * iirAmount
            ratioAL = ratioAL * (1 - speed) + senseL * speed
            ratioAR = ratioAR * (1 - speed) + senseR * speed
            if (ratioAL > depth) ratioAL = depth
            if (ratioAR > depth) ratioAR = depth
            if (ratioAL > 1) inputSampleL = iirSampleAL + (inputSampleL - iirSampleAL) / ratioAL
            if (ratioAR > 1) inputSampleR = iirSampleAR + (inputSampleR - iirSampleAR) / ratioAR
          } else {
            iirSampleBL = iirSampleBL * (1 - iirAmount) + inputSampleL * iirAmount
            iirSampleBR = iirSampleBR * (1 - iirAmount) + inputSampleR * iirAmount
            ratioBL = ratioBL * (1 - speed) + senseL * speed
            ratioBR = ratioBR * (1 - speed) + senseR * speed
            if (ratioBL > depth) ratioBL = depth
            if (ratioBR > depth) ratioBR = depth
            // (sic) the original tests ratioA* here, not ratioB*
            if (ratioAL > 1) inputSampleL = iirSampleBL + (inputSampleL - iirSampleBL) / ratioBL
            if (ratioAR > 1) inputSampleR = iirSampleBR + (inputSampleR - iirSampleBR) / ratioBR
          }
          flip = !flip

          if (monitoring > 0.49999) {
            inputSampleL = inL - inputSampleL
            inputSampleR = inR - inputSampleR
          }

          left[i] = inputSampleL
          right[i] = inputSampleR
        }
      },
    }
  },
}
