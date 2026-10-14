/**
 * Port of Airwindows Tube2 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * Tube-style saturation: asymmetric soft clip, a power-law tube curve and a slew-dependent "spiky fuzz" stage.
 */
import type { AirwindowsEffect, AirwindowsInfo } from './types'

const f2 = (v: number) => v.toFixed(2)

export const Tube2: AirwindowsInfo = {
  name: 'Tube2',
  params: [
    { name: 'Input', default: 0.5, display: f2 },
    { name: 'Tube', default: 0.5, display: f2 },
  ],
  create(sampleRate: number): AirwindowsEffect {
    const overallscale = (1.0 / 44100.0) * sampleRate
    let A = 0.5
    let B = 0.5
    // previousSampleA..F
    let pA = 0
    let pB = 0
    let pC = 0
    let pD = 0
    let pE = 0
    let pF = 0

    return {
      setParams(values) {
        if (values[0] !== undefined) A = values[0]
        if (values[1] !== undefined) B = values[1]
      },
      reset() {
        pA = pB = pC = pD = pE = pF = 0
      },
      process(left, right, n) {
        const inputPad = A
        const iterations = 1.0 - B
        const powerfactor = Math.trunc(9.0 * iterations + 1)
        const asymPad = powerfactor
        const gainscaling = 1.0 / (powerfactor + 1)
        const outputscaling = 1.0 + 1.0 / powerfactor

        for (let i = 0; i < n; i++) {
          let L = left[i]
          let R = right[i]

          if (inputPad < 1.0) {
            L *= inputPad
            R *= inputPad
          }

          if (overallscale > 1.9) {
            let stored = L
            L += pA
            pA = stored
            L *= 0.5
            stored = R
            R += pB
            pB = stored
            R *= 0.5
          }

          if (L > 1.0) L = 1.0
          if (L < -1.0) L = -1.0
          if (R > 1.0) R = 1.0
          if (R < -1.0) R = -1.0

          // flatten bottom, point top of sine waveshaper L
          L /= asymPad
          let sharpen = -L
          if (sharpen > 0.0) sharpen = 1.0 + Math.sqrt(sharpen)
          else sharpen = 1.0 - Math.sqrt(-sharpen)
          L -= L * Math.abs(L) * sharpen * 0.25
          L *= asymPad

          // R
          R /= asymPad
          sharpen = -R
          if (sharpen > 0.0) sharpen = 1.0 + Math.sqrt(sharpen)
          else sharpen = 1.0 - Math.sqrt(-sharpen)
          R -= R * Math.abs(R) * sharpen * 0.25
          R *= asymPad

          // original Tube algorithm, left
          let factor = L
          for (let x = 0; x < powerfactor; x++) factor *= L
          if (powerfactor % 2 === 1 && L !== 0.0) factor = (factor / L) * Math.abs(L)
          factor *= gainscaling
          L -= factor
          L *= outputscaling

          // right
          factor = R
          for (let x = 0; x < powerfactor; x++) factor *= R
          if (powerfactor % 2 === 1 && R !== 0.0) factor = (factor / R) * Math.abs(R)
          factor *= gainscaling
          R -= factor
          R *= outputscaling

          if (overallscale > 1.9) {
            let stored = L
            L += pC
            pC = stored
            L *= 0.5
            stored = R
            R += pD
            pD = stored
            R *= 0.5
          }

          // hysteresis and spiky fuzz L
          let slew = pE - L
          if (overallscale > 1.9) {
            const stored = L
            L += pE
            pE = stored
            L *= 0.5
          } else pE = L
          if (slew > 0.0) slew = 1.0 + Math.sqrt(slew) * 0.5
          else slew = 1.0 - Math.sqrt(-slew) * 0.5
          L -= L * Math.abs(L) * slew * gainscaling
          if (L > 0.52) L = 0.52
          if (L < -0.52) L = -0.52
          L *= 1.923076923076923

          // R
          slew = pF - R
          if (overallscale > 1.9) {
            const stored = R
            R += pF
            pF = stored
            R *= 0.5
          } else pF = R
          if (slew > 0.0) slew = 1.0 + Math.sqrt(slew) * 0.5
          else slew = 1.0 - Math.sqrt(-slew) * 0.5
          R -= R * Math.abs(R) * slew * gainscaling
          if (R > 0.52) R = 0.52
          if (R < -0.52) R = -0.52
          R *= 1.923076923076923

          left[i] = L
          right[i] = R
        }
      },
    }
  },
}
