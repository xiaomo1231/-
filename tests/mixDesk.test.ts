import { describe, expect, it } from 'vitest'
import {
  bypassModule,
  dbToY,
  fitBands,
  fitMix,
  formatDb,
  formatHz,
  formatPan,
  freqToX,
  mixEqual,
  moduleOn,
  peakDb,
  previewRegion,
  rmsDb,
  xToFreq,
  yToDb,
} from '@/widgets/mix/mixUtils'
import { DEFAULT_MIX, MIX_PRESETS, cloneMix } from '@/songs/mixPresets'

describe('log frequency axis', () => {
  it('maps the ends of the axis to the edges', () => {
    expect(freqToX(20, 500)).toBeCloseTo(0, 6)
    expect(freqToX(20000, 500)).toBeCloseTo(500, 6)
  })

  it('maps one decade to one third of the width (log scale)', () => {
    // 20 → 20000 spans three decades; 200 is exactly one decade in.
    expect(freqToX(200, 300)).toBeCloseTo(100, 6)
  })

  it('round-trips frequency through x', () => {
    for (const f of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
      expect(xToFreq(freqToX(f, 640), 640)).toBeCloseTo(f, 4)
    }
  })

  it('clamps out-of-range input', () => {
    expect(freqToX(1, 100)).toBeCloseTo(0, 6)
    expect(xToFreq(-50, 100)).toBeCloseTo(20, 6)
    expect(xToFreq(500, 100)).toBeCloseTo(20000, 4)
  })
})

describe('dB axis', () => {
  it('puts +18 dB at the top and -18 dB at the bottom', () => {
    expect(dbToY(18, 200)).toBeCloseTo(0, 6)
    expect(dbToY(-18, 200)).toBeCloseTo(200, 6)
    expect(dbToY(0, 200)).toBeCloseTo(100, 6)
  })

  it('round-trips gain through y and clamps to the range', () => {
    expect(yToDb(dbToY(6.5, 300), 300)).toBeCloseTo(6.5, 6)
    expect(yToDb(-40, 300)).toBeCloseTo(18, 6)
    expect(dbToY(40, 200)).toBeCloseTo(0, 6)
  })
})

describe('level helpers', () => {
  it('returns -120 dBFS for silence', () => {
    expect(rmsDb(new Float32Array(256))).toBe(-120)
    expect(peakDb(new Float32Array(0))).toBe(-120)
  })

  it('measures a full-scale sine RMS at about -3 dBFS', () => {
    const n = 4096
    const s = new Float32Array(n)
    for (let i = 0; i < n; i++) s[i] = Math.sin((2 * Math.PI * 10 * i) / n)
    expect(rmsDb(s)).toBeCloseTo(-3.01, 1)
    expect(peakDb(s)).toBeCloseTo(0, 2)
  })

  it('measures a constant signal exactly', () => {
    expect(rmsDb(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(-6.02, 1)
  })
})

describe('formatting', () => {
  it('formats frequencies as Hz or kHz', () => {
    expect(formatHz(120)).toBe('120 Hz')
    expect(formatHz(99.6)).toBe('100 Hz')
    expect(formatHz(1200)).toBe('1.2k')
    expect(formatHz(2000)).toBe('2k')
    expect(formatHz(10000)).toBe('10k')
  })

  it('formats gains with a sign', () => {
    expect(formatDb(2.5)).toBe('+2.5 dB')
    expect(formatDb(-3)).toBe('-3 dB')
    expect(formatDb(0)).toBe('0 dB')
  })

  it('formats pan', () => {
    expect(formatPan(0)).toBe('居中')
    expect(formatPan(-0.3)).toBe('左 30%')
    expect(formatPan(0.5)).toBe('右 50%')
  })
})

describe('mix helpers', () => {
  it('pads a short EQ to four bands and keeps the first four', () => {
    const three = MIX_PRESETS.radio.settings.vocal.eq.bands.slice(0, 3)
    const fitted = fitBands(three)
    expect(fitted).toHaveLength(4)
    expect(fitted[0]).toEqual(three[0])
    expect(fitted[3]!.gainDb).toBe(0)
    expect(fitBands(MIX_PRESETS.bright.settings.vocal.eq.bands)).toHaveLength(4)
  })

  it('fitMix clamps values and leaves the input untouched', () => {
    const src = cloneMix(DEFAULT_MIX)
    src.vocal.gainDb = 99
    src.vocal.eq.bands = src.vocal.eq.bands.slice(0, 2)
    const out = fitMix(src)
    expect(out.vocal.gainDb).toBe(12)
    expect(out.vocal.eq.bands).toHaveLength(4)
    expect(src.vocal.gainDb).toBe(99)
    expect(src.vocal.eq.bands).toHaveLength(2)
  })

  it('mixEqual compares settings by value', () => {
    expect(mixEqual(DEFAULT_MIX, cloneMix(DEFAULT_MIX))).toBe(true)
    expect(mixEqual(DEFAULT_MIX, MIX_PRESETS.rock.settings)).toBe(false)
  })

  it('bypassModule switches only the target module off', () => {
    const off = bypassModule(DEFAULT_MIX, 'reverb')
    expect(off.vocal.reverb.on).toBe(false)
    expect(off.vocal.comp.on).toBe(DEFAULT_MIX.vocal.comp.on)
    expect(DEFAULT_MIX.vocal.reverb.on).toBe(true)
    expect(bypassModule(DEFAULT_MIX, 'lowcut').vocal.lowCut.on).toBe(false)
    expect(bypassModule(DEFAULT_MIX, 'delay').vocal.delay.on).toBe(false)
  })

  it('bypassModule resets balance values', () => {
    const m = cloneMix(DEFAULT_MIX)
    m.vocal.gainDb = 3
    m.vocal.pan = 0.4
    const b = bypassModule(m, 'balance')
    expect(b.vocal.gainDb).toBe(0)
    expect(b.vocal.pan).toBe(0)
  })

  it('moduleOn reports the switch, or null for balance', () => {
    expect(moduleOn(DEFAULT_MIX, 'comp')).toBe(true)
    expect(moduleOn(MIX_PRESETS.raw.settings, 'comp')).toBe(false)
    expect(moduleOn(DEFAULT_MIX, 'balance')).toBeNull()
  })
})

describe('preview region', () => {
  it('uses the whole song without a loop', () => {
    expect(previewRegion(30, null, 6)).toEqual({ start: 0, end: 6 })
    expect(previewRegion(4, null, 6)).toEqual({ start: 0, end: 4 })
  })

  it('uses the loop region and caps its length', () => {
    expect(previewRegion(60, { start: 10, end: 12 }, 6)).toEqual({ start: 10, end: 12 })
    expect(previewRegion(60, { start: 10, end: 40 }, 6)).toEqual({ start: 10, end: 16 })
  })

  it('handles an empty loop by taking a window from its start', () => {
    expect(previewRegion(60, { start: 20, end: 20 }, 6)).toEqual({ start: 20, end: 26 })
  })
})
