import { describe, expect, it } from 'vitest'
import templateJson from '../src/songs/drumTemplates.json'
import { DRUM_PIECES, barSteps, type DrumTemplateLibrary } from '../src/songs/drumTypes'
import { parseMidi } from '../src/songs/midiFile'

const u16 = (n: number) => [(n >> 8) & 0xff, n & 0xff]
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]
const ascii = (s: string) => Array.from(s).map((c) => c.charCodeAt(0))
const chunk = (id: string, data: number[]) => [...ascii(id), ...u32(data.length), ...data]
const header = (format: number, tracks: number, division: number) =>
  chunk('MThd', [...u16(format), ...u16(tracks), ...u16(division)])
const build = (...parts: number[][]) => Uint8Array.from(parts.flat())

const END_OF_TRACK = [0x00, 0xff, 0x2f, 0x00]

describe('parseMidi', () => {
  it('reads a format 0 file with running status, tempo, time signature and note off as velocity 0', () => {
    const track = [
      0x00, 0xff, 0x51, 0x03, 0x07, 0xa1, 0x20, // tempo 500000 us/quarter (120 bpm)
      0x00, 0xff, 0x58, 0x04, 0x03, 0x02, 0x18, 0x08, // 3/4
      0x00, 0x90, 0x3c, 0x64, // note on C4 vel 100
      0x60, 0x3c, 0x00, // running status: note on vel 0 = off at tick 96
      0x00, 0x3e, 0x50, // running status: note on D4 vel 80 at tick 96
      0x83, 0x00, 0x3e, 0x00, // delta 384 (varlen 0x83 0x00): off at tick 480
      ...END_OF_TRACK,
    ]
    const parsed = parseMidi(build(header(0, 1, 480), chunk('MTrk', track)))
    expect(parsed.ppq).toBe(480)
    expect(parsed.tracks).toHaveLength(1)
    expect(parsed.tracks[0]).toEqual([
      { tick: 0, type: 'on', channel: 0, key: 60, vel: 100 },
      { tick: 96, type: 'off', channel: 0, key: 60, vel: 0 },
      { tick: 96, type: 'on', channel: 0, key: 62, vel: 80 },
      { tick: 480, type: 'off', channel: 0, key: 62, vel: 0 },
    ])
    expect(parsed.tempos).toEqual([{ tick: 0, usPerQuarter: 500000 }])
    expect(parsed.timeSigs).toEqual([{ tick: 0, num: 3, den: 4 }])
  })

  it('reads a format 1 file with two tracks, multi-byte delta times and sysex', () => {
    const conductor = [0x00, 0xff, 0x51, 0x03, 0x0f, 0x42, 0x40, ...END_OF_TRACK]
    const drums = [
      0x00, 0xf0, 0x03, 0x7e, 0x00, 0xf7, // sysex (skipped)
      0x81, 0x00, 0x99, 0x24, 0x50, // delta 128: note on channel 10, key 36, vel 80
      0x81, 0x00, 0x89, 0x24, 0x40, // delta 128: note off channel 10, key 36
      ...END_OF_TRACK,
    ]
    const parsed = parseMidi(build(header(1, 2, 96), chunk('MTrk', conductor), chunk('MTrk', drums)))
    expect(parsed.tracks).toHaveLength(2)
    expect(parsed.tracks[0]).toEqual([])
    expect(parsed.tracks[1]).toEqual([
      { tick: 128, type: 'on', channel: 9, key: 36, vel: 80 },
      { tick: 256, type: 'off', channel: 9, key: 36, vel: 64 },
    ])
    expect(parsed.tempos).toEqual([{ tick: 0, usPerQuarter: 1000000 }])
  })

  it('skips unknown chunks before a track', () => {
    const track = [0x00, 0x90, 0x30, 0x40, ...END_OF_TRACK]
    const parsed = parseMidi(build(header(0, 1, 480), chunk('XFIH', [1, 2, 3]), chunk('MTrk', track)))
    expect(parsed.tracks[0]).toEqual([{ tick: 0, type: 'on', channel: 0, key: 48, vel: 64 }])
  })

  it('rejects data that is not a Standard MIDI File', () => {
    expect(() => parseMidi(build(chunk('RIFF', [0, 0, 0, 0, 0, 0])))).toThrow(/MThd/)
    expect(() => parseMidi(new Uint8Array(4))).toThrow(/too short/)
  })

  it('rejects SMPTE time, unsupported formats and zero time division', () => {
    const track = chunk('MTrk', END_OF_TRACK)
    expect(() => parseMidi(build(header(0, 1, 0xe250), track))).toThrow(/SMPTE/)
    expect(() => parseMidi(build(header(2, 1, 480), track))).toThrow(/unsupported format 2/)
    expect(() => parseMidi(build(header(0, 1, 0), track))).toThrow(/zero/)
  })

  it('rejects a track whose length runs past the end of the file', () => {
    const bytes = build(header(0, 1, 480), [...ascii('MTrk'), ...u32(100), ...END_OF_TRACK])
    expect(() => parseMidi(bytes)).toThrow(/truncated/)
  })

  it('rejects running status before any status byte', () => {
    const track = [0x00, 0x40, 0x40, ...END_OF_TRACK]
    expect(() => parseMidi(build(header(0, 1, 480), chunk('MTrk', track)))).toThrow(/running status/)
  })

  it('rejects a track that ends before the declared track count', () => {
    expect(() => parseMidi(build(header(1, 2, 480), chunk('MTrk', END_OF_TRACK)))).toThrow(/expected track 2/)
  })

  it('rejects a note event cut off by the end of its track', () => {
    const track = [0x00, 0x90, 0x3c]
    expect(() => parseMidi(build(header(0, 1, 480), chunk('MTrk', track)))).toThrow(/unexpected end/)
  })
})

describe('drumTemplates.json', () => {
  const lib = templateJson as DrumTemplateLibrary
  const pieceOrder = new Map(DRUM_PIECES.map((p, i) => [p.id, i]))

  it('matches the template library header and style ids', () => {
    expect(lib.version).toBe(1)
    expect(lib.license).toContain('CC BY 4.0')
    expect(lib.styles.length).toBeGreaterThan(0)
    const ids = lib.styles.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('keeps every bar inside its meter and every hit valid', () => {
    for (const style of lib.styles) {
      expect(style.minBpm).toBeLessThanOrEqual(style.maxBpm)
      const groups = [...style.grooves, ...style.chorus, ...style.fills]
      for (const pattern of groups) {
        expect(pattern.weight).toBeGreaterThan(0)
        expect(pattern.bars.length).toBeGreaterThan(0)
        for (const bar of pattern.bars) {
          expect(`${bar.num}/${bar.den}`).toBe(style.meter)
          expect([3, 4, 6]).toContain(bar.stepsPerQuarter)
          const steps = barSteps(bar)
          const seen = new Set<string>()
          let prev = -1
          let prevOrder = -1
          for (const hit of bar.hits) {
            expect(Number.isInteger(hit.step)).toBe(true)
            expect(hit.step).toBeGreaterThanOrEqual(0)
            expect(hit.step).toBeLessThan(steps)
            expect([1, 2, 3]).toContain(hit.vel)
            const order = pieceOrder.get(hit.piece)
            expect(order, `unknown piece ${hit.piece}`).toBeDefined()
            expect(hit.step >= prev).toBe(true)
            if (hit.step === prev) expect(order!).toBeGreaterThan(prevOrder)
            prev = hit.step
            prevOrder = order!
            const key = `${hit.step}|${hit.piece}`
            expect(seen.has(key)).toBe(false)
            seen.add(key)
          }
        }
      }
    }
  })
})
