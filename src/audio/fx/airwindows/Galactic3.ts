/**
 * Port of Airwindows Galactic3 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * A big, dark, endlessly sustaining space reverb: a vibrato pre-delay, a 12-delay Hadamard-style
 * network run at a reduced ("derezzed") sample rate, and bezier reconstruction back up.
 */
import {
  xorshift32,
  type AirwindowsEffect,
  type AirwindowsInfo,
  type AirwindowsParam,
} from './types'

const f2 = (v: number) => v.toFixed(2)

const params: AirwindowsParam[] = [
  { name: 'Replace', default: 0.5, display: f2 },
  { name: 'Brightns', default: 0.5, display: f2 },
  { name: 'Detune', default: 0.5, display: f2 },
  { name: 'Derez', default: 1.0, display: f2 },
  { name: 'Bigness', default: 1.0, display: f2 },
  { name: 'Dry/Wet', default: 1.0, display: f2 },
]

// Delay slots A..L (index 0..11) and their base lengths; M (the pre-delay) is separate.
const SIZES = [9700, 6000, 2320, 940, 15220, 8460, 4540, 3200, 6480, 3660, 1720, 680]
const BASE = [4801, 2909, 1153, 461, 7607, 4217, 2269, 1597, 3407, 1823, 859, 331]
const M_SIZE = 3111

// bez indices
const AL = 0
const AR = 1
const BL = 2
const BR = 3
const CL = 4
const CR = 5
const InL = 6
const InR = 7
const UnInL = 8
const UnInR = 9
const SampL = 10
const SampR = 11
const CYCLE = 12

class Galactic3Effect implements AirwindowsEffect {
  private readonly overallscale: number
  private readonly p = [0.5, 0.5, 0.5, 1.0, 1.0, 1.0]

  private regen = 0
  private attenuate = 0
  private lowpass = 0
  private drift = 0
  private derez = 1
  private wet = 1

  private dL: Float64Array[] = []
  private dR: Float64Array[] = []
  private aML = new Float64Array(M_SIZE)
  private aMR = new Float64Array(M_SIZE)
  private readonly count = new Int32Array(12)
  private readonly delay = new Int32Array(12)
  private countM = 1
  private readonly delayM = 256

  private iirAL = 0
  private iirBL = 0
  private iirAR = 0
  private iirBR = 0
  private vibM = 3.0
  private oldfpd = 429496.7295
  private fpdL = 0
  private rng = xorshift32(0x9e3779b9)
  private readonly fbL = new Float64Array(4)
  private readonly fbR = new Float64Array(4)
  private readonly oL = new Float64Array(4)
  private readonly oR = new Float64Array(4)
  private readonly bez = new Float64Array(13)

  constructor(sampleRate: number) {
    this.overallscale = sampleRate / 44100
    for (const s of SIZES) {
      this.dL.push(new Float64Array(s))
      this.dR.push(new Float64Array(s))
    }
    this.reset()
    this.setParams(this.p)
  }

  setParams(values: readonly number[]): void {
    for (let i = 0; i < 6; i++) if (values[i] !== undefined) this.p[i] = values[i]
    const [A, B, C, D, E, F] = this.p
    const os = this.overallscale
    this.regen = 0.0625 + (1.0 - A) * 0.0625
    this.attenuate = (1.0 - this.regen / 0.125) * 1.333
    this.lowpass = Math.pow(1.00001 - (1.0 - B), 2.0) / Math.sqrt(os)
    this.drift = Math.pow(C, 3) * 0.001
    let derez = D / os
    if (derez < 0.0005) derez = 0.0005
    if (derez > 1.0) derez = 1.0
    this.derez = 1.0 / Math.trunc(1.0 / derez)
    const size = E * 1.77 + 0.1
    this.wet = 1.0 - Math.pow(1.0 - F, 3)
    for (let i = 0; i < 12; i++) this.delay[i] = Math.trunc(BASE[i] * size)
  }

