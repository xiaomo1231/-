import { describe, expect, it } from 'vitest'
import { chromaFromSpectrum, hintAgrees, matchChord } from '@/audio/chroma'
import { analyzeBend, analyzeVibrato, bendFeedback, vibratoFeedback, type PitchPoint } from '@/guitar/technique'
import { LICKS, PLAY_PASS, noteQuiz, pentatonicBox, playNotes, tabMidi, upAndDown } from '@/guitar/scales'
import { judgeTake, songStrums, songSubScores, strumPattern, totalBars } from '@/guitar/strum'
import { ALL_UNITS, LEAD_UNITS, RHYTHM_UNITS, parseChordSymbol } from '@/guitar/units'
import { GUITAR_STANDARD, guitarChordShape } from '@/music/fretboard'
import { chordSymbolFor } from '@/music/score'
import type { RomanId } from '@/music/keys'

const SR = 48000
const FFT = 16384
const STD = GUITAR_STANDARD.strings

/** Fake analyser output: peaks at each note's partials, a low floor elsewhere. */
function spectrum(midis: number[], partials = 6): Float32Array {
  const db = new Float32Array(FFT / 2).fill(-110)
  const binHz = SR / FFT
  for (const m of midis) {
    const f0 = 440 * Math.pow(2, (m - 69) / 12)
    for (let h = 1; h <= partials; h++) {
      const k = Math.round((f0 * h) / binHz)
      if (k < db.length - 1) {
        db[k] = Math.max(db[k]!, -20 - 6 * (h - 1))
        db[k - 1] = Math.max(db[k - 1]!, -40 - 6 * (h - 1))
        db[k + 1] = Math.max(db[k + 1]!, -40 - 6 * (h - 1))
      }
    }
  }
  return db
}

describe('chord recognition hint', () => {
  const shapeMidis = (symbol: string) => {
    const { rootPc, suffix, rootName } = parseChordSymbol(symbol)
    const shape = guitarChordShape(rootPc, suffix, rootName)!
    return shape.frets.flatMap((f, s) => (f === null ? [] : [STD[s]! + f]))
  }
  it('recognises open and barre chords from their partials', () => {
    for (const sym of ['G', 'C', 'D', 'Em', 'Am', 'E', 'A', 'F', 'Bm']) {
      const hint = matchChord(chromaFromSpectrum(spectrum(shapeMidis(sym)), SR, FFT))!
      expect(hintAgrees(hint, parseChordSymbol(sym)), `${sym} → ${hint.label}`).toBe(true)
    }
  })
  it('power chords match either family, silence gives nothing', () => {
    const hint = matchChord(chromaFromSpectrum(spectrum(shapeMidis('E5')), SR, FFT))!
    expect(hint.rootPc).toBe(4)
    expect(hintAgrees({ rootPc: 4, quality: 'maj' }, parseChordSymbol('E5'))).toBe(true)
    expect(hintAgrees({ rootPc: 4, quality: 'min' }, parseChordSymbol('E'))).toBe(false)
    expect(matchChord(chromaFromSpectrum(new Float32Array(FFT / 2).fill(-120), SR, FFT))).toBeNull()
  })
})

const track = (fn: (t: number) => number | null, seconds = 3, rate = 40): PitchPoint[] => Array.from({ length: seconds * rate }, (_, i) => ({ t: i / rate, midi: fn(i / rate) }))

describe('bend and vibrato analysis', () => {
  it('measures a good whole-tone bend', () => {
    const from = 62
    const pts = track((t) => (t < 0.3 ? null : t < 0.6 ? from : t < 0.9 ? from + ((t - 0.6) / 0.3) * 2 : from + 2.05))
    const r = analyzeBend(pts, from, from + 2)
    expect(r.ok).toBe(true)
    expect(Math.abs(r.errorCents!)).toBeLessThanOrEqual(10)
    expect(bendFeedback(r, 2)).toContain('准')
  })
  it('flags an under-bend and a missing start', () => {
    const under = analyzeBend(track((t) => (t < 0.5 ? 62 : 63.5)), 62, 64)
    expect(under.ok).toBe(false)
    expect(under.errorCents).toBeLessThan(-25)
    expect(bendFeedback(under, 2)).toContain('不够')
    expect(analyzeBend(track(() => 70), 62, 64).started).toBe(false)
  })
  it('measures vibrato depth and rate', () => {
    const good = analyzeVibrato(track((t) => 69 + 0.25 * Math.sin(2 * Math.PI * 5.5 * t)), 69)
    expect(good.ok).toBe(true)
    expect(good.rateHz).toBeGreaterThan(4.5)
    expect(good.rateHz).toBeLessThan(6.5)
    expect(good.depthCents).toBeGreaterThan(30)
    const flat = analyzeVibrato(track(() => 69.02), 69)
    expect(flat.ok).toBe(false)
    expect(vibratoFeedback(flat)).toContain('太小')
  })
})

