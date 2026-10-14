/**
 * Port of Airwindows ToTape6 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * Tape emulation: input drive, high-frequency softening, head bump, flutter and a soft output clip.
 */
import type { AirwindowsEffect, AirwindowsInfo } from './types'
import { xorshift32 } from './types'

const f2 = (v: number) => v.toFixed(2)
const dbDisp = (v: number) => `${((v - 0.5) * 24.0).toFixed(2)} dB`

/**
 * One channel's state. The C++ keeps parallel L/R variables with identical code;
 * the "A" and "B" sets alternate with `flip` (interleaved biquads for two-sample stepping).
 */
interface Channel {
  d: Float64Array
  iirMidRollerA: number
  iirMidRollerB: number
  iirHeadBumpA: number
  iirHeadBumpB: number
  biquadA: Float64Array
  biquadB: Float64Array
  biquadC: Float64Array
  biquadD: Float64Array
  lastSample: number
}

function makeChannel(): Channel {
  return {
    d: new Float64Array(502),
    iirMidRollerA: 0,
    iirMidRollerB: 0,
    iirHeadBumpA: 0,
    iirHeadBumpB: 0,
    biquadA: new Float64Array(9),
    biquadB: new Float64Array(9),
    biquadC: new Float64Array(9),
    biquadD: new Float64Array(9),
    lastSample: 0,
  }
}

function clearChannel(c: Channel) {
  c.d.fill(0)
  c.iirMidRollerA = c.iirMidRollerB = c.iirHeadBumpA = c.iirHeadBumpB = 0
  c.biquadA.fill(0)
  c.biquadB.fill(0)
  c.biquadC.fill(0)
  c.biquadD.fill(0)
  c.lastSample = 0
}

/** Interleaved biquad step on `x` (coefficient 3 is never set by the plugin and stays 0). */
function biquad(b: Float64Array, x: number): number {
  const t = x * b[2] + b[7]
  b[7] = x * b[3] - t * b[5] + b[8]
  b[8] = x * b[4] - t * b[6]
  return t
}

