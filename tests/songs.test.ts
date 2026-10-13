import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { JianpuError, parseJianpu } from '@/songs/jianpuParse'
import { LIBRARY, librarySongScore } from '@/songs/library'
import { melodyTab, strumChart } from '@/songs/practice'
import { SongService } from '@/services/songService'
import { chordChartToScore } from '@/import/chordChart'
import { GUITAR_STANDARD } from '@/music/fretboard'
import { chordSymbolFor, slotSymbol } from '@/music/score'
import { STRUM_PATTERNS } from '@/guitar/strum'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`songs-${Date.now()}-${n++}`)))

describe('jianpu parser', () => {
  it('reads steps, octaves, accidentals, durations, holds, rests and lyrics', () => {
    const notes = parseJianpu("1 2/ 3/ 5. 6/ | 1' - 0 b7,", 60, '一二三四五_六')
    expect(notes.map((x) => [x.start, x.beats, x.midi])).toEqual([
      [0, 1, 60],
      [1, 0.5, 62],
      [1.5, 0.5, 64],
      [2, 1.5, 67],
      [3.5, 0.5, 69],
      [4, 2, 72],
      [7, 1, 58],
    ])
    expect(notes.map((x) => x.lyric)).toEqual(['一', '二', '三', '四', '五', undefined, '六'])
  })
  it('rejects bars that do not add up', () => {
    expect(() => parseJianpu('1 2 3', 60)).toThrow(JianpuError)
    expect(() => parseJianpu('1 2 3 x', 60)).toThrow(/看不懂/)
  })
})

describe('built-in library', () => {
  it('every song parses, has one chord entry per bar and a known pattern', () => {
    const ids = new Set<string>()
    for (const s of LIBRARY) {
      expect(ids.has(s.id)).toBe(false)
      ids.add(s.id)
      const sc = librarySongScore(s)
      expect(sc.bars).toBe(s.chords.length)
      expect(sc.melody.length).toBeGreaterThan(4)
      expect(sc.melody.every((x) => Math.floor(x.start / 4) === Math.floor((x.start + x.beats - 1e-6) / 4))).toBe(true)
      for (const c of sc.chords) expect(() => slotSymbol(sc, c)).not.toThrow()
      expect(STRUM_PATTERNS.some((p) => p.id === s.pattern), s.id).toBe(true)
      if (s.lyrics) expect(sc.melody.filter((x) => x.lyric).length).toBe([...s.lyrics].filter((c) => c !== '_').length)
    }
    expect(LIBRARY.length).toBeGreaterThanOrEqual(15)
  })
})

describe('practice conversions', () => {
  it('strum charts take the beat-1 chord of each bar; minor songs move to the relative major', () => {
    const king = librarySongScore(LIBRARY.find((s) => s.id === 'mountain-king')!)
    const c = strumChart(king)!
    expect(c.romans.slice(0, 4).map((r) => chordSymbolFor({ keyTonic: c.tonic, mode: 'major' }, r))).toEqual(['Am', 'E', 'Am', 'C'])
    const twinkle = librarySongScore(LIBRARY.find((s) => s.id === 'twinkle')!)
    expect(strumChart(twinkle, 0, 4)!.romans).toEqual(['I', 'IV', 'IV', 'V'])
  })
  it('melody tabs land in the guitar range and keep the pitches', () => {
    const joy = librarySongScore(LIBRARY.find((s) => s.id === 'ode-to-joy')!)
    const { notes, shift } = melodyTab(joy, GUITAR_STANDARD, 0, 4)
    const src = joy.melody.filter((x) => x.start < 16)
    expect(notes).toHaveLength(src.length)
    notes.forEach((t, i) => expect(GUITAR_STANDARD.strings[t.string]! + t.fret).toBe(src[i]!.midi + shift))
    expect(Math.max(...notes.map((t) => t.fret)) - Math.min(...notes.map((t) => t.fret))).toBeLessThanOrEqual(5)
    expect(notes.reduce((s, t) => s + t.beats, 0)).toBe(16)
  })
})

describe('song sheets', () => {
  it('detects tabs and chord charts in pasted text and saves them', async () => {
    const tab = SongService.importText('e|---5-8---|\nB|-5-------|\nG|---------|\nD|---------|\nA|---------|\nE|---------|')
    expect(tab.source).toBe('tab')
    const chords = SongService.importText('主歌\n| G | D | Em | C |')
    expect(chords.source).toBe('chords')
    expect(chords.score!.chords.map((c) => slotSymbol(chords.score!, c))).toEqual(['G', 'D', 'Em', 'C'])
    expect(() => SongService.importText('只有歌词没有和弦')).toThrow(/没有认出/)
    const saved = await SongService.save(chords, '我的歌', { pattern: 'folk' })
    expect((await SongService.list()).map((s) => s.title)).toEqual(['我的歌'])
    expect((await SongService.get(saved.id))!.pattern).toBe('folk')
    await SongService.remove(saved.id)
    expect(await SongService.list()).toEqual([])
  })
  it('three chords in a bar share it 2 + 1 + 1', () => {
    const r = chordChartToScore('| C F G |', { key: { tonicPc: 0, mode: 'major' } })
    expect(r.score.chords.map((c) => [c.start, c.beats])).toEqual([[0, 2], [2, 1], [3, 1]])
  })
})