describe('pentatonic boxes and licks', () => {
  it('box 1 and box 2 of A minor are the standard shapes', () => {
    const f = (p: number) => pentatonicBox(9, p, STD).map((n) => `${n.string}:${n.fret}`).join(' ')
    expect(f(1)).toBe('0:5 0:8 1:5 1:7 2:5 2:7 3:5 3:7 4:5 4:8 5:5 5:8')
    expect(f(2)).toBe('0:8 0:10 1:7 1:10 2:7 2:10 3:7 3:9 4:8 4:10 5:8 5:10')
    for (let p = 1; p <= 5; p++) {
      const box = pentatonicBox(9, p, STD)
      const span = Math.max(...box.map((n) => n.fret)) - Math.min(...box.map((n) => n.fret))
      expect(span).toBeLessThanOrEqual(4)
      expect(box.every((n) => [0, 3, 5, 7, 10].includes((tabMidi(n, STD) - 9 + 120) % 12))).toBe(true)
    }
    expect(upAndDown(pentatonicBox(9, 1, STD))).toHaveLength(23)
  })
  it('licks stay in A minor pentatonic box 1 and resolve somewhere sensible', () => {
    for (const l of LICKS) {
      for (const n of l.notes) {
        expect([0, 3, 5, 7, 10], `${l.id}`).toContain((tabMidi(n, STD) - 9 + 120) % 12)
        expect(n.fret).toBeGreaterThanOrEqual(5)
        expect(n.fret).toBeLessThanOrEqual(l.id.startsWith('legato') ? 10 : 8)
      }
      const beats = l.notes.reduce((s, n) => s + n.beats, 0)
      expect(beats % 1).toBe(0)
    }
    expect(PLAY_PASS).toBeGreaterThan(0.5)
  })
  it('note quizzes ask natural notes on the chosen strings', () => {
    const q = noteQuiz(12, STD, 42, [0, 1])
    expect(q).toHaveLength(12)
    for (const item of q) {
      expect([0, 1]).toContain(item.string)
      expect(item.midi).toBe(STD[item.string]! + item.fret)
      expect(item.name).not.toContain('#')
    }
    expect(noteQuiz(12, STD, 42, [0, 1])).toEqual(q)
  })
})

describe('songs and sub-scores', () => {
  const segs = [
    { pattern: 'folk', romans: ['I', 'V'], bars: 2 },
    { pattern: 'pop', romans: ['IV'], bars: 2 },
  ]
  it('lays out strums across sections and marks chord changes', () => {
    const s = songStrums(segs, 0, 0.5)
    expect(totalBars(segs)).toBe(4)
    expect(s.filter((x) => x.change).map((x) => x.bar)).toEqual([0, 1, 2])
    expect(s[0]!.time).toBe(0)
    expect(s.length).toBe(6 + 6 + 6 + 6)
  })
  it('scores off-beats and changes separately', () => {
    const s = songStrums(segs, 0, 0.5)
    const detected = s.filter((x) => Number.isInteger(x.beatInBar)).map((x) => x.time)
    const r = judgeTake(s.map((x) => x.time), detected)
    const sub = songSubScores(r, s)
    expect(sub.offbeat!.score).toBe(0)
    expect(sub.changes!.score).toBe(1)
  })
})

describe('G2 units', () => {
  it('all sixteen units are released', () => {
    expect([...RHYTHM_UNITS, ...LEAD_UNITS].every((u) => !u.comingIn && u.exercises.length > 0)).toBe(true)
  })
  it('every exercise is playable with standard tuning', () => {
    for (const u of ALL_UNITS.filter((x) => !x.comingIn)) {
      for (const ex of u.exercises) {
        if (ex.kind === 'chord-check' || ex.kind === 'change') {
          for (const c of ex.chords) {
            const { rootPc, suffix, rootName } = parseChordSymbol(c)
            expect(guitarChordShape(rootPc, suffix, rootName), `${ex.id} ${c}`).not.toBeNull()
          }
        }
        if (ex.kind === 'strum' || ex.kind === 'song') {
          const segments = ex.kind === 'strum' ? [{ pattern: ex.pattern, romans: ex.romans, bars: ex.bars }] : ex.segments
          for (const seg of segments) {
            expect(() => strumPattern(seg.pattern)).not.toThrow()
            for (const r of seg.romans) {
              const sym = chordSymbolFor({ keyTonic: ex.tonic, mode: 'major' }, r as RomanId)
              const { rootPc, suffix, rootName } = parseChordSymbol(sym)
              expect(guitarChordShape(rootPc, ex.kind === 'strum' && ex.chordSuffix ? ex.chordSuffix : suffix, rootName), `${ex.id} ${sym}`).not.toBeNull()
            }
          }
        }
        if (ex.kind === 'play') expect(playNotes(ex.source, STD).notes.length).toBeGreaterThan(4)
        if (ex.kind === 'bend' || ex.kind === 'vibrato') expect(ex.fret).toBeGreaterThan(0)
      }
    }
  })
})
