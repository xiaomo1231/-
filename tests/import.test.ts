import { describe, expect, it } from 'vitest'
import { chordToRoman, guessKey, parseChord } from '@/import/chordSymbols'
import { chartBars, chordChartToScore } from '@/import/chordChart'
import { guessMelodyTrack, midiToScore, parseMidi, ImportError } from '@/import/midiImport'
import { musicXmlParts, musicXmlToScore } from '@/import/musicxmlImport'
import { parseAsciiTab } from '@/import/asciiTab'
import { unzipMusicXml } from '@/import/unzip'
import { writeMidi } from '@/export/midi'
import { writeMusicXml } from '@/export/musicxml'
import { addNote, emptyScore, setChord, slotSymbol, type Score } from '@/music/score'
import { withTracks } from '@/music/arrangement'

function song(): Score {
  let s = emptyScore({ bars: 4, bpm: 96 })
  ;(['I', 'V', 'vi', 'IV'] as const).forEach((r, i) => (s = setChord(s, { start: i * 4, beats: 4, roman: r })))
  const mel: Array<[number, number, number]> = [
    [0, 1, 64], [1, 1, 67], [2, 2, 72],
    [4, 0.5, 71], [4.5, 0.5, 67], [5, 1, 62], [6, 2, 67],
    [8, 1, 69], [9, 1, 72], [10, 2, 76],
    [12, 1, 65], [13, 1, 69], [14, 2, 72],
  ]
  for (const [start, beats, midi] of mel) s = addNote(s, { start, beats, midi, lyric: '啦' })
  return withTracks(s)
}

describe('chord symbols', () => {
  it('parses qualities, accidentals and slash basses', () => {
    expect(parseChord('Am7')).toMatchObject({ rootPc: 9, quality: 'min7' })
    expect(parseChord('Bbmaj7')).toMatchObject({ rootPc: 10, quality: 'maj7' })
    expect(parseChord('F#m')).toMatchObject({ rootPc: 6, quality: 'min' })
    expect(parseChord('G/B')).toMatchObject({ rootPc: 7, bassPc: 11 })
    expect(parseChord('Dsus4')!.quality).toBe('sus4')
    expect(parseChord('E5')!.quality).toBe('power')
    expect(parseChord('歌词')).toBeNull()
  })
  it('maps to romans with colour overrides and inversions', () => {
    expect(chordToRoman(parseChord('Am')!, 0, 'major')).toEqual({ roman: 'vi' })
    expect(chordToRoman(parseChord('A')!, 0, 'major')).toEqual({ roman: 'vi', quality: 'maj' })
    expect(chordToRoman(parseChord('G7')!, 0, 'major')).toEqual({ roman: 'V', quality: 'dom7' })
    expect(chordToRoman(parseChord('G/B')!, 0, 'major')).toEqual({ roman: 'V', bass: 1 })
    expect(chordToRoman(parseChord('Bb')!, 0, 'major')).toEqual({ roman: 'bVII' })
    expect(chordToRoman(parseChord('F#')!, 0, 'major')).toBeNull()
    expect(chordToRoman(parseChord('E')!, 9, 'minor')).toEqual({ roman: 'V' })
  })
  it('guesses the key of a progression', () => {
    expect(guessKey(['G', 'D', 'Em', 'C'].map((c) => parseChord(c)!))).toEqual({ tonicPc: 7, mode: 'major' })
    expect(guessKey(['Am', 'F', 'C', 'G', 'Am'].map((c) => parseChord(c)!))).toEqual({ tonicPc: 9, mode: 'minor' })
  })
})

describe('chord charts', () => {
  it('reads bars, shared bars, inline brackets and skips labels', () => {
    expect(chartBars('主歌:\n| C | G | Am F | G |').bars).toEqual([['C'], ['G'], ['Am', 'F'], ['G']])
    expect(chartBars('C G Am F').bars).toEqual([['C'], ['G'], ['Am'], ['F']])
    const inline = chartBars('[C]我们一起[G]唱歌\n[Am]今天天气[F]很好')
    expect(inline.bars).toEqual([['C'], ['G'], ['Am'], ['F']])
  })
  it('builds a score in the guessed key', () => {
    const r = chordChartToScore('| G | D | Em | C |\n| G | D | C | C D |')
    expect(r.key).toEqual({ tonicPc: 7, mode: 'major' })
    expect(r.score.bars).toBe(8)
    expect(r.score.chords.map((c) => slotSymbol(r.score, c))).toEqual(['G', 'D', 'Em', 'C', 'G', 'D', 'C', 'C', 'D'])
    expect(r.score.chords.slice(-2).map((c) => c.beats)).toEqual([2, 2])
    expect(r.unsupported).toEqual([])
  })
  it('reports chords it cannot place', () => {
    expect(chordChartToScore('C F# G C', { key: { tonicPc: 0, mode: 'major' } }).unsupported).toEqual(['F#'])
  })
})

