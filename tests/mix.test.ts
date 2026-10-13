import { describe, expect, it } from 'vitest'
import { GUIDE_STEPS, MIX_LESSONS, makeEarQuiz } from '@/songs/mixLessons'
import {
  DEFAULT_MIX,
  MIX_PRESETS,
  biquadMagnitudeDb,
  clampMix,
  delayMs,
  dbToGain,
  eqCurve,
  gainToDb,
  highpassMagnitudeDb,
  logFreqs,
} from '@/songs/mixPresets'

describe('mix presets', () => {
  it('DEFAULT_MIX equals the pop preset', () => {
    expect(DEFAULT_MIX).toEqual(MIX_PRESETS.pop.settings)
  })

  it('every preset passes clampMix unchanged', () => {
    for (const preset of Object.values(MIX_PRESETS)) {
      expect(clampMix(preset.settings)).toEqual(preset.settings)
    }
  })

  it('clampMix limits out-of-range values without mutating input', () => {
    const wild = clampMix(DEFAULT_MIX)
    wild.vocal.pan = 5
    wild.vocal.comp.ratio = 100
    const input = structuredClone(DEFAULT_MIX)
    input.vocal.pan = 5
    input.vocal.comp.ratio = 100
    const out = clampMix(input)
    expect(out.vocal.pan).toBe(1)
    expect(out.vocal.comp.ratio).toBe(20)
    expect(input.vocal.pan).toBe(5)
  })

  it('raw preset has every vocal module off', () => {
    const v = MIX_PRESETS.raw.settings.vocal
    expect(v.lowCut.on).toBe(false)
    expect(v.eq.on).toBe(false)
    expect(v.comp.on).toBe(false)
    expect(v.deEss.on).toBe(false)
    expect(v.reverb.on).toBe(false)
    expect(v.delay.on).toBe(false)
  })

  it('presets have one-sentence Chinese descriptions and labels', () => {
    for (const preset of Object.values(MIX_PRESETS)) {
      expect(preset.label.length).toBeGreaterThan(0)
      expect(preset.description).toMatch(/[。]$/)
    }
  })
})

describe('delayMs and gain conversion', () => {
  it('computes note values from BPM', () => {
    expect(delayMs(120, '1/4')).toBe(500)
    expect(delayMs(120, '1/8')).toBe(250)
    expect(delayMs(120, '1/8.')).toBe(375)
    expect(delayMs(120, '1/16')).toBe(125)
  })

  it('round-trips dB and gain', () => {
    expect(dbToGain(0)).toBe(1)
    expect(gainToDb(dbToGain(-6))).toBeCloseTo(-6, 9)
  })
})

