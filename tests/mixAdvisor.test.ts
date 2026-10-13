import { describe, expect, it } from 'vitest'
import { measureVoice, suggest, type VoiceMetrics } from '@/audio/fx/mixAdvisor'
import { DEFAULT_MIX, MIX_PRESETS, cloneMix } from '@/songs/mixPresets'

const SR = 44100
const HARM = [0.5, 1, 0.8, 0.6, 0.5, 0.4, 0.3, 0.3, 0.2, 0.2]

/** Deterministic PRNG for noise. */
function rng(seed = 1): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32 - 0.5
  }
}

/** A "sung" signal: 2 s phrases of a 300 Hz harmonic tone, 1 s gaps. */
function voice(seconds: number, scale = 0.08, gapNoise = 0): Float32Array {
  const x = new Float32Array(Math.round(seconds * SR))
  const r = rng(7)
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    const inPhrase = t % 3 < 2
    let s = 0
    if (inPhrase) for (let k = 0; k < HARM.length; k++) s += (HARM[k] ?? 0) * Math.sin(2 * Math.PI * 300 * (k + 1) * t)
    x[i] = s * scale + (inPhrase ? 0 : gapNoise * r() * Math.sqrt(12))
  }
  return x
}

const raw = () => cloneMix(MIX_PRESETS.raw.settings)

describe('measureVoice', () => {
  it('a clean voice gets no rumble / gate / de-ess suggestions', () => {
    const m = measureVoice(voice(12), null, SR)
    expect(m.bands.sub).toBeLessThan(0.05)
    expect(m.clipped).toBe(0)
    const ids = suggest(m, raw()).map((s) => s.id)
    expect(ids).not.toContain('rumble')
    expect(ids).not.toContain('gate')
    expect(ids).not.toContain('deess')
  })

  it('50 Hz hum yields a low-cut suggestion, unless low cut is already on', () => {
    const x = voice(12)
    for (let i = 0; i < x.length; i++) x[i] = (x[i] ?? 0) + 0.06 * Math.sin((2 * Math.PI * 50 * i) / SR)
    const m = measureVoice(x, null, SR)
    expect(m.noiseHum).toBeGreaterThan(0.9)
    const s = suggest(m, raw()).find((y) => y.id === 'rumble')
    expect(s).toBeDefined()
    expect(s?.module).toBe('lowcut')
    const after = s!.apply(raw())
    expect(after.vocal.lowCut.on).toBe(true)
    expect(after.vocal.lowCut.freq).toBeGreaterThanOrEqual(90)
    expect(after.vocal.lowCut.freq).toBeLessThanOrEqual(120)
    expect(suggest(m, DEFAULT_MIX).find((y) => y.id === 'rumble')).toBeUndefined()
  })

  it('loud 7 kHz bursts yield a de-esser around 7 kHz', () => {
    const x = voice(12)
    const r = rng(3)
    const phases = Array.from({ length: 20 }, () => r() * 2 * Math.PI)
    for (let p = 0; p < 4; p++) {
      const start = p * 3 * SR
      for (let i = 0; i < 0.15 * SR; i++) {
        let s = 0
        for (let k = 0; k < 20; k++) s += Math.sin((2 * Math.PI * (6600 + k * 40) * i) / SR + (phases[k] ?? 0))
        x[start + i] = (x[start + i] ?? 0) + (s / Math.sqrt(10)) * 0.15
      }
    }
    const m = measureVoice(x, null, SR)
    expect(m.bands.sibilance).toBeGreaterThan(0.08)
    expect(Math.abs(m.sibilanceHz - 7000)).toBeLessThan(600)
    const s = suggest(m, raw()).find((y) => y.id === 'deess')
    expect(s).toBeDefined()
    const after = s!.apply(raw())
    expect(after.vocal.deEss.on).toBe(true)
    expect(after.vocal.deEss.freq).toBeGreaterThanOrEqual(6000)
    expect(after.vocal.deEss.freq).toBeLessThanOrEqual(8000)
  })

  it('a quiet voice over a loud backing yields a gain-up suggestion', () => {
    const v = voice(12, 0.01)
    const r = rng(9)
    const b = new Float32Array(v.length)
    for (let i = 0; i < b.length; i++) b[i] = 0.3 * r() + 0.2 * Math.sin((2 * Math.PI * 110 * i) / SR)
    const m = measureVoice(v, b, SR)
    expect(m.backingDb).toBeGreaterThan(m.voiceDb + 10)
    const s = suggest(m, raw()).find((y) => y.id === 'balance')
    expect(s?.title).toBe('人声偏小')
    const after = s!.apply(raw())
    expect(after.vocal.gainDb).toBeGreaterThan(raw().vocal.gainDb)
    expect(after.vocal.gainDb).toBeLessThanOrEqual(12)
    expect(m.masking).toBeGreaterThan(0.5)
  })

  it('noisy gaps yield a gate above the floor', () => {
    const m = measureVoice(voice(12, 0.08, 0.0056), null, SR)
    expect(m.noiseFloorDb).toBeGreaterThan(-50)
    expect(m.noiseFloorDb).toBeLessThan(-40)
    const s = suggest(m, raw()).find((y) => y.id === 'gate')
    expect(s).toBeDefined()
    const after = s!.apply(raw())
    expect(after.vocal.gate.on).toBe(true)
    expect(after.vocal.gate.thresholdDb).toBeGreaterThan(m.noiseFloorDb)
    // Already gated above the floor → no suggestion.
    expect(suggest(m, after).find((y) => y.id === 'gate')).toBeUndefined()
  })

  it('detects clipping and offers a top-priority, no-op suggestion', () => {
    const x = voice(6, 0.5)
    for (let i = 0; i < x.length; i++) x[i] = Math.max(-1, Math.min(1, x[i] ?? 0))
    const m = measureVoice(x, null, SR)
    expect(m.clipped).toBeGreaterThan(0)
    const list = suggest(m, raw())
    const s = list.find((y) => y.id === 'clipping')
    expect(s).toBeDefined()
    expect(list[0]?.id).toBe('clipping')
    const mix = raw()
    const after = s!.apply(mix)
    expect(after).not.toBe(mix)
    expect(after).toEqual(mix)
  })
})

