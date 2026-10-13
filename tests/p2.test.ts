import { describe, expect, it } from 'vitest'
import { yin } from '@/audio/pitch/yin'
import {
  centsFromTarget,
  longestStableRun,
  measureBestStretch,
  measureWindow,
  nearestNote,
  smoothFrames,
  type PitchFrame,
} from '@/audio/pitch/analysis'
import { midiToFrequency } from '@/music/pitch'
import { generateQuestion } from '@/drills/generators'
import { gradeQuestion } from '@/drills/grading'
import { levelTitles } from '@/drills/levels'
import { skillLabel, skillModule } from '@/drills/skills'
import { intervalNameFromSpelling } from '@/drills/theory'
import { MODULES, type DrillQuestion, type ModuleId } from '@/drills/types'
import { BASS_STANDARD, GUITAR_STANDARD, fingerMelody, guitarChordShape, positionsFor, shapeNotes } from '@/music/fretboard'
import { generateMelody, melodyLength } from '@/music/melody'
import { createRng } from '@/music/random'
import { scaleNotes } from '@/music/scales'
import { spell, spelledToMidi, vexKey } from '@/music/spelling'

function sine(freq: number, sampleRate = 48000, n = 2048, amp = 0.5): Float32Array {
  const buf = new Float32Array(n)
  for (let i = 0; i < n; i++) buf[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate) + 0.15 * amp * Math.sin((4 * Math.PI * freq * i) / sampleRate)
  return buf
}

describe('yin', () => {
  it.each([82.41, 110, 196, 261.63, 440, 659.25])('detects %f Hz within 5 cents', (f) => {
    const r = yin(sine(f), { sampleRate: 48000, minFreq: 70, maxFreq: 1100 })
    expect(r.freq).not.toBeNull()
    expect(Math.abs(1200 * Math.log2(r.freq! / f))).toBeLessThan(5)
    expect(r.clarity).toBeGreaterThan(0.9)
  })
  it('detects low bass E1 with a long window', () => {
    const r = yin(sine(41.2, 48000, 4096), { sampleRate: 48000, minFreq: 30, maxFreq: 420, threshold: 0.2 })
    expect(Math.abs(1200 * Math.log2(r.freq! / 41.2))).toBeLessThan(8)
  })
  it('reports noise as unvoiced', () => {
    const rng = createRng(3)
    const buf = new Float32Array(2048).map(() => rng.next() * 2 - 1)
    expect(yin(buf, { sampleRate: 48000, minFreq: 70, maxFreq: 1100 }).freq).toBeNull()
  })
})

function frames(hzs: Array<number | null>, dt = 0.025, t0 = 0): PitchFrame[] {
  return hzs.map((hz, i) => ({ t: t0 + i * dt, hz, clarity: hz ? 0.95 : 0, rms: hz ? 0.1 : 0 }))
}

describe('analysis', () => {
  const a4 = midiToFrequency(69)
  it('folds octaves when asked', () => {
    expect(centsFromTarget(a4 * 2, 69, true)).toBeCloseTo(0)
    expect(centsFromTarget(a4 * 2, 69, false)).toBeCloseTo(1200)
    expect(centsFromTarget(a4 * Math.pow(2, 30 / 1200), 69, true)).toBeCloseTo(30)
  })
  it('finds the longest stable run and measures it', () => {
    const scoop = [a4 * 0.9, a4 * 0.95]
    const steady = Array.from({ length: 40 }, () => a4 * Math.pow(2, 10 / 1200))
    const f = frames([null, ...scoop, ...steady, null, null])
    const run = longestStableRun(f)!
    expect(run.end - run.start + 1).toBeGreaterThanOrEqual(40)
    const m = measureBestStretch(f, 69, false)
    expect(m.medianCents).toBe(10)
    expect(m.stableMs).toBeGreaterThan(900)
    expect(m.driftCents).toBe(0)
  })
  it('measures a paced window and skips the onset', () => {
    const f = frames([...Array.from({ length: 8 }, () => a4 * 1.06), ...Array.from({ length: 32 }, () => a4)], 0.025)
    const m = measureWindow(f, 0, 1, 69, false)
    expect(Math.abs(m.medianCents!)).toBeLessThan(3)
    expect(m.voicedRatio).toBe(1)
  })
  it('empty windows measure as nothing', () => {
    expect(measureWindow(frames([null, null, null]), 0, 1, 69, false).medianCents).toBeNull()
  })
  it('smoothing removes single-frame glitches', () => {
    const f = frames([a4, a4, a4 * 2, a4, a4])
    expect(smoothFrames(f)[2]!.hz).toBeCloseTo(a4)
  })
  it('nearest note', () => {
    expect(nearestNote(445)).toEqual({ midi: 69, cents: 20 })
  })
})

