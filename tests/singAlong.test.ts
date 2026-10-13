import { describe, expect, it } from 'vitest'
import { ANALYSIS_RATE, HOP, cleanCurve, extractCurve, findLag, noteFeedback, notePoints, notesOf, phrasesOf, scoreNotes, steadyLag, type PitchCurve, type SungSample } from '@/songs/singAlong'

/** Sine segments at 16 kHz: [hz | 0 for silence, seconds]. */
function signal(parts: Array<[number, number]>): Float32Array {
  const out: number[] = []
  let phase = 0
  for (const [hz, sec] of parts) {
    for (let i = 0; i < Math.round(sec * ANALYSIS_RATE); i++) {
      phase += (2 * Math.PI * hz) / ANALYSIS_RATE
      out.push(hz ? 0.4 * Math.sin(phase) : 0)
    }
  }
  return Float32Array.from(out)
}

const midiOf = (hz: number) => 69 + 12 * Math.log2(hz / 440)

describe('pitch line', () => {
  it('extracts the singer’s pitch and splits phrases at pauses', async () => {
    const curve = await extractCurve(signal([[0, 0.3], [220, 1], [0, 0.6], [330, 1.2], [0, 0.3]]))
    expect(curve.hop).toBe(HOP)
    const phrases = phrasesOf(curve)
    expect(phrases).toHaveLength(2)
    expect(phrases[0]!.medianMidi).toBeCloseTo(midiOf(220), 1)
    expect(phrases[1]!.medianMidi).toBeCloseTo(midiOf(330), 1)
    expect(phrases[0]!.startMs).toBeGreaterThanOrEqual(260)
    expect(phrases[0]!.startMs).toBeLessThanOrEqual(360)
    expect(phrases[1]!.startMs).toBeGreaterThan(phrases[0]!.endMs + 300)
  })

  it('cleans blips and octave errors', () => {
    const raw = new Float32Array(40).fill(NaN)
    raw.fill(60, 0, 30)
    raw[10] = 72 // octave error
    raw[35] = 64 // 20 ms blip
    raw[36] = 64
    const c = cleanCurve(raw)
    expect(c[10]).toBe(60)
    expect(Number.isNaN(c[35]!)).toBe(true)
  })
})

describe('scoring 2.0: notes', () => {
  // A phrase from 1 s: A3 with vibrato (±50 cents at 5.5 Hz) for 0.8 s, a 100 ms glide, C4 for 0.8 s.
  const frames = 160
  const midi = new Float32Array(frames).fill(NaN)
  for (let i = 50; i < 90; i++) midi[i] = 57 + 0.5 * Math.sin((2 * Math.PI * 5.5 * i * HOP))
  for (let i = 90; i < 95; i++) midi[i] = 57 + ((i - 89) / 6) * 3
  for (let i = 95; i < 135; i++) midi[i] = 60
  const curve: PitchCurve = { hop: HOP, midi }
  const notes = notesOf(curve)
  const phrase = { startMs: 1000, endMs: 2700 }
  const sing = (parts: Array<[number, number, number]>, wobble = 0): SungSample[] =>
    parts.flatMap(([from, to, m]) => Array.from({ length: Math.round((to - from) / 20) }, (_, k) => ({ ms: from + k * 20, midi: m + wobble * Math.sin(2 * Math.PI * 5 * (from + k * 20) / 1000) })))

  it('turns vibrato into one steady note and skips the glide', () => {
    expect(notes).toHaveLength(2)
    expect(notes[0]!.midi).toBeCloseTo(57, 0)
    expect(notes[1]!.midi).toBe(60)
    expect(notes[0]!.endMs).toBeLessThanOrEqual(notes[1]!.startMs)
  })
  it('full marks for the right notes, with or without the student’s own vibrato', () => {
    expect(scoreNotes(notes, phrase, sing([[1000, 1800, 57], [1900, 2700, 60]]))!.score).toBeCloseTo(1, 2)
    expect(scoreNotes(notes, phrase, sing([[1000, 1800, 57], [1900, 2700, 60]], 0.4))!.score).toBeGreaterThan(0.95)
  })
  it('a late entry (200 ms) is found and not punished; the habit is noticed', () => {
    const s = scoreNotes(notes, phrase, sing([[1200, 2000, 57], [2100, 2900, 60]]))!
    expect(s.lagMs).toBe(200)
    expect(s.score).toBeCloseTo(1, 2)
    expect(findLag(notes, sing([[1000, 1800, 57], [1900, 2700, 60]]))).toBe(0)
    expect(steadyLag([200, 220, 180])).toBe(200)
    expect(steadyLag([200, -40, 180])).toBeNull()
  })
  it('any octave counts', () => {
    const s = scoreNotes(notes, phrase, sing([[1000, 1800, 69], [1900, 2700, 72]]))!
    expect(s.octaveShift).toBe(12)
    expect(s.score).toBeCloseTo(1, 2)
  })
  it('points fade between 25 and 100 cents instead of hit-or-miss', () => {
    expect(notePoints(20)).toBe(1)
    expect(notePoints(-62.5)).toBeCloseTo(0.5, 5)
    expect(notePoints(120)).toBe(0)
    const s = scoreNotes(notes, phrase, sing([[1000, 1800, 57.5], [1900, 2700, 60.5]]))!
    expect(s.biasCents).toBeGreaterThan(40)
    expect(s.biasCents).toBeLessThan(55)
    expect(s.score).toBeGreaterThan(0.6)
    expect(s.score).toBeLessThan(0.8)
    expect(noteFeedback(s)).toContain('偏高')
  })
  it('an unsung note counts as zero; a short one-note phrase or silence is not scored', () => {
    const half = scoreNotes(notes, phrase, sing([[1000, 1800, 57]]))!
    expect(half.notesSung).toBe(1)
    expect(half.score).toBeCloseTo(0.5, 1)
    // One sustained note (0.8 s) is scored; a phrase window holding no full note is not.
    expect(scoreNotes(notes, { startMs: 1000, endMs: 1850 }, sing([[1000, 1800, 57]]))!.score).toBeCloseTo(1, 1)
    expect(scoreNotes(notes, { startMs: 1000, endMs: 1400 }, sing([[1000, 1400, 57]]))).toBeNull()
    expect(scoreNotes(notes, phrase, [])).toBeNull()
  })
})