  reset(): void {
    for (const a of this.dL) a.fill(0)
    for (const a of this.dR) a.fill(0)
    this.aML.fill(0)
    this.aMR.fill(0)
    this.count.fill(1)
    this.countM = 1
    this.iirAL = this.iirBL = this.iirAR = this.iirBR = 0
    this.fbL.fill(0)
    this.fbR.fill(0)
    this.bez.fill(0)
    this.bez[CYCLE] = 1.0
    this.vibM = 3.0
    this.oldfpd = 429496.7295
    this.rng = xorshift32(0x9e3779b9)
    this.fpdL = this.rng()
  }

  process(left: Float32Array, right: Float32Array, n: number): void {
    const { regen, attenuate, lowpass, drift, derez, wet } = this
    const { dL, dR, aML, aMR, count, delay, fbL, fbR, oL, oR, bez, delayM } = this
    const PI = Math.PI
    for (let s = 0; s < n; s++) {
      let inputSampleL = left[s]
      let inputSampleR = right[s]
      const drySampleL = inputSampleL
      const drySampleR = inputSampleR

      this.vibM += this.oldfpd * drift
      if (this.vibM > PI * 2.0) {
        this.vibM = 0.0
        this.oldfpd = 0.4294967295 + this.fpdL * 0.0000000000618
      }
      const vibM = this.vibM
      aML[this.countM] = inputSampleL * attenuate
      aMR[this.countM] = inputSampleR * attenuate
      this.countM++
      if (this.countM < 0 || this.countM > delayM) this.countM = 0
      const countM = this.countM
      const offsetML = (Math.sin(vibM) + 1.0) * 127
      const offsetMR = (Math.sin(vibM + PI / 2.0) + 1.0) * 127
      const workingML = (countM + offsetML) | 0
      const workingMR = (countM + offsetMR) | 0
      const fracL = offsetML - Math.floor(offsetML)
      const fracR = offsetMR - Math.floor(offsetMR)
      let interpolML = aML[workingML - (workingML > delayM ? delayM + 1 : 0)] * (1 - fracL)
      interpolML += aML[workingML + 1 - (workingML + 1 > delayM ? delayM + 1 : 0)] * fracL
      let interpolMR = aMR[workingMR - (workingMR > delayM ? delayM + 1 : 0)] * (1 - fracR)
      interpolMR += aMR[workingMR + 1 - (workingMR + 1 > delayM ? delayM + 1 : 0)] * fracR
      inputSampleL = interpolML
      inputSampleR = interpolMR
      // predelay that applies vibrato

      this.iirAL = this.iirAL * (1.0 - lowpass) + inputSampleL * lowpass
      inputSampleL = this.iirAL
      this.iirAR = this.iirAR * (1.0 - lowpass) + inputSampleR * lowpass
      inputSampleR = this.iirAR
      // initial filter

      bez[CYCLE] += derez
      bez[SampL] += (inputSampleL + bez[InL]) * derez
      bez[SampR] += (inputSampleR + bez[InR]) * derez
      bez[InL] = inputSampleL
      bez[InR] = inputSampleR
      if (bez[CYCLE] > 1.0) {
        // hit the end point and we do a reverb sample
        bez[CYCLE] = 0.0
        const sumL = bez[SampL] + bez[UnInL]
        const sumR = bez[SampR] + bez[UnInR]
        for (let k = 0; k < 4; k++) {
          const i = 8 + k // I J K L
          dL[i][count[i]] = sumL + fbR[k] * regen
          dR[i][count[i]] = sumR + fbL[k] * regen
        }
        bez[UnInL] = bez[SampL]
        bez[UnInR] = bez[SampR]
        for (let i = 8; i < 12; i++) {
          count[i]++
          if (count[i] < 0 || count[i] > delay[i]) count[i] = 0
        }
        for (let k = 0; k < 4; k++) {
          oL[k] = dL[8 + k][count[8 + k]]
          oR[k] = dR[8 + k][count[8 + k]]
        }
        // first block: now we have four outputs
        for (let k = 0; k < 4; k++) {
          dL[k][count[k]] = oL[k] - (oL[(k + 1) & 3] + oL[(k + 2) & 3] + oL[(k + 3) & 3])
          dR[k][count[k]] = oR[k] - (oR[(k + 1) & 3] + oR[(k + 2) & 3] + oR[(k + 3) & 3])
        }
        for (let i = 0; i < 4; i++) {
          count[i]++
          if (count[i] < 0 || count[i] > delay[i]) count[i] = 0
        }
        for (let k = 0; k < 4; k++) {
          oL[k] = dL[k][count[k]]
          oR[k] = dR[k][count[k]]
        }
        // second block: four more outputs
        for (let k = 0; k < 4; k++) {
          const i = 4 + k // E F G H
          dL[i][count[i]] = oL[k] - (oL[(k + 1) & 3] + oL[(k + 2) & 3] + oL[(k + 3) & 3])
          dR[i][count[i]] = oR[k] - (oR[(k + 1) & 3] + oR[(k + 2) & 3] + oR[(k + 3) & 3])
        }
        for (let i = 4; i < 8; i++) {
          count[i]++
          if (count[i] < 0 || count[i] > delay[i]) count[i] = 0
        }
        for (let k = 0; k < 4; k++) {
          oL[k] = dL[4 + k][count[4 + k]]
          oR[k] = dR[4 + k][count[4 + k]]
        }
        // third block: final outputs
        for (let k = 0; k < 4; k++) {
          fbL[k] = oL[k] - (oL[(k + 1) & 3] + oL[(k + 2) & 3] + oL[(k + 3) & 3])
          fbR[k] = oR[k] - (oR[(k + 1) & 3] + oR[(k + 2) & 3] + oR[(k + 3) & 3])
        }
        // which we need to feed back into the input again, a bit
        inputSampleL = (oL[0] + oL[1] + oL[2] + oL[3]) / 8.0
        inputSampleR = (oR[0] + oR[1] + oR[2] + oR[3]) / 8.0
        // and take the final combined sum of outputs
        bez[CL] = bez[BL]
        bez[BL] = bez[AL]
        bez[AL] = inputSampleL
        bez[SampL] = 0.0
        bez[CR] = bez[BR]
        bez[BR] = bez[AR]
        bez[AR] = inputSampleR
        bez[SampR] = 0.0
      }
      const cyc = bez[CYCLE]
      const CBL = bez[CL] * (1.0 - cyc) + bez[BL] * cyc
      const CBR = bez[CR] * (1.0 - cyc) + bez[BR] * cyc
      const BAL = bez[BL] * (1.0 - cyc) + bez[AL] * cyc
      const BAR = bez[BR] * (1.0 - cyc) + bez[AR] * cyc
      inputSampleL = (bez[BL] + CBL * (1.0 - cyc) + BAL * cyc) * 0.125
      inputSampleR = (bez[BR] + CBR * (1.0 - cyc) + BAR * cyc) * 0.125

      this.iirBL = this.iirBL * (1.0 - lowpass) + inputSampleL * lowpass
      inputSampleL = this.iirBL
      this.iirBR = this.iirBR * (1.0 - lowpass) + inputSampleR * lowpass
      inputSampleR = this.iirBR
      // end filter

      if (wet < 1.0) {
        inputSampleL = inputSampleL * wet + drySampleL * (1.0 - wet)
        inputSampleR = inputSampleR * wet + drySampleR * (1.0 - wet)
      }
      // the plugin's fpd advances once per sample (dither); it also seeds the drift modulation
      this.fpdL = this.rng()
      left[s] = inputSampleL
      right[s] = inputSampleR
    }
  }
}

export const Galactic3: AirwindowsInfo = {
  name: 'Galactic3',
  params,
  create: (sampleRate: number) => new Galactic3Effect(sampleRate),
}
