/**
 * Port of Airwindows Verbity2 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * A dense, smooth studio reverb: five parallel delays feeding four stages of 5x5 Householder
 * mixing, with soft feedback, a highpass/lowpass "mulch" tone control and a submix-style dry/wet
 * (50% is both dry and wet at full level).
 */
import {
  xorshift32,
  type AirwindowsEffect,
  type AirwindowsInfo,
  type AirwindowsParam,
} from './types'

const f2 = (v: number) => v.toFixed(2)

const params: AirwindowsParam[] = [
  { name: 'RmSize', default: 0.5, display: f2 },
  { name: 'Sustain', default: 0.5, display: f2 },
  { name: 'Mulch', default: 0.5, display: f2 },
  { name: 'Wetness', default: 1.0, display: f2 },
]

// Delay slots A..Y (index 0..24): array sizes and base lengths (scaled by room size).
// Grouped in fives: A-E, F-J, K-O, P-T, U-Y.
const SIZES = [
  5005, 4351, 3325, 2143, 679, 4953, 4159, 2793, 1813, 645, 4921, 3931, 2769, 1735, 441, 4801, 3531,
  2391, 1173, 351, 4753, 3331, 2349, 789, 283,
]
const BASE = [
  5003, 4349, 3323, 2141, 677, 4951, 4157, 2791, 1811, 643, 4919, 3929, 2767, 1733, 439, 4799, 3529,
  2389, 1171, 349, 4751, 3329, 2347, 787, 281,
]

class Verbity2Effect implements AirwindowsEffect {
  private readonly overallscale: number
  private readonly cycleEnd: number
  private readonly p = [0.5, 0.5, 0.5, 1.0]

  private regen = 0
  private lowpass = 0
  private highpass = 0
  private interpolateMax = 0
  private wet = 1
  private dry = 0

  private readonly dL: Float64Array[] = []
  private readonly dR: Float64Array[] = []
  private readonly count = new Int32Array(25)
  private readonly delay = new Int32Array(25)

  private iirAL = 0
  private iirBL = 0
  private iirAR = 0
  private iirBR = 0
  private readonly fbL = new Float64Array(5)
  private readonly fbR = new Float64Array(5)
  private readonly prevL = new Float64Array(5)
  private readonly prevR = new Float64Array(5)
  private readonly lastRefL = new Float64Array(7)
  private readonly lastRefR = new Float64Array(7)
  private readonly oL = new Float64Array(5)
  private readonly oR = new Float64Array(5)
  private readonly hL = new Float64Array(5)
  private readonly hR = new Float64Array(5)
  private cycle = 0
  private fpdL = 0
  private fpdR = 0
  private rngL = xorshift32(0x9e3779b9)
  private rngR = xorshift32(0x85ebca6b)

  constructor(sampleRate: number) {
    this.overallscale = sampleRate / 44100
    let ce = Math.floor(this.overallscale)
    if (ce < 1) ce = 1
    if (ce > 4) ce = 4
    this.cycleEnd = ce
    for (const s of SIZES) {
      this.dL.push(new Float64Array(s))
      this.dR.push(new Float64Array(s))
    }
    this.reset()
    this.setParams(this.p)
  }

  setParams(values: readonly number[]): void {
    for (let i = 0; i < 4; i++) if (values[i] !== undefined) this.p[i] = values[i]
    const [A, B, C, D] = this.p
    const os = this.overallscale
    const size = Math.pow(A, 2.0) * 0.9 + 0.1
    this.regen = (1.0 - Math.pow(1.0 - B, 3.0)) * 0.00032
    this.lowpass = (1.0 - C * 0.75) / Math.sqrt(os)
    this.highpass = (0.007 + C * 0.022) / Math.sqrt(os)
    this.interpolateMax = 0.07 + C * 0.4
    let wet = D * 2.0
    let dry = 2.0 - wet
    if (wet > 1.0) wet = 1.0
    if (wet < 0.0) wet = 0.0
    if (dry > 1.0) dry = 1.0
    if (dry < 0.0) dry = 0.0
    this.wet = wet
    this.dry = dry
    // this reverb makes 50% full dry AND full wet, not crossfaded
    for (let i = 0; i < 25; i++) this.delay[i] = Math.trunc(BASE[i] * size)
    if (this.cycle > this.cycleEnd - 1) this.cycle = this.cycleEnd - 1
  }

