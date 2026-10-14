/**
 * Port of Airwindows kPlateD by Chris Johnson (MIT License, https://github.com/airwindows/airwindows).
 * A large stereo plate reverb: a 5x5 Householder feedback network of 25 delays per side, early
 * reflection allpasses, predelay, a self-compressing input and output, and fixed ultrasonic/sub
 * band-pass filters inside the loop. Wetness 0.5 is full dry AND full wet.
 */
import type { AirwindowsEffect, AirwindowsInfo, AirwindowsParam } from './types'

const earlyA = 103
const earlyB = 709
const earlyC = 151
const earlyD = 263
const earlyE = 1433
const earlyF = 593
const earlyG = 1361
const earlyH = 31
const earlyI = 691
const predelay = 24010
const delayA = 619
const delayB = 181
const delayC = 101
const delayD = 677
const delayE = 401
const delayF = 151
const delayG = 409
const delayH = 31
const delayI = 641
const delayJ = 661
const delayK = 11
const delayL = 691
const delayM = 719
const delayN = 17
const delayO = 61
const delayP = 743
const delayQ = 89
const delayR = 659
const delayS = 5
const delayT = 547
const delayU = 769
const delayV = 421
const delayW = 47
const delayX = 521
const delayY = 163

const fix_freq = 0
const fix_reso = 1
const fix_a0 = 2
const fix_a1 = 3
const fix_a2 = 4
const fix_b1 = 5
const fix_b2 = 6
const fix_sL1 = 7
const fix_sL2 = 8
const fix_sR1 = 9
const fix_sR2 = 10
const fix_total = 11

const params: AirwindowsParam[] = [
  { name: 'InputPad', default: 1.0, display: (v) => v.toFixed(2) },
  { name: 'Damping', default: 0.5, display: (v) => (v * 10).toFixed(2) },
  { name: 'Low Cut', default: 1.0, display: (v) => (v * 3).toFixed(2) },
  { name: 'Predelay', default: 0.0, display: (v) => `${(Math.pow(v, 2) * 0.5).toFixed(3)} sec` },
  { name: 'Wetness', default: 0.25, display: (v) => v.toFixed(2) },
]

