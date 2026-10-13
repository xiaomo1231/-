import { describe, expect, it } from 'vitest'
import { deviceComboKey, deviceDisplayName, inputKindOf, isGuitarCableLabel, pickInputFor } from '@/audio/input/devices'
import { BUILTIN_PRESETS, DEFAULT_RIG, normalizePresets, normalizeRig, syncedDelayTime } from '@/audio/guitar/rigSettings'
import { ampPreGain, dbToGain, gateBlock, masterGain, pedalDrive, reverbImpulse, shaperCurve, toneCutoff } from '@/audio/guitar/dsp'
import { calibrate, estimateRoundTripMs, judgeOffset } from '@/audio/latency'
import { OnsetDetector } from '@/audio/onset/onset'

const SR = 48000

/** Synthetic guitar: noise floor plus decaying plucks at the given times (seconds). */
function render(times: number[], seconds: number, opts: { amp?: number; noise?: number; decay?: number; freq?: number } = {}): Float32Array {
  const { amp = 0.5, noise = 0.0005, decay = 0.35, freq = 110 } = opts
  const out = new Float32Array(Math.round(seconds * SR))
  let s = 12345
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) * 2 - 1
  for (let i = 0; i < out.length; i++) out[i] = rnd() * noise
  // Each pluck re-excites the string (the previous one is damped by the pick),
  // with a short bright pick transient and harmonics that decay faster than the fundamental.
  times.forEach((t0, k) => {
    const start = Math.round(t0 * SR)
    const end = k + 1 < times.length ? Math.round(times[k + 1]! * SR) : out.length
    for (let i = start; i < out.length; i++) {
      const t = (i - start) / SR
      const damp = i >= end ? Math.exp(-(i - end) / (SR * 0.004)) : 1
      let v = 0
      for (let h = 1; h <= 8; h++) v += (Math.sin(2 * Math.PI * freq * h * t + h) / h) * Math.exp(-t / (decay / h))
      const pick = t < 0.004 ? rnd() * 0.35 * (1 - t / 0.004) : 0
      out[i]! += amp * damp * (Math.min(1, t / 0.0008) * v + pick)
    }
  })
  return out
}

function detect(signal: Float32Array, profile: 'cable' | 'mic' = 'cable', chunk = 128) {
  const d = new OnsetDetector(SR, profile)
  const found: number[] = []
  for (let i = 0; i < signal.length; i += chunk) found.push(...d.feed(signal.subarray(i, i + chunk), i).map((o) => o.time))
  return found
}

describe('input devices', () => {
  it('recognises guitar cables by name', () => {
    expect(isGuitarCableLabel('Rocksmith Guitar Adapter (12ba:00ff)')).toBe(true)
    expect(isGuitarCableLabel('Real Tone Cable')).toBe(true)
    expect(isGuitarCableLabel('麦克风 (Realtek(R) Audio)')).toBe(false)
    expect(inputKindOf('Default - Rocksmith Guitar Adapter')).toBe('cable')
    expect(deviceDisplayName('Default - Rocksmith Guitar Adapter (12ba:00ff)')).toBe('Rocksmith Guitar Adapter')
    expect(deviceComboKey('Rocksmith Guitar Adapter (12ba:00ff)', 'Headphones')).toBe(deviceComboKey('rocksmith guitar adapter', 'headphones'))
  })
  it('singing never uses the cable', () => {
    const devices = [
      { id: 'default', label: 'Default - Rocksmith Guitar Adapter', kind: 'cable' as const },
      { id: 'a', label: 'Rocksmith Guitar Adapter', kind: 'cable' as const },
      { id: 'b', label: 'Microphone (Realtek)', kind: 'mic' as const },
    ]
    expect(pickInputFor('instrument', devices, 'a')).toBe('a')
    expect(pickInputFor('voice', devices, 'a')).toBe('b')
    expect(pickInputFor('voice', devices, 'b')).toBe('b')
    expect(pickInputFor('instrument', devices, undefined)).toBeUndefined()
  })
})

