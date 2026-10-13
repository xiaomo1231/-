import { arrangementEvents, withTracks } from './arrangement'
import type { Score } from './score'

/**
 * Compatibility layer over the multitrack arrangement for code written
 * against the P3 single-accompaniment model.
 */
export type AccompanimentPart = 'melody' | 'comp' | 'bass' | 'kick' | 'snare' | 'hat' | 'crash'

export interface PlayEvent {
  part: AccompanimentPart
  start: number
  beats: number
  midi: number
  velocity: number
}

export function melodyEvents(s: Score): PlayEvent[] {
  return s.melody.map((n) => ({ part: 'melody', start: n.start, beats: n.beats * 0.95, midi: n.midi, velocity: 0.9 }))
}

/** Accompaniment only (no melody), with keys and guitar folded into `comp`. */
export function accompanimentEvents(s: Score): PlayEvent[] {
  return arrangementEvents({ ...withTracks(s), melody: [] }).map((e) => ({
    part: e.part === 'keys' || e.part === 'guitar' ? 'comp' : e.part === 'openhat' ? 'hat' : e.part === 'lead' ? 'melody' : e.part,
    start: e.start,
    beats: e.beats,
    midi: e.midi,
    velocity: e.velocity,
  }))
}
