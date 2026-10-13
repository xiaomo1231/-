import { beforeEach, describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { defaultTrack, formatFromName, instrumentOf, normalizeTitle, readSheetMeta, trackChordChart, trackToTab } from '@/import/gpImport'
import { matchTuning } from '@/songs/tuningMatch'
import { base64ToBytes, bytesToBase64 } from '@/shared/lib/base64'
import { GrooveLabDB, getDb, setDbForTests } from '@/infrastructure/db/database'
import { SongService } from '@/services/songService'

// A small two-track Guitar Pro 7 file, made with alphaTab's own exporter (no
// third-party content): Drop D lead with a bend, a chord, a rest, a tie,
// vibrato and a hammer-on; chord names; sections; a bass track.
const TEX = String.raw`\title "Probe" \artist "Band" \tab "Me" \tempo 120
\track "Lead"
\tuning (E4 B3 G3 D3 A2 D2)
\section "Intro"
3.3{b (0 4)}.4 (0.1 1.2).4 r.4 5.2{ch "Am"}.4 |
-.2.2 0.1{v}.4 2.3{h}.8 4.3.8 |
\section "Verse"
3.6{ch "C"}.1
\track "Bass"
\tuning (G2 D2 A1 E1)
3.4.1 | 5.3.1 | 0.2.1`

function gpFile(): Uint8Array {
  return new at.exporter.Gp7Exporter().export(at.importer.ScoreLoader.loadAlphaTex(TEX))
}
const load = () => at.importer.ScoreLoader.loadScoreFromBytes(gpFile())

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`gp-${Date.now()}-${n++}`)))

describe('Guitar Pro metadata', () => {
  it('public/alphatab matches the installed alphaTab (run scripts/copy-alphatab.mjs after upgrading)', () => {
    const root = path.resolve(__dirname, '..')
    const installed = JSON.parse(readFileSync(path.join(root, 'node_modules/@coderline/alphatab/package.json'), 'utf8')).version
    expect(readFileSync(path.join(root, 'public/alphatab/VERSION.txt'), 'utf8').trim()).toBe(installed)
  })
  it('reads title, singer, tabber, tempo, sections and tracks', () => {
    const meta = readSheetMeta(load())
    expect(meta).toMatchObject({ title: 'Probe', artist: 'Band', tabber: 'Me', bpm: 120, bars: 3 })
    expect(meta.sections).toEqual([
      { bar: 0, name: 'Intro' },
      { bar: 2, name: 'Verse' },
    ])
    expect(meta.tracks.map((t) => [t.name, t.instrument, t.tuning])).toEqual([
      ['Lead', 'guitar', [38, 45, 50, 55, 59, 64]],
      ['Bass', 'bass', [28, 33, 38, 43]],
    ])
    expect(defaultTrack(meta)).toBe(0)
  })
  it('classifies instruments from GM program and string count', () => {
    expect(instrumentOf(33, false, 4)).toBe('bass')
    expect(instrumentOf(29, false, 6)).toBe('guitar')
    expect(instrumentOf(0, true, 0)).toBe('drums')
    expect(instrumentOf(0, false, 0)).toBe('keys')
  })
  it('recognises file formats by extension', () => {
    expect(['a.gp3', 'a.GP5', 'a.gpx', 'a.gp', 'a.mxl', 'a.xml', 'a.mid', 'a.pdf'].map(formatFromName)).toEqual(['gp3', 'gp5', 'gpx', 'gp', 'mxl', 'musicxml', 'midi', null])
  })
})

describe('Guitar Pro → practice', () => {
  it('turns a track into a single-line tab: top note of chords, ties and rests merged, techniques kept', () => {
    const tab = trackToTab(load(), 0)
    expect(tab.notes).toEqual([
      { string: 3, fret: 3, beats: 1, tech: 'bend' },
      { string: 5, fret: 0, beats: 2 },
      { string: 4, fret: 5, beats: 3 },
      { string: 5, fret: 0, beats: 1, tech: 'vibrato' },
      { string: 3, fret: 2, beats: 0.5, tech: 'hammer' },
      { string: 3, fret: 4, beats: 0.5 },
      { string: 0, fret: 3, beats: 4 },
    ])
    expect(tab.tuning).toEqual([38, 45, 50, 55, 59, 64])
    expect(tab.warnings.join()).toContain('最高的那个音')
  })
  it('limits to a bar range', () => {
    expect(trackToTab(load(), 0, 2, 3).notes).toEqual([{ string: 0, fret: 3, beats: 4 }])
  })
  it('collects written chord names as a chord chart, carrying the last chord over', () => {
    expect(trackChordChart(load(), 0)).toBe('| Am | Am | C |')
    expect(trackChordChart(load(), 1)).toBeNull()
  })
  it('matches Drop D (and nothing for unknown tunings)', () => {
    expect(matchTuning([38, 45, 50, 55, 59, 64], 0)).toEqual({ id: 'dropD', capo: 0 })
    expect(matchTuning([40, 45, 50, 55, 59, 64], 2)).toEqual({ id: 'standard', capo: 2 })
    expect(matchTuning([38, 45, 50, 55, 57, 62], 0)).toBeNull()
  })
  it('normalises titles for grouping', () => {
    expect(normalizeTitle(' Wonder-wall (Live) ')).toBe(normalizeTitle('wonderwall live'))
  })
})

describe('sheet files', () => {
  it('base64 round-trips bytes', () => {
    const bytes = gpFile()
    expect(base64ToBytes(bytesToBase64(bytes))).toEqual(bytes)
  })
  it('saves the original file with the sheet and deletes it with the sheet', async () => {
    const bytes = gpFile()
    const meta = readSheetMeta(load())
    const sheet = await SongService.save({ source: 'gp', format: 'gp', title: meta.title, artist: meta.artist, tracks: meta.tracks, bars: meta.bars, warnings: [], file: { name: 'probe.gp', bytes } }, 'Probe', { versionLabel: '原版' })
    expect(sheet).toMatchObject({ artist: 'Band', versionLabel: '原版', format: 'gp' })
    expect(await SongService.fileBytes(sheet.fileId!)).toEqual(bytes)
    expect(await SongService.artists()).toEqual(['Band'])
    await SongService.recordPractice(sheet.id, '0:0-2', 0.6)
    await SongService.recordPractice(sheet.id, '0:0-2', 0.4)
    expect((await SongService.get(sheet.id))!.sectionBests).toEqual({ '0:0-2': 0.6 })
    await SongService.remove(sheet.id)
    expect(await getDb().sheetFiles.count()).toBe(0)
  })
})
