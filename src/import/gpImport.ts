/**
 * Guitar Pro (and anything else alphaTab reads) → sheet metadata and practice
 * material (pure, given an alphaTab Score).
 *
 * alphaTab itself is loaded at runtime (public/alphatab, see
 * audio/alphatabLoader.ts); this module only uses its types, so tests can pass
 * scores parsed with the npm package.
 */
import type { model } from '@coderline/alphatab'
import type { TabNote, Technique } from '@/guitar/scales'

type AtScore = model.Score
type AtNote = model.Note

/** alphaTab ticks per quarter note. */
export const QUARTER_TICKS = 960

export type SheetFormat = 'gp3' | 'gp4' | 'gp5' | 'gpx' | 'gp' | 'musicxml' | 'mxl' | 'midi' | 'chords' | 'tab'

/** Formats alphaTab can render and play (the original file is kept for these). */
export const ALPHATAB_FORMATS: readonly SheetFormat[] = ['gp3', 'gp4', 'gp5', 'gpx', 'gp', 'musicxml', 'mxl']

export function formatFromName(name: string): SheetFormat | null {
  const ext = name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  switch (ext) {
    case 'gp3':
    case 'gp4':
    case 'gp5':
    case 'gpx':
    case 'gp':
      return ext
    case 'musicxml':
    case 'xml':
      return 'musicxml'
    case 'mxl':
      return 'mxl'
    case 'mid':
    case 'midi':
      return 'midi'
    default:
      return null
  }
}

export const FORMAT_LABEL: Record<SheetFormat, string> = {
  gp3: 'Guitar Pro 3',
  gp4: 'Guitar Pro 4',
  gp5: 'Guitar Pro 5',
  gpx: 'Guitar Pro 6',
  gp: 'Guitar Pro 7/8',
  musicxml: 'MusicXML',
  mxl: 'MusicXML',
  midi: 'MIDI',
  chords: '和弦谱',
  tab: '六线谱',
}

export type TrackInstrument = 'guitar' | 'bass' | 'drums' | 'keys' | 'voice' | 'other'

export interface SheetTrackInfo {
  index: number
  name: string
  instrument: TrackInstrument
  /** Open-string MIDI notes, lowest string first (empty for drums / keys). */
  tuning: number[]
  capo: number
  /** Number of notes in the track (to spot empty tracks). */
  notes: number
}

export interface SheetMeta {
  title: string
  artist: string
  /** Who wrote the tab (GP "tab" field). */
  tabber: string
  album: string
  bpm: number
  bars: number
  tracks: SheetTrackInfo[]
  /** Section markers (Intro, Verse…) by bar. */
  sections: Array<{ bar: number; name: string }>
}

/** General MIDI program → instrument family. */
export function instrumentOf(program: number, percussion: boolean, strings: number): TrackInstrument {
  if (percussion) return 'drums'
  if (program >= 32 && program <= 39) return 'bass'
  if (program >= 24 && program <= 31) return strings === 4 || strings === 5 ? 'bass' : 'guitar'
  if (program <= 23) return strings > 0 ? 'guitar' : 'keys'
  if (program >= 52 && program <= 54) return 'voice'
  if (strings >= 6) return 'guitar'
  if (strings === 4 || strings === 5) return 'bass'
  return 'other'
}

const clean = (s: string | undefined | null) => (s ?? '').replace(/\s+/g, ' ').trim()

export function readSheetMeta(score: AtScore): SheetMeta {
  const tracks: SheetTrackInfo[] = score.tracks.map((t) => {
    const staff = t.staves[0]
    const tuning = staff && !staff.isPercussion ? [...staff.tuning].reverse() : []
    let notes = 0
    for (const bar of staff?.bars ?? []) for (const v of bar.voices) for (const b of v.beats) notes += b.notes.length
    return {
      index: t.index,
      name: clean(t.name) || `音轨 ${t.index + 1}`,
      instrument: instrumentOf(t.playbackInfo.program, Boolean(staff?.isPercussion), tuning.length),
      tuning,
      capo: staff?.capo ?? 0,
      notes,
    }
  })
  return {
    title: clean(score.title),
    artist: clean(score.artist),
    tabber: clean(score.tab),
    album: clean(score.album),
    bpm: Math.round(score.tempo) || 90,
    bars: score.masterBars.length,
    tracks,
    sections: score.masterBars.flatMap((mb) => (mb.section ? [{ bar: mb.index, name: clean(mb.section.text) || clean(mb.section.marker) || `段落 ${mb.index + 1}` }] : [])),
  }
}