describe('MIDI import', () => {
  it('round-trips the site\'s own export: melody, tempo and chords', () => {
    const original = song()
    const f = parseMidi(writeMidi(original, 'Test'))
    expect(f.tempo).toBe(96)
    const track = guessMelodyTrack(f)
    const { score, warnings } = midiToScore(f, track)
    expect(score.bars).toBe(4)
    expect(score.melody.map((n) => [n.start, n.beats, n.midi])).toEqual(original.melody.map((n) => [n.start, n.beats, n.midi]))
    expect(score.chords.map((c) => slotSymbol(score, c))).toEqual(['C', 'G', 'Am', 'F'])
    expect(warnings).toEqual([])
  })
  it('rejects files that are not MIDI', () => {
    expect(() => parseMidi(new TextEncoder().encode('hello world, not midi'))).toThrow(ImportError)
  })
})

describe('MusicXML import', () => {
  it('round-trips the site\'s own export: melody, lyrics, key and chord symbols', () => {
    const original = song()
    const xml = writeMusicXml(original, '测试曲')
    expect(musicXmlParts(xml).length).toBeGreaterThanOrEqual(1)
    const { score, title, warnings } = musicXmlToScore(xml)
    expect(title).toBe('测试曲')
    expect(score.melody.map((n) => [n.start, n.beats, n.midi])).toEqual(original.melody.map((n) => [n.start, n.beats, n.midi]))
    expect(score.melody[0]!.lyric).toBe('啦')
    expect(score.chords.map((c) => slotSymbol(score, c))).toEqual(['C', 'G', 'Am', 'F'])
    expect(warnings).toEqual([])
  })
  it('merges tied notes and reads compressed .mxl', async () => {
    const xml = `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Melody</part-name></score-part></part-list>
<part id="P1"><measure number="1"><attributes><divisions>2</divisions><key><fifths>1</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
<note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice></note>
<note><pitch><step>A</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><tie type="start"/></note></measure>
<measure number="2"><note><pitch><step>A</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><tie type="stop"/></note>
<note><rest/><duration>6</duration><voice>1</voice></note></measure></part></score-partwise>`
    const { score, warnings } = musicXmlToScore(xml)
    expect(score.keyTonic % 12).toBe(7)
    expect(score.melody.map((n) => [n.start, n.beats, n.midi])).toEqual([[0, 2, 67], [2, 2, 69]])
    expect(warnings.some((w) => w.includes('跨过小节线'))).toBe(true)
    // Build a stored (uncompressed) zip around the XML and read it back.
    const enc = new TextEncoder()
    const name = enc.encode('score.xml')
    const data = enc.encode(xml)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint32(20, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, 0, true)
    central.set(name, 46)
    const eocd = new Uint8Array(22)
    const ev = new DataView(eocd.buffer)
    ev.setUint32(0, 0x06054b50, true)
    ev.setUint16(10, 1, true)
    ev.setUint32(16, local.length + data.length, true)
    const zip = new Uint8Array([...local, ...data, ...central, ...eocd])
    expect(await unzipMusicXml(zip)).toBe(xml)
  })
  it('explains unsupported files', () => {
    expect(() => musicXmlToScore('<html/>')).toThrow(/不是 MusicXML/)
  })
})

describe('ASCII tab import', () => {
  const tab = `e|-------5-8-|
B|---5-8-----|
G|-5---------|
D|-----------|
A|-----------|
E|-----------|`
  it('reads frets, strings and spacing', () => {
    const { notes } = parseAsciiTab(tab)
    expect(notes.map((n) => [n.string, n.fret])).toEqual([[3, 5], [4, 5], [4, 8], [5, 5], [5, 8]])
    expect(notes.slice(0, 4).every((n) => n.beats === 0.5)).toBe(true)
  })
  it('reads techniques and two-digit frets', () => {
    const t = `e|--12b-10p8~--|
B|-------------|
G|-------------|
D|-------------|
A|-------------|
E|-------------|`
    const { notes } = parseAsciiTab(t)
    expect(notes.map((n) => [n.fret, n.tech])).toEqual([[12, 'bend'], [10, 'pull'], [8, 'vibrato']])
  })
  it('rejects text without a tab', () => {
    expect(() => parseAsciiTab('just some words')).toThrow(ImportError)
  })
})
