import { chordNotes, chordTypeById } from './chords'
import {
  sectionAt,
  slotBassInterval,
  slotQuality,
  slotRoot,
  type ChordSlot,
  type Score,
  type ScoreNote,
  type Section,
  type Track,
  type TrackKind,
  type TrackPattern,
} from './score'

/**
 * Multitrack arrangement: generate each accompaniment track from the chord
 * track, the sections (energy, key changes, drop-outs) and the track pattern.
 * Everything is a pure function of the score.
 */

export type PartId = 'lead' | 'keys' | 'guitar' | 'bass' | 'kick' | 'snare' | 'hat' | 'openhat' | 'crash'

export interface ArrEvent {
  /** Track id ('lead' for the melody). */
  track: string
  part: PartId
  start: number
  beats: number
  midi: number
  velocity: number
}

export const DRUM = { kick: 36, snare: 38, hat: 42, openhat: 46, crash: 49 } as const
const DRUM_PART: Record<number, PartId> = { 36: 'kick', 38: 'snare', 42: 'hat', 46: 'openhat', 49: 'crash' }

export const TRACK_LABEL: Record<TrackKind, string> = { keys: '键盘', guitar: '吉他', bass: '贝斯', drums: '鼓' }

export const PATTERN_LABEL: Record<TrackPattern, string> = {
  block: '柱式',
  arpeggio: '分解',
  pad: '铺底长音',
  stabs: '反拍短和弦',
  strum: '扫弦',
  power8: '强力和弦八分',
  offbeat: '反拍切音',
  roots: '根音四分',
  root8: '根音八分',
  fifths: '根音 + 五度',
  octaves: '八度跳',
  walking: '经过音',
  rock: '摇滚',
  pop: '流行',
  halftime: '半速',
  punk: '朋克',
  rnb: 'R&B',
  four: '四踩',
}

export const PATTERNS_BY_KIND: Record<TrackKind, TrackPattern[]> = {
  keys: ['block', 'arpeggio', 'pad', 'stabs'],
  guitar: ['strum', 'power8', 'arpeggio', 'offbeat'],
  bass: ['roots', 'root8', 'fifths', 'octaves', 'walking'],
  drums: ['pop', 'rock', 'halftime', 'punk', 'rnb', 'four'],
}

export const TIMBRES_BY_KIND: Record<TrackKind, Array<{ id: string; label: string }>> = {
  keys: [
    { id: 'piano', label: '钢琴' },
    { id: 'epiano', label: '电钢琴' },
    { id: 'organ', label: '风琴' },
  ],
  guitar: [
    { id: 'clean', label: '清音' },
    { id: 'drive', label: '失真' },
  ],
  bass: [
    { id: 'finger', label: '指弹' },
    { id: 'synth', label: '合成' },
  ],
  drums: [{ id: 'kit', label: '标准套鼓' }],
}

export interface StyleTemplate {
  id: 'pop' | 'rock' | 'punk' | 'rnb'
  name: string
  description: string
  bpm: number
  tracks: Record<TrackKind, { pattern: TrackPattern; timbre: string; on: boolean }>
  /** Energy per section label. */
  energy: Partial<Record<Section['label'], 1 | 2 | 3>>
}

