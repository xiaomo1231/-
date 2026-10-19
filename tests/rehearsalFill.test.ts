import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FILL,
  fillOf,
  planFill,
  speakerMix,
  type FillMember,
  type FillTrackInput,
} from '../src/songs/rehearsalFill'
import type { FillConfig } from '../src/songs/scoreServerTypes'

const tracks: FillTrackInput[] = [
  { index: 0, name: 'Guitar', isDrums: false },
  { index: 1, name: 'Bass', isDrums: false },
  { index: 2, name: 'Drums', isDrums: true },
  { index: 3, name: 'Keys', isDrums: false },
]

const members: FillMember[] = [
  { id: 'u1', displayName: '小王', instrument: 'guitar' },
  { id: 'u2', displayName: '小李', instrument: 'bass' },
  { id: 'u3', displayName: '小赵', instrument: 'drums' },
  { id: 'u4', displayName: '小周', instrument: null },
]

function fill(patch: Partial<FillConfig> = {}): FillConfig {
  return { ...DEFAULT_FILL, tracks: {}, volumes: {}, ...patch }
}

function plan(
  over: {
    parts?: Record<string, string>
    present?: string[]
    fill?: FillConfig
    hasSavedDrums?: boolean
    tracks?: FillTrackInput[]
    members?: FillMember[]
  } = {},
) {
  return planFill({
    tracks: over.tracks ?? tracks,
    parts: over.parts ?? {},
    present: over.present ?? [],
    members: over.members ?? members,
    fill: over.fill ?? fill(),
    hasSavedDrums: over.hasSavedDrums ?? false,
  })
}

describe('fillOf', () => {
  it('returns defaults for a missing fill', () => {
    expect(fillOf({})).toEqual(DEFAULT_FILL)
    expect(fillOf({ fill: undefined })).toEqual(DEFAULT_FILL)
  })

  it('fills in missing fields of a partial fill', () => {
    const f = fillOf({ fill: { tracks: { '0': 'on' } } as unknown as FillConfig })
    expect(f.tracks).toEqual({ '0': 'on' })
    expect(f.drums).toBe('auto')
    expect(f.drumSource).toBe('auto')
    expect(f.drumStyle).toBeNull()
    expect(f.metronome).toBe(false)
    expect(f.countIn).toBe(true)
    expect(f.volumes).toEqual({})
  })

  it('does not mutate DEFAULT_FILL', () => {
    const f = fillOf({})
    f.tracks['1'] = 'on'
    expect(DEFAULT_FILL.tracks).toEqual({})
  })
})

