import { describe, expect, it } from 'vitest'
import {
  DRUM,
  STYLES,
  applyStyle,
  arrangementEvents,
  ensureTracks,
  materialize,
  sectionDensity,
  setSection,
  toggleTrackNote,
  trackEvents,
  updateTrack,
  withTracks,
} from '@/music/arrangement'
import { addNote, emptyScore, setChord, slotPitchClasses, slotRomanLabel, slotSymbol, tonicAt, type Score } from '@/music/score'
import { diatonicSeventh } from '@/music/keys'
import { analyzeArrangement } from '@/analysis/arrangementRules'
import { analyzeScore } from '@/analysis/ruleEngine'
import { writeMidi } from '@/export/midi'
import { writeMusicXml } from '@/export/musicxml'
import { encodeWav } from '@/export/wav'
import { STAGES as STAGE_LIST, allLessons, lessonById } from '@/course/stages'
import { checkSong, scoreFromSpec } from '@/course/rules'
import type { SongCreationSpec } from '@/course/types'

function song(): Score {
  let s = emptyScore({ bars: 8, accompaniment: { comp: 'block', bass: 'roots', drums: 'pop' } })
  const romans = ['I', 'V', 'vi', 'IV', 'I', 'V', 'IV', 'I'] as const
  romans.forEach((r, i) => (s = setChord(s, { start: i * 4, beats: 4, roman: r })))
  for (let b = 0; b < 8; b++) s = addNote(s, { start: b * 4, beats: 2, midi: b < 4 ? 64 : 72, lyric: '啦' })
  s = setSection(s, { start: 0, bars: 4, label: 'verse', energy: 1 })
  s = setSection(s, { start: 4, bars: 4, label: 'chorus', energy: 3 })
  return withTracks(s)
}

describe('chord colour and key changes', () => {
  it('slots carry quality, bass and transposition', () => {
    let s = emptyScore({ bars: 2 })
    s = setChord(s, { start: 0, beats: 4, roman: 'V', quality: 'dom7' })
    s = setChord(s, { start: 4, beats: 4, roman: 'I', bass: 1 })
    expect(slotSymbol(s, s.chords[0]!)).toBe('G7')
    expect(slotRomanLabel(s, s.chords[0]!)).toBe('V7')
    expect(slotSymbol(s, s.chords[1]!)).toBe('C/E')
    expect(slotRomanLabel(s, s.chords[1]!)).toBe('I/3')
    expect(slotPitchClasses(s, s.chords[0]!)).toEqual([7, 11, 2, 5])
    const up = setSection(s, { start: 1, bars: 1, label: 'chorus', energy: 3, transpose: 2 })
    expect(tonicAt(up, 5)).toBe(62)
    expect(slotSymbol(up, up.chords[1]!)).toBe('D/F♯')
  })
  it('diatonic sevenths', () => {
    expect(diatonicSeventh('I', 'major')).toBe('maj7')
    expect(diatonicSeventh('ii', 'major')).toBe('min7')
    expect(diatonicSeventh('V', 'major')).toBe('dom7')
    expect(diatonicSeventh('vii°', 'major')).toBe('m7b5')
  })
  it('rule engine uses colour tones: the 7th of G7 is a chord tone', () => {
    let s = emptyScore({ bars: 1 })
    s = setChord(s, { start: 0, beats: 4, roman: 'V', quality: 'dom7' })
    s = addNote(s, { start: 0, beats: 4, midi: 65 })
    expect(analyzeScore(s).notes[0]!.chordTone).toBe(true)
  })
})