/** The guitar track a student most likely wants: a guitar with the most notes, else any pitched track. */
export function defaultTrack(meta: SheetMeta): number {
  const pitched = meta.tracks.filter((t) => t.instrument !== 'drums' && t.notes > 0)
  const guitars = pitched.filter((t) => t.instrument === 'guitar')
  const pick = (xs: SheetTrackInfo[]) => xs.reduce((a, b) => (b.notes > a.notes ? b : a))
  if (guitars.length) return pick(guitars).index
  if (pitched.length) return pick(pitched).index
  return 0
}

function techniqueOf(n: AtNote, next: AtNote | undefined): Technique | undefined {
  if (n.hasBend) {
    const peak = Math.max(0, ...(n.bendPoints ?? []).map((p) => p.value))
    // alphaTab bend values are quarter tones: 4 = a whole step.
    return peak > 0 && peak <= 2 ? 'bend-half' : 'bend'
  }
  if (n.isHammerPullOrigin && next) return next.fret >= n.fret ? 'hammer' : 'pull'
  if (n.slideOutType !== 0) return 'slide'
  if (n.vibrato !== 0) return 'vibrato'
  return undefined
}

export interface TrackTab {
  notes: TabNote[]
  /** Open strings of the track, lowest first (what the student must tune to). */
  tuning: number[]
  capo: number
  warnings: string[]
}

/**
 * One track, bars [fromBar, toBar), as a single-line tab: the highest note of
 * each beat (chords keep their top note), ties merged into the note they
 * continue, rests added to the previous note's length. Durations are in
 * quarter notes.
 */
export function trackToTab(score: AtScore, trackIndex: number, fromBar = 0, toBar = score.masterBars.length): TrackTab {
  const track = score.tracks[trackIndex]
  const staff = track?.staves[0]
  if (!track || !staff) return { notes: [], tuning: [], capo: 0, warnings: ['找不到这条音轨。'] }
  if (staff.isPercussion) return { notes: [], tuning: [], capo: 0, warnings: ['鼓轨没有音高，不能用来练旋律。'] }
  const strings = staff.tuning.length
  const warnings: string[] = []
  let chords = 0
  let multiVoice = false
  const notes: TabNote[] = []
  const end = Math.min(toBar, score.masterBars.length)
  let leadRest = 0
  for (let b = Math.max(0, fromBar); b < end; b++) {
    const bar = staff.bars[b]
    if (!bar) continue
    if (bar.voices.slice(1).some((v) => !v.isEmpty)) multiVoice = true
    const beats = bar.voices[0]?.beats ?? []
    beats.forEach((beat, i) => {
      const len = beat.playbackDuration / QUARTER_TICKS
      const playable = beat.notes.filter((n) => !n.isDead && n.string >= 1 && n.string <= strings)
      if (beat.isRest || playable.length === 0) {
        if (notes.length) notes[notes.length - 1]!.beats += len
        else leadRest += len
        return
      }
      if (playable.length > 1) chords++
      const top = playable.reduce((a, n) => (n.realValue > a.realValue ? n : a))
      if (top.isTieDestination && notes.length) {
        notes[notes.length - 1]!.beats += len
        return
      }
      const nextBeat = beats[i + 1] ?? staff.bars[b + 1]?.voices[0]?.beats[0]
      const next = nextBeat?.notes.find((n) => n.string === top.string)
      const tech = techniqueOf(top, next)
      notes.push({ string: top.string - 1, fret: top.fret, beats: len, ...(tech ? { tech } : {}) })
    })
  }
  for (const n of notes) n.beats = Math.max(0.125, Math.round(n.beats * 8) / 8)
  if (chords) warnings.push(`有 ${chords} 处和弦或双音，练习时只取最高的那个音。`)
  if (multiVoice) warnings.push('这条音轨有多个声部，练习时只取第一个声部。')
  if (leadRest > 0 && notes.length) warnings.push('开头的休止已省略，从第一个音开始。')
  return { notes, tuning: [...staff.tuning].reverse(), capo: staff.capo, warnings }
}

/**
 * Chord names written in the track (GP chord diagrams / names) as a text chord
 * chart, one "| … |" bar per bar, so it can go through the chord-chart
 * importer. Null when the track has no chord names.
 */
export function trackChordChart(score: AtScore, trackIndex: number): string | null {
  const staff = score.tracks[trackIndex]?.staves[0]
  if (!staff) return null
  let any = false
  let last = ''
  const bars: string[] = []
  for (const bar of staff.bars) {
    const names: string[] = []
    for (const beat of bar.voices[0]?.beats ?? []) {
      const name = clean(beat.chord?.name)
      if (name && name !== names[names.length - 1]) names.push(name)
    }
    if (names.length) {
      any = true
      last = names[names.length - 1]!
      bars.push(names.slice(0, 4).join(' '))
    } else {
      bars.push(last)
    }
  }
  if (!any) return null
  return bars.map((b) => `| ${b || '-'} `).join('') + '|'
}

/** Lowercase, no spaces or punctuation: "Wonderwall (Live)" and "wonderwall live" group together. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')
}