export const STYLES: readonly StyleTemplate[] = [
  {
    id: 'pop',
    name: '流行',
    description: '钢琴铺和声、吉他分解，鼓在副歌里打满。',
    bpm: 100,
    tracks: {
      keys: { pattern: 'block', timbre: 'piano', on: true },
      guitar: { pattern: 'arpeggio', timbre: 'clean', on: true },
      bass: { pattern: 'roots', timbre: 'finger', on: true },
      drums: { pattern: 'pop', timbre: 'kit', on: true },
    },
    energy: { intro: 1, verse: 1, pre: 2, chorus: 3, bridge: 2, outro: 1 },
  },
  {
    id: 'rock',
    name: '摇滚',
    description: '失真吉他强力和弦八分音，贝斯跟底鼓锁死。',
    bpm: 120,
    tracks: {
      keys: { pattern: 'pad', timbre: 'organ', on: false },
      guitar: { pattern: 'power8', timbre: 'drive', on: true },
      bass: { pattern: 'root8', timbre: 'finger', on: true },
      drums: { pattern: 'rock', timbre: 'kit', on: true },
    },
    energy: { intro: 2, verse: 2, pre: 2, chorus: 3, bridge: 2, outro: 2 },
  },
  {
    id: 'punk',
    name: '朋克',
    description: '快、直接：八分底鼓、强力和弦、一路冲到底。',
    bpm: 168,
    tracks: {
      keys: { pattern: 'block', timbre: 'piano', on: false },
      guitar: { pattern: 'power8', timbre: 'drive', on: true },
      bass: { pattern: 'root8', timbre: 'finger', on: true },
      drums: { pattern: 'punk', timbre: 'kit', on: true },
    },
    energy: { intro: 3, verse: 2, pre: 3, chorus: 3, bridge: 2, outro: 3 },
  },
  {
    id: 'rnb',
    name: '轻 R&B',
    description: '电钢琴七和弦、切分贝斯、松弛的十六分音鼓。',
    bpm: 84,
    tracks: {
      keys: { pattern: 'stabs', timbre: 'epiano', on: true },
      guitar: { pattern: 'offbeat', timbre: 'clean', on: false },
      bass: { pattern: 'walking', timbre: 'synth', on: true },
      drums: { pattern: 'rnb', timbre: 'kit', on: true },
    },
    energy: { intro: 1, verse: 2, pre: 2, chorus: 3, bridge: 1, outro: 1 },
  },
]

let idCounter = 0
const newId = (kind: TrackKind) => `${kind}-${Date.now().toString(36)}-${(idCounter++).toString(36)}`

export function makeTrack(kind: TrackKind, pattern: TrackPattern, timbre: string, on = true): Track {
  return { id: newId(kind), kind, name: TRACK_LABEL[kind], source: 'auto', pattern, notes: [], timbre, volume: 0.8, pan: kind === 'guitar' ? -0.3 : kind === 'keys' ? 0.25 : 0, mute: !on, solo: false }
}

/**
 * Tracks for a score. Scores from before P4 have only `accompaniment`
 * (comp / bass / drums styles); those map onto keys / bass / drums tracks.
 */
export function ensureTracks(s: Score): Track[] {
  if (s.tracks) return s.tracks
  const { comp, bass, drums } = s.accompaniment
  return [
    { ...makeTrack('keys', comp === 'off' ? 'block' : comp === 'strum' ? 'block' : comp, 'piano', comp !== 'off'), id: 'keys' },
    { ...makeTrack('guitar', 'strum', 'clean', comp === 'strum'), id: 'guitar' },
    { ...makeTrack('bass', bass === 'off' ? 'roots' : bass, 'finger', bass !== 'off'), id: 'bass' },
    { ...makeTrack('drums', drums === 'off' ? 'pop' : drums, 'kit', drums !== 'off'), id: 'drums' },
  ]
}

export function withTracks(s: Score): Score {
  return s.tracks ? s : { ...s, tracks: ensureTracks(s) }
}