describe('suggest', () => {
  const worst: VoiceMetrics = {
    voiceDb: -40,
    backingDb: -18,
    bands: { sub: 0.2, lowMid: 0.7, mid: 0.08, presence: 0.005, sibilance: 0.01, air: 0.005 },
    dynamicRangeDb: 22,
    noiseFloorDb: -50,
    noiseHum: 0.8,
    peakDb: 0,
    clipped: 0.001,
    masking: 0.8,
    sibilanceHz: 7000,
  }

  it('sorts by priority and never mutates the input mix', () => {
    const mix = raw()
    const before = JSON.stringify(mix)
    const list = suggest(worst, mix)
    expect(list.length).toBeGreaterThan(6)
    for (let i = 1; i < list.length; i++) expect(list[i - 1]!.priority).toBeGreaterThanOrEqual(list[i]!.priority)
    for (const s of list) {
      const out = s.apply(mix)
      expect(out).not.toBe(mix)
      expect(out.vocal.gainDb).toBeLessThanOrEqual(12)
      expect(out.vocal.gainDb).toBeGreaterThanOrEqual(-24)
    }
    expect(JSON.stringify(mix)).toBe(before)
  })

  it('applying each suggestion makes it disappear (except clipping and balance re-measure)', () => {
    let mix = raw()
    for (const s of suggest(worst, mix)) if (s.id !== 'clipping' && s.id !== 'balance' && s.id !== 'loudness') mix = s.apply(mix)
    const left = suggest(worst, mix).map((s) => s.id)
    expect(left.filter((id) => !['clipping', 'balance', 'loudness'].includes(id))).toEqual([])
  })
})

describe('performance', () => {
  it('analyses 4 minutes in well under 1.5 s', () => {
    const v = voice(240, 0.08, 0.002)
    const r = rng(5)
    const b = new Float32Array(v.length)
    for (let i = 0; i < b.length; i++) b[i] = 0.1 * r()
    const t0 = performance.now()
    measureVoice(v, b, SR)
    const dt = performance.now() - t0
    expect(dt).toBeLessThan(1500)
  })
})