describe('biquad responses (Web Audio definitions)', () => {
  it('peaking gain at its own frequency equals the band gain', () => {
    const band = { type: 'peaking' as const, freq: 1000, gainDb: 6, q: 1 }
    expect(Math.abs(biquadMagnitudeDb(band, 1000) - 6)).toBeLessThanOrEqual(0.1)
  })

  it('peaking is near 0 dB far away from its frequency', () => {
    const band = { type: 'peaking' as const, freq: 1000, gainDb: 6, q: 1 }
    expect(Math.abs(biquadMagnitudeDb(band, 20))).toBeLessThan(0.5)
    expect(Math.abs(biquadMagnitudeDb(band, 20000))).toBeLessThan(0.5)
  })

  it('lowshelf: full gain at 20 Hz, about 0 dB at 20 kHz', () => {
    const band = { type: 'lowshelf' as const, freq: 120, gainDb: 6, q: 0.7 }
    expect(Math.abs(biquadMagnitudeDb(band, 20) - 6)).toBeLessThan(0.5)
    expect(Math.abs(biquadMagnitudeDb(band, 20000))).toBeLessThan(0.1)
  })

  it('highshelf: about 0 dB at 20 Hz, full gain at 20 kHz', () => {
    const band = { type: 'highshelf' as const, freq: 10000, gainDb: 6, q: 0.7 }
    expect(Math.abs(biquadMagnitudeDb(band, 20))).toBeLessThan(0.1)
    expect(Math.abs(biquadMagnitudeDb(band, 20000) - 6)).toBeLessThan(0.5)
  })

  it('highpass is -3 dB at cutoff, -12 dB one octave below, ~0 dB well above', () => {
    expect(Math.abs(highpassMagnitudeDb(100, 100) + 3)).toBeLessThanOrEqual(0.1)
    expect(Math.abs(highpassMagnitudeDb(50, 100) + 12)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(highpassMagnitudeDb(10000, 100))).toBeLessThan(0.1)
  })

  it('eqCurve sums low cut and all bands when on', () => {
    const vocal = structuredClone(DEFAULT_MIX.vocal)
    const freqs = [200, 1000, 5000]
    const curve = eqCurve(vocal, freqs)
    freqs.forEach((f, i) => {
      let sum = highpassMagnitudeDb(f, vocal.lowCut.freq)
      for (const band of vocal.eq.bands) sum += biquadMagnitudeDb(band, f)
      expect(curve[i]).toBeCloseTo(sum, 9)
    })
  })

  it('eqCurve ignores disabled modules', () => {
    const vocal = structuredClone(MIX_PRESETS.raw.settings.vocal)
    expect(eqCurve(vocal, [100, 1000])).toEqual([0, 0])
  })

  it('logFreqs spans 20 Hz to 20 kHz, log-spaced and increasing', () => {
    const f = logFreqs()
    expect(f).toHaveLength(128)
    expect(f[0]).toBe(20)
    expect(f[127]).toBe(20000)
    for (let i = 1; i < f.length; i++) expect(f[i]).toBeGreaterThan(f[i - 1])
    // log spacing: constant ratio between neighbours
    expect(f[2] / f[1]).toBeCloseTo(f[1] / f[0], 9)
  })
})

describe('lessons and ear training', () => {
  it('covers all seven lesson ids and the five-step guide order', () => {
    expect(MIX_LESSONS.map((l) => l.id).sort()).toEqual(['balance', 'comp', 'deess', 'delay', 'eq', 'lowcut', 'reverb'])
    expect(GUIDE_STEPS.map((s) => s.id)).toEqual(['lowcut', 'eq', 'comp', 'reverb', 'balance'])
  })

  it('makeEarQuiz is deterministic per seed', () => {
    expect(makeEarQuiz('lowcut', 42)).toEqual(makeEarQuiz('lowcut', 42))
    expect(makeEarQuiz('comp', 7)).toEqual(makeEarQuiz('comp', 7))
  })

  it('lowcut quiz answer points at the variant with low cut on', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const q = makeEarQuiz('lowcut', seed)
      expect(q.options).toHaveLength(2)
      expect(q.variants).toHaveLength(2)
      expect(q.variants[q.answer].lowCut.on).toBe(true)
      expect(q.variants[1 - q.answer].lowCut.on).toBe(false)
    }
  })

  it('comp quiz answer points at the variant with compression on', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const q = makeEarQuiz('comp', seed)
      expect(q.variants[q.answer].comp.on).toBe(true)
      expect(q.variants[1 - q.answer].comp.on).toBe(false)
    }
  })

  it('order is randomised by seed', () => {
    const answers = new Set<number>()
    for (let seed = 1; seed <= 20; seed++) answers.add(makeEarQuiz('comp', seed).answer)
    expect(answers).toEqual(new Set([0, 1]))
  })
})

describe('preset band counts', () => {
  it('every preset has exactly four EQ bands (the chain has four slots)', async () => {
    const { MIX_PRESETS } = await import('@/songs/mixPresets')
    for (const p of Object.values(MIX_PRESETS)) expect(p.settings.vocal.eq.bands).toHaveLength(4)
  })
})