describe('arrangement', () => {
  it('old scores get four tracks from their accompaniment settings', () => {
    const tracks = ensureTracks(emptyScore({ accompaniment: { comp: 'arpeggio', bass: 'fifths', drums: 'off' } }))
    expect(tracks.map((t) => t.kind)).toEqual(['keys', 'guitar', 'bass', 'drums'])
    expect(tracks.find((t) => t.kind === 'drums')!.mute).toBe(true)
    expect(tracks.find((t) => t.kind === 'keys')!.pattern).toBe('arpeggio')
  })
  it('energy changes density: chorus is fuller than verse', () => {
    const s = song()
    const d = sectionDensity(s)
    expect(d[1]!.density).toBeGreaterThan(d[0]!.density * 1.5)
    const crash = arrangementEvents(s).filter((e) => e.midi === DRUM.crash)
    expect(crash.map((e) => e.start)).toEqual([16])
  })
  it('sections can silence tracks', () => {
    let s = song()
    s = setSection(s, { start: 0, bars: 4, label: 'verse', energy: 1, off: ['drums'] })
    const drums = ensureTracks(s).find((t) => t.kind === 'drums')!
    expect(trackEvents(s, drums).every((e) => e.start >= 16)).toBe(true)
  })
  it('mute and solo', () => {
    let s = song()
    const bass = ensureTracks(s).find((t) => t.kind === 'bass')!
    s = updateTrack(s, bass.id, { solo: true })
    const ev = arrangementEvents(s)
    expect(new Set(ev.map((e) => e.track))).toEqual(new Set([bass.id]))
  })
  it('styles set patterns, tempo and energies', () => {
    const s = applyStyle(song(), STYLES.find((x) => x.id === 'rock')!)
    expect(s.bpm).toBe(120)
    expect(ensureTracks(s).find((t) => t.kind === 'guitar')!.pattern).toBe('power8')
    expect(ensureTracks(s).find((t) => t.kind === 'keys')!.mute).toBe(true)
  })
  it('materialize freezes auto parts and toggling edits them', () => {
    let s = song()
    const keys = ensureTracks(s).find((t) => t.kind === 'keys')!
    const frozen = materialize(s, keys)
    expect(frozen.source).toBe('manual')
    expect(frozen.notes.length).toBeGreaterThan(0)
    s = updateTrack(s, keys.id, frozen)
    const before = trackEvents(s, ensureTracks(s).find((t) => t.id === keys.id)!).length
    s = toggleTrackNote(s, keys.id, { start: 0.5, beats: 0.5, midi: 84 })
    expect(trackEvents(s, ensureTracks(s).find((t) => t.id === keys.id)!).length).toBe(before + 1)
    s = toggleTrackNote(s, keys.id, { start: 0.5, beats: 0.5, midi: 84 })
    expect(trackEvents(s, ensureTracks(s).find((t) => t.id === keys.id)!).length).toBe(before)
  })
  it('walking bass approaches the next root by a semitone', () => {
    let s = song()
    const bass = ensureTracks(s).find((t) => t.kind === 'bass')!
    s = updateTrack(s, bass.id, { pattern: 'walking' })
    s = { ...s, sections: [] }
    const ev = trackEvents(s, ensureTracks(s).find((t) => t.id === bass.id)!)
    const lastOfBar1 = ev.filter((e) => e.start < 4).pop()!
    const firstOfBar2 = ev.find((e) => e.start >= 4)!
    expect(Math.abs(firstOfBar2.midi - lastOfBar1.midi)).toBe(1)
  })
})

describe('arrangement rules', () => {
  it('praises bass/kick lock and contrast; flags a weak chorus', () => {
    const s = song()
    const f = analyzeArrangement(s)
    expect(f.find((x) => x.id === 'contrast')!.severity).toBe('good')
    expect(f.find((x) => x.id === 'tracks')!.severity).toBe('good')
    const flat = { ...s, sections: s.sections!.map((x) => ({ ...x, energy: 2 as const })) }
    expect(analyzeArrangement(flat).find((x) => x.id === 'contrast')!.severity).toBe('warn')
  })
  it('flags bass notes out of range', () => {
    let s = song()
    const bass = ensureTracks(s).find((t) => t.kind === 'bass')!
    s = updateTrack(s, bass.id, { source: 'manual', notes: [{ start: 0, beats: 1, midi: 72 }] })
    expect(analyzeArrangement(s).some((x) => x.id === `range-${bass.id}`)).toBe(true)
  })
})