describe('rig settings', () => {
  it('normalises untrusted settings', () => {
    const r = normalizeRig({ gate: { on: 'yes', threshold: -500 }, amp: { type: 'nuclear', gain: 7 }, delay: { feedback: 2 }, volume: -1, extra: 1 })
    expect(r.gate.on).toBe(DEFAULT_RIG.gate.on)
    expect(r.gate.threshold).toBe(-80)
    expect(r.amp.type).toBe('clean')
    expect(r.amp.gain).toBe(1)
    expect(r.delay.feedback).toBeLessThanOrEqual(0.85)
    expect(r.volume).toBe(0)
    expect(Object.keys(r)).not.toContain('extra')
    expect(normalizeRig(undefined)).toEqual(DEFAULT_RIG)
  })
  it('built-in presets are valid and distinct', () => {
    for (const p of BUILTIN_PRESETS) expect(normalizeRig(p.settings)).toEqual(p.settings)
    expect(new Set(BUILTIN_PRESETS.map((p) => p.settings.amp.type))).toEqual(new Set(['clean', 'crunch', 'high']))
    expect(normalizePresets([{ id: 'x', name: '我的', settings: {} }, { name: 'no id' }])).toHaveLength(1)
  })
  it('synced delay is a dotted eighth', () => {
    expect(syncedDelayTime(100)).toBeCloseTo(0.45, 3)
    expect(syncedDelayTime(10)).toBeLessThanOrEqual(1.2)
  })
})

describe('DSP helpers', () => {
  it('drive curves are monotonic, odd-ish and bounded', () => {
    for (const k of ['soft', 'hard', 'amp-clean', 'amp-crunch', 'amp-high'] as const) {
      const c = shaperCurve(k, 512)
      expect(Math.max(...c.map(Math.abs))).toBeCloseTo(1, 5)
      for (let i = 1; i < c.length; i++) expect(c[i]!).toBeGreaterThanOrEqual(c[i - 1]! - 1e-6)
      expect(Math.abs(c[255]! + c[256]!)).toBeLessThan(0.05)
    }
    // The high-gain amp saturates far more than the clean one at half input.
    const at = (k: 'amp-clean' | 'amp-high') => shaperCurve(k, 1001)[750]!
    expect(at('amp-high')).toBeGreaterThan(at('amp-clean'))
  })
  it('knob tapers', () => {
    expect(pedalDrive('soft', 0)).toBe(2)
    expect(pedalDrive('hard', 1)).toBe(300)
    expect(ampPreGain('high', 1)).toBeGreaterThan(ampPreGain('crunch', 1))
    expect(toneCutoff(0)).toBe(1200)
    expect(Math.round(toneCutoff(1))).toBe(9000)
    expect(masterGain(0)).toBe(0)
    expect(masterGain(1)).toBeCloseTo(1, 6)
  })
  it('reverb impulse is deterministic, stereo and longer for bigger rooms', () => {
    const [l1] = reverbImpulse(8000, 0.2)
    const [l2, r2] = reverbImpulse(8000, 0.9)
    expect(l2.length).toBeGreaterThan(l1.length)
    expect(reverbImpulse(8000, 0.9)[0]).toEqual(l2)
    expect(r2).not.toEqual(l2)
  })
  it('noise gate silences hiss and opens on a note', () => {
    const hiss = new Float32Array(4800).map((_, i) => (i % 2 ? 1 : -1) * dbToGain(-70))
    let st = { env: 0, gain: 0, below: 1 }
    st = gateBlock(hiss, st, -58, 0.1, SR)
    expect(Math.max(...hiss.map(Math.abs))).toBeLessThan(dbToGain(-90))
    const note = new Float32Array(4800).map((_, i) => 0.3 * Math.sin(i / 10))
    st = gateBlock(note, st, -58, 0.1, SR)
    expect(st.gain).toBeGreaterThan(0.99)
    expect(Math.abs(note[4000]!)).toBeCloseTo(Math.abs(0.3 * Math.sin(400)), 2)
  })
})

