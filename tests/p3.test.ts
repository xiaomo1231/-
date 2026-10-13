import { describe, expect, it } from 'vitest'
import {
  addNote,
  applyLyrics,
  chordAt,
  chordSymbolFor,
  emptyScore,
  noteAt,
  removeNoteAt,
  resizeScore,
  scoreEvents,
  scoreFromCells,
  setChord,
  signatureTonicOf,
  transposeScore,
  type Score,
} from '@/music/score'
import { jianpuDegree, layoutJianpu, referenceTonic } from '@/music/jianpu'
import { analyzeScore, estimateKey } from '@/analysis/ruleEngine'
import { accompanimentEvents } from '@/music/accompaniment'

const melody = (s: Score, notes: Array<[number, number, number]>) => notes.reduce((acc, [start, beats, midi]) => addNote(acc, { start, beats, midi }), s)

describe('score model', () => {
  it('adds notes, trims at the bar line and replaces overlaps', () => {
    let s = emptyScore({ bars: 2 })
    s = addNote(s, { start: 3, beats: 2, midi: 60 })
    expect(s.melody).toEqual([{ start: 3, beats: 1, midi: 60 }])
    s = addNote(s, { start: 0, beats: 2, midi: 62 })
    s = addNote(s, { start: 1, beats: 1, midi: 64 })
    expect(s.melody.map((n) => [n.start, n.midi])).toEqual([
      [1, 64],
      [3, 60],
    ])
    expect(noteAt(s, 1.5)?.midi).toBe(64)
    s = removeNoteAt(s, 1)
    expect(s.melody).toHaveLength(1)
  })

  it('sets and clears chords, resizes and transposes', () => {
    let s = emptyScore({ bars: 4 })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    s = setChord(s, { start: 4, beats: 4, roman: 'V' })
    expect(chordAt(s, 5)?.roman).toBe('V')
    s = setChord(s, { start: 4, beats: 4, roman: null })
    expect(s.chords).toHaveLength(1)
    s = melody(s, [[0, 1, 60], [12, 2, 67]])
    s = resizeScore(s, 2)
    expect(s.melody).toHaveLength(1)
    const t = transposeScore(s, 62)
    expect(t.melody[0]!.midi).toBe(62)
    expect(chordSymbolFor(t, 'V')).toBe('A')
  })

  it('chord symbols follow the key and mode', () => {
    expect(chordSymbolFor(emptyScore({ keyTonic: 57, mode: 'minor' }), 'iv')).toBe('Dm')
    expect(chordSymbolFor(emptyScore({ keyTonic: 65 }), 'IV')).toBe('B♭')
    expect(signatureTonicOf({ keyTonic: 57, mode: 'minor' })).toBe(60)
  })

  it('events fill every bar exactly with drawable durations and never cross bars', () => {
    let s = emptyScore({ bars: 3 })
    s = melody(s, [[0.5, 0.5, 60], [1, 1.5, 62], [3, 1, 64], [5, 0.5, 65], [8, 4, 60]])
    const ev = scoreEvents(s)
    const drawable = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25]
    let t = 0
    for (const e of ev) {
      expect(e.start).toBeCloseTo(t)
      expect(drawable).toContain(e.beats)
      expect(Math.floor(e.start / 4 + 1e-6)).toBe(Math.floor((e.start + e.beats - 1e-6) / 4))
      t += e.beats
    }
    expect(t).toBeCloseTo(12)
    // Notes keep their identity.
    expect(ev.filter((e) => e.midi !== null)).toHaveLength(5)
  })

  it('lyrics are spread over the notes', () => {
    let s = melody(emptyScore(), [[0, 1, 60], [1, 1, 62], [2, 1, 64]])
    s = applyLyrics(s, '你 好')
    expect(s.melody.map((n) => n.lyric)).toEqual(['你', '好', undefined])
    expect(scoreEvents(s).find((e) => e.midi === 60)?.lyric).toBe('你')
  })

  it('old quarter-cell creations convert', () => {
    const s = scoreFromCells([60, null, 64, 67], { tonic: 60, mode: 'major', bpm: 90 })
    expect(s.melody.map((n) => n.start)).toEqual([0, 2, 3])
    expect(s.bars).toBe(1)
  })
})