const P2_MODULES: ModuleId[] = ['E6', 'E7', 'E8', 'E9', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'N1', 'T1', 'I1', 'I2']

describe('P2 generators', () => {
  it('cover every new module, level and many seeds', () => {
    for (const m of P2_MODULES) {
      for (const { level } of levelTitles(m)) {
        for (let s = 1; s <= 30; s++) {
          const q = generateQuestion(m, level, { seed: s * 104729 + level, instrument: s % 3 === 0 ? 'bass' : s % 3 === 1 ? 'guitar' : 'piano' })
          expect(q.module).toBe(m)
          expect(q.skillIds.length).toBeGreaterThan(0)
          for (const sk of q.skillIds) {
            expect(skillLabel(sk)).not.toBe(sk)
            if (!m.startsWith('I')) expect(skillModule(sk)).toBe(m)
          }
          checkInvariants(q)
        }
      }
    }
  })
  it('modules list has a level table for each module', () => {
    for (const m of MODULES) expect(levelTitles(m.id).length).toBe(m.maxLevel)
  })
  it('singing targets stay inside the vocal range', () => {
    const range = { low: 45, high: 62 }
    for (const m of ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7'] as const) {
      for (let s = 1; s <= 40; s++) {
        const q = generateQuestion(m, 3, { seed: s, vocalRange: range })
        if (q.kind !== 'perform') throw new Error('kind')
        for (const t of q.targets) {
          expect(t.midi).toBeGreaterThanOrEqual(range.low - 2)
          expect(t.midi).toBeLessThanOrEqual(range.high + 2)
        }
      }
    }
  })
})

function checkInvariants(q: DrillQuestion): void {
  switch (q.kind) {
    case 'progression':
      expect(q.chords.length).toBe(q.answer.length)
      for (const a of q.answer) expect(q.options).toContain(a)
      expect(q.prompt).toContain(q.answer[0]!.replace(/^b/, '♭'))
      break
    case 'bassline': {
      const total = q.notes.reduce((s, n) => s + n.beats, 0)
      expect(total).toBe(q.answer.length * 4)
      for (const a of q.answer) expect(q.options).toContain(a)
      expect(q.prompt).toContain(`${q.answer[0]} 级`)
      for (const n of q.notes) expect(n.midi).toBeLessThanOrEqual(64)
      break
    }
    case 'dictation':
      expect(q.melody[0]!.midi).toBe(q.tonic)
      break
    case 'rhythm_choice':
      expect(q.options.map((o) => o.id)).toContain(q.answer)
      expect(new Set(q.options.map((o) => o.id)).size).toBe(q.options.length)
      expect(q.options.length).toBeGreaterThanOrEqual(2)
      break
    case 'perform':
      expect(q.targets.length).toBeGreaterThan(0)
      if (!q.freeTiming) {
        for (let i = 1; i < q.targets.length; i++) expect(q.targets[i]!.startBeat).toBeGreaterThan(q.targets[i - 1]!.startBeat)
      }
      break
    case 'note_name':
      expect(q.options).toContain(q.answer)
      expect(spelledToMidi(q.note.letter, q.note.accidental, q.note.octave)).toBe(q.note.midi)
      break
    case 'theory':
      expect(q.options.map((o) => o.value)).toContain(q.answer)
      expect(new Set(q.options.map((o) => o.value)).size).toBe(q.options.length)
      expect(q.explanation.length).toBeGreaterThan(5)
      break
    default:
      break
  }
}

