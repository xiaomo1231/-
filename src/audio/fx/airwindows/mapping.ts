/**
 * 新音色 (0.28.0): the desk's own knobs (threshold / ratio, drive, decay…)
 * mapped onto the Airwindows plugins' 0–1 parameters, so presets, the auto
 * mix and saved mixes keep working and 新 / 经典 can be compared on the same
 * settings. `trimDb` brings each effect back to about the level the 经典
 * version has on the same settings (measured on a vocal at −18 dBFS RMS,
 * rendered through both chains), so an A/B is not won by loudness. The
 * exception is saturation: it is kept about level-neutral here, where 经典's
 * waveshaper got up to 6 dB louder with drive.
 */
import type { MixSettings } from '@/songs/singTypes'
import type { AirwindowsName } from './registry'

export interface AwSetting {
  effect: AirwindowsName
  params: number[]
  /** Level after the plugin, dB. */
  trimDb: number
}

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v))
/** Piecewise-linear lookup in a sorted table of [x, y]. */
function lookup(table: ReadonlyArray<readonly [number, number]>, x: number): number {
  if (x <= table[0]![0]) return table[0]![1]
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i]!
    const [x0, y0] = table[i - 1]!
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
  }
  return table[table.length - 1]![1]
}

type Comp = MixSettings['vocal']['comp']

/** How hard a threshold / ratio pair leans on the voice (dB of nominal reduction at 0 dBFS). */
const pressureOf = (c: Comp) => -c.thresholdDb * (1 - 1 / c.ratio)

/**
 * Main compressor → Pressure4 (a vari-mu style compressor that really evens out
 * the level: the loudness spread of a vocal goes from 21 to about 16 dB at 0.6).
 * Release → Speed. Attack has no counterpart (the plugin is program-dependent).
 */
export function compSetting(c: Comp): AwSetting {
  const pressure = clamp(0.25 + pressureOf(c) / 40, 0, 0.8)
  const speed = clamp(0.55 - c.releaseMs / 400, 0.05, 0.6)
  // 经典 (Web Audio's compressor, which adds its own make-up) comes out at about the
  // make-up gain, a little less for heavy settings; Pressure4's own gain is taken out.
  const target = c.makeupDb - 0.17 * Math.max(0, pressureOf(c) - 13)
  const own = lookup(
    [
      [0, 0],
      [0.2, 0.4],
      [0.4, 1],
      [0.5, 1.6],
      [0.55, 1.4],
      [0.58, 1.1],
      [0.625, 0.7],
      [0.65, 0.4],
      [0.75, -1.4],
      [0.8, -3.7],
    ],
    pressure,
  )
  return { effect: 'Pressure4', params: [pressure, speed, 1, 1], trimDb: target - own }
}

/** Second compressor → ButterComp2 (smooth "glue", mostly tone and density). */
export function glueSetting(c: Comp): AwSetting {
  const compress = clamp(0.2 + pressureOf(c) / 15, 0, 1)
  const target = c.makeupDb + 0.25 * pressureOf(c)
  const own = lookup(
    [
      [0, 0],
      [0.38, 0.5],
      [0.53, 0.15],
      [0.6, -0.5],
      [0.8, -1.9],
      [1, -3.7],
    ],
    compress,
  )
  return { effect: 'ButterComp2', params: [compress, 0.5, 1], trimDb: target - own }
}

/** The squashed copy of parallel compression → ButterComp2 at full. */
export const PARALLEL_SETTING: AwSetting = { effect: 'ButterComp2', params: [1, 0.5, 1], trimDb: 7 }

/**
 * De-esser → DeBess (detects the spiky sibilance itself, so the threshold has no
 * counterpart). amountDb → Intensity and Depth (the most it may turn down);
 * higher frequency → less of the top counted as "highs".
 */
export function deEssSetting(d: MixSettings['vocal']['deEss']): AwSetting {
  const intense = clamp(0.35 + (0.5 * d.amountDb) / 12, 0, 0.95)
  const depth = clamp(10 ** (-d.amountDb / 20), 0.05, 1)
  const filter = clamp(0.7 - (0.4 * (d.freq - 3000)) / 9000, 0.2, 0.8)
  return { effect: 'DeBess', params: [intense, 0.5, depth, filter, 0], trimDb: 0 }
}

/**
 * Saturation: tape → ToTape6, tube → Tube2, hard → ADClip8. Drive 0–1 as on
 * the desk; the dry / wet blend stays the desk's own.
 */