describe('jianpu', () => {
  it('maps degrees and octaves movable-do', () => {
    expect(jianpuDegree(60, 60)).toEqual({ digit: '1', accidental: '', octave: 0 })
    expect(jianpuDegree(72, 60)).toEqual({ digit: '1', accidental: '', octave: 1 })
    expect(jianpuDegree(59, 60)).toEqual({ digit: '7', accidental: '', octave: -1 })
    expect(jianpuDegree(66, 60)).toEqual({ digit: '4', accidental: '#', octave: 0 })
    expect(jianpuDegree(70, 60)).toEqual({ digit: '7', accidental: 'b', octave: 0 })
  })
  it('chooses the middle-register 1 from the melody', () => {
    expect(referenceTonic([60, 62, 64, 65, 67], 60)).toBe(60)
    expect(referenceTonic([48, 50, 52], 60)).toBe(48)
    // A minor reads with 1 = C, so A is 6.
    expect(jianpuDegree(57, referenceTonic([57, 60, 64], 60))).toMatchObject({ digit: '6' })
  })
  it('lays out dashes, rests, underlines and beams', () => {
    let s = emptyScore({ bars: 1 })
    s = melody(s, [[0, 2, 60], [2, 0.5, 62], [2.5, 0.5, 64]])
    const lines = layoutJianpu(scoreEvents(s), 60, 1, [{ start: 0, text: 'C' }])
    expect(lines).toHaveLength(1)
    const t = lines[0]!.tokens
    expect(t.filter((x) => x.kind === 'dash')).toHaveLength(1)
    expect(t.filter((x) => x.kind === 'rest')).toHaveLength(1)
    expect(t.filter((x) => x.lines === 1)).toHaveLength(2)
    expect(lines[0]!.beams).toHaveLength(1)
    expect(lines[0]!.chords[0]!.text).toBe('C')
  })
  it('wraps four bars per line', () => {
    const s = emptyScore({ bars: 6 })
    expect(layoutJianpu(scoreEvents(s), 60, 6)).toHaveLength(2)
  })
})

describe('rule engine', () => {
  const base = () => {
    let s = emptyScore({ bars: 2 })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    s = setChord(s, { start: 4, beats: 2, roman: 'V' })
    s = setChord(s, { start: 6, beats: 2, roman: 'I' })
    return s
  }
  it('classifies chord tones and passing tones and praises a tonic ending', () => {
    const s = melody(base(), [[0, 1, 60], [1, 1, 62], [2, 1, 64], [3, 1, 67], [4, 1, 67], [5, 1, 65], [6, 2, 60]])
    const a = analyzeScore(s)
    expect(a.notes.find((n) => s.melody[n.index]!.midi === 62)?.nct).toBe('passing')
    expect(a.findings.some((f) => f.id === 'end-tonic' && f.severity === 'good')).toBe(true)
    expect(a.cadence).toContain('正格')
  })
  it('flags unresolved non-chord tones, big leaps and an open ending', () => {
    const s = melody(base(), [[0, 1, 60], [1, 1, 66], [2, 1, 79], [3, 1, 60], [4, 2, 62]])
    const a = analyzeScore(s)
    expect(a.findings.some((f) => f.id.startsWith('nct-'))).toBe(true)
    expect(a.findings.some((f) => f.id.startsWith('bigleap'))).toBe(true)
    expect(a.findings.find((f) => f.id === 'end-tonic')?.severity).toBe('warn')
    expect(a.findings[0]!.severity).toBe('warn')
  })
  it('reports parallel fifths with the bass and empty chord bars', () => {
    let s = emptyScore({ bars: 3 })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    s = setChord(s, { start: 4, beats: 4, roman: 'ii' })
    s = melody(s, [[3, 1, 67], [4, 1, 69]])
    const a = analyzeScore(s)
    expect(a.findings.some((f) => f.id.startsWith('parallel'))).toBe(true)
    expect(a.findings.some((f) => f.id === 'nochord-2')).toBe(true)
  })
  it('estimates the key', () => {
    let s = emptyScore({ bars: 2 })
    s = melody(s, [[0, 1, 67], [1, 1, 71], [2, 1, 74], [3, 1, 66], [4, 1, 67], [5, 1, 62], [6, 2, 67]])
    const k = estimateKey(s.melody)!
    expect(k.tonicPc).toBe(7)
    expect(k.mode).toBe('major')
  })
})

describe('accompaniment', () => {
  it('generates comping, bass and drums from the chord track', () => {
    let s = emptyScore({ bars: 2, accompaniment: { comp: 'block', bass: 'fifths', drums: 'rock' } })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    s = setChord(s, { start: 4, beats: 4, roman: 'IV' })
    const ev = accompanimentEvents(s)
    expect(ev.filter((e) => e.part === 'comp')).toHaveLength(12)
    const bass = ev.filter((e) => e.part === 'bass')
    expect(bass).toHaveLength(8)
    expect(bass[1]!.midi - bass[0]!.midi).toBe(7)
    expect(ev.filter((e) => e.part === 'snare')).toHaveLength(4)
    expect(ev.filter((e) => e.part === 'hat')).toHaveLength(16)
    for (const e of bass) expect(e.midi).toBeLessThan(55)
  })
  it('turns off parts', () => {
    let s = emptyScore({ bars: 1, accompaniment: { comp: 'off', bass: 'off', drums: 'off' } })
    s = setChord(s, { start: 0, beats: 4, roman: 'I' })
    expect(accompanimentEvents(s)).toHaveLength(0)
  })
})
