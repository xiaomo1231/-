/**
 * Port of Airwindows ButterComp2 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * A gentle, bi-polar "interleaved" compressor: positive and negative half-waves are squeezed separately
 * with two alternating control sets, giving a smooth, glue-like and slightly colourful compression.
 */
import { type AirwindowsEffect, type AirwindowsInfo, type AirwindowsParam } from './types'

const fmt = (v: number) => v.toFixed(2)

const params: AirwindowsParam[] = [
  { name: 'Compress', default: 0.0, display: fmt },
  { name: 'Output', default: 0.5, display: (v) => fmt(v * 2) },
  { name: 'Dry/Wet', default: 1.0, display: fmt },
]

class ButterComp2Effect implements AirwindowsEffect {
  private overallscale: number
  private A = params[0].default
  private B = params[1].default
  private C = params[2].default

  private controlAposL = 1
  private controlAnegL = 1
  private controlBposL = 1
  private controlBnegL = 1
  private targetposL = 1
  private targetnegL = 1
  private lastOutputL = 0
  private controlAposR = 1
  private controlAnegR = 1
  private controlBposR = 1
  private controlBnegR = 1
  private targetposR = 1
  private targetnegR = 1
  private lastOutputR = 0
  private flip = false

  constructor(sampleRate: number) {
    this.overallscale = sampleRate / 44100
  }

  setParams(values: readonly number[]): void {
    if (values[0] !== undefined) this.A = values[0]
    if (values[1] !== undefined) this.B = values[1]
    if (values[2] !== undefined) this.C = values[2]
  }

  reset(): void {
    this.controlAposL = this.controlAnegL = this.controlBposL = this.controlBnegL = 1
    this.targetposL = this.targetnegL = 1
    this.lastOutputL = 0
    this.controlAposR = this.controlAnegR = this.controlBposR = this.controlBnegR = 1
    this.targetposR = this.targetnegR = 1
    this.lastOutputR = 0
    this.flip = false
  }

  process(left: Float32Array, right: Float32Array, n: number): void {
    const { A, B, C, overallscale } = this
    const inputgain = Math.pow(10.0, (A * 14.0) / 20.0)
    const compfactor = 0.012 * (A / 135.0)
    const output = B * 2.0
    const wet = C
    let outputgain = inputgain
    outputgain -= 1.0
    outputgain /= 1.5
    outputgain += 1.0

    for (let i = 0; i < n; i++) {
      let inputSampleL = left[i]
      let inputSampleR = right[i]
      const drySampleL = inputSampleL
      const drySampleR = inputSampleR

      inputSampleL *= inputgain
      inputSampleR *= inputgain

      // ---- left ----
      let divisor = compfactor / (1.0 + Math.abs(this.lastOutputL))
      divisor /= overallscale
      let remainder = divisor
      divisor = 1.0 - divisor

      let inputposL = inputSampleL + 1.0
      if (inputposL < 0.0) inputposL = 0.0
      let outputposL = inputposL / 2.0
      if (outputposL > 1.0) outputposL = 1.0
      inputposL *= inputposL
      this.targetposL *= divisor
      this.targetposL += inputposL * remainder
      const calcposL = Math.pow(1.0 / this.targetposL, 2)

      let inputnegL = -inputSampleL + 1.0
      if (inputnegL < 0.0) inputnegL = 0.0
      let outputnegL = inputnegL / 2.0
      if (outputnegL > 1.0) outputnegL = 1.0
      inputnegL *= inputnegL
      this.targetnegL *= divisor
      this.targetnegL += inputnegL * remainder
      const calcnegL = Math.pow(1.0 / this.targetnegL, 2)

      if (inputSampleL > 0) {
        if (this.flip) {
          this.controlAposL *= divisor
          this.controlAposL += calcposL * remainder
        } else {
          this.controlBposL *= divisor
          this.controlBposL += calcposL * remainder
        }
      } else if (this.flip) {
        this.controlAnegL *= divisor
        this.controlAnegL += calcnegL * remainder
      } else {
        this.controlBnegL *= divisor
        this.controlBnegL += calcnegL * remainder
      }

      // ---- right ----
      divisor = compfactor / (1.0 + Math.abs(this.lastOutputR))
      divisor /= overallscale
      remainder = divisor
      divisor = 1.0 - divisor

      let inputposR = inputSampleR + 1.0
      if (inputposR < 0.0) inputposR = 0.0
      let outputposR = inputposR / 2.0
      if (outputposR > 1.0) outputposR = 1.0
      inputposR *= inputposR
      this.targetposR *= divisor
      this.targetposR += inputposR * remainder
      const calcposR = Math.pow(1.0 / this.targetposR, 2)

      let inputnegR = -inputSampleR + 1.0
      if (inputnegR < 0.0) inputnegR = 0.0
      let outputnegR = inputnegR / 2.0
      if (outputnegR > 1.0) outputnegR = 1.0
      inputnegR *= inputnegR
      this.targetnegR *= divisor
      this.targetnegR += inputnegR * remainder
      const calcnegR = Math.pow(1.0 / this.targetnegR, 2)

      if (inputSampleR > 0) {
        if (this.flip) {
          this.controlAposR *= divisor
          this.controlAposR += calcposR * remainder
        } else {
          this.controlBposR *= divisor
          this.controlBposR += calcposR * remainder
        }
      } else if (this.flip) {
        this.controlAnegR *= divisor
        this.controlAnegR += calcnegR * remainder
      } else {
        this.controlBnegR *= divisor
        this.controlBnegR += calcnegR * remainder
      }

      let totalmultiplierL: number
      let totalmultiplierR: number
      if (this.flip) {
        totalmultiplierL = this.controlAposL * outputposL + this.controlAnegL * outputnegL
        totalmultiplierR = this.controlAposR * outputposR + this.controlAnegR * outputnegR
      } else {
        totalmultiplierL = this.controlBposL * outputposL + this.controlBnegL * outputnegL
        totalmultiplierR = this.controlBposR * outputposR + this.controlBnegR * outputnegR
      }

      inputSampleL *= totalmultiplierL
      inputSampleL /= outputgain
      inputSampleR *= totalmultiplierR
      inputSampleR /= outputgain

      if (output !== 1.0) {
        inputSampleL *= output
        inputSampleR *= output
      }

      if (wet !== 1.0) {
        inputSampleL = inputSampleL * wet + drySampleL * (1.0 - wet)
        inputSampleR = inputSampleR * wet + drySampleR * (1.0 - wet)
      }

      this.lastOutputL = inputSampleL
      this.lastOutputR = inputSampleR
      this.flip = !this.flip

      left[i] = inputSampleL
      right[i] = inputSampleR
    }
  }
}

export const ButterComp2: AirwindowsInfo = {
  name: 'ButterComp2',
  params,
  create: (sampleRate) => new ButterComp2Effect(sampleRate),
}