function build(sampleRate: number, init: readonly number[]): AirwindowsEffect {
  let [A, B, C, D, E] = init

  let iirAL = 0
  let iirBL = 0
  let iirAR = 0
  let iirBR = 0
  let gainIn = 1
  let gainOutL = 1
  let gainOutR = 1

  const eAL = new Float64Array(earlyA + 5)
  const eBL = new Float64Array(earlyB + 5)
  const eCL = new Float64Array(earlyC + 5)
  const eDL = new Float64Array(earlyD + 5)
  const eEL = new Float64Array(earlyE + 5)
  const eFL = new Float64Array(earlyF + 5)
  const eGL = new Float64Array(earlyG + 5)
  const eHL = new Float64Array(earlyH + 5)
  const eIL = new Float64Array(earlyI + 5)
  const eAR = new Float64Array(earlyA + 5)
  const eBR = new Float64Array(earlyB + 5)
  const eCR = new Float64Array(earlyC + 5)
  const eDR = new Float64Array(earlyD + 5)
  const eER = new Float64Array(earlyE + 5)
  const eFR = new Float64Array(earlyF + 5)
  const eGR = new Float64Array(earlyG + 5)
  const eHR = new Float64Array(earlyH + 5)
  const eIR = new Float64Array(earlyI + 5)
  const aAL = new Float64Array(delayA + 5)
  const aBL = new Float64Array(delayB + 5)
  const aCL = new Float64Array(delayC + 5)
  const aDL = new Float64Array(delayD + 5)
  const aEL = new Float64Array(delayE + 5)
  const aFL = new Float64Array(delayF + 5)
  const aGL = new Float64Array(delayG + 5)
  const aHL = new Float64Array(delayH + 5)
  const aIL = new Float64Array(delayI + 5)
  const aJL = new Float64Array(delayJ + 5)
  const aKL = new Float64Array(delayK + 5)
  const aLL = new Float64Array(delayL + 5)
  const aML = new Float64Array(delayM + 5)
  const aNL = new Float64Array(delayN + 5)
  const aOL = new Float64Array(delayO + 5)
  const aPL = new Float64Array(delayP + 5)
  const aQL = new Float64Array(delayQ + 5)
  const aRL = new Float64Array(delayR + 5)
  const aSL = new Float64Array(delayS + 5)
  const aTL = new Float64Array(delayT + 5)
  const aUL = new Float64Array(delayU + 5)
  const aVL = new Float64Array(delayV + 5)
  const aWL = new Float64Array(delayW + 5)
  const aXL = new Float64Array(delayX + 5)
  const aYL = new Float64Array(delayY + 5)
  const aAR = new Float64Array(delayA + 5)
  const aBR = new Float64Array(delayB + 5)
  const aCR = new Float64Array(delayC + 5)
  const aDR = new Float64Array(delayD + 5)
  const aER = new Float64Array(delayE + 5)
  const aFR = new Float64Array(delayF + 5)
  const aGR = new Float64Array(delayG + 5)
  const aHR = new Float64Array(delayH + 5)
  const aIR = new Float64Array(delayI + 5)
  const aJR = new Float64Array(delayJ + 5)
  const aKR = new Float64Array(delayK + 5)
  const aLR = new Float64Array(delayL + 5)
  const aMR = new Float64Array(delayM + 5)
  const aNR = new Float64Array(delayN + 5)
  const aOR = new Float64Array(delayO + 5)
  const aPR = new Float64Array(delayP + 5)
  const aQR = new Float64Array(delayQ + 5)
  const aRR = new Float64Array(delayR + 5)
  const aSR = new Float64Array(delayS + 5)
  const aTR = new Float64Array(delayT + 5)
  const aUR = new Float64Array(delayU + 5)
  const aVR = new Float64Array(delayV + 5)
  const aWR = new Float64Array(delayW + 5)
  const aXR = new Float64Array(delayX + 5)
  const aYR = new Float64Array(delayY + 5)
  const aZL = new Float64Array(predelay + 5)
  const aZR = new Float64Array(predelay + 5)

  let feedbackAL = 0
  let feedbackBL = 0
  let feedbackCL = 0
  let feedbackDL = 0
  let feedbackEL = 0
  let feedbackER = 0
  let feedbackJR = 0
  let feedbackOR = 0
  let feedbackTR = 0
  let feedbackYR = 0
  const lastRefL = new Float64Array(7)
  const lastRefR = new Float64Array(7)

  let earlyAL = 1
  let earlyAR = 1
  let earlyBL = 1
  let earlyBR = 1
  let earlyCL = 1
  let earlyCR = 1
  let earlyDL = 1
  let earlyDR = 1
  let earlyEL = 1
  let earlyER = 1
  let earlyFL = 1
  let earlyFR = 1
  let earlyGL = 1
  let earlyGR = 1
  let earlyHL = 1
  let earlyHR = 1
  let earlyIL = 1
  let earlyIR = 1
  let countAL = 1
  let countBL = 1
  let countCL = 1
  let countDL = 1
  let countEL = 1
  let countFL = 1
  let countGL = 1
  let countHL = 1
  let countIL = 1
  let countJL = 1
  let countKL = 1
  let countLL = 1
  let countML = 1
  let countNL = 1
  let countOL = 1
  let countPL = 1
  let countQL = 1
  let countRL = 1
  let countSL = 1
  let countTL = 1
  let countUL = 1
  let countVL = 1
  let countWL = 1
  let countXL = 1
  let countYL = 1
  let countAR = 1
  let countBR = 1
  let countCR = 1
  let countDR = 1
  let countER = 1
  let countFR = 1
  let countGR = 1
  let countHR = 1
  let countIR = 1
  let countJR = 1
  let countKR = 1
  let countLR = 1
  let countMR = 1
  let countNR = 1
  let countOR = 1
  let countPR = 1
  let countQR = 1
  let countRR = 1
  let countSR = 1
  let countTR = 1
  let countUR = 1
  let countVR = 1
  let countWR = 1
  let countXR = 1
  let countYR = 1
  let countZ = 1
  let cycle = 0

  const fixA = new Float64Array(fix_total)
  const fixB = new Float64Array(fix_total)
  const fixC = new Float64Array(fix_total)
  const fixD = new Float64Array(fix_total)

  let prevMulchBL = 0
  let prevMulchBR = 0
  let prevMulchCL = 0
  let prevMulchCR = 0
  let prevMulchDL = 0
  let prevMulchDR = 0
  let prevMulchEL = 0
  let prevMulchER = 0
  let prevOutDL = 0
  let prevOutDR = 0
  let prevOutEL = 0
  let prevOutER = 0
  let prevInDL = 0
  let prevInDR = 0
  let prevInEL = 0
  let prevInER = 0

  // Sample-rate dependent setup (the plugin recomputes this every block; it never changes).
  const overallscale = (1.0 / 44100.0) * sampleRate
  let cycleEnd = Math.floor(overallscale)
  if (cycleEnd < 1) cycleEnd = 1
  if (cycleEnd > 4) cycleEnd = 4
  const downRate = sampleRate / cycleEnd

  fixA[fix_freq] = 20.0 / downRate
  fixA[fix_reso] = 0.0018769
  fixD[fix_freq] = 14.0 / downRate
  fixD[fix_reso] = 0.0024964
  fixB[fix_freq] = (fixA[fix_freq] + fixA[fix_freq] + fixD[fix_freq]) / 3.0
  fixB[fix_reso] = 0.0020834
  fixC[fix_freq] = (fixA[fix_freq] + fixD[fix_freq] + fixD[fix_freq]) / 3.0
  fixC[fix_reso] = 0.0022899
  for (const f of [fixA, fixB, fixC, fixD]) {
    const K = Math.tan(Math.PI * f[fix_freq])
    const norm = 1.0 / (1.0 + K / f[fix_reso] + K * K)
    f[fix_a0] = (K / f[fix_reso]) * norm
    f[fix_a1] = 0.0
    f[fix_a2] = -f[fix_a0]
    f[fix_b1] = 2.0 * (K * K - 1.0) * norm
    f[fix_b2] = (1.0 - K / f[fix_reso] + K * K) * norm
  }

  // Parameter-dependent values.
  let inputPad = 1
  let regen = 0
  let iirAmount = 0
  let adjPredelay = 0
  let wet = 0
  let dry = 0
  const updateDerived = () => {
    inputPad = A
    regen = B * 0.425 + 0.16
    regen = regen * 0.0001 + 0.00024
    iirAmount = C * 0.3 + 0.04
    iirAmount = (iirAmount * 1000.0) / downRate
    const earlyVolume = Math.pow(D, 2) * 0.5 // predelay to a half-second
    adjPredelay = Math.trunc(downRate * earlyVolume)
    wet = E * 2.0
    dry = 2.0 - wet
    if (wet > 1.0) wet = 1.0
    if (wet < 0.0) wet = 0.0
    if (dry > 1.0) dry = 1.0
    if (dry < 0.0) dry = 0.0
  }
  updateDerived()

  return {
    setParams(values) {
      if (values[0] !== undefined) A = values[0]
      if (values[1] !== undefined) B = values[1]
      if (values[2] !== undefined) C = values[2]
      if (values[3] !== undefined) D = values[3]
      if (values[4] !== undefined) E = values[4]
      updateDerived()
    },
    process(left, right, n) {
      for (let i = 0; i < n; i++) {
        let inputSampleL = left[i]
        let inputSampleR = right[i]
        let drySampleL = inputSampleL
        let drySampleR = inputSampleR

        cycle++
        if (cycle == cycleEnd) {
          if (inputPad < 1.0) {
            inputSampleL *= inputPad
            inputSampleR *= inputPad
          }
          let outSample = 0
          outSample = (inputSampleL + prevInDL) * 0.5
          prevInDL = inputSampleL
          inputSampleL = outSample
          outSample = (inputSampleR + prevInDR) * 0.5
          prevInDR = inputSampleR
          inputSampleR = outSample
          if (inputSampleL > 1.57079633) inputSampleL = 1.57079633
          if (inputSampleL < -1.57079633) inputSampleL = -1.57079633
          if (inputSampleR > 1.57079633) inputSampleR = 1.57079633
          if (inputSampleR < -1.57079633) inputSampleR = -1.57079633
          inputSampleL = Math.sin(inputSampleL)
          inputSampleR = Math.sin(inputSampleR)
          iirAL = iirAL * (1.0 - iirAmount) + inputSampleL * iirAmount
          inputSampleL = inputSampleL - iirAL
          iirAR = iirAR * (1.0 - iirAmount) + inputSampleR * iirAmount
          inputSampleR = inputSampleR - iirAR
          inputSampleL *= 0.5
          inputSampleR *= 0.5
          if (gainIn < 0.0078125) gainIn = 0.0078125
          if (gainIn > 1.0) gainIn = 1.0
          inputSampleL *= gainIn
          inputSampleR *= gainIn
          gainIn +=
            Math.sin(Math.abs(inputSampleL * 4) > 1 ? 4 : Math.abs(inputSampleL * 4)) *
            Math.pow(inputSampleL, 4)
          gainIn +=
            Math.sin(Math.abs(inputSampleR * 4) > 1 ? 4 : Math.abs(inputSampleR * 4)) *
            Math.pow(inputSampleR, 4)
          iirBL = iirBL * (1.0 - iirAmount) + inputSampleL * iirAmount
          inputSampleL = inputSampleL - iirBL
          iirBR = iirBR * (1.0 - iirAmount) + inputSampleR * iirAmount
          inputSampleR = inputSampleR - iirBR
          outSample = (inputSampleL + prevInEL) * 0.5
          prevInEL = inputSampleL
          inputSampleL = outSample
          outSample = (inputSampleR + prevInER) * 0.5
          prevInER = inputSampleR
          inputSampleR = outSample
          let oeAL = inputSampleL - eAL[earlyAL + 1 - (earlyAL + 1 > earlyA ? earlyA + 1 : 0)] * 0.5
          let oeBL = inputSampleL - eBL[earlyBL + 1 - (earlyBL + 1 > earlyB ? earlyB + 1 : 0)] * 0.5
          let oeCL = inputSampleL - eCL[earlyCL + 1 - (earlyCL + 1 > earlyC ? earlyC + 1 : 0)] * 0.5
          let oeCR = inputSampleR - eCR[earlyCR + 1 - (earlyCR + 1 > earlyC ? earlyC + 1 : 0)] * 0.5
          let oeFR = inputSampleR - eFR[earlyFR + 1 - (earlyFR + 1 > earlyF ? earlyF + 1 : 0)] * 0.5
          let oeIR = inputSampleR - eIR[earlyIR + 1 - (earlyIR + 1 > earlyI ? earlyI + 1 : 0)] * 0.5
          eAL[earlyAL] = oeAL
          oeAL *= 0.5
          eBL[earlyBL] = oeBL
          oeBL *= 0.5
          eCL[earlyCL] = oeCL
          oeCL *= 0.5
          eCR[earlyCR] = oeCR
          oeCR *= 0.5
          eFR[earlyFR] = oeFR
          oeFR *= 0.5
          eIR[earlyIR] = oeIR
          oeIR *= 0.5
          earlyAL++
          if (earlyAL < 0 || earlyAL > earlyA) earlyAL = 0
          earlyBL++
          if (earlyBL < 0 || earlyBL > earlyB) earlyBL = 0
          earlyCL++
          if (earlyCL < 0 || earlyCL > earlyC) earlyCL = 0
          earlyCR++
          if (earlyCR < 0 || earlyCR > earlyC) earlyCR = 0
          earlyFR++
          if (earlyFR < 0 || earlyFR > earlyF) earlyFR = 0
          earlyIR++
          if (earlyIR < 0 || earlyIR > earlyI) earlyIR = 0
          oeAL += eAL[earlyAL - (earlyAL > earlyA ? earlyA + 1 : 0)]
          oeBL += eBL[earlyBL - (earlyBL > earlyB ? earlyB + 1 : 0)]
          oeCL += eCL[earlyCL - (earlyCL > earlyC ? earlyC + 1 : 0)]
          oeCR += eCR[earlyCR - (earlyCR > earlyC ? earlyC + 1 : 0)]
          oeFR += eFR[earlyFR - (earlyFR > earlyF ? earlyF + 1 : 0)]
          oeIR += eIR[earlyIR - (earlyIR > earlyI ? earlyI + 1 : 0)]
          let oeDL =
            oeBL + oeCL - oeAL - eDL[earlyDL + 1 - (earlyDL + 1 > earlyD ? earlyD + 1 : 0)] * 0.5
          let oeEL =
            oeAL + oeCL - oeBL - eEL[earlyEL + 1 - (earlyEL + 1 > earlyE ? earlyE + 1 : 0)] * 0.5
          let oeFL =
            oeAL + oeBL - oeCL - eFL[earlyFL + 1 - (earlyFL + 1 > earlyF ? earlyF + 1 : 0)] * 0.5
          let oeBR =
            oeFR + oeIR - oeCR - eBR[earlyBR + 1 - (earlyBR + 1 > earlyB ? earlyB + 1 : 0)] * 0.5
          let oeER =
            oeCR + oeIR - oeFR - eER[earlyER + 1 - (earlyER + 1 > earlyE ? earlyE + 1 : 0)] * 0.5
          let oeHR =
            oeCR + oeFR - oeIR - eHR[earlyHR + 1 - (earlyHR + 1 > earlyH ? earlyH + 1 : 0)] * 0.5
          eDL[earlyDL] = oeDL
          oeDL *= 0.5
          eEL[earlyEL] = oeEL
          oeEL *= 0.5
          eFL[earlyFL] = oeFL
          oeFL *= 0.5
          eBR[earlyBR] = oeBR
          oeBR *= 0.5
          eER[earlyER] = oeER
          oeER *= 0.5
          eHR[earlyHR] = oeHR
          oeHR *= 0.5
          earlyDL++
          if (earlyDL < 0 || earlyDL > earlyD) earlyDL = 0
          earlyEL++
          if (earlyEL < 0 || earlyEL > earlyE) earlyEL = 0
          earlyFL++
          if (earlyFL < 0 || earlyFL > earlyF) earlyFL = 0
          earlyBR++
          if (earlyBR < 0 || earlyBR > earlyB) earlyBR = 0
          earlyER++
          if (earlyER < 0 || earlyER > earlyE) earlyER = 0
          earlyHR++
          if (earlyHR < 0 || earlyHR > earlyH) earlyHR = 0
          oeDL += eDL[earlyDL - (earlyDL > earlyD ? earlyD + 1 : 0)]
          oeEL += eEL[earlyEL - (earlyEL > earlyE ? earlyE + 1 : 0)]
          oeFL += eFL[earlyFL - (earlyFL > earlyF ? earlyF + 1 : 0)]
          oeBR += eBR[earlyBR - (earlyBR > earlyB ? earlyB + 1 : 0)]
          oeER += eER[earlyER - (earlyER > earlyE ? earlyE + 1 : 0)]
          oeHR += eHR[earlyHR - (earlyHR > earlyH ? earlyH + 1 : 0)]
          let oeGL =
            oeEL + oeFL - oeDL - eGL[earlyGL + 1 - (earlyGL + 1 > earlyG ? earlyG + 1 : 0)] * 0.5
          let oeHL =
            oeDL + oeFL - oeEL - eHL[earlyHL + 1 - (earlyHL + 1 > earlyH ? earlyH + 1 : 0)] * 0.5
          let oeIL =
            oeDL + oeEL - oeFL - eIL[earlyIL + 1 - (earlyIL + 1 > earlyI ? earlyI + 1 : 0)] * 0.5
          let oeAR =
            oeER + oeHR - oeBR - eAR[earlyAR + 1 - (earlyAR + 1 > earlyA ? earlyA + 1 : 0)] * 0.5
          let oeDR =
            oeBR + oeHR - oeER - eDR[earlyDR + 1 - (earlyDR + 1 > earlyD ? earlyD + 1 : 0)] * 0.5
          let oeGR =
            oeBR + oeER - oeHR - eGR[earlyGR + 1 - (earlyGR + 1 > earlyG ? earlyG + 1 : 0)] * 0.5
          eGL[earlyGL] = oeGL
          oeGL *= 0.5
          eHL[earlyHL] = oeHL
          oeHL *= 0.5
          eIL[earlyIL] = oeIL
          oeIL *= 0.5
          eAR[earlyAR] = oeAR
          oeAR *= 0.5
          eDR[earlyDR] = oeDR
          oeDR *= 0.5
          eGR[earlyGR] = oeGR
          oeGR *= 0.5
          earlyGL++
          if (earlyGL < 0 || earlyGL > earlyG) earlyGL = 0
          earlyHL++
          if (earlyHL < 0 || earlyHL > earlyH) earlyHL = 0
          earlyIL++
          if (earlyIL < 0 || earlyIL > earlyI) earlyIL = 0
          earlyAR++
          if (earlyAR < 0 || earlyAR > earlyA) earlyAR = 0
          earlyDR++
          if (earlyDR < 0 || earlyDR > earlyD) earlyDR = 0
          earlyGR++
          if (earlyGR < 0 || earlyGR > earlyG) earlyGR = 0
          oeGL += eGL[earlyGL - (earlyGL > earlyG ? earlyG + 1 : 0)]
          oeHL += eHL[earlyHL - (earlyHL > earlyH ? earlyH + 1 : 0)]
          oeIL += eIL[earlyIL - (earlyIL > earlyI ? earlyI + 1 : 0)]
          oeAR += eAR[earlyAR - (earlyAR > earlyA ? earlyA + 1 : 0)]
          oeDR += eDR[earlyDR - (earlyDR > earlyD ? earlyD + 1 : 0)]
          oeGR += eGR[earlyGR - (earlyGR > earlyG ? earlyG + 1 : 0)]
          aZL[countZ] = (oeGL + oeHL + oeIL) * 0.25
          aZR[countZ] = (oeAR + oeDR + oeGR) * 0.25
          countZ++
          if (countZ < 0 || countZ > adjPredelay) countZ = 0
          inputSampleL = aZL[countZ - (countZ > adjPredelay ? adjPredelay + 1 : 0)]
          inputSampleR = aZR[countZ - (countZ > adjPredelay ? adjPredelay + 1 : 0)]
          aAL[countAL] = inputSampleL + feedbackAL * regen
          aBL[countBL] = inputSampleL + feedbackBL * regen
          aCL[countCL] = inputSampleL + feedbackCL * regen
          aDL[countDL] = inputSampleL + feedbackDL * regen
          aEL[countEL] = inputSampleL + feedbackEL * regen
          aER[countER] = inputSampleR + feedbackER * regen
          aJR[countJR] = inputSampleR + feedbackJR * regen
          aOR[countOR] = inputSampleR + feedbackOR * regen
          aTR[countTR] = inputSampleR + feedbackTR * regen
          aYR[countYR] = inputSampleR + feedbackYR * regen
          countAL++
          if (countAL < 0 || countAL > delayA) countAL = 0
          countBL++
          if (countBL < 0 || countBL > delayB) countBL = 0
          countCL++
          if (countCL < 0 || countCL > delayC) countCL = 0
          countDL++
          if (countDL < 0 || countDL > delayD) countDL = 0
          countEL++
          if (countEL < 0 || countEL > delayE) countEL = 0
          countER++
          if (countER < 0 || countER > delayE) countER = 0
          countJR++
          if (countJR < 0 || countJR > delayJ) countJR = 0
          countOR++
          if (countOR < 0 || countOR > delayO) countOR = 0
          countTR++
          if (countTR < 0 || countTR > delayT) countTR = 0
          countYR++
          if (countYR < 0 || countYR > delayY) countYR = 0
          let outAL = aAL[countAL - (countAL > delayA ? delayA + 1 : 0)]
          const outBL = aBL[countBL - (countBL > delayB ? delayB + 1 : 0)]
          const outCL = aCL[countCL - (countCL > delayC ? delayC + 1 : 0)]
          const outDL = aDL[countDL - (countDL > delayD ? delayD + 1 : 0)]
          const outEL = aEL[countEL - (countEL > delayE ? delayE + 1 : 0)]
          let outER = aER[countER - (countER > delayE ? delayE + 1 : 0)]
          const outJR = aJR[countJR - (countJR > delayJ ? delayJ + 1 : 0)]
          const outOR = aOR[countOR - (countOR > delayO ? delayO + 1 : 0)]
          const outTR = aTR[countTR - (countTR > delayT ? delayT + 1 : 0)]
          const outYR = aYR[countYR - (countYR > delayY ? delayY + 1 : 0)]
          outSample = outAL * fixA[fix_a0] + fixA[fix_sL1]
          fixA[fix_sL1] = outAL * fixA[fix_a1] - outSample * fixA[fix_b1] + fixA[fix_sL2]
          fixA[fix_sL2] = outAL * fixA[fix_a2] - outSample * fixA[fix_b2]
          outAL = outSample
          outSample = outER * fixA[fix_a0] + fixA[fix_sR1]
          fixA[fix_sR1] = outER * fixA[fix_a1] - outSample * fixA[fix_b1] + fixA[fix_sR2]
          fixA[fix_sR2] = outER * fixA[fix_a2] - outSample * fixA[fix_b2]
          outER = outSample
          aFL[countFL] = outAL * 3.0 - (outBL + outCL + outDL + outEL) * 2.0
          aGL[countGL] = outBL * 3.0 - (outAL + outCL + outDL + outEL) * 2.0
          aHL[countHL] = outCL * 3.0 - (outAL + outBL + outDL + outEL) * 2.0
          aIL[countIL] = outDL * 3.0 - (outAL + outBL + outCL + outEL) * 2.0
          aJL[countJL] = outEL * 3.0 - (outAL + outBL + outCL + outDL) * 2.0
          aDR[countDR] = outER * 3.0 - (outJR + outOR + outTR + outYR) * 2.0
          aIR[countIR] = outJR * 3.0 - (outER + outOR + outTR + outYR) * 2.0
          aNR[countNR] = outOR * 3.0 - (outER + outJR + outTR + outYR) * 2.0
          aSR[countSR] = outTR * 3.0 - (outER + outJR + outOR + outYR) * 2.0
          aXR[countXR] = outYR * 3.0 - (outER + outJR + outOR + outTR) * 2.0
          countFL++
          if (countFL < 0 || countFL > delayF) countFL = 0
          countGL++
          if (countGL < 0 || countGL > delayG) countGL = 0
          countHL++
          if (countHL < 0 || countHL > delayH) countHL = 0
          countIL++
          if (countIL < 0 || countIL > delayI) countIL = 0
          countJL++
          if (countJL < 0 || countJL > delayJ) countJL = 0
          countDR++
          if (countDR < 0 || countDR > delayD) countDR = 0
          countIR++
          if (countIR < 0 || countIR > delayI) countIR = 0
          countNR++
          if (countNR < 0 || countNR > delayN) countNR = 0
          countSR++
          if (countSR < 0 || countSR > delayS) countSR = 0
          countXR++
          if (countXR < 0 || countXR > delayX) countXR = 0
          let outFL = aFL[countFL - (countFL > delayF ? delayF + 1 : 0)]
          let outGL = aGL[countGL - (countGL > delayG ? delayG + 1 : 0)]
          const outHL = aHL[countHL - (countHL > delayH ? delayH + 1 : 0)]
          const outIL = aIL[countIL - (countIL > delayI ? delayI + 1 : 0)]
          const outJL = aJL[countJL - (countJL > delayJ ? delayJ + 1 : 0)]
          let outDR = aDR[countDR - (countDR > delayD ? delayD + 1 : 0)]
          let outIR = aIR[countIR - (countIR > delayI ? delayI + 1 : 0)]
          const outNR = aNR[countNR - (countNR > delayN ? delayN + 1 : 0)]
          const outSR = aSR[countSR - (countSR > delayS ? delayS + 1 : 0)]
          const outXR = aXR[countXR - (countXR > delayX ? delayX + 1 : 0)]
          outSample = outFL * fixB[fix_a0] + fixB[fix_sL1]
          fixB[fix_sL1] = outFL * fixB[fix_a1] - outSample * fixB[fix_b1] + fixB[fix_sL2]
          fixB[fix_sL2] = outFL * fixB[fix_a2] - outSample * fixB[fix_b2]
          outFL = outSample
          outSample = outDR * fixB[fix_a0] + fixB[fix_sR1]
          fixB[fix_sR1] = outDR * fixB[fix_a1] - outSample * fixB[fix_b1] + fixB[fix_sR2]
          fixB[fix_sR2] = outDR * fixB[fix_a2] - outSample * fixB[fix_b2]
          outDR = outSample
          outSample = (outGL + prevMulchBL) * 0.5
          prevMulchBL = outGL
          outGL = outSample
          outSample = (outIR + prevMulchBR) * 0.5
          prevMulchBR = outIR
          outIR = outSample
          aKL[countKL] = outFL * 3.0 - (outGL + outHL + outIL + outJL) * 2.0
          aLL[countLL] = outGL * 3.0 - (outFL + outHL + outIL + outJL) * 2.0
          aML[countML] = outHL * 3.0 - (outFL + outGL + outIL + outJL) * 2.0
          aNL[countNL] = outIL * 3.0 - (outFL + outGL + outHL + outJL) * 2.0
          aOL[countOL] = outJL * 3.0 - (outFL + outGL + outHL + outIL) * 2.0
          aCR[countCR] = outDR * 3.0 - (outIR + outNR + outSR + outXR) * 2.0
          aHR[countHR] = outIR * 3.0 - (outDR + outNR + outSR + outXR) * 2.0
          aMR[countMR] = outNR * 3.0 - (outDR + outIR + outSR + outXR) * 2.0
          aRR[countRR] = outSR * 3.0 - (outDR + outIR + outNR + outXR) * 2.0
          aWR[countWR] = outXR * 3.0 - (outDR + outIR + outNR + outSR) * 2.0
          countKL++
          if (countKL < 0 || countKL > delayK) countKL = 0
          countLL++
          if (countLL < 0 || countLL > delayL) countLL = 0
          countML++
          if (countML < 0 || countML > delayM) countML = 0
          countNL++
          if (countNL < 0 || countNL > delayN) countNL = 0
          countOL++
          if (countOL < 0 || countOL > delayO) countOL = 0
          countCR++
          if (countCR < 0 || countCR > delayC) countCR = 0
          countHR++
          if (countHR < 0 || countHR > delayH) countHR = 0
          countMR++
          if (countMR < 0 || countMR > delayM) countMR = 0
          countRR++
          if (countRR < 0 || countRR > delayR) countRR = 0
          countWR++
          if (countWR < 0 || countWR > delayW) countWR = 0
          let outKL = aKL[countKL - (countKL > delayK ? delayK + 1 : 0)]
          let outLL = aLL[countLL - (countLL > delayL ? delayL + 1 : 0)]
          const outML = aML[countML - (countML > delayM ? delayM + 1 : 0)]
          const outNL = aNL[countNL - (countNL > delayN ? delayN + 1 : 0)]
          const outOL = aOL[countOL - (countOL > delayO ? delayO + 1 : 0)]
          let outCR = aCR[countCR - (countCR > delayC ? delayC + 1 : 0)]
          let outHR = aHR[countHR - (countHR > delayH ? delayH + 1 : 0)]
          const outMR = aMR[countMR - (countMR > delayM ? delayM + 1 : 0)]
          const outRR = aRR[countRR - (countRR > delayR ? delayR + 1 : 0)]
          const outWR = aWR[countWR - (countWR > delayW ? delayW + 1 : 0)]
          outSample = outKL * fixC[fix_a0] + fixC[fix_sL1]
          fixC[fix_sL1] = outKL * fixC[fix_a1] - outSample * fixC[fix_b1] + fixC[fix_sL2]
          fixC[fix_sL2] = outKL * fixC[fix_a2] - outSample * fixC[fix_b2]
          outKL = outSample
          outSample = outCR * fixC[fix_a0] + fixC[fix_sR1]
          fixC[fix_sR1] = outCR * fixC[fix_a1] - outSample * fixC[fix_b1] + fixC[fix_sR2]
          fixC[fix_sR2] = outCR * fixC[fix_a2] - outSample * fixC[fix_b2]
          outCR = outSample
          outSample = (outLL + prevMulchCL) * 0.5
          prevMulchCL = outLL
          outLL = outSample
          outSample = (outHR + prevMulchCR) * 0.5
          prevMulchCR = outHR
          outHR = outSample
          aPL[countPL] = outKL * 3.0 - (outLL + outML + outNL + outOL) * 2.0
          aQL[countQL] = outLL * 3.0 - (outKL + outML + outNL + outOL) * 2.0
          aRL[countRL] = outML * 3.0 - (outKL + outLL + outNL + outOL) * 2.0
          aSL[countSL] = outNL * 3.0 - (outKL + outLL + outML + outOL) * 2.0
          aTL[countTL] = outOL * 3.0 - (outKL + outLL + outML + outNL) * 2.0
          aBR[countBR] = outCR * 3.0 - (outHR + outMR + outRR + outWR) * 2.0
          aGR[countGR] = outHR * 3.0 - (outCR + outMR + outRR + outWR) * 2.0
          aLR[countLR] = outMR * 3.0 - (outCR + outHR + outRR + outWR) * 2.0
          aQR[countQR] = outRR * 3.0 - (outCR + outHR + outMR + outWR) * 2.0
          aVR[countVR] = outWR * 3.0 - (outCR + outHR + outMR + outRR) * 2.0
          countPL++
          if (countPL < 0 || countPL > delayP) countPL = 0
          countQL++
          if (countQL < 0 || countQL > delayQ) countQL = 0
          countRL++
          if (countRL < 0 || countRL > delayR) countRL = 0
          countSL++
          if (countSL < 0 || countSL > delayS) countSL = 0
          countTL++
          if (countTL < 0 || countTL > delayT) countTL = 0
          countBR++
          if (countBR < 0 || countBR > delayB) countBR = 0
          countGR++
          if (countGR < 0 || countGR > delayG) countGR = 0
          countLR++
          if (countLR < 0 || countLR > delayL) countLR = 0
          countQR++
          if (countQR < 0 || countQR > delayQ) countQR = 0
          countVR++
          if (countVR < 0 || countVR > delayV) countVR = 0
          let outPL = aPL[countPL - (countPL > delayP ? delayP + 1 : 0)]
          let outQL = aQL[countQL - (countQL > delayQ ? delayQ + 1 : 0)]
          const outRL = aRL[countRL - (countRL > delayR ? delayR + 1 : 0)]
          const outSL = aSL[countSL - (countSL > delayS ? delayS + 1 : 0)]
          const outTL = aTL[countTL - (countTL > delayT ? delayT + 1 : 0)]
          let outBR = aBR[countBR - (countBR > delayB ? delayB + 1 : 0)]
          let outGR = aGR[countGR - (countGR > delayG ? delayG + 1 : 0)]
          const outLR = aLR[countLR - (countLR > delayL ? delayL + 1 : 0)]
          const outQR = aQR[countQR - (countQR > delayQ ? delayQ + 1 : 0)]
          const outVR = aVR[countVR - (countVR > delayV ? delayV + 1 : 0)]
          outSample = outPL * fixD[fix_a0] + fixD[fix_sL1]
          fixD[fix_sL1] = outPL * fixD[fix_a1] - outSample * fixD[fix_b1] + fixD[fix_sL2]
          fixD[fix_sL2] = outPL * fixD[fix_a2] - outSample * fixD[fix_b2]
          outPL = outSample
          outSample = outBR * fixD[fix_a0] + fixD[fix_sR1]
          fixD[fix_sR1] = outBR * fixD[fix_a1] - outSample * fixD[fix_b1] + fixD[fix_sR2]
          fixD[fix_sR2] = outBR * fixD[fix_a2] - outSample * fixD[fix_b2]
          outBR = outSample
          outSample = (outQL + prevMulchDL) * 0.5
          prevMulchDL = outQL
          outQL = outSample
          outSample = (outGR + prevMulchDR) * 0.5
          prevMulchDR = outGR
          outGR = outSample
          aUL[countUL] = outPL * 3.0 - (outQL + outRL + outSL + outTL) * 2.0
          aVL[countVL] = outQL * 3.0 - (outPL + outRL + outSL + outTL) * 2.0
          aWL[countWL] = outRL * 3.0 - (outPL + outQL + outSL + outTL) * 2.0
          aXL[countXL] = outSL * 3.0 - (outPL + outQL + outRL + outTL) * 2.0
          aYL[countYL] = outTL * 3.0 - (outPL + outQL + outRL + outSL) * 2.0
          aAR[countAR] = outBR * 3.0 - (outGR + outLR + outQR + outVR) * 2.0
          aFR[countFR] = outGR * 3.0 - (outBR + outLR + outQR + outVR) * 2.0
          aKR[countKR] = outLR * 3.0 - (outBR + outGR + outQR + outVR) * 2.0
          aPR[countPR] = outQR * 3.0 - (outBR + outGR + outLR + outVR) * 2.0
          aUR[countUR] = outVR * 3.0 - (outBR + outGR + outLR + outQR) * 2.0
          countUL++
          if (countUL < 0 || countUL > delayU) countUL = 0
          countVL++
          if (countVL < 0 || countVL > delayV) countVL = 0
          countWL++
          if (countWL < 0 || countWL > delayW) countWL = 0
          countXL++
          if (countXL < 0 || countXL > delayX) countXL = 0
          countYL++
          if (countYL < 0 || countYL > delayY) countYL = 0
          countAR++
          if (countAR < 0 || countAR > delayA) countAR = 0
          countFR++
          if (countFR < 0 || countFR > delayF) countFR = 0
          countKR++
          if (countKR < 0 || countKR > delayK) countKR = 0
          countPR++
          if (countPR < 0 || countPR > delayP) countPR = 0
          countUR++
          if (countUR < 0 || countUR > delayU) countUR = 0
          const outUL = aUL[countUL - (countUL > delayU ? delayU + 1 : 0)]
          let outVL = aVL[countVL - (countVL > delayV ? delayV + 1 : 0)]
          const outWL = aWL[countWL - (countWL > delayW ? delayW + 1 : 0)]
          const outXL = aXL[countXL - (countXL > delayX ? delayX + 1 : 0)]
          const outYL = aYL[countYL - (countYL > delayY ? delayY + 1 : 0)]
          const outAR = aAR[countAR - (countAR > delayA ? delayA + 1 : 0)]
          let outFR = aFR[countFR - (countFR > delayF ? delayF + 1 : 0)]
          const outKR = aKR[countKR - (countKR > delayK ? delayK + 1 : 0)]
          const outPR = aPR[countPR - (countPR > delayP ? delayP + 1 : 0)]
          const outUR = aUR[countUR - (countUR > delayU ? delayU + 1 : 0)]
          outSample = (outVL + prevMulchEL) * 0.5
          prevMulchEL = outVL
          outVL = outSample
          outSample = (outFR + prevMulchER) * 0.5
          prevMulchER = outFR
          outFR = outSample
          feedbackER = outUL * 3.0 - (outVL + outWL + outXL + outYL) * 2.0
          feedbackAL = outAR * 3.0 - (outFR + outKR + outPR + outUR) * 2.0
          feedbackJR = outVL * 3.0 - (outUL + outWL + outXL + outYL) * 2.0
          feedbackBL = outFR * 3.0 - (outAR + outKR + outPR + outUR) * 2.0
          feedbackOR = outWL * 3.0 - (outUL + outVL + outXL + outYL) * 2.0
          feedbackCL = outKR * 3.0 - (outAR + outFR + outPR + outUR) * 2.0
          feedbackTR = outXL * 3.0 - (outUL + outVL + outWL + outYL) * 2.0
          feedbackDL = outPR * 3.0 - (outAR + outFR + outKR + outUR) * 2.0
          feedbackYR = outYL * 3.0 - (outUL + outVL + outWL + outXL) * 2.0
          feedbackEL = outUR * 3.0 - (outAR + outFR + outKR + outPR) * 2.0
          inputSampleL = (outUL + outVL + outWL + outXL + outYL) * 0.0016
          inputSampleR = (outAR + outFR + outKR + outPR + outUR) * 0.0016
          inputSampleL *= 0.5
          inputSampleR *= 0.5
          if (gainOutL < 0.0078125) gainOutL = 0.0078125
          if (gainOutL > 1.0) gainOutL = 1.0
          if (gainOutR < 0.0078125) gainOutR = 0.0078125
          if (gainOutR > 1.0) gainOutR = 1.0
          inputSampleL *= gainOutL
          inputSampleR *= gainOutR
          gainOutL +=
            Math.sin(Math.abs(inputSampleL * 4) > 1 ? 4 : Math.abs(inputSampleL * 4)) *
            Math.pow(inputSampleL, 4)
          gainOutR +=
            Math.sin(Math.abs(inputSampleR * 4) > 1 ? 4 : Math.abs(inputSampleR * 4)) *
            Math.pow(inputSampleR, 4)
          inputSampleL *= 2.0
          inputSampleR *= 2.0
          outSample = (inputSampleL + prevOutDL) * 0.5
          prevOutDL = inputSampleL
          inputSampleL = outSample
          outSample = (inputSampleR + prevOutDR) * 0.5
          prevOutDR = inputSampleR
          inputSampleR = outSample
          outSample = (inputSampleL + prevOutEL) * 0.5
          prevOutEL = inputSampleL
          inputSampleL = outSample
          outSample = (inputSampleR + prevOutER) * 0.5
          prevOutER = inputSampleR
          inputSampleR = outSample
          if (cycleEnd == 4) {
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
          if (cycleEnd == 3) {
            lastRefL[0] = lastRefL[3]
            lastRefL[2] = (lastRefL[0] + lastRefL[0] + inputSampleL) / 3
            lastRefL[1] = (lastRefL[0] + inputSampleL + inputSampleL) / 3
            lastRefL[3] = inputSampleL
            lastRefR[0] = lastRefR[3]
            lastRefR[2] = (lastRefR[0] + lastRefR[0] + inputSampleR) / 3
            lastRefR[1] = (lastRefR[0] + inputSampleR + inputSampleR) / 3
            lastRefR[3] = inputSampleR
          }
          if (cycleEnd == 2) {
            lastRefL[0] = lastRefL[2]
            lastRefL[1] = (lastRefL[0] + inputSampleL) / 2
            lastRefL[2] = inputSampleL
            lastRefR[0] = lastRefR[2]
            lastRefR[1] = (lastRefR[0] + inputSampleR) / 2
            lastRefR[2] = inputSampleR
          }
          if (cycleEnd == 1) {
            lastRefL[0] = inputSampleL
            lastRefR[0] = inputSampleR
          }
          cycle = 0
          inputSampleL = lastRefL[cycle]
          inputSampleR = lastRefR[cycle]
        } else {
          inputSampleL = lastRefL[cycle]
          inputSampleR = lastRefR[cycle]
        }
        if (inputSampleL > 1.0) inputSampleL = 1.0
        if (inputSampleL < -1.0) inputSampleL = -1.0
        if (inputSampleR > 1.0) inputSampleR = 1.0
        if (inputSampleR < -1.0) inputSampleR = -1.0
        inputSampleL = Math.asin(inputSampleL)
        inputSampleR = Math.asin(inputSampleR)
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

        left[i] = inputSampleL
        right[i] = inputSampleR
      }
    },
    reset() {
      // handled by the wrapper (rebuilds all state)
    },
  }
}

function create(sampleRate: number): AirwindowsEffect {
  const current = params.map((p) => p.default)
  let inst = build(sampleRate, current)
  return {
    setParams(values) {
      for (let i = 0; i < current.length; i++) if (values[i] !== undefined) current[i] = values[i]
      inst.setParams(current)
    },
    process(left, right, n) {
      inst.process(left, right, n)
    },
    reset() {
      inst = build(sampleRate, current)
    },
  }
}

export const kPlateD: AirwindowsInfo = { name: 'kPlateD', params, create }