describe('P2 grading', () => {
  it('progressions score only the asked chords', () => {
    const q = generateQuestion('E6', 2, { seed: 5 })
    if (q.kind !== 'progression') throw new Error('kind')
    expect(gradeQuestion(q, { kind: 'choices', values: q.answer.slice(1) }).correct).toBe(true)
    expect(gradeQuestion(q, { kind: 'choices', values: [...q.answer] }).correct).toBe(true)
    const wrong = [...q.answer.slice(1)]
    wrong[0] = wrong[0] === 'IV' ? 'V' : 'IV'
    const r = gradeQuestion(q, { kind: 'choices', values: wrong })
    expect(r.correct).toBe(false)
    expect(r.credit).toBeCloseTo(2 / 3)
    expect(r.confusedExpected).toBe(q.answer[1])
  })

  it('dictation compares pitch classes and notes octave slips', () => {
    const q = generateQuestion('E8', 2, { seed: 9 })
    if (q.kind !== 'dictation') throw new Error('kind')
    const exact = q.melody.map((n) => n.midi)
    expect(gradeQuestion(q, { kind: 'notes', midis: exact }).correct).toBe(true)
    const slipped = exact.map((m, i) => (i === 2 ? m + 12 : m))
    const r = gradeQuestion(q, { kind: 'notes', midis: slipped })
    expect(r.correct).toBe(true)
    expect(r.feedback).toContain('八度')
    const wrong = exact.map((m, i) => (i === 1 ? m + 1 : m))
    expect(gradeQuestion(q, { kind: 'notes', midis: wrong }).credit).toBeCloseTo(2 / 3)
  })

  it('performance grading uses tolerance, sustain and voicing', () => {
    const q = generateQuestion('S1', 1, { seed: 1 })
    if (q.kind !== 'perform') throw new Error('kind')
    const good = { medianCents: 20, voicedRatio: 0.9, driftCents: 10, stableMs: 1500 }
    expect(gradeQuestion(q, { kind: 'performance', notes: [good] }).correct).toBe(true)
    expect(gradeQuestion(q, { kind: 'performance', notes: [{ ...good, medianCents: 70 }] }).correct).toBe(false)
    expect(gradeQuestion(q, { kind: 'performance', notes: [{ ...good, stableMs: 100 }] }).correct).toBe(false)
    const none = gradeQuestion(q, { kind: 'performance', notes: [{ medianCents: null, voicedRatio: 0, driftCents: null, stableMs: 0 }] })
    expect(none.feedback).toContain('没有听到')

    const s2 = generateQuestion('S2', 2, { seed: 2 })
    if (s2.kind !== 'perform') throw new Error('kind')
    expect(gradeQuestion(s2, { kind: 'performance', notes: [{ ...good, stableMs: 3000, driftCents: 30 }] }).correct).toBe(true)
    const drifty = gradeQuestion(s2, { kind: 'performance', notes: [{ ...good, stableMs: 3000, driftCents: 90 }] })
    expect(drifty.correct).toBe(false)
    expect(drifty.feedback).toContain('晃动')

    const s4 = generateQuestion('S4', 1, { seed: 3 })
    if (s4.kind !== 'perform') throw new Error('kind')
    const notes = s4.targets.map((_, i) => ({ ...good, medianCents: i < 4 ? 5 : 80 }))
    expect(gradeQuestion(s4, { kind: 'performance', notes }).credit).toBeCloseTo(4 / s4.targets.length)
  })

  it('note names and theory', () => {
    const q = generateQuestion('N1', 1, { seed: 4 })
    if (q.kind !== 'note_name') throw new Error('kind')
    expect(gradeQuestion(q, { kind: 'choice', value: q.answer }).correct).toBe(true)
    const t = generateQuestion('T1', 3, { seed: 4 })
    if (t.kind !== 'theory') throw new Error('kind')
    const wrong = t.options.find((o) => o.value !== t.answer)!.value
    const r = gradeQuestion(t, { kind: 'choice', value: wrong })
    expect(r.feedback).toBe(t.explanation)
  })
})