export function saturationSetting(s: MixSettings['vocal']['saturation']): AwSetting {
  const d = clamp(s.drive)
  if (s.type === 'tape') {
    const input = 0.5 + 0.3 * d
    const inDb = (input - 0.5) * 24
    // The tape curve's own gain (≈ 3.8 dB + 0.72 dB per dB of input), taken back at its Output.
    const output = clamp(0.5 - (3.8 + 0.72 * inDb) / 24)
    return { effect: 'ToTape6', params: [input, 0.3, 0.4, 0.08 + 0.12 * d, output, 1], trimDb: 0 }
  }
  if (s.type === 'tube') {
    const tube = 0.15 + 0.7 * d
    const own = lookup(
      [
        [0, 0.3],
        [0.25, 0.5],
        [0.5, 0.8],
        [0.75, 1.5],
        [1, 3.2],
      ],
      tube,
    )
    return { effect: 'Tube2', params: [0.5, tube], trimDb: -own }
  }
  const boost = 0.4 * d
  return { effect: 'ADClip8', params: [boost, 0.883, 0], trimDb: -boost * 18 * 0.9 }
}

/** Level of the 经典 convolver for a decay (Web Audio normalises its impulse), dB. */
const classicWetDb = (decay: number) =>
  20 * Math.log10(0.00125 * Math.sqrt(44100 * Math.min(8, Math.max(0.2, decay))))

/**
 * Reverb (always 100 % wet here; the desk's send level, pre-delay and filters
 * stay its own): plate → kPlateD, room → Verbity2, hall → Galactic3. Decay is
 * matched to the measured RT60 of each plugin.
 */
export function reverbSetting(r: MixSettings['vocal']['reverb']): AwSetting {
  const decay = Math.max(0.2, r.decay)
  if (r.type === 'plate') {
    // kPlateD Damping → RT60 (s).
    const damping = lookup(
      [
        [1.24, 0],
        [1.33, 0.1],
        [1.44, 0.2],
        [1.57, 0.3],
        [1.71, 0.4],
        [1.87, 0.5],
        [2.07, 0.6],
        [2.32, 0.7],
        [2.66, 0.8],
        [3.1, 0.9],
        [3.72, 1],
      ],
      decay,
    )
    const lowCut = 0.6 + 0.4 * (1 - clamp(r.size))
    return {
      effect: 'kPlateD',
      params: [1, damping, lowCut, 0, 1],
      trimDb: classicWetDb(decay) - (3.8 + 1.9 * damping),
    }
  }
  if (r.type === 'room') {
    // Verbity2: room size from size, Sustain from decay (RT60 measured at sizes 0.15 / 0.35 / 0.55).
    const s = clamp(r.size)
    const rows: Array<ReadonlyArray<readonly [number, number]>> = [
      [
        [0.08, 0],
        [0.18, 0.1],
        [0.32, 0.2],
        [0.51, 0.3],
        [0.85, 0.4],
        [1.44, 0.5],
      ],
      [
        [0.13, 0],
        [0.32, 0.1],
        [0.56, 0.2],
        [0.92, 0.3],
        [1.51, 0.4],
        [2.59, 0.5],
      ],
      [
        [0.22, 0],
        [0.56, 0.1],
        [1.0, 0.2],
        [1.65, 0.3],
        [2.69, 0.4],
        [4.67, 0.5],
      ],
    ]
    const at = s * 2
    const i = Math.min(1, Math.floor(at))
    const f = at - i
    const sustain = lookup(rows[i]!, decay) * (1 - f) + lookup(rows[i + 1]!, decay) * f
    return {
      effect: 'Verbity2',
      params: [0.15 + 0.4 * s, sustain, 0.4, 1],
      trimDb: classicWetDb(decay) - (5.8 + 6 * sustain),
    }
  }
  // Galactic3: RT60 ≈ (7.2·Bigness + 0.38) × 1.08 at Replace 0.94; Detune grows with size.
  const bigness = clamp((decay / 1.083 - 0.38) / 7.2, 0.1, 1)
  const brightness = clamp(0.35 + r.highCut / 40000, 0.35, 0.7)
  return {
    effect: 'Galactic3',
    params: [0.94, brightness, 0.25 + 0.4 * clamp(r.size), 1, bigness, 1],
    trimDb: classicWetDb(decay) + 1.4,
  }
}