  reset(): void {
    for (const a of this.dL) a.fill(0)
    for (const a of this.dR) a.fill(0)
    this.count.fill(1)
    this.iirAL = this.iirBL = this.iirAR = this.iirBR = 0
    this.fbL.fill(0)
    this.fbR.fill(0)
    this.prevL.fill(0)
    this.prevR.fill(0)
    this.lastRefL.fill(0)
    this.lastRefR.fill(0)
    this.cycle = 0
    this.rngL = xorshift32(0x9e3779b9)
    this.rngR = xorshift32(0x85ebca6b)
    this.fpdL = this.rngL()
    this.fpdR = this.rngR()
  }

  /** 3*o[k] - 2*(sum of the other four), written to dst. */
  private static mix(o: Float64Array, dst: Float64Array): void {
    for (let k = 0; k < 5; k++) {
      dst[k] =
        o[k] * 3.0 - (o[(k + 1) % 5] + o[(k + 2) % 5] + o[(k + 3) % 5] + o[(k + 4) % 5]) * 2.0
    }
  }

  process(left: Float32Array, right: Float32Array, n: number): void {
    const { regen, lowpass, highpass, interpolateMax, wet, dry, cycleEnd } = this
    const { dL, dR, count, delay, fbL, fbR, prevL, prevR, lastRefL, lastRefR, oL, oR } = this
    const { hL, hR } = this
    for (let s = 0; s < n; s++) {
      let inputSampleL = left[s]
      let inputSampleR = right[s]
      let drySampleL = inputSampleL
      let drySampleR = inputSampleR

      if (Math.abs(this.iirAL) < 1.18e-37) this.iirAL = 0.0
      this.iirAL = this.iirAL * (1.0 - highpass) + inputSampleL * highpass
      inputSampleL -= this.iirAL
      if (Math.abs(this.iirAR) < 1.18e-37) this.iirAR = 0.0
      this.iirAR = this.iirAR * (1.0 - highpass) + inputSampleR * highpass
      inputSampleR -= this.iirAR
      // first filter is highpass

      const interpolateL = interpolateMax + interpolateMax * (this.fpdL / 4294967295)
      const interpolateR = interpolateMax + interpolateMax * (this.fpdR / 4294967295)
      // we have our feedback soften also working as Chrome Oxide soften/noise

      this.cycle++
      if (this.cycle === cycleEnd) {
        // hit the end point and we do a reverb sample
        for (let k = 0; k < 5; k++) {
          fbL[k] = fbL[k] * (1.0 - interpolateL) + prevL[k] * interpolateL
          prevL[k] = fbL[k]
          fbR[k] = fbR[k] * (1.0 - interpolateR) + prevR[k] * interpolateR
          prevR[k] = fbR[k]
        }
        for (let k = 0; k < 5; k++) {
          dL[k][count[k]] = inputSampleL + fbL[k] * (regen * (1.0 - Math.abs(fbL[k] * regen)))
          dR[k][count[k]] = inputSampleR + fbR[k] * (regen * (1.0 - Math.abs(fbR[k] * regen)))
        }
        for (let k = 0; k < 5; k++) {
          count[k]++
          if (count[k] < 0 || count[k] > delay[k]) count[k] = 0
          oL[k] = dL[k][count[k]]
          oR[k] = dR[k][count[k]]
        }
        // stages one..four: Householder mix into the next group of five delays
        for (let st = 1; st <= 4; st++) {
          const base = st * 5
          Verbity2Effect.mix(oL, hL)
          Verbity2Effect.mix(oR, hR)
          for (let k = 0; k < 5; k++) {
            dL[base + k][count[base + k]] = hL[k]
            dR[base + k][count[base + k]] = hR[k]
          }
          for (let k = 0; k < 5; k++) {
            const i = base + k
            count[i]++
            if (count[i] < 0 || count[i] > delay[i]) count[i] = 0
            oL[k] = dL[i][count[i]]
            oR[k] = dR[i][count[i]]
          }
        }
        // five: the final mix, cross-fed between channels, back into the input again
        Verbity2Effect.mix(oL, hL)
        Verbity2Effect.mix(oR, hR)
        for (let k = 0; k < 5; k++) {
          if ((k & 1) === 0) {
            fbL[k] = hR[k]
            fbR[k] = hL[k]
          } else {
            fbL[k] = hL[k]
            fbR[k] = hR[k]
          }
        }
        inputSampleL = (oL[0] + oL[1] + oL[2] + oL[3] + oL[4]) * 0.0016
        inputSampleR = (oR[0] + oR[1] + oR[2] + oR[3] + oR[4]) * 0.0016
        // and take the final combined sum of outputs, corrected for Householder gain
        if (cycleEnd === 4) {
          lastRefL[0] = lastRefL[4]
          lastRefL[2] = (lastRefL[0] + inputSampleL) / 2
          lastRefL[1] = (lastRefL[0] + lastRefL[2]) / 2
          lastRefL[3] = (lastRefL[2] + inputSampleL) / 2
          lastRefL[4] = inputSampleL
          lastRefR[0] = lastRefR[4]
          lastRefR[2] = (lastRefR[0] + inputSampleR) / 2
          lastRefR[1] = (lastRefR[0] + lastRefR[2]) / 2
          lastRefR[3] = (lastRefR[2] + inputSampleR) / 2
          lastRefR[4] = inputSampleR
        }
        if (cycleEnd === 3) {
          lastRefL[0] = lastRefL[3]
          lastRefL[2] = (lastRefL[0] + lastRefL[0] + inputSampleL) / 3
          lastRefL[1] = (lastRefL[0] + inputSampleL + inputSampleL) / 3
          lastRefL[3] = inputSampleL
          lastRefR[0] = lastRefR[3]
          lastRefR[2] = (lastRefR[0] + lastRefR[0] + inputSampleR) / 3
          lastRefR[1] = (lastRefR[0] + inputSampleR + inputSampleR) / 3
          lastRefR[3] = inputSampleR
        }
        if (cycleEnd === 2) {
          lastRefL[0] = lastRefL[2]
          lastRefL[1] = (lastRefL[0] + inputSampleL) / 2
          lastRefL[2] = inputSampleL
          lastRefR[0] = lastRefR[2]
          lastRefR[1] = (lastRefR[0] + inputSampleR) / 2
          lastRefR[2] = inputSampleR
        }
        if (cycleEnd === 1) {
          lastRefL[0] = inputSampleL
          lastRefR[0] = inputSampleR
        }
        this.cycle = 0
        inputSampleL = lastRefL[this.cycle]
        inputSampleR = lastRefR[this.cycle]
      } else {
        inputSampleL = lastRefL[this.cycle]
        inputSampleR = lastRefR[this.cycle]
        // we are going through our references now
      }

      if (Math.abs(this.iirBL) < 1.18e-37) this.iirBL = 0.0
      this.iirBL = this.iirBL * (1.0 - lowpass) + inputSampleL * lowpass
      inputSampleL = this.iirBL
      if (Math.abs(this.iirBR) < 1.18e-37) this.iirBR = 0.0
      this.iirBR = this.iirBR * (1.0 - lowpass) + inputSampleR * lowpass
      inputSampleR = this.iirBR
      // second filter

      if (wet < 1.0) {
        inputSampleL *= wet
        inputSampleR *= wet
      }
      if (dry < 1.0) {
        drySampleL *= dry
        drySampleR *= dry
      }
      inputSampleL += drySampleL
      inputSampleR += drySampleR
      // submix verb dry/wet: 0.5 is BOTH at FULL VOLUME

      // fpd advances once per sample per channel (the plugin's dither step); it drives the softening
      this.fpdL = this.rngL()
      this.fpdR = this.rngR()
      left[s] = inputSampleL
      right[s] = inputSampleR
    }
  }
}

export const Verbity2: AirwindowsInfo = {
  name: 'Verbity2',
  params,
  create: (sampleRate: number) => new Verbity2Effect(sampleRate),
}