/** Apply a style template: patterns, sounds, tempo and section energies. */
export function applyStyle(s: Score, style: StyleTemplate): Score {
  const tracks = ensureTracks(s).map((t) => {
    const cfg = style.tracks[t.kind]
    return { ...t, source: 'auto' as const, notes: [], pattern: cfg.pattern, timbre: cfg.timbre, mute: !cfg.on }
  })
  const sections = s.sections?.map((sec) => ({ ...sec, energy: style.energy[sec.label] ?? sec.energy }))
  return { ...s, bpm: style.bpm, tracks, ...(sections ? { sections } : {}) }
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function energyAt(s: Score, beat: number): 1 | 2 | 3 {
  return sectionAt(s, beat)?.energy ?? 2
}

function isOff(s: Score, kind: TrackKind, beat: number): boolean {
  return Boolean(sectionAt(s, beat)?.off?.includes(kind))
}

/** Close-position voicing around C4 (keys) or E3 (guitar). */
function voicing(s: Score, slot: ChordSlot, centre: number): number[] {
  const root = slotRoot(s, slot)
  let r = root
  while (r < centre - 7) r += 12
  while (r > centre + 4) r -= 12
  return chordNotes(r, slotQuality(s, slot))
}

function bassNote(s: Score, slot: ChordSlot): number {
  let m = slotRoot(s, slot) + slotBassInterval(s, slot)
  while (m > 47) m -= 12
  while (m < 33) m += 12
  return m
}

/** Beats of each chord, split at section boundaries so energy can change mid-chord. */
function chordSegments(s: Score): Array<{ slot: ChordSlot; start: number; end: number }> {
  const out: Array<{ slot: ChordSlot; start: number; end: number }> = []
  const bounds = new Set<number>((s.sections ?? []).flatMap((sec) => [sec.start * s.beatsPerBar, (sec.start + sec.bars) * s.beatsPerBar]))
  for (const slot of [...s.chords].sort((a, b) => a.start - b.start)) {
    let cur = slot.start
    const end = slot.start + slot.beats
    const cuts = [...bounds].filter((b) => b > cur + 1e-6 && b < end - 1e-6).sort((a, b) => a - b)
    for (const c of [...cuts, end]) {
      out.push({ slot, start: cur, end: c })
      cur = c
    }
  }
  return out
}

function keysEvents(s: Score, t: Track): Omit<ArrEvent, 'track'>[] {
  const out: Omit<ArrEvent, 'track'>[] = []
  for (const seg of chordSegments(s)) {
    if (isOff(s, 'keys', seg.start)) continue
    const e = energyAt(s, seg.start)
    const v = voicing(s, seg.slot, 60)
    const len = seg.end - seg.start
    const vel = 0.35 + e * 0.07
    const pattern = e === 1 && t.pattern === 'block' ? 'pad' : t.pattern
    if (pattern === 'pad') {
      for (const m of v) out.push({ part: 'keys', start: seg.start, beats: len * 0.98, midi: m, velocity: vel - 0.05 })
    } else if (pattern === 'block') {
      const step = e === 3 ? 1 : 2
      for (let x = 0; x < len - 1e-6; x += step) for (const m of v) out.push({ part: 'keys', start: seg.start + x, beats: Math.min(step, len - x) * 0.92, midi: m, velocity: vel })
    } else if (pattern === 'arpeggio') {
      const step = e === 1 ? 1 : 0.5
      const seq = [...v, v[1]!]
      for (let x = 0, k = 0; x < len - 1e-6; x += step, k++) out.push({ part: 'keys', start: seg.start + x, beats: step, midi: seq[k % seq.length]!, velocity: vel - 0.05 })
    } else if (pattern === 'stabs') {
      for (let x = 0.5; x < len - 1e-6; x += e === 3 ? 0.5 : 1) for (const m of v) out.push({ part: 'keys', start: seg.start + x, beats: 0.3, midi: m, velocity: vel })
    }
  }
  return out
}

function guitarEvents(s: Score, t: Track): Omit<ArrEvent, 'track'>[] {
  const out: Omit<ArrEvent, 'track'>[] = []
  for (const seg of chordSegments(s)) {
    if (isOff(s, 'guitar', seg.start)) continue
    const e = energyAt(s, seg.start)
    const len = seg.end - seg.start
    const vel = 0.32 + e * 0.08
    if (t.pattern === 'power8') {
      const root = bassNote(s, seg.slot) + 12
      const step = e === 1 ? 1 : 0.5
      for (let x = 0; x < len - 1e-6; x += step) for (const m of [root, root + 7]) out.push({ part: 'guitar', start: seg.start + x, beats: step * 0.8, midi: m, velocity: vel })
    } else if (t.pattern === 'strum') {
      const v = voicing(s, seg.slot, 52)
      const hits = e === 1 ? [0] : e === 2 ? [0, 1, 1.5, 2.5, 3, 3.5] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]
      for (let bar = 0; bar < len - 1e-6; bar += 4) {
        for (const h of hits) {
          if (bar + h >= len - 1e-6) continue
          v.forEach((m, i) => out.push({ part: 'guitar', start: seg.start + bar + h + i * 0.012, beats: e === 1 ? 3.5 : 0.45, midi: m, velocity: h % 1 ? vel * 0.75 : vel }))
        }
      }
    } else if (t.pattern === 'arpeggio') {
      const v = voicing(s, seg.slot, 55)
      const seq = [bassNote(s, seg.slot) + 12, ...v, v[1]!]
      for (let x = 0, k = 0; x < len - 1e-6; x += 0.5, k++) out.push({ part: 'guitar', start: seg.start + x, beats: 0.9, midi: seq[k % seq.length]!, velocity: vel * 0.8 })
    } else if (t.pattern === 'offbeat') {
      const v = voicing(s, seg.slot, 60)
      for (let x = 0.5; x < len - 1e-6; x += 1) for (const m of v) out.push({ part: 'guitar', start: seg.start + x, beats: 0.2, midi: m, velocity: vel })
    }
  }
  return out
}

