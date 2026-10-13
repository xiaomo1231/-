import { describe, expect, it } from 'vitest'
import { clampTranspose, defaultWay, transposeLabel, transposeScore, transposeTab, transposedKey } from '@/songs/transpose'
import { emptyScore } from '@/music/score'

describe('变调', () => {
  it('moves the key, melody and hand-written parts, never drums', () => {
    const s = emptyScore({ keyTonic: 60, mode: 'major', bpm: 90, bars: 2, chords: [{ start: 0, beats: 4, roman: 'I' }] })
    const withParts = {
      ...s,
      melody: [{ start: 0, beats: 1, midi: 64 }],
      tracks: [
        { id: 'k', kind: 'keys' as const, name: 'K', source: 'manual' as const, pattern: s.tracks?.[0]?.pattern ?? ('block' as never), notes: [{ start: 0, beats: 1, midi: 48 }], timbre: 'piano', volume: 1, pan: 0, mute: false, solo: false },
        { id: 'd', kind: 'drums' as const, name: 'D', source: 'manual' as const, pattern: 'rock' as never, notes: [{ start: 0, beats: 1, midi: 36 }], timbre: '', volume: 1, pan: 0, mute: false, solo: false },
      ],
    }
    const t = transposeScore(withParts, 2)
    expect(t.keyTonic).toBe(62)
    expect(t.melody[0]!.midi).toBe(66)
    expect(t.tracks![0]!.notes[0]!.midi).toBe(50)
    expect(t.tracks![1]!.notes[0]!.midi).toBe(36)
    expect(t.chords).toEqual(withParts.chords)
    expect(transposeScore(withParts, 0)).toBe(withParts)
  })
  it('moves frets and keeps notes on the neck (an octave up or down when needed)', () => {
    const tab = [
      { string: 0, fret: 0, beats: 1 },
      { string: 1, fret: 3, beats: 1 },
      { string: 5, fret: 21, beats: 1 },
    ]
    expect(transposeTab(tab, -2).map((x) => x.fret)).toEqual([10, 1, 19])
    expect(transposeTab(tab, 3).map((x) => x.fret)).toEqual([3, 6, 12])
    expect(transposeTab(tab, 0)).toEqual(tab)
  })
  it('labels, keys, limits and the natural way to play it', () => {
    expect(clampTranspose(9)).toBe(6)
    expect(clampTranspose(-7.4)).toBe(-6)
    expect(transposeLabel(0)).toBe('原调')
    expect(transposeLabel(-3)).toBe('降 3 个半音')
    expect(transposedKey(60, 'major', 2)).toBe('D 大调')
    expect(transposedKey(57, 'minor', 1)).toBe('B♭ 小调')
    expect(defaultWay(2)).toBe('capo')
    expect(defaultWay(-2)).toBe('frets')
    expect(defaultWay(4, 7)).toBe('frets')
  })
})