describe('planFill: non-drum tracks', () => {
  it('auto: a present player plays it live, so the 音箱 does not', () => {
    const p = plan({ parts: { '0': 'u1' }, present: ['u1'] })
    const t = p.tracks.find((x) => x.index === 0)!
    expect(t.player).toBe('u1')
    expect(t.present).toBe(true)
    expect(t.play).toBe(false)
    expect(t.reason).toBe('小王在场，由本人来弹')
  })

  it('auto: an absent player means the 音箱 plays it', () => {
    const p = plan({ parts: { '0': 'u1' }, present: ['u2'] })
    const t = p.tracks.find((x) => x.index === 0)!
    expect(t.player).toBe('u1')
    expect(t.present).toBe(false)
    expect(t.play).toBe(true)
    expect(t.reason).toBe('小王没来，音箱补上')
  })

  it('auto: an unassigned track is played by the 音箱', () => {
    const p = plan({ parts: {}, present: ['u1'] })
    const t = p.tracks.find((x) => x.index === 1)!
    expect(t.player).toBeNull()
    expect(t.present).toBe(false)
    expect(t.play).toBe(true)
    expect(t.reason).toBe('没人负责，音箱补上')
  })

  it('ignores parts pointing to unknown members', () => {
    const p = plan({ parts: { '0': 'ghost' }, present: ['ghost'] })
    const t = p.tracks.find((x) => x.index === 0)!
    expect(t.player).toBeNull()
    expect(t.present).toBe(false)
    expect(t.play).toBe(true)
    expect(t.reason).toBe('没人负责，音箱补上')
  })

  it('on overrides a present player', () => {
    const p = plan({
      parts: { '0': 'u1' },
      present: ['u1'],
      fill: fill({ tracks: { '0': 'on' } }),
    })
    const t = p.tracks.find((x) => x.index === 0)!
    expect(t.mode).toBe('on')
    expect(t.play).toBe(true)
    expect(t.present).toBe(true)
    expect(t.reason).toBe('设为一直播放')
  })

  it('off overrides an absent player', () => {
    const p = plan({
      parts: { '1': 'u2' },
      present: [],
      fill: fill({ tracks: { '1': 'off' } }),
    })
    const t = p.tracks.find((x) => x.index === 1)!
    expect(t.mode).toBe('off')
    expect(t.play).toBe(false)
    expect(t.reason).toBe('设为不播放')
  })

  it('missing track mode defaults to auto', () => {
    const p = plan({ present: [] })
    expect(p.tracks.every((t) => t.mode === 'auto')).toBe(true)
  })

  it('lists non-drum tracks in index order and excludes drums', () => {
    const shuffled: FillTrackInput[] = [
      { index: 3, name: 'Keys', isDrums: false },
      { index: 2, name: 'Drums', isDrums: true },
      { index: 0, name: 'Guitar', isDrums: false },
      { index: 1, name: 'Bass', isDrums: false },
    ]
    const p = plan({ tracks: shuffled })
    expect(p.tracks.map((t) => t.index)).toEqual([0, 1, 3])
  })

  it('volume defaults to 100, is clamped to 0–150 and rounded', () => {
    const p = plan({
      fill: fill({ volumes: { '0': 200, '1': -5, '3': 80.6 } }),
    })
    expect(p.tracks.find((t) => t.index === 0)!.volume).toBe(150)
    expect(p.tracks.find((t) => t.index === 1)!.volume).toBe(0)
    expect(p.tracks.find((t) => t.index === 3)!.volume).toBe(81)
    const none = plan({ fill: fill({ volumes: {} }) })
    expect(none.tracks[0].volume).toBe(100)
  })

  it('treats a non-finite volume as 100', () => {
    const p = plan({ fill: fill({ volumes: { '0': Number.NaN } }) })
    expect(p.tracks[0].volume).toBe(100)
  })
})

describe('planFill: drums', () => {
  it('auto with a present drummer assigned to a drum track: 音箱 stays silent', () => {
    const p = plan({ parts: { '2': 'u3' }, present: ['u3'] })
    expect(p.drums.drummers).toEqual(['u3'])
    expect(p.drums.play).toBe(false)
    expect(p.drums.reason).toBe('鼓手在场（小赵）')
  })

  it('auto with a present member whose instrument is drums counts as a drummer', () => {
    const p = plan({ parts: {}, present: ['u3'] })
    expect(p.drums.drummers).toEqual(['u3'])
    expect(p.drums.play).toBe(false)
  })

  it('auto with an absent drummer: 音箱 plays drums', () => {
    const p = plan({ parts: { '2': 'u3' }, present: ['u1'] })
    expect(p.drums.drummers).toEqual([])
    expect(p.drums.play).toBe(true)
    expect(p.drums.reason).toBe('没有鼓手，音箱补上')
  })

  it('a present member with no drum role is not a drummer', () => {
    const p = plan({ parts: { '0': 'u1' }, present: ['u1'] })
    expect(p.drums.drummers).toEqual([])
    expect(p.drums.play).toBe(true)
  })

  it('a drum-track player who is absent is not a drummer', () => {
    const p = plan({ parts: { '2': 'u3' }, present: [] })
    expect(p.drums.drummers).toEqual([])
  })

  it('on and off override the drummer rule', () => {
    const on = plan({
      parts: { '2': 'u3' },
      present: ['u3'],
      fill: fill({ drums: 'on' }),
    })
    expect(on.drums.mode).toBe('on')
    expect(on.drums.play).toBe(true)
    expect(on.drums.drummers).toEqual(['u3'])
    expect(on.drums.reason).toBe('设为一直播放')

    const off = plan({ present: [], fill: fill({ drums: 'off' }) })
    expect(off.drums.play).toBe(false)
    expect(off.drums.reason).toBe('设为不播放')
  })

  it('volume uses the drums key and is clamped', () => {
    expect(plan({ fill: fill({ volumes: { drums: 130 } }) }).drums.volume).toBe(130)
    expect(plan({ fill: fill({ volumes: { drums: 999 } }) }).drums.volume).toBe(150)
    expect(plan().drums.volume).toBe(100)
  })
})

