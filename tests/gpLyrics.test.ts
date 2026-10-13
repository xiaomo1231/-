import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as at from '@coderline/alphatab'
import { lyricsFromScore, lyricsFromSheet, NO_LYRICS_MESSAGE } from '@/import/gpLyrics'
import { EMPTY_SYNC, barTimeline, type SyncMap } from '@/songs/backingSync'
import { readSheetMeta } from '@/import/gpImport'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { SongService } from '@/services/songService'

/** Four quarter notes per bar at 120 bpm: beats at 0, 500, 1000, 1500 ms of each bar. */
function scoreWith(bars: Array<Array<string | null>>, opts: { sectionAt?: number } = {}) {
  const parts = bars.map((_, i) => (i === opts.sectionAt ? '\\section "Verse"\n' : '') + '0.1.4 0.1.4 0.1.4 0.1.4')
  const tex = `\\title "L" \\tempo 120\n` + parts.join(' |\n')
  const score = at.importer.ScoreLoader.loadAlphaTex(tex)
  bars.forEach((syllables, b) => {
    const beats = score.tracks[0]!.staves[0]!.bars[b]!.voices[0]!.beats
    syllables.forEach((text, k) => {
      if (text !== null) beats[k]!.lyrics = [text]
    })
  })
  return score
}

const lyricsOf = (score: ReturnType<typeof scoreWith>, sync: SyncMap = EMPTY_SYNC, track = 0) =>
  lyricsFromScore(score, barTimeline(score), sync, track)

// alphaTab is imported directly in tests (its script loader needs a browser).
vi.mock('@/audio/alphatabLoader', async () => ({ loadAlphaTab: async () => await import('@coderline/alphatab') }))

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`gplyr-${Date.now()}-${n++}`)))

describe('lyricsFromScore', () => {
  it('times each syllable from its beat (120 bpm: beat 2 at 500 ms, bar 2 at 2000 ms)', () => {
    const lines = lyricsOf(scoreWith([['a', 'b', 'c', 'd.'], ['e', null, null, null]]))
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [0, 'a b c d.'],
      [2000, 'e'],
    ])
    expect(lines[0]!.words).toEqual([
      { startMs: 0, text: 'a' },
      { startMs: 500, text: ' b' },
      { startMs: 1000, text: ' c' },
      { startMs: 1500, text: ' d.' },
    ])
  })

  it('joins hyphenated Latin syllables without a space and keeps the hyphen out of the text', () => {
    const [line] = lyricsOf(scoreWith([['Hel-', 'lo', 'world.', null]]))
    expect(line!.text).toBe('Hello world.')
    expect(line!.words!.map((w) => w.text)).toEqual(['Hel', 'lo', ' world.'])
  })

  it('joins CJK syllables without spaces', () => {
    const [line] = lyricsOf(scoreWith([['我', '们', '好。', null]]))
    expect(line!.text).toBe('我们好。')
  })

  it('starts a new line after a long gap', () => {
    const lines = lyricsOf(scoreWith([['a', null, null, null], ['b', null, null, null]]))
    expect(lines.map((l) => [l.startMs, l.text])).toEqual([
      [0, 'a'],
      [2000, 'b'],
    ])
  })

  it('starts a new line at a section marker even without a gap', () => {
    const lines = lyricsOf(scoreWith([['a', 'b', 'c', 'd'], ['e', null, null, null]], { sectionAt: 1 }))
    expect(lines.map((l) => l.text)).toEqual(['a b c d', 'e'])
  })

  it('applies the sync offset (constant)', () => {
    const lines = lyricsOf(scoreWith([['a', 'b', null, null]]), { offsetMs: 1000, points: [] })
    expect(lines[0]!.words!.map((w) => w.startMs)).toEqual([1000, 1500])
  })

  it('applies tapped sync points (linear between them)', () => {
    // Bar 0 at 0 ms in the score is at 0 ms in the recording; bar 1 (score 2000 ms) at 4000 ms: the ratio is 2.
    const sync: SyncMap = {
      offsetMs: 0,
      points: [
        { bar: 0, audioMs: 0 },
        { bar: 1, audioMs: 4000 },
      ],
    }
    const lines = lyricsOf(scoreWith([['a', 'b', null, null], ['c', null, null, null]]), sync)
    expect(lines[0]!.words!.map((w) => w.startMs)).toEqual([0, 1000])
    expect(lines[1]!.startMs).toBe(4000)
  })

  it('falls back to the first track with lyrics', () => {
    const tex = `\\title "L" \\tempo 120\n\\track "A"\n0.1.4 0.1.4 0.1.4 0.1.4\n\\track "B"\n0.1.4 0.1.4 0.1.4 0.1.4`
    const score = at.importer.ScoreLoader.loadAlphaTex(tex)
    score.tracks[1]!.staves[0]!.bars[0]!.voices[0]!.beats[0]!.lyrics = ['Hi']
    const tl = barTimeline(score)
    expect(lyricsFromScore(score, tl, EMPTY_SYNC, 0).map((l) => l.text)).toEqual(['Hi'])
    expect(lyricsFromScore(score, tl, EMPTY_SYNC, 9).map((l) => l.text)).toEqual(['Hi'])
  })

  it('returns [] when the score has no lyrics', () => {
    expect(lyricsOf(scoreWith([[null, null, null, null]]))).toEqual([])
  })
})

describe('lyricsFromSheet', () => {
  it('rejects a missing sheet', async () => {
    await expect(lyricsFromSheet('nope')).rejects.toThrow('找不到这份谱子。')
  })

  it('reads the lyrics of a saved Guitar Pro file and throws the Chinese message when there are none', async () => {
    const withLyrics = scoreWith([['Hel-', 'lo', 'world.', null]])
    const bytes = new at.exporter.Gp7Exporter().export(withLyrics)
    const loaded = at.importer.ScoreLoader.loadScoreFromBytes(bytes)
    const meta = readSheetMeta(loaded)
    const sheet = await SongService.save(
      { source: 'gp', format: 'gp', title: 'L', artist: meta.artist, tracks: meta.tracks, bars: meta.bars, warnings: [], file: { name: 'l.gp', bytes } },
      'L',
    )
    const lines = await lyricsFromSheet(sheet.id)
    expect(lines.map((l) => l.text)).toEqual(['Hello world.'])

    const plainBytes = new at.exporter.Gp7Exporter().export(scoreWith([[null, null, null, null]]))
    const plain = await SongService.save(
      { source: 'gp', format: 'gp', title: 'P', tracks: meta.tracks, bars: meta.bars, warnings: [], file: { name: 'p.gp', bytes: plainBytes } },
      'P',
    )
    await expect(lyricsFromSheet(plain.id)).rejects.toThrow(NO_LYRICS_MESSAGE)
  })
})
