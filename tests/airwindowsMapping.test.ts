import { describe, expect, it } from 'vitest'
import type { AwSetting } from '@/audio/fx/airwindows/mapping'
import {
  PARALLEL_SETTING,
  compSetting,
  deEssSetting,
  glueSetting,
  reverbSetting,
  saturationSetting,
} from '@/audio/fx/airwindows/mapping'
import { AIRWINDOWS, type AirwindowsName } from '@/audio/fx/airwindows/registry'
import { MIX_PRESETS, clampMix, cloneMix } from '@/songs/mixPresets'
import type { MixSettings } from '@/songs/singTypes'

const presetIds = Object.keys(MIX_PRESETS) as Array<keyof typeof MIX_PRESETS>

/** Checks the shared contract of every mapping result. */
function expectValidSetting(s: AwSetting) {
  expect(AIRWINDOWS).toHaveProperty(s.effect)
  const info = AIRWINDOWS[s.effect as AirwindowsName]
  expect(s.params.length).toBe(info.params.length)
  for (const p of s.params) {
    expect(Number.isFinite(p)).toBe(true)
    expect(p).toBeGreaterThanOrEqual(0)
    expect(p).toBeLessThanOrEqual(1)
  }
  expect(Number.isFinite(s.trimDb)).toBe(true)
}

describe('airwindows mapping: parameter ranges', () => {
  it('every preset and mapping yields finite, in-range params of the right length', () => {
    for (const id of presetIds) {
      const vocal = MIX_PRESETS[id].settings.vocal
      expectValidSetting(compSetting(vocal.comp))
      expectValidSetting(glueSetting(vocal.comp2))
      expectValidSetting(deEssSetting(vocal.deEss))
      for (const type of ['tape', 'tube', 'hard'] as const) {
        for (const drive of [0, 0.5, 1]) {
          expectValidSetting(saturationSetting({ ...vocal.saturation, type, drive }))
        }
      }
      for (const type of ['plate', 'room', 'hall'] as const) {
        expectValidSetting(reverbSetting({ ...vocal.reverb, type }))
      }
      expectValidSetting(PARALLEL_SETTING)
    }
  })
})

describe('airwindows mapping: reverb', () => {
  it('picks the plugin for each reverb type', () => {
    const reverb = MIX_PRESETS.pop.settings.vocal.reverb
    expect(reverbSetting({ ...reverb, type: 'plate' }).effect).toBe('kPlateD')
    expect(reverbSetting({ ...reverb, type: 'room' }).effect).toBe('Verbity2')
    expect(reverbSetting({ ...reverb, type: 'hall' }).effect).toBe('Galactic3')
  })

  it('a longer decay gives a larger decay parameter', () => {
    const reverb = MIX_PRESETS.pop.settings.vocal.reverb
    const short = { ...reverb, decay: 1.2 }
    const long = { ...reverb, decay: 3.0 }

    const plateShort = reverbSetting({ ...short, type: 'plate' })
    const plateLong = reverbSetting({ ...long, type: 'plate' })
    expect(plateShort.params[1]).toBeLessThan(plateLong.params[1]!)

    const roomShort = reverbSetting({ ...short, type: 'room', size: 0.5 })
    const roomLong = reverbSetting({ ...long, type: 'room', size: 0.5 })
    expect(roomShort.params[1]).toBeLessThan(roomLong.params[1]!)

    const hallShort = reverbSetting({ ...short, type: 'hall' })
    const hallLong = reverbSetting({ ...long, type: 'hall' })
    expect(hallShort.params[4]).toBeLessThan(hallLong.params[4]!)
  })
})

describe('airwindows mapping: compression', () => {
  it('stronger compression gives a larger compressor amount', () => {
    const base = MIX_PRESETS.pop.settings.vocal.comp
    const mild = compSetting({ ...base, thresholdDb: -10, ratio: 2 })
    const strong = compSetting({ ...base, thresholdDb: -30, ratio: 6 })
    expect(mild.params[0]).toBeLessThan(strong.params[0]!)
  })

  it('stronger compression gives a larger glue amount', () => {
    const base = MIX_PRESETS.pop.settings.vocal.comp2
    const mild = glueSetting({ ...base, thresholdDb: -10, ratio: 2 })
    const strong = glueSetting({ ...base, thresholdDb: -30, ratio: 6 })
    expect(mild.params[0]).toBeLessThan(strong.params[0]!)
  })
})

describe('airwindows mapping: de-esser', () => {
  it('larger amountDb gives more intensity and less depth', () => {
    const base = MIX_PRESETS.pop.settings.vocal.deEss
    const small = deEssSetting({ ...base, amountDb: 2 })
    const large = deEssSetting({ ...base, amountDb: 8 })
    expect(small.params[0]).toBeLessThan(large.params[0]!)
    expect(small.params[2]).toBeGreaterThan(large.params[2]!)
  })
})

describe('airwindows mapping: engine flag', () => {
  it('clampMix defaults a missing engine to classic', () => {
    const m = cloneMix(MIX_PRESETS.pop.settings) as Partial<MixSettings>
    delete m.engine
    expect(clampMix(m as MixSettings).engine).toBe('classic')
  })

  it('clampMix keeps an explicit classic engine', () => {
    const m = cloneMix(MIX_PRESETS.pop.settings)
    m.engine = 'classic'
    expect(clampMix(m).engine).toBe('classic')
  })

  it('every preset uses the airwindows engine', () => {
    for (const id of presetIds) {
      expect(MIX_PRESETS[id].settings.engine).toBe('airwindows')
    }
  })
})