describe('onset detection', () => {
  it('finds each pluck within 3 ms and ignores the decay', () => {
    const times = [0.5, 1.0, 1.25, 1.5, 2.0]
    const found = detect(render(times, 2.6))
    expect(found).toHaveLength(times.length)
    found.forEach((t, i) => expect(Math.abs(t - times[i]!)).toBeLessThan(0.003))
  })
  it('catches a re-strum while the previous one still rings (16ths at 120 BPM)', () => {
    const times = Array.from({ length: 8 }, (_, i) => 0.3 + i * 0.125)
    const found = detect(render(times, 1.8, { decay: 0.6 }))
    expect(found).toHaveLength(8)
  })
  it('ignores the noise floor and quiet hum', () => {
    expect(detect(render([], 1.5, { noise: 0.002 }))).toEqual([])
  })
  it('works regardless of chunk size', () => {
    const sig = render([0.4, 0.9], 1.3)
    expect(detect(sig, 'cable', 128)).toEqual(detect(sig, 'cable', 1000))
  })
})

describe('latency', () => {
  it('estimates the round trip', () => {
    expect(estimateRoundTripMs({ base: 0.01, output: 0.02, input: 0.01 })).toBe(40)
    expect(estimateRoundTripMs({ base: 0.01, output: 0.02, input: 0 })).toBe(42)
  })
  it('calibrates from plucks along with clicks', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 1 + i * (60 / 90))
    const jitter = [3, -4, 2, 0, -2, 5, -3, 1, 2, -1, 0, 4, -2, 1, 3, -3]
    const onsets = clicks.map((c, i) => c + 0.045 + jitter[i]! / 1000)
    onsets.splice(9, 1, clicks[9]! + 0.2) // one sloppy pluck
    const r = calibrate(clicks, onsets)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.offsetMs - 45)).toBeLessThanOrEqual(2)
    expect(r.used).toBeGreaterThanOrEqual(10)
  })
  it('rejects too few, unsteady or implausible results', () => {
    const clicks = Array.from({ length: 16 }, (_, i) => 1 + i * 0.667)
    expect(calibrate(clicks, clicks.slice(0, 6).map((c) => c + 0.04)).reason).toBe('too-few')
    const wild = clicks.map((c, i) => c + 0.04 + (i % 2 ? 0.06 : -0.06))
    expect(calibrate(clicks, wild).reason).toBe('unsteady')
    expect(calibrate(clicks, clicks.map((c) => c - 0.1)).reason).toBe('out-of-range')
  })
  it('prefers the calibrated value for this device pair', () => {
    expect(judgeOffset({ a: 38 }, 'a', 50)).toEqual({ seconds: 0.038, calibrated: true })
    expect(judgeOffset({}, 'a', 50)).toEqual({ seconds: 0.05, calibrated: false })
  })
})

import { STRUM_PATTERNS, expectedTimes, judgeTake, patternBeats, strumPattern, takeFeedback } from '@/guitar/strum'
import { StableNoteTracker, changeCounterNote, chordCheckDone, chordCheckNote, chordCheckPassed, chordCheckSkip, startChangeCounter, startChordCheck } from '@/guitar/checks'
import { ALL_UNITS, RHYTHM_UNITS, parseChordSymbol } from '@/guitar/units'
import { OPEN_CHORDS, guitarChordShape } from '@/music/fretboard'
import { chordSymbolFor } from '@/music/score'