describe('planFill: drum source', () => {
  it('auto: saved drums win when present', () => {
    const p = plan({ hasSavedDrums: true })
    expect(p.drums.source).toBe('saved')
    expect(p.drums.sourceNote).toBeNull()
  })

  it('auto: file drum track when no saved drums', () => {
    const p = plan({ hasSavedDrums: false })
    expect(p.drums.source).toBe('file')
    expect(p.drums.sourceNote).toBeNull()
  })

  it('auto: generated when neither exists', () => {
    const p = plan({
      tracks: tracks.filter((t) => !t.isDrums),
      hasSavedDrums: false,
    })
    expect(p.drums.source).toBe('generated')
    expect(p.drums.sourceNote).toBeNull()
  })

  it('auto: saved beats file, and file is not used when generated would apply', () => {
    const p = plan({
      tracks: tracks.filter((t) => !t.isDrums),
      hasSavedDrums: true,
    })
    expect(p.drums.source).toBe('saved')
  })

  it('saved without saved drums falls back to the file drums with a note', () => {
    const p = plan({ fill: fill({ drumSource: 'saved' }), hasSavedDrums: false })
    expect(p.drums.source).toBe('file')
    expect(p.drums.sourceNote).toBe('还没有编辑过的鼓谱，改用谱里的鼓')
  })

  it('saved without saved drums and no file drums falls back to generated with a note', () => {
    const p = plan({
      tracks: tracks.filter((t) => !t.isDrums),
      fill: fill({ drumSource: 'saved' }),
      hasSavedDrums: false,
    })
    expect(p.drums.source).toBe('generated')
    expect(p.drums.sourceNote).toBe('还没有编辑过的鼓谱，改用自动生成的鼓')
  })

  it('saved with saved drums is used directly', () => {
    const p = plan({ fill: fill({ drumSource: 'saved' }), hasSavedDrums: true })
    expect(p.drums.source).toBe('saved')
    expect(p.drums.sourceNote).toBeNull()
  })

  it('file with a file drum track is used directly', () => {
    const p = plan({ fill: fill({ drumSource: 'file' }), hasSavedDrums: true })
    expect(p.drums.source).toBe('file')
    expect(p.drums.sourceNote).toBeNull()
  })

  it('file without a file drum track falls back to generated with a note', () => {
    const p = plan({
      tracks: tracks.filter((t) => !t.isDrums),
      fill: fill({ drumSource: 'file' }),
      hasSavedDrums: true,
    })
    expect(p.drums.source).toBe('generated')
    expect(p.drums.sourceNote).toBe('谱里没有鼓轨，改用自动生成的鼓')
  })

  it('generated and metronome are used as chosen', () => {
    expect(plan({ fill: fill({ drumSource: 'generated' }) }).drums.source).toBe('generated')
    expect(plan({ fill: fill({ drumSource: 'generated' }) }).drums.sourceNote).toBeNull()
    expect(plan({ fill: fill({ drumSource: 'metronome' }) }).drums.source).toBe('metronome')
    expect(plan({ fill: fill({ drumSource: 'metronome' }) }).drums.sourceNote).toBeNull()
  })
})

describe('planFill: metronome and count-in', () => {
  it('metronome follows the fill setting', () => {
    expect(plan({ fill: fill({ metronome: true }) }).metronome).toBe(true)
    expect(plan({ fill: fill({ metronome: false }) }).metronome).toBe(false)
  })

  it('metronome is on when drums play from the metronome source', () => {
    const p = plan({
      present: [],
      fill: fill({ drumSource: 'metronome', metronome: false }),
    })
    expect(p.drums.play).toBe(true)
    expect(p.metronome).toBe(true)
  })

  it('metronome source with drums not playing does not turn the metronome on', () => {
    const p = plan({
      parts: { '2': 'u3' },
      present: ['u3'],
      fill: fill({ drumSource: 'metronome', metronome: false }),
    })
    expect(p.drums.play).toBe(false)
    expect(p.metronome).toBe(false)
  })

  it('countIn is passed through', () => {
    expect(plan({ fill: fill({ countIn: false }) }).countIn).toBe(false)
    expect(plan({ fill: fill({ countIn: true }) }).countIn).toBe(true)
  })
})

