/**
 * Port of Airwindows Pressure4 by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * A vari-mu style compressor with a program-dependent release and a "mewiness" control that bends the
 * gain curve, followed by a soft sine saturation stage that keeps the output from overshooting.
 */
import { type AirwindowsEffect, type AirwindowsInfo, type AirwindowsParam } from './types'

const fmt = (v: number) => v.toFixed(2)

const params: AirwindowsParam[] = [
  { name: 'Pressure', default: 0.0, display: fmt },
  { name: 'Speed', default: 0.2, display: fmt },
  { name: 'Mewiness', default: 1.0, display: (v) => fmt(v * 2 - 1) },
  { name: 'Output Gain', default: 1.0, display: fmt },
]

class Pressure4Effect implements AirwindowsEffect {
  private overallscale: number
  private A = params[0].default
  private B = params[1].default
  private C = params[2].default
  private D = params[3].default

  private muVary = 1
  private muAttack = 0
  private muNewSpeed = 0
  private muSpeedA = 10000
  private muSpeedB = 10000
  private muCoefficientA = 1
  private muCoefficientB = 1
  // The plugin never toggles `flip`, so only the "B" set is ever active; kept for fidelity.
  private flip = false

  constructor(sampleRate: number) {
    this.overallscale = sampleRate / 44100
  }

  setParams(values: readonly number[]): void {
    if (values[0] !== undefined) this.A = values[0]
    if (values[1] !== undefined) this.B = values[1]
    if (values[2] !== undefined) this.C = values[2]
    if (values[3] !== undefined) this.D = values[3]
  }

  reset(): void {
    this.muVary = 1
    this.muAttack = 0
    this.muNewSpeed = 0
    this.muSpeedA = 10000
    this.muSpeedB = 10000
    this.muCoefficientA = 1
    this.muCoefficientB = 1
    this.flip = false
  }

  process(left: Float32Array, right: Float32Array, n: number): void {
    const { A, B, C, D, overallscale } = this
    const threshold = 1.0 - A * 0.95
    const muMakeupGain = 1.0 / threshold
    let release = Math.pow(1.28 - B, 5) * 32768.0
    release /= overallscale
    const fastest = Math.sqrt(release)
    let mewiness = C * 2.0 - 1.0
    let unmewiness: number
    const outputGain = D
    let positivemu: boolean
    if (mewiness >= 0) {
      positivemu = true
      unmewiness = 1.0 - mewiness
    } else {
      positivemu = false
      mewiness = -mewiness
      unmewiness = 1.0 - mewiness
    }

    for (let i = 0; i < n; i++) {
      let inputSampleL = left[i]
      let inputSampleR = right[i]

      inputSampleL = inputSampleL * muMakeupGain
      inputSampleR = inputSampleR * muMakeupGain

      let inputSense = Math.abs(inputSampleL)
      if (Math.abs(inputSampleR) > inputSense) inputSense = Math.abs(inputSampleR)

      if (this.flip) {
        if (inputSense > threshold) {
          this.muVary = threshold / inputSense
          this.muAttack = Math.sqrt(Math.abs(this.muSpeedA))
          this.muCoefficientA = this.muCoefficientA * (this.muAttack - 1.0)
          if (this.muVary < threshold) this.muCoefficientA = this.muCoefficientA + threshold
          else this.muCoefficientA = this.muCoefficientA + this.muVary
          this.muCoefficientA = this.muCoefficientA / this.muAttack
        } else {
          this.muCoefficientA = this.muCoefficientA * (this.muSpeedA * this.muSpeedA - 1.0)
          this.muCoefficientA = this.muCoefficientA + 1.0
          this.muCoefficientA = this.muCoefficientA / (this.muSpeedA * this.muSpeedA)
        }
        this.muNewSpeed = this.muSpeedA * (this.muSpeedA - 1)
        this.muNewSpeed = this.muNewSpeed + Math.abs(inputSense * release) + fastest
        this.muSpeedA = this.muNewSpeed / this.muSpeedA
      } else {
        if (inputSense > threshold) {
          this.muVary = threshold / inputSense
          this.muAttack = Math.sqrt(Math.abs(this.muSpeedB))
          this.muCoefficientB = this.muCoefficientB * (this.muAttack - 1)
          if (this.muVary < threshold) this.muCoefficientB = this.muCoefficientB + threshold
          else this.muCoefficientB = this.muCoefficientB + this.muVary
          this.muCoefficientB = this.muCoefficientB / this.muAttack
        } else {
          this.muCoefficientB = this.muCoefficientB * (this.muSpeedB * this.muSpeedB - 1.0)
          this.muCoefficientB = this.muCoefficientB + 1.0
          this.muCoefficientB = this.muCoefficientB / (this.muSpeedB * this.muSpeedB)
        }
        this.muNewSpeed = this.muSpeedB * (this.muSpeedB - 1)
        this.muNewSpeed = this.muNewSpeed + Math.abs(inputSense * release) + fastest
        this.muSpeedB = this.muNewSpeed / this.muSpeedB
      }

      const mu = this.flip ? this.muCoefficientA : this.muCoefficientB
      let coefficient = positivemu ? Math.pow(mu, 2) : Math.sqrt(mu)
      coefficient = coefficient * mewiness + mu * unmewiness
      inputSampleL *= coefficient
      inputSampleR *= coefficient

      if (outputGain !== 1.0) {
        inputSampleL *= outputGain
        inputSampleR *= outputGain
      }

      let bridgerectifier = Math.abs(inputSampleL)
      if (bridgerectifier > 1.57079633) bridgerectifier = 1.0
      else bridgerectifier = Math.sin(bridgerectifier)
      inputSampleL = inputSampleL > 0 ? bridgerectifier : -bridgerectifier

      bridgerectifier = Math.abs(inputSampleR)
      if (bridgerectifier > 1.57079633) bridgerectifier = 1.0
      else bridgerectifier = Math.sin(bridgerectifier)
      inputSampleR = inputSampleR > 0 ? bridgerectifier : -bridgerectifier

      left[i] = inputSampleL
      right[i] = inputSampleR
    }
  }
}

export const Pressure4: AirwindowsInfo = {
  name: 'Pressure4',
  params,
  create: (sampleRate) => new Pressure4Effect(sampleRate),
}