export const ToTape6: AirwindowsInfo = {
  name: 'ToTape6',
  params: [
    { name: 'Input', default: 0.5, display: dbDisp },
    { name: 'Soften', default: 0.5, display: f2 },
    { name: 'Head B', default: 0.5, display: f2 },
    { name: 'Flutter', default: 0.5, display: f2 },
    { name: 'Output', default: 0.5, display: dbDisp },
    { name: 'Dry/Wet', default: 1.0, display: f2 },
  ],
  create(sampleRate: number): AirwindowsEffect {
    const overallscale = (1.0 / 44100.0) * sampleRate
    const p = [0.5, 0.5, 0.5, 0.5, 0.5, 1.0]

    const ch = [makeChannel(), makeChannel()]
    let gcount = 0
    let rateof = 0.5
    let sweep = Math.PI
    let nextmax = 0.5
    let flip = false
    let rng = xorshift32()

    return {
      setParams(values) {
        for (let k = 0; k < 6; k++) if (values[k] !== undefined) p[k] = values[k]
      },
      reset() {
        clearChannel(ch[0])
        clearChannel(ch[1])
        gcount = 0
        rateof = 0.5
        sweep = Math.PI
        nextmax = 0.5
        flip = false
        rng = xorshift32()
      },
      process(left, right, n) {
        const [A, B, C, D, E, F] = p
        const inputgain = Math.pow(10.0, ((A - 0.5) * 24.0) / 20.0)
        const SoftenControl = Math.pow(B, 2)
        const RollAmount = (1.0 - SoftenControl * 0.45) / overallscale
        const HeadBumpControl = C * 0.25 * inputgain
        const HeadBumpFreq = 0.12 / overallscale

        // [0] frequency, [1] resonance (set every block, as the plugin does)
        const fa = 0.007 / overallscale
        const qa = 0.0009
        let K = Math.tan(Math.PI * fa)
        let norm = 1.0 / (1.0 + K / qa + K * K)
        const setBand = (b: Float64Array, f: number, q: number) => {
          b[0] = f
          b[1] = q
          b[2] = (K / q) * norm
          b[4] = -b[2]
          b[5] = 2.0 * (K * K - 1.0) * norm
          b[6] = (1.0 - K / q + K * K) * norm
        }
        for (const c of ch) {
          setBand(c.biquadA, fa, qa)
          setBand(c.biquadB, fa, qa)
        }
        const fc = 0.032 / overallscale
        const qc = 0.0007
        K = Math.tan(Math.PI * fc)
        norm = 1.0 / (1.0 + K / qc + K * K)
        for (const c of ch) {
          setBand(c.biquadC, fc, qc)
          setBand(c.biquadD, fc, qc)
        }

        const depth = Math.pow(D, 2) * overallscale * 70
        const fluttertrim = (0.0024 * Math.pow(D, 2)) / overallscale
        const outputgain = Math.pow(10.0, ((E - 0.5) * 24.0) / 20.0)

        const refclip = 0.99
        const softness = 0.6180339887498949
        const wet = F

        const io = [left, right]
        const x = [0, 0]
        const dry = [0, 0]
        const vibDry = [0, 0]
        const highs = [0, 0]

        for (let i = 0; i < n; i++) {
          for (let k = 0; k < 2; k++) {
            x[k] = io[k][i]
            dry[k] = x[k]
            if (inputgain < 1.0) x[k] *= inputgain
          }

          // the plugin's fpdL drives flutter randomness (one step per sample)
          const flutterrandy = rng() / 4294967295
          if (gcount < 0 || gcount > 499) gcount = 499
          ch[0].d[gcount] = x[0]
          ch[1].d[gcount] = x[1]
          let count = gcount
          if (depth !== 0.0) {
            const offset = depth + depth * Math.pow(rateof, 2) * Math.sin(sweep)
            const fl = Math.floor(offset)
            const frac = offset - fl
            count += fl
            // modulo guards very high sample rates where the offset could exceed the buffer
            const i0 = (count - (count > 499 ? 500 : 0)) % 500
            const i1 = (count + 1 - (count + 1 > 499 ? 500 : 0)) % 500
            for (let k = 0; k < 2; k++) {
              x[k] = ch[k].d[i0] * (1 - frac)
              x[k] += ch[k].d[i1] * frac
            }

            rateof = rateof * (1.0 - fluttertrim) + nextmax * fluttertrim
            sweep += rateof * fluttertrim

            if (sweep >= Math.PI * 2.0) {
              sweep -= Math.PI
              nextmax = 0.24 + flutterrandy * 0.74
            }
          }
          gcount--

          for (let k = 0; k < 2; k++) {
            const c = ch[k]
            let s = x[k]
            vibDry[k] = s
            if (flip) {
              c.iirMidRollerA = c.iirMidRollerA * (1.0 - RollAmount) + s * RollAmount
              highs[k] = s - c.iirMidRollerA

              c.iirHeadBumpA += s * 0.05
              c.iirHeadBumpA -= c.iirHeadBumpA * c.iirHeadBumpA * c.iirHeadBumpA * HeadBumpFreq
              c.iirHeadBumpA = Math.sin(c.iirHeadBumpA)
              c.iirHeadBumpA = biquad(c.biquadA, c.iirHeadBumpA)
              if (c.iirHeadBumpA > 1.0) c.iirHeadBumpA = 1.0
              if (c.iirHeadBumpA < -1.0) c.iirHeadBumpA = -1.0
              c.iirHeadBumpA = Math.asin(c.iirHeadBumpA)

              s = Math.sin(s)
              s = biquad(c.biquadC, s)
              if (s > 1.0) s = 1.0
              if (s < -1.0) s = -1.0
              s = Math.asin(s)
            } else {
              c.iirMidRollerB = c.iirMidRollerB * (1.0 - RollAmount) + s * RollAmount
              highs[k] = s - c.iirMidRollerB

              c.iirHeadBumpB += s * 0.05
              c.iirHeadBumpB -= c.iirHeadBumpB * c.iirHeadBumpB * c.iirHeadBumpB * HeadBumpFreq
              c.iirHeadBumpB = Math.sin(c.iirHeadBumpB)
              c.iirHeadBumpB = biquad(c.biquadB, c.iirHeadBumpB)
              if (c.iirHeadBumpB > 1.0) c.iirHeadBumpB = 1.0
              if (c.iirHeadBumpB < -1.0) c.iirHeadBumpB = -1.0
              c.iirHeadBumpB = Math.asin(c.iirHeadBumpB)

              s = Math.sin(s)
              s = biquad(c.biquadD, s)
              if (s > 1.0) s = 1.0
              if (s < -1.0) s = -1.0
              s = Math.asin(s)
            }
            x[k] = s
          }
          flip = !flip

          for (let k = 0; k < 2; k++) {
            const c = ch[k]
            let s = x[k]
            const groundSample = vibDry[k] - s // UnBox on fluttered audio

            if (inputgain > 1.0) s *= inputgain

            let applySoften = Math.abs(highs[k]) * 1.57079633
            if (applySoften > 1.57079633) applySoften = 1.57079633
            applySoften = 1 - Math.cos(applySoften)
            if (highs[k] > 0) s -= applySoften
            if (highs[k] < 0) s += applySoften

            const suppress = (1.0 - Math.abs(s)) * 0.00013
            if (c.iirHeadBumpA > suppress) c.iirHeadBumpA -= suppress
            if (c.iirHeadBumpA < -suppress) c.iirHeadBumpA += suppress
            if (c.iirHeadBumpB > suppress) c.iirHeadBumpB -= suppress
            if (c.iirHeadBumpB < -suppress) c.iirHeadBumpB += suppress

            s += (c.iirHeadBumpA + c.iirHeadBumpB) * HeadBumpControl

            if (s > 1.0) s = 1.0
            if (s < -1.0) s = -1.0
            const mojo = Math.pow(Math.abs(s), 0.25)
            if (mojo > 0.0) s = Math.sin(s * mojo * Math.PI * 0.5) / mojo

            s += groundSample

            if (outputgain !== 1.0) s *= outputgain

            // ADClip
            let last = c.lastSample
            if (last >= refclip) {
              if (s < refclip) last = refclip * softness + s * (1.0 - softness)
              else last = refclip
            }
            if (last <= -refclip) {
              if (s > -refclip) last = -refclip * softness + s * (1.0 - softness)
              else last = -refclip
            }
            if (s > refclip) {
              if (last < refclip) s = refclip * softness + last * (1.0 - softness)
              else s = refclip
            }
            if (s < -refclip) {
              if (last > -refclip) s = -refclip * softness + last * (1.0 - softness)
              else s = -refclip
            }
            c.lastSample = s

            // final iron bar
            if (s > refclip) s = refclip
            if (s < -refclip) s = -refclip

            if (wet !== 1.0) s = s * wet + dry[k] * (1.0 - wet)

            io[k][i] = s
          }
        }
      },
    }
  },
}
