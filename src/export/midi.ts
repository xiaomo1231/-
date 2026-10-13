import { arrangementEvents, ensureTracks, trackEvents } from '@/music/arrangement'
import { majorKeySignature } from '@/music/keys'
import type { Score, Track } from '@/music/score'

/**
 * Standard MIDI File (format 1) writer. Track 0 carries tempo, metre and key;
 * then one track for the melody (with lyrics) and one per accompaniment track.
 * Drums go to channel 10 as General MIDI requires.
 */

export const PPQ = 480

/** General MIDI programs for our timbres. */
export function gmProgram(kind: 'lead' | Track['kind'], timbre: string): number {
  if (kind === 'lead') return timbre === 'piano' ? 0 : 80 // square lead
  if (kind === 'keys') return timbre === 'epiano' ? 4 : timbre === 'organ' ? 16 : 0
  if (kind === 'guitar') return timbre === 'drive' ? 29 : 27
  if (kind === 'bass') return timbre === 'synth' ? 38 : 33
  return 0
}

function vlq(n: number): number[] {
  let v = Math.max(0, Math.round(n))
  const bytes = [v & 0x7f]
  v >>= 7
  while (v > 0) {
    bytes.unshift((v & 0x7f) | 0x80)
    v >>= 7
  }
  return bytes
}

const str = (s: string) => Array.from(new TextEncoder().encode(s))
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff]
const u16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff]

interface RawEvent {
  tick: number
  /** Sort order at the same tick: meta 0, note-off 1, program 2, note-on 3. */
  order: number
  bytes: number[]
}

function chunk(events: RawEvent[]): number[] {
  events.sort((a, b) => a.tick - b.tick || a.order - b.order)
  const body: number[] = []
  let last = 0
  for (const e of events) {
    body.push(...vlq(e.tick - last), ...e.bytes)
    last = e.tick
  }
  body.push(0x00, 0xff, 0x2f, 0x00) // end of track
  return [...str('MTrk'), ...u32(body.length), ...body]
}

const meta = (tick: number, type: number, data: number[]): RawEvent => ({ tick, order: 0, bytes: [0xff, type, ...vlq(data.length), ...data] })

function noteTrack(name: string, channel: number, program: number | null, notes: Array<{ start: number; beats: number; midi: number; velocity: number; lyric?: string }>): number[] {
  const ev: RawEvent[] = [meta(0, 0x03, str(name))]
  if (program !== null) ev.push({ tick: 0, order: 2, bytes: [0xc0 | channel, program & 0x7f] })
  for (const n of notes) {
    const on = Math.round(n.start * PPQ)
    const off = Math.max(on + 1, Math.round((n.start + n.beats) * PPQ))
    const vel = Math.max(1, Math.min(127, Math.round(n.velocity * 127)))
    if (n.lyric) ev.push(meta(on, 0x05, str(n.lyric)))
    ev.push({ tick: on, order: 3, bytes: [0x90 | channel, n.midi & 0x7f, vel] })
    ev.push({ tick: off, order: 1, bytes: [0x80 | channel, n.midi & 0x7f, 0] })
  }
  return chunk(ev)
}

export function writeMidi(score: Score, title = 'GrooveLab'): Uint8Array {
  const tracks = ensureTracks(score)
  const anySolo = tracks.some((t) => t.solo) || score.lead?.solo
  const playing = (mute: boolean, solo: boolean) => (anySolo ? solo : !mute)

  // Conductor track.
  const mpqn = Math.round(60_000_000 / score.bpm)
  const sf = majorKeySignature((((score.mode === 'minor' ? score.keyTonic + 3 : score.keyTonic) % 12) + 12) % 12)
  const conductor = chunk([
    meta(0, 0x03, str(title)),
    meta(0, 0x51, [(mpqn >> 16) & 0xff, (mpqn >> 8) & 0xff, mpqn & 0xff]),
    meta(0, 0x58, [score.beatsPerBar, 2, 24, 8]),
    meta(0, 0x59, [sf & 0xff, score.mode === 'minor' ? 1 : 0]),
  ])

  const chunks: number[][] = [conductor]
  const lead = score.lead ?? { volume: 0.9, pan: 0, mute: false, solo: false, timbre: 'lead' }
  if (score.melody.length && playing(lead.mute, lead.solo)) {
    chunks.push(noteTrack('主旋律', 0, gmProgram('lead', lead.timbre), score.melody.map((n) => ({ ...n, velocity: 0.85 }))))
  }
  let channel = 1
  for (const t of tracks) {
    if (!playing(t.mute, t.solo)) continue
    const isDrums = t.kind === 'drums'
    const ch = isDrums ? 9 : channel++
    if (channel === 9) channel++
    const notes = trackEvents(score, t).map((e) => ({ start: e.start, beats: e.beats, midi: e.midi, velocity: e.velocity }))
    if (notes.length) chunks.push(noteTrack(t.name, ch, isDrums ? null : gmProgram(t.kind, t.timbre), notes))
  }

  const header = [...str('MThd'), ...u32(6), ...u16(1), ...u16(chunks.length), ...u16(PPQ)]
  return new Uint8Array([...header, ...chunks.flat()])
}

/** Count of note-on events per track, for tests and the export summary. */
export function midiSummary(score: Score): { tracks: number; notes: number } {
  return { tracks: 1 + (score.melody.length ? 1 : 0) + ensureTracks(score).filter((t) => !t.mute).length, notes: arrangementEvents(score).length }
}