function bassEvents(s: Score, t: Track): Omit<ArrEvent, 'track'>[] {
  const out: Omit<ArrEvent, 'track'>[] = []
  const segs = chordSegments(s)
  segs.forEach((seg, i) => {
    if (isOff(s, 'bass', seg.start)) return
    const e = energyAt(s, seg.start)
    const len = seg.end - seg.start
    const r = bassNote(s, seg.slot)
    const vel = 0.65 + e * 0.08
    let pattern = t.pattern
    if (e === 1 && (pattern === 'root8' || pattern === 'roots')) pattern = 'roots'
    if (e === 3 && pattern === 'roots') pattern = 'root8'
    const step = pattern === 'root8' ? 0.5 : e === 1 ? 2 : 1
    for (let x = 0, k = 0; x < len - 1e-6; x += step, k++) {
      let m = r
      if (pattern === 'fifths' && k % 2 === 1) m = r + 7
      if (pattern === 'octaves' && k % 2 === 1) m = r + 12
      if (pattern === 'walking') {
        const next = segs[i + 1]
        const isLast = x + step >= len - 1e-6
        if (isLast && next) {
          const target = bassNote(s, next.slot)
          m = target > r ? target - 1 : target + 1
        } else if (k % 4 === 2) m = r + (chordTypeById(slotQuality(s, seg.slot)).intervals[2] ?? 7)
      }
      out.push({ part: 'bass', start: seg.start + x, beats: step * 0.9, midi: m, velocity: vel })
    }
  })
  return out
}

function drumEvents(s: Score, t: Track): Omit<ArrEvent, 'track'>[] {
  const out: Omit<ArrEvent, 'track'>[] = []
  const total = s.bars * s.beatsPerBar
  const hit = (part: keyof typeof DRUM, start: number, velocity: number) => out.push({ part, start, beats: 0.2, midi: DRUM[part], velocity })
  for (let bar = 0; bar < total; bar += s.beatsPerBar) {
    if (isOff(s, 'drums', bar)) continue
    const e = energyAt(s, bar)
    const sec = sectionAt(s, bar)
    if (e === 3 && sec && sec.start * s.beatsPerBar === bar) hit('crash', bar, 0.7)
    const p = t.pattern
    // Kick
    const kicks =
      p === 'rock' ? [0, 2, 2.5] : p === 'pop' ? [0, 1.5, 2] : p === 'halftime' ? [0, 1.5] : p === 'punk' ? [0, 1, 2, 3] : p === 'rnb' ? [0, 1.75, 2.5] : [0, 1, 2, 3]
    const kickSet = e === 1 ? kicks.filter((k) => k === 0 || k === 2) : kicks
    for (const k of kickSet) hit('kick', bar + k, 0.85)
    // Snare
    const snares = p === 'halftime' ? [2] : [1, 3]
    for (const k of snares) hit('snare', bar + k, e === 1 ? 0.45 : 0.8)
    // Hats
    const hatStep = e === 1 ? 1 : p === 'rnb' || (e === 3 && p !== 'punk' && p !== 'halftime') ? 0.25 : 0.5
    for (let h = 0; h < s.beatsPerBar - 1e-6; h += hatStep) {
      if (p === 'four' && h % 1 === 0.5 && e >= 2) hit('openhat', bar + h, 0.5)
      else hit('hat', bar + h, h % 1 ? 0.3 : 0.45)
    }
  }
  return out
}