describe('speakerMix', () => {
  const base = { trackCount: 4, fileDrums: [2], added: null, std: null }

  it('mutes present players and plays absent ones', () => {
    const p = plan({ parts: { '0': 'u1', '1': 'u2' }, present: ['u1'] })
    const mix = speakerMix(p, base)
    expect(mix.mute[0]).toBe(true)
    expect(mix.mute[1]).toBe(false)
    expect(mix.mute[3]).toBe(false)
  })

  it('volume is a 0–1.5 factor from the plan', () => {
    const p = plan({ fill: fill({ volumes: { '1': 150, '3': 50 } }) })
    const mix = speakerMix(p, base)
    expect(mix.volume[1]).toBe(1.5)
    expect(mix.volume[3]).toBe(0.5)
  })

  it('file drums play only when source is file and drums play', () => {
    const playing = plan({ present: [], hasSavedDrums: false })
    expect(speakerMix(playing, base).mute[2]).toBe(false)

    const saved = plan({ present: [], hasSavedDrums: true })
    expect(speakerMix(saved, base).mute[2]).toBe(true)

    const notPlaying = plan({
      parts: { '2': 'u3' },
      present: ['u3'],
      hasSavedDrums: false,
    })
    expect(speakerMix(notPlaying, base).mute[2]).toBe(true)
  })

  it('file drum volume uses the drums factor', () => {
    const p = plan({ present: [], fill: fill({ volumes: { drums: 120 } }) })
    expect(speakerMix(p, base).volume[2]).toBeCloseTo(1.2)
  })

  it('added drum track plays only for saved or generated source', () => {
    const layout = { trackCount: 5, fileDrums: [2], added: 4, std: null }
    const saved = plan({ present: [], hasSavedDrums: true })
    expect(speakerMix(saved, layout).mute[4]).toBe(false)

    const file = plan({ present: [], hasSavedDrums: false })
    expect(speakerMix(file, layout).mute[4]).toBe(true)

    const generated = plan({
      tracks: tracks.filter((t) => !t.isDrums),
      present: [],
      hasSavedDrums: false,
    })
    const mix = speakerMix(generated, { ...layout, fileDrums: [] })
    expect(mix.mute[4]).toBe(false)

    const metro = plan({ present: [], fill: fill({ drumSource: 'metronome' }) })
    expect(speakerMix(metro, layout).mute[4]).toBe(true)
  })

  it('added drum track is muted when drums do not play', () => {
    const p = plan({
      parts: { '2': 'u3' },
      present: ['u3'],
      hasSavedDrums: true,
    })
    const layout = { trackCount: 5, fileDrums: [2], added: 4, std: null }
    expect(speakerMix(p, layout).mute[4]).toBe(true)
  })

  it('std copy is always muted', () => {
    const p = plan({ present: [], hasSavedDrums: true })
    const layout = { trackCount: 5, fileDrums: [2], added: 4, std: 3 }
    const mix = speakerMix(p, layout)
    expect(mix.mute[3]).toBe(true)
  })

  it('own tracks are always muted, even when they would play', () => {
    const p = plan({ parts: { '0': 'u1' }, present: [] })
    const mix = speakerMix(p, { ...base, own: [0] })
    expect(mix.mute[0]).toBe(true)
    expect(mix.mute[1]).toBe(false)
  })

  it('own defaults to none', () => {
    const p = plan({ parts: { '0': 'u1' }, present: [] })
    expect(speakerMix(p, base).mute[0]).toBe(false)
  })

  it('unknown track indexes are muted', () => {
    const p = plan({ present: [] })
    const mix = speakerMix(p, { trackCount: 10, fileDrums: [], added: null, std: null })
    expect(mix.mute).toHaveLength(10)
    expect(mix.mute[7]).toBe(true)
    expect(mix.volume[7]).toBe(1)
  })

  it('returns arrays of trackCount length', () => {
    const p = plan({ present: [] })
    const mix = speakerMix(p, base)
    expect(mix.mute).toHaveLength(4)
    expect(mix.volume).toHaveLength(4)
  })
})
