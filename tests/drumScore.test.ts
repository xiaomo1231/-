import { describe, expect, it } from 'vitest'
import * as at from '@coderline/alphatab'
import { existsSync, readFileSync } from 'node:fs'
import {
  buildDrumTrack,
  drumMidiToPiece,
  exportGp,
  findDrumTrack,
  partFromTrack,
  removeTrack,
  songBars,
} from '@/songs/drumScore'
import type { DrumPart } from '@/songs/drumTypes'

// Guitar track with a 6/8 bar of eighth triplets, a 4/4 bar, a tempo change and a section.
const SONG = String.raw`\title "Drum test" \tempo 100 \ts 6 8
\track "Guitar"
\tuning (E4 B3 G3 D3 A2 E2)
\section "Intro"
3.3.8{tu 3} 3.3.8{tu 3} 3.3.8{tu 3} 3.3.4 3.3.4 |\ts 4 4 \tempo 120 3.3.4 r.4 3.3.8 3.3.8 3.3.4 |\tempo 90 \section "Chorus" 3.3.4 3.3.4 3.3.4 3.3.4 |`

function loadSong(): at.model.Score {
  return at.importer.ScoreLoader.loadAlphaTex(SONG)
}

const META = { path: 'drum-test.gp', title: 'Drum test', artist: 'Tester', updatedBy: 'tester' }

/** Bar 0: 6/8 eighth triplets; bar 1: 4/4 empty (whole rest); bar 2: 4/4 sixteenth triplets. */
function handPart(): DrumPart {
  return {
    version: 1,
    path: META.path,
    title: META.title,
    artist: META.artist,
    source: 'hand',
    edited: true,
    style: null,
    updatedAt: 0,
    updatedBy: META.updatedBy,
    bars: [
      {
        num: 6,
        den: 8,
        stepsPerQuarter: 3,
        hits: [
          { step: 0, piece: 'kick', vel: 2 },
          { step: 1, piece: 'hihatClosed', vel: 2 },
          { step: 3, piece: 'snare', vel: 3 },
          { step: 6, piece: 'hihatClosed', vel: 2 },
        ],
      },
      { num: 4, den: 4, stepsPerQuarter: 4, hits: [] },
      {
        num: 4,
        den: 4,
        stepsPerQuarter: 6,
        hits: [
          { step: 0, piece: 'hihatClosed', vel: 2 },
          { step: 0, piece: 'kick', vel: 3 },
          { step: 1, piece: 'hihatClosed', vel: 2 },
          { step: 6, piece: 'snare', vel: 2 },
          { step: 12, piece: 'kick', vel: 2 },
          { step: 18, piece: 'snare', vel: 1 },
        ],
      },
    ],
  }
}

/** NoteOn events of the given channel as [tick, key, velocity], sorted. */
function noteOns(score: at.model.Score, channel: number): Array<[number, number, number]> {
  const midi = new at.midi.MidiFile()
  const handler = new at.midi.AlphaSynthMidiFileHandler(midi)
  new at.midi.MidiFileGenerator(score, new at.Settings(), handler).generate()
  return midi.events
    .filter((e) => e.constructor.name === 'NoteOnEvent' && (e as unknown as { channel: number }).channel === channel)
    .map((e) => {
      const n = e as unknown as { tick: number; noteKey: number; noteVelocity: number }
      return [n.tick, n.noteKey, n.noteVelocity] as [number, number, number]
    })
    .sort((a, b) => a[0] - b[0] || a[1] - b[1])
}

describe('drumMidiToPiece', () => {
  it('maps GM keys and their alternates to pieces', () => {
    expect(drumMidiToPiece(36)).toBe('kick')
    expect(drumMidiToPiece(35)).toBe('kick')
    expect(drumMidiToPiece(38)).toBe('snare')
    expect(drumMidiToPiece(40)).toBe('snare')
    expect(drumMidiToPiece(42)).toBe('hihatClosed')
    expect(drumMidiToPiece(59)).toBe('ride')
    expect(drumMidiToPiece(1)).toBeNull()
  })
})

describe('songBars', () => {
  it('reads meter, tempo, section, guide onsets and triplet feel per master bar', () => {
    const score = loadSong()
    const bars = songBars(score, 0)
    expect(bars.map((b) => [b.num, b.den])).toEqual([
      [6, 8],
      [4, 4],
      [4, 4],
    ])
    expect(bars.map((b) => b.bpm)).toEqual([100, 120, 90])
    expect(bars.map((b) => b.section)).toEqual(['Intro', null, 'Chorus'])
    expect(bars.map((b) => b.triplet)).toEqual([true, false, false])

    const onsets = bars[0]!.onsets.map((o) => o.at)
    expect(onsets).toHaveLength(5)
    expect(onsets[0]).toBeCloseTo(0)
    expect(onsets[1]).toBeCloseTo(1 / 3, 2)
    expect(onsets[2]).toBeCloseTo(2 / 3, 2)
    expect(onsets[3]).toBeCloseTo(1)
    expect(onsets[4]).toBeCloseTo(2)
    expect(bars[0]!.onsets.every((o) => o.vel >= 0 && o.vel <= 127)).toBe(true)
    expect(bars[2]!.onsets.map((o) => o.at)).toEqual([0, 1, 2, 3])
  })

  it('chooses the guitar automatically when no guide track is given', () => {
    const score = loadSong()
    expect(songBars(score, null)).toEqual(songBars(score, 0))
  })

  it('finds no drum track in a score without one', () => {
    expect(findDrumTrack(loadSong())).toBeNull()
  })
})