function autoEvents(s: Score, t: Track): Omit<ArrEvent, 'track'>[] {
  switch (t.kind) {
    case 'keys':
      return keysEvents(s, t)
    case 'guitar':
      return guitarEvents(s, t)
    case 'bass':
      return bassEvents(s, t)
    case 'drums':
      return drumEvents(s, t)
  }
}

export function trackEvents(s: Score, t: Track): ArrEvent[] {
  if (t.source === 'manual') {
    return t.notes
      .filter((n) => !isOff(s, t.kind, n.start))
      .map((n) => ({ track: t.id, part: t.kind === 'drums' ? (DRUM_PART[n.midi] ?? 'snare') : t.kind, start: n.start, beats: n.beats, midi: n.midi, velocity: t.kind === 'drums' ? 0.8 : 0.7 }))
  }
  return autoEvents(s, t).map((e) => ({ ...e, track: t.id }))
}

/** Every audible event of the arrangement, honouring mute and solo. */
export function arrangementEvents(s: Score): ArrEvent[] {
  const tracks = ensureTracks(s)
  const lead = s.lead ?? { volume: 0.9, pan: 0, mute: false, solo: false, timbre: 'lead' }
  const anySolo = lead.solo || tracks.some((t) => t.solo)
  const audible = (mute: boolean, solo: boolean) => (anySolo ? solo : !mute)
  const out: ArrEvent[] = []
  if (audible(lead.mute, lead.solo)) for (const n of s.melody) out.push({ track: 'lead', part: 'lead', start: n.start, beats: n.beats * 0.95, midi: n.midi, velocity: 0.9 })
  for (const t of tracks) if (audible(t.mute, t.solo)) out.push(...trackEvents(s, t))
  return out.sort((a, b) => a.start - b.start)
}

/** Freeze an auto track into editable notes. */
export function materialize(s: Score, t: Track): Track {
  if (t.source === 'manual') return t
  const seen = new Set<string>()
  const notes: ScoreNote[] = []
  for (const e of autoEvents(s, t)) {
    const start = Math.round(e.start * 4) / 4
    const key = `${start}:${e.midi}`
    if (seen.has(key)) continue
    seen.add(key)
    notes.push({ start, beats: Math.max(0.25, Math.round(e.beats * 4) / 4), midi: e.midi })
  }
  return { ...t, source: 'manual', notes: notes.sort((a, b) => a.start - b.start || a.midi - b.midi) }
}

export function updateTrack(s: Score, id: string, patch: Partial<Track>): Score {
  return { ...s, tracks: ensureTracks(s).map((t) => (t.id === id ? { ...t, ...patch } : t)) }
}

/** Toggle a note in a manual track (polyphonic: same start + pitch removes it). */
export function toggleTrackNote(s: Score, id: string, note: ScoreNote): Score {
  const t = ensureTracks(s).find((x) => x.id === id)
  if (!t) return s
  const exists = t.notes.find((n) => Math.abs(n.start - note.start) < 1e-6 && n.midi === note.midi)
  const notes = exists ? t.notes.filter((n) => n !== exists) : [...t.notes, note].sort((a, b) => a.start - b.start)
  return updateTrack(s, id, { notes, source: 'manual' })
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

export function setSection(s: Score, section: Section): Score {
  const end = section.start + section.bars
  const kept = (s.sections ?? []).filter((x) => x.start + x.bars <= section.start || x.start >= end)
  return { ...s, sections: [...kept, section].sort((a, b) => a.start - b.start) }
}

export function removeSection(s: Score, start: number): Score {
  return { ...s, sections: (s.sections ?? []).filter((x) => x.start !== start) }
}

/** Notes per beat for each section, a rough "energy" measure used by the rule engine and the curve display. */
export function sectionDensity(s: Score): Array<{ section: Section; density: number }> {
  const events = arrangementEvents(s)
  return (s.sections ?? []).map((section) => {
    const from = section.start * s.beatsPerBar
    const to = (section.start + section.bars) * s.beatsPerBar
    const n = events.filter((e) => e.start >= from - 1e-6 && e.start < to - 1e-6).length
    return { section, density: n / Math.max(1, to - from) }
  })
}