describe('theory helpers', () => {
  it('names intervals from spelling', () => {
    const c4 = spell(60)
    expect(intervalNameFromSpelling(c4, spell(64))).toBe('大三度')
    expect(intervalNameFromSpelling(c4, { letter: 'E', accidental: 'b', octave: 4, midi: 63 })).toBe('小三度')
    expect(intervalNameFromSpelling(c4, spell(67))).toBe('纯五度')
    expect(intervalNameFromSpelling(c4, { letter: 'F', accidental: '#', octave: 4, midi: 66 })).toBe('增四度')
    expect(intervalNameFromSpelling(c4, spell(72))).toBe('纯八度')
  })
  it('spells by key', () => {
    expect(vexKey(spell(70, { keyTonic: 65 }))).toBe('bb/4')
    expect(vexKey(spell(66, { keyTonic: 67 }))).toBe('f#/4')
  })
})

describe('fretboard', () => {
  it('finds positions', () => {
    expect(positionsFor(64, GUITAR_STANDARD).map((p) => [p.string, p.fret])).toEqual([
      [2, 14],
      [3, 9],
      [4, 5],
      [5, 0],
    ])
    expect(positionsFor(28, BASS_STANDARD)).toEqual([{ string: 0, fret: 0, midi: 28 }])
  })
  it('fingers a melody in a compact window', () => {
    const melody = scaleNotes(48, 'major', true)
    const pos = fingerMelody(melody, GUITAR_STANDARD)
    expect(pos.every((p) => p !== null)).toBe(true)
    const frets = pos.map((p) => p!.fret)
    expect(Math.max(...frets) - Math.min(...frets)).toBeLessThanOrEqual(5)
  })
  it('chord shapes sound the right pitch classes', () => {
    const cases: Array<[number, string, string, number[]]> = [
      [0, '', 'C', [0, 4, 7]],
      [9, 'm', 'A', [9, 0, 4]],
      [5, '', 'F', [5, 9, 0]],
      [10, '', 'B♭', [10, 2, 5]],
      [6, 'm', 'F♯', [6, 9, 1]],
      [7, '7', 'G', [7, 11, 2, 5]],
      [2, '5', 'D', [2, 9]],
    ]
    for (const [pc, suffix, name, expected] of cases) {
      const shape = guitarChordShape(pc, suffix, name)!
      const pcs = new Set(shapeNotes(shape).map((m) => m % 12))
      for (const e of expected) expect(pcs.has(e)).toBe(true)
      for (const p of pcs) expect(expected).toContain(p)
    }
  })
})

describe('melody', () => {
  it('fills the requested length and ends on the tonic', () => {
    for (let s = 1; s <= 50; s++) {
      const m = generateMelody({ tonic: 60, scale: 'major', beats: 8, maxLeap: 3, eighths: true }, createRng(s))
      expect(melodyLength(m)).toBe(8)
      expect(m[m.length - 1]!.midi % 12).toBe(0)
      for (let i = 1; i < m.length; i++) expect(Math.abs(m[i]!.midi - m[i - 1]!.midi)).toBeLessThanOrEqual(9)
    }
  })
  it('stepwise melodies only move by scale steps', () => {
    const scale = new Set(scaleNotes(60, 'major', false).map((n) => n % 12))
    for (let s = 1; s <= 30; s++) {
      const m = generateMelody({ tonic: 60, scale: 'major', beats: 4, maxLeap: 1, eighths: false, noteCount: 6, startOnTonic: true }, createRng(s))
      expect(m[0]!.midi).toBe(60)
      for (const n of m) expect(scale.has(n.midi % 12)).toBe(true)
    }
  })
})
