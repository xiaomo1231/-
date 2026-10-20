import { describe, expect, it } from 'vitest'
import { GM, guessProgram, separateChannels, sharesChannels, type ChannelTrack } from '../src/songs/trackChannels'

const GUITAR = [64, 59, 55, 50, 45, 40]
const BASS = [43, 38, 33, 28]

function track(name: string, info: ChannelTrack['playbackInfo'], tuning = GUITAR, isPercussion = false): ChannelTrack {
  return { name, isPercussion, playbackInfo: info, staves: [{ tuning }] }
}

/** A songsterr-style file: every track points at one shared playbackInfo object. */
function sharedFile(): ChannelTrack[] {
  const shared = { primaryChannel: 6, secondaryChannel: 7, program: 30 }
  return [
    track('Lead Guitar', shared),
    track('Rhythm Guitar', shared),
    track('Track 3', shared, BASS),
    track('Vocals', shared),
  ]
}

describe('separateChannels', () => {
  it('gives every track of a shared-channel file its own channel and object', () => {
    const tracks = sharedFile()
    const before = separateChannels(tracks)
    const chans = tracks.map((t) => t.playbackInfo.primaryChannel)
    expect(new Set(chans).size).toBe(4)
    expect(chans).not.toContain(9)
    expect(new Set(tracks.map((t) => t.playbackInfo)).size).toBe(4)
    expect(sharesChannels(tracks)).toBe(false)
    // the old shared program is reported for every guessed track
    expect([...before.values()]).toEqual([30, 30, 30, 30])
  })

  it('guesses instruments from names and strings, keeping the file\'s guitar sound', () => {
    const tracks = sharedFile()
    separateChannels(tracks)
    expect(tracks.map((t) => t.playbackInfo.program)).toEqual([30, 30, GM.fingerBass, GM.voiceOohs])
  })

  it('leaves well-formed files alone', () => {
    const tracks = [
      track('Guitar', { primaryChannel: 0, secondaryChannel: 1, program: 27 }),
      track('Bass', { primaryChannel: 2, secondaryChannel: 3, program: 34 }, BASS),
      track('Drums', { primaryChannel: 9, secondaryChannel: 9, program: 0 }, [], true),
      track('Drums 2', { primaryChannel: 9, secondaryChannel: 9, program: 0 }, [], true),
    ]
    expect(separateChannels(tracks).size).toBe(0)
    expect(tracks.map((t) => t.playbackInfo.primaryChannel)).toEqual([0, 2, 9, 9])
    expect(tracks[0]!.playbackInfo.program).toBe(27)
  })

  it('keeps drums on channel 9 and uses the same channel for effects when channels run out', () => {
    const shared = { primaryChannel: 2, secondaryChannel: 3, program: 34 }
    const tracks = Array.from({ length: 9 }, (_, i) => track(`Track ${i + 1}`, shared))
    tracks.push(track('Drums', { primaryChannel: 9, secondaryChannel: 9, program: 0 }, [], true))
    separateChannels(tracks)
    const pitched = tracks.slice(0, 9)
    expect(new Set(pitched.map((t) => t.playbackInfo.primaryChannel)).size).toBe(9)
    expect(pitched.every((t) => t.playbackInfo.primaryChannel !== 9 && t.playbackInfo.secondaryChannel !== 9)).toBe(true)
    expect(tracks[9]!.playbackInfo.primaryChannel).toBe(9)
  })
})

describe('guessProgram', () => {
  const g = (name: string, fallback = 30, tuning = GUITAR) => guessProgram(track(name, { primaryChannel: 0, secondaryChannel: 0, program: fallback }, tuning), fallback)
  it('reads common names in several languages', () => {
    expect(g('Bass - rupa (Rupa)')).toBe(GM.fingerBass)
    expect(g('Bass', 34)).toBe(34)
    expect(g('Vocals - Jing Qin Ren Cai')).toBe(GM.voiceOohs)
    expect(g('Keyboard (Left Hand)')).toBe(GM.piano)
    expect(g('Electric Piano (Right Hand)')).toBe(GM.electricPiano)
    expect(g('Sequencer Synthesizer')).toBe(GM.synthLead)
    expect(g('ベース')).toBe(GM.fingerBass)
    expect(g('主唱')).toBe(GM.voiceOohs)
    expect(g('Guitar R', 34)).toBe(GM.overdrivenGuitar)
    expect(g('Guitar L', 27)).toBe(27)
  })
  it('falls back to the strings for unnamed tracks', () => {
    expect(g('Track 2', 30, BASS)).toBe(GM.fingerBass)
    expect(g('Track 1', 34, GUITAR)).toBe(GM.overdrivenGuitar)
  })
})