describe('buildDrumTrack', () => {
  it('appends a percussion track that plays the hits on MIDI channel 9 at the right ticks', () => {
    const score = loadSong()
    const part = handPart()
    const track = buildDrumTrack(at, score, part)
    expect(score.tracks).toHaveLength(2)
    expect(track.index).toBe(1)
    expect(track.isPercussion).toBe(true)
    expect(track.playbackInfo.primaryChannel).toBe(9)
    expect(findDrumTrack(score)).toBe(1)
    expect(score.tracks[1]!.staves[0]!.bars).toHaveLength(score.masterBars.length)

    const starts = score.masterBars.map((mb) => mb.start)
    const perStep = [960 / 3, 960 / 4, 960 / 6]
    const expected: Array<[number, number]> = []
    part.bars.forEach((bar, i) => {
      for (const hit of bar.hits) {
        expected.push([starts[i]! + hit.step * perStep[[3, 4, 6].indexOf(bar.stepsPerQuarter)]!, hit.piece === 'kick' ? 36 : hit.piece === 'snare' ? 38 : 42])
      }
    })
    expected.sort((a, b) => a[0] - b[0] || a[1] - b[1])

    const ons = noteOns(score, 9)
    expect(ons.map(([t, k]) => [t, k])).toEqual(expected)

    // ghost snare softer than the normal snare; accented kick louder than the normal kick
    const vel = (tick: number, key: number) => ons.find(([t, k]) => t === tick && k === key)![2]
    expect(vel(starts[2]! + 18 * 160, 38)).toBeLessThan(vel(starts[2]! + 6 * 160, 38))
    expect(vel(starts[2]!, 36)).toBeGreaterThan(vel(starts[2]! + 12 * 160, 36))

    // the guitar still plays on its own channel
    expect(noteOns(score, 0).length).toBeGreaterThan(0)
  })

  it('moves a pitched track off channel 9 and can remove the generated track again', () => {
    const score = loadSong()
    score.tracks[0]!.playbackInfo.primaryChannel = 9
    score.tracks[0]!.playbackInfo.secondaryChannel = 9
    buildDrumTrack(at, score, handPart())
    expect(score.tracks[0]!.playbackInfo.primaryChannel).not.toBe(9)
    expect(score.tracks[1]!.playbackInfo.primaryChannel).toBe(9)

    removeTrack(score, 1)
    expect(score.tracks).toHaveLength(1)
    expect(findDrumTrack(score)).toBeNull()
    buildDrumTrack(at, score, handPart())
    expect(score.tracks).toHaveLength(2)
    expect(score.tracks[1]!.index).toBe(1)
  })
})

describe('partFromTrack', () => {
  it('turns a built track back into the same hits (round trip)', () => {
    const score = loadSong()
    const part = handPart()
    buildDrumTrack(at, score, part)
    const back = partFromTrack(score, 1, META)
    expect(back.source).toBe('file')
    expect(back.edited).toBe(false)
    expect(back.bars.map((b) => b.stepsPerQuarter)).toEqual([3, 4, 6])
    expect(back.bars.map((b) => b.hits)).toEqual(part.bars.map((b) => b.hits))
  })

  it('survives GP7 export and reload with the drum track intact', () => {
    const score = loadSong()
    const part = handPart()
    buildDrumTrack(at, score, part)
    const bytes = exportGp(at, score)
    expect(bytes).toBeInstanceOf(Uint8Array)
    expect(bytes.length).toBeGreaterThan(100)

    const reloaded = at.importer.ScoreLoader.loadScoreFromBytes(bytes)
    const idx = findDrumTrack(reloaded)
    expect(idx).not.toBeNull()
    const back = partFromTrack(reloaded, idx!, META)
    expect(back.bars.map((b) => b.hits)).toEqual(part.bars.map((b) => b.hits))
    expect(back.bars.map((b) => [b.num, b.den])).toEqual([[6, 8], [4, 4], [4, 4]])
  })
})

const REAL = 'F:\\吉他谱\\吉他谱库\\1-华语\\男歌手\\周杰伦\\晴天\\晴天.gp5'
describe.skipIf(!existsSync(REAL))('real Guitar Pro file (read only)', () => {
  it('reads the drum track of 晴天.gp5 with kick, snare and hi-hat', () => {
    const score = at.importer.ScoreLoader.loadScoreFromBytes(new Uint8Array(readFileSync(REAL)))
    const track = score.tracks[2]!
    expect(track.isPercussion).toBe(true)
    const part = partFromTrack(score, 2, { path: REAL, title: '晴天', artist: '周杰伦', updatedBy: 'test' })
    const pieces = new Set(part.bars.flatMap((b) => b.hits.map((h) => h.piece)))
    const first = part.bars.findIndex((b) => b.hits.length > 0)
    console.log('first bar with hits:', first, 'two bars:', JSON.stringify(part.bars.slice(first, first + 2)))
    const counts = new Map<string, number>()
    for (const h of part.bars.flatMap((b) => b.hits)) counts.set(h.piece, (counts.get(h.piece) ?? 0) + 1)
    console.log('hits per piece:', JSON.stringify([...counts]), 'bars:', part.bars.length)
    expect(pieces.has('kick')).toBe(true)
    expect(pieces.has('snare')).toBe(true)
    // 晴天 writes its hi-hat on GM key 44 (pedal hi-hat), which maps to hihatPedal
    expect(pieces.has('hihatClosed') || pieces.has('hihatOpen') || pieces.has('hihatPedal')).toBe(true)
  })
})