describe('strum patterns and judging', () => {
  it('patterns have full bars and the right strum positions', () => {
    for (const p of STRUM_PATTERNS) expect(p.cells.length).toBe(p.grid)
    expect(patternBeats(strumPattern('pop'))).toEqual([0, 1, 1.5, 2.5, 3, 3.5])
    expect(patternBeats(strumPattern('sixteen'))).toHaveLength(12)
    const t = expectedTimes(strumPattern('quarters'), 2, 10, 0.5)
    expect(t).toEqual([10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5])
  })
  it('grades perfect, good, missed and extra strums', () => {
    const expected = [1, 1.5, 2, 2.5]
    const r = judgeTake(expected, [1.01, 1.56, 2.3, 2.49, 3.5])
    expect(r.hits.map((h) => h.grade)).toEqual(['perfect', 'good', 'miss', 'perfect'])
    expect(r.extra).toBe(2)
    expect(r.score).toBeLessThan(0.75)
    const clean = judgeTake(expected, expected.map((e) => e + 0.01))
    expect(clean.score).toBe(1)
    expect(takeFeedback(clean)).toContain('稳')
  })
  it('one strum cannot fill two slots, and dragging is reported', () => {
    const r = judgeTake([1, 1.1], [1.05])
    expect(r.perfect + r.good).toBe(1)
    const late = judgeTake([1, 2, 3, 4], [1.06, 2.06, 3.06, 4.06])
    expect(late.meanSignedMs).toBe(60)
    expect(takeFeedback(late)).toContain('偏慢')
  })
})

describe('pitch checks', () => {
  const hz = (m: number) => 440 * Math.pow(2, (m - 69) / 12)
  it('stable notes need a few steady frames and fire once', () => {
    const t = new StableNoteTracker(3)
    const outs = [hz(40), hz(40.1), hz(39.95), hz(40), hz(40)].map((h) => t.push({ hz: h }))
    expect(outs.filter((x) => x !== null)).toEqual([40])
    expect(t.push({ hz: hz(45) })).toBeNull()
  })
  it('chord check walks the strings and asks for a retry on a wrong note', () => {
    let s = startChordCheck([{ string: 0, midi: 40 }, { string: 1, midi: 47 }, { string: 2, midi: 52 }])
    s = chordCheckNote(s, 40)
    s = chordCheckNote(s, 40) // still ringing: ignored
    s = chordCheckNote(s, 48) // wrong
    expect(s.states[1]).toBe('retry')
    s = chordCheckNote(s, 47)
    s = chordCheckNote(s, 52)
    expect(chordCheckDone(s)).toBe(true)
    expect(chordCheckPassed(s)).toBe(true)
    expect(s.firstTry).toBe(2)
    const skipped = chordCheckSkip(startChordCheck([{ string: 0, midi: 40 }]))
    expect(chordCheckPassed(skipped)).toBe(false)
  })
  it('chord changes are counted by the root that is heard', () => {
    let s = startChangeCounter([52, 45]) // Em (E) and Am (A)
    for (const m of [40, 40, 45, 57, 40, 43, 45]) s = changeCounterNote(s, m)
    expect(s.changes).toBe(3)
  })
})

describe('guitar units', () => {
  it('ids are unique, released units have exercises, and every chord has a playable open shape', () => {
    const ids = ALL_UNITS.flatMap((u) => [u.id, ...u.exercises.map((e) => e.id)])
    expect(new Set(ids).size).toBe(ids.length)
    const released = RHYTHM_UNITS.filter((u) => ['R1', 'R2', 'R3', 'R4'].includes(u.id))
    for (const u of released) {
      expect(u.exercises.length).toBeGreaterThan(0)
      expect(u.intro.length).toBeGreaterThan(50)
      for (const ex of u.exercises) {
        const chords = ex.kind === 'strum' ? ex.romans.map((r) => chordSymbolFor({ keyTonic: ex.tonic, mode: 'major' }, r)) : ex.kind === 'chord-check' || ex.kind === 'change' ? ex.chords : []
        for (const c of chords) {
          const { rootPc, suffix, rootName } = parseChordSymbol(c)
          const shape = guitarChordShape(rootPc, suffix, rootName)
          expect(shape, `${ex.id} ${c}`).not.toBeNull()
          expect(OPEN_CHORDS.some((o) => o.symbol === c), `${ex.id} ${c} should be an open chord`).toBe(true)
        }
        if (ex.kind === 'strum') expect(() => strumPattern(ex.pattern)).not.toThrow()
      }
    }
  })
})
