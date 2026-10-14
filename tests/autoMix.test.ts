import { describe, expect, it } from 'vitest'
import { TONE_BANDS, autoMix, matchingEq, reverbFromTails, toneCurve } from '@/audio/fx/autoMix'
import { DEFAULT_MIX } from '@/songs/mixPresets'

const SR = 16000
let seed = 7
const rnd = () => {
  seed = (seed * 16807) % 2147483647
  return seed / 2147483647 - 0.5
}

/** Phrases of a harmonic voice (1.5 s on, 0.7 s off) with optional noise floor, brightness and an exponential tail. */
function voice(
  opts: {
    seconds?: number
    amp?: number
    noise?: number
    bright?: number
    decayS?: number
    f0?: number
  } = {},
): Float32Array {
  const { seconds = 20, amp = 0.2, noise = 0, bright = 0, decayS = 0, f0 = 220 } = opts
  const x = new Float32Array(seconds * SR)
  for (let i = 0; i < x.length; i++) {
    const t = i / SR
    const inPhrase = t % 2.2 < 1.5
    const since = (t % 2.2) - 1.5
    // After a phrase: the dry voice stops; a reverb tail 15 dB down decays at 60 dB per decayS.
    const env = inPhrase ? 1 : decayS > 0 ? 10 ** ((-15 - (60 * since) / decayS) / 20) : 0
    let v = 0
    for (let k = 1; k <= 12; k++)
      v += Math.sin(2 * Math.PI * f0 * k * t) / (k <= 6 ? k : k / (1 + bright))
    x[i] = amp * env * v * 0.3 + noise * rnd()
  }
  return x
}

describe('auto mix', () => {
  it('matching EQ moves toward the target and stays within the limit', () => {
    const flat = TONE_BANDS.map(() => 0)
    const target = TONE_BANDS.map((f) => (f > 2000 && f < 5000 ? 8 : 0))
    const bands = matchingEq(flat, target, 4)
    expect(bands[2]!.freq).toBeGreaterThan(1800)
    expect(bands[2]!.freq).toBeLessThan(5200)
    expect(bands[2]!.gainDb).toBe(4)
    expect(bands.every((b) => Math.abs(b.gainDb) <= 4)).toBe(true)
    expect(matchingEq(flat, flat, 6).every((b) => b.gainDb === 0)).toBe(true)
  })

  it('reads the reverb length from phrase endings', () => {
    const wet = reverbFromTails(voice({ decayS: 1.6 }), SR)!
    expect(wet.decayS).toBeGreaterThan(1.1)
    expect(wet.decayS).toBeLessThan(2.3)
    const dry = reverbFromTails(voice({ decayS: 0.4 }), SR)
    if (dry) expect(dry.decayS).toBeLessThan(wet.decayS)
  })

  it('tone curve tells a brighter voice from a darker one', () => {
    const dark = toneCurve(voice(), SR)!
    const bright = toneCurve(voice({ bright: 3 }), SR)!
    const hi = TONE_BANDS.findIndex((f) => f > 2500)
    expect(bright[hi]!).toBeGreaterThan(dark[hi]!)
  })

  it('clean: gate for a noisy take, low cut under the lowest note, loudness target, and reasons', () => {
    const r = autoMix(
      {
        voice: voice({ noise: 0.01 }),
        backing: voice({ amp: 0.1, f0: 110 }),
        reference: null,
        sampleRate: SR,
        bpm: 120,
        lowestMidi: 52,
        direction: 'clean',
        strength: 1,
      },
      DEFAULT_MIX,
    )
    expect(r.mix.vocal.gate.on).toBe(true)
    expect(r.mix.vocal.lowCut.freq).toBeLessThanOrEqual(Math.round((164.8 * 0.7) / 5) * 5 + 40)
    expect(r.mix.master.targetLufs).toBe(-14)
    expect(r.decisions.length).toBeGreaterThan(5)
    expect(r.referenceBalanceDb).toBeNull()
  })

  it("reference: follows the original balance and keeps the student's own tuning", () => {
    const backing = voice({ amp: 0.1, f0: 110 })
    const current = structuredClone(DEFAULT_MIX)
    current.vocal.tune.on = true
    const quietRef = autoMix(
      {
        voice: voice(),
        backing,
        reference: voice({ amp: 0.05, decayS: 1.5 }),
        sampleRate: SR,
        bpm: 90,
        direction: 'reference',
        strength: 1,
      },
      current,
    )
    const loudRef = autoMix(
      {
        voice: voice(),
        backing,
        reference: voice({ amp: 0.4, decayS: 1.5 }),
        sampleRate: SR,
        bpm: 90,
        direction: 'reference',
        strength: 1,
      },
      current,
    )
    expect(loudRef.referenceBalanceDb!).toBeGreaterThan(quietRef.referenceBalanceDb!)
    expect(loudRef.mix.vocal.gainDb).toBeGreaterThan(quietRef.mix.vocal.gainDb)
    expect(loudRef.mix.vocal.tune.on).toBe(true)
    // strength 0 = the clean result
    const none = autoMix(
      {
        voice: voice(),
        backing,
        reference: voice({ amp: 0.4 }),
        sampleRate: SR,
        bpm: 90,
        direction: 'reference',
        strength: 0,
      },
      current,
    )
    const clean = autoMix(
      {
        voice: voice(),
        backing,
        reference: null,
        sampleRate: SR,
        bpm: 90,
        direction: 'clean',
        strength: 1,
      },
      current,
    )
    expect(none.mix.vocal.gainDb).toBe(clean.mix.vocal.gainDb)
  })
})