describe('export', () => {
  it('writes a valid format-1 MIDI file with one track per part', () => {
    const bytes = writeMidi(song(), 'Test')
    const text = (i: number, n: number) => String.fromCharCode(...bytes.slice(i, i + n))
    expect(text(0, 4)).toBe('MThd')
    expect((bytes[8]! << 8) | bytes[9]!).toBe(1)
    const ntrks = (bytes[10]! << 8) | bytes[11]!
    // conductor + melody + 3 audible tracks (guitar is muted by default from block comp)
    expect(ntrks).toBe(5)
    let count = 0
    for (let i = 0; i < bytes.length - 3; i++) if (text(i, 4) === 'MTrk') count++
    expect(count).toBe(ntrks)
    // Drum notes go out on channel 10 (0x99).
    expect(bytes.includes(0x99)).toBe(true)
  })
  it('writes MusicXML with harmony, lyrics and a bass part', () => {
    const xml = writeMusicXml(song(), 'Test & Co')
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    expect(doc.getElementsByTagName('parsererror')).toHaveLength(0)
    expect(doc.getElementsByTagName('part')).toHaveLength(2)
    expect(doc.getElementsByTagName('measure').length).toBe(16)
    expect(doc.getElementsByTagName('harmony').length).toBe(8)
    expect(doc.getElementsByTagName('lyric').length).toBe(8)
    expect(xml).toContain('Test &amp; Co')
    // Every measure of the melody sums to 4 beats (16 divisions).
    const p1 = doc.getElementsByTagName('part')[0]!
    for (const m of Array.from(p1.getElementsByTagName('measure'))) {
      const total = Array.from(m.getElementsByTagName('duration')).reduce((t, d) => t + Number(d.textContent), 0)
      expect(total).toBe(16)
    }
  })
  it('encodes WAV headers and samples', () => {
    const wav = encodeWav([new Float32Array([0, 1, -1]), new Float32Array([0.5, 0, 0])], 44100)
    const v = new DataView(wav.buffer)
    expect(String.fromCharCode(...wav.slice(0, 4))).toBe('RIFF')
    expect(String.fromCharCode(...wav.slice(8, 12))).toBe('WAVE')
    expect(v.getUint16(22, true)).toBe(2)
    expect(v.getUint32(24, true)).toBe(44100)
    expect(v.getUint32(40, true)).toBe(12)
    expect(v.getInt16(46, true)).toBe(Math.round(0.5 * 0x7fff - 0.5) + 0 || 16383)
    expect(v.getInt16(48, true)).toBe(0x7fff)
    expect(v.getInt16(52, true)).toBe(-0x8000)
  })
})

describe('stage 4–5 lessons', () => {
  const advanced = allLessons().filter((l) => l.stage >= 4)
  it('22 lessons are released', () => {
    expect(advanced.filter((l) => l.stage === 4)).toHaveLength(10)
    expect(advanced.filter((l) => l.stage === 5)).toHaveLength(12)
    expect(STAGE_LIST.every((s) => !s.releasedIn)).toBe(true)
  })
  it('no creation passes untouched', () => {
    for (const l of advanced) {
      const spec = l.creation as SongCreationSpec
      expect(checkSong(spec, scoreFromSpec(spec)).ok, l.id).toBe(false)
    }
  })
  it('borrowed, secondary, colour, slash and key-change rules', () => {
    const spec = lessonById('L4-1')!.creation as SongCreationSpec
    const plain = { ...scoreFromSpec(spec), chords: spec.exampleChords!.map((c) => (c.roman === 'bVII' ? { ...c, roman: 'V' as const } : c)) }
    expect(checkSong(spec, plain).problems.some((p) => p.includes('借用和弦'))).toBe(true)
    const colour = lessonById('L4-6')!.creation as SongCreationSpec
    const triads = { ...scoreFromSpec(colour), chords: colour.exampleChords!.map(({ quality: _q, ...c }) => c) }
    expect(checkSong(colour, triads).problems.some((p) => p.includes('大七'))).toBe(true)
    const mod = lessonById('L4-9')!.creation as SongCreationSpec
    const noKeyChange = { ...scoreFromSpec(mod), chords: mod.exampleChords! }
    expect(checkSong(mod, noKeyChange).problems.some((p) => p.includes('转调'))).toBe(true)
  })
  it('arrangement rules: voices, pan and manual tracks', () => {
    const band = lessonById('L5-1')!.creation as SongCreationSpec
    expect(checkSong(band, scoreFromSpec(band)).problems.some((p) => p.includes('声部'))).toBe(true)
    const pan = lessonById('L5-11')!.creation as SongCreationSpec
    expect(checkSong(pan, scoreFromSpec(pan)).problems.some((p) => p.includes('声像'))).toBe(true)
    const final = lessonById('L5-12')!.creation as SongCreationSpec
    const auto = applyStyle(scoreFromSpec(final), STYLES.find((x) => x.id === 'pop')!)
    expect(checkSong(final, { ...auto, sections: final.exampleSections! }).problems.some((p) => p.includes('手写'))).toBe(true)
  })
})

describe('file names', () => {
  it('strips path separators on every platform', async () => {
    const { safeFileName } = await import('@/export/download')
    expect(safeFileName('a\\b/c:d')).toBe('a_b_c_d')
    expect(safeFileName('   ')).toBe('groovelab')
  })
})

describe('borrowed chord spelling', () => {
  it('spells flat roots as flats', () => {
    const s = emptyScore({ bars: 1 })
    expect(slotSymbol(s, { start: 0, roman: 'bVII' })).toBe('B♭')
    expect(slotSymbol(s, { start: 0, roman: 'bVI' })).toBe('A♭')
    expect(slotSymbol({ ...s, keyTonic: 64 }, { start: 0, roman: 'bVII' })).toBe('D')
    expect(slotSymbol(s, { start: 0, roman: 'II' })).toBe('D')
  })
})
