/**
 * 鼓谱 shared by the score server (server/) and its web page (web/): an editable
 * step-grid drum part — converted from a file's drum track, generated (templates
 * or Drumify), or written by hand — kept apart from the score file, which is never changed.
 * Types, constants and tiny pure helpers only, so both sides can import it.
 */

/** Drum kit pieces, top to bottom as rows of the grid. */
export type DrumPiece =
  | 'crash'
  | 'china'
  | 'splash'
  | 'ride'
  | 'rideBell'
  | 'hihatOpen'
  | 'hihatClosed'
  | 'hihatPedal'
  | 'tomHigh'
  | 'tomMid'
  | 'snare'
  | 'sideStick'
  | 'tomFloor'
  | 'kick'
  | 'cowbell'
  | 'tambourine'
  | 'clap'

export interface DrumPieceInfo {
  id: DrumPiece
  /** Chinese name shown in the grid's row header. */
  zh: string
  /** Short label for the text tab ("HH", "SD", "BD"…), 2 characters. */
  abbr: string
  /** General MIDI percussion key (channel 10) used to play and export it. */
  midi: number
  /** Other GM keys that are read as this piece when converting a file's drum track. */
  alsoMidi: number[]
  /** Shown by default (the rest appear only when the part uses them). */
  common: boolean
}

/** Rows of the grid, in this order. */
export const DRUM_PIECES: ReadonlyArray<DrumPieceInfo> = [
  { id: 'crash', zh: '吊镲', abbr: 'CR', midi: 49, alsoMidi: [57, 55], common: true },
  { id: 'china', zh: '中国镲', abbr: 'CH', midi: 52, alsoMidi: [], common: false },
  { id: 'splash', zh: '水镲', abbr: 'SP', midi: 55, alsoMidi: [], common: false },
  { id: 'ride', zh: '叮叮镲', abbr: 'RD', midi: 51, alsoMidi: [59], common: true },
  { id: 'rideBell', zh: '叮叮镲帽', abbr: 'RB', midi: 53, alsoMidi: [], common: false },
  { id: 'hihatOpen', zh: '开镲', abbr: 'OH', midi: 46, alsoMidi: [], common: true },
  { id: 'hihatClosed', zh: '踩镲', abbr: 'HH', midi: 42, alsoMidi: [], common: true },
  { id: 'hihatPedal', zh: '踩镲（脚）', abbr: 'HP', midi: 44, alsoMidi: [], common: false },
  { id: 'tomHigh', zh: '高通鼓', abbr: 'T1', midi: 48, alsoMidi: [50], common: true },
  { id: 'tomMid', zh: '中通鼓', abbr: 'T2', midi: 45, alsoMidi: [47], common: true },
  { id: 'snare', zh: '军鼓', abbr: 'SD', midi: 38, alsoMidi: [40], common: true },
  { id: 'sideStick', zh: '边击', abbr: 'SS', midi: 37, alsoMidi: [], common: false },
  { id: 'tomFloor', zh: '落地通鼓', abbr: 'FT', midi: 43, alsoMidi: [41], common: true },
  { id: 'kick', zh: '底鼓', abbr: 'BD', midi: 36, alsoMidi: [35], common: true },
  { id: 'cowbell', zh: '牛铃', abbr: 'CB', midi: 56, alsoMidi: [], common: false },
  { id: 'tambourine', zh: '铃鼓', abbr: 'TB', midi: 54, alsoMidi: [], common: false },
  { id: 'clap', zh: '拍手', abbr: 'CP', midi: 39, alsoMidi: [], common: false },
]

/** 1 = ghost (鬼音), 2 = normal, 3 = accent (重音). */
export type DrumVelocity = 1 | 2 | 3

/** MIDI velocity for each level when playing / exporting. */
export const DRUM_VELOCITY_MIDI: Record<DrumVelocity, number> = { 1: 45, 2: 90, 3: 120 }

export interface DrumHit {
  /** 0-based step inside the bar. */
  step: number
  piece: DrumPiece
  vel: DrumVelocity
}

export interface DrumBar {
  /** Time signature of this bar (copied from the score's master bar). */
  num: number
  den: number
  /**
   * Grid resolution: steps per quarter note. 4 = sixteenth notes (straight),
   * 3 = eighth-note triplets, 6 = sixteenth-note triplets.
   * Steps in the bar = num × (4 / den) × stepsPerQuarter.
   */
  stepsPerQuarter: 4 | 3 | 6
  /** Sorted by step, then by piece order; at most one hit per (step, piece). */
  hits: DrumHit[]
}

export type DrumSource = 'file' | 'template' | 'drumify' | 'hand'

/** A whole drum part for one score file: exactly one bar per master bar of the score. */
export interface DrumPart {
  version: 1
  /** The score file (relative path in the library). */
  path: string
  title: string
  artist: string
  bars: DrumBar[]
  /** How the part started; editing keeps it but sets `edited`. */
  source: DrumSource
  edited: boolean
  /** Style id of the templates used, when generated from templates. */
  style: string | null
  updatedAt: number
  /** Account id of the last saver. */
  updatedBy: string
}

/** Number of steps in a bar. */
export function barSteps(bar: Pick<DrumBar, 'num' | 'den' | 'stepsPerQuarter'>): number {
  return Math.round((bar.num * 4 * bar.stepsPerQuarter) / bar.den)
}

// ---------------------------------------------------------------------------
// templates (from the Groove MIDI Dataset, CC BY 4.0, Google LLC)
// ---------------------------------------------------------------------------

/** One style of the template library, e.g. rock 8 beat. */
export interface DrumStyle {
  id: string
  /** Chinese name shown in the style picker, e.g. "摇滚 8 分". */
  zh: string
  /** Meter it fits: "4/4", "3/4", "6/8", "12/8". */
  meter: string
  /** Tempo range it suits (bpm, quarter notes). */
  minBpm: number
  maxBpm: number
  /** 1–2 bar main grooves (bars are listed one after another; a pattern is 1 or 2 bars). */
  grooves: Array<{ bars: DrumBar[]; weight: number }>
  /** Variations for the chorus (busier: ride / open hi-hat / more kicks). */
  chorus: Array<{ bars: DrumBar[]; weight: number }>
  /** One-bar fills for the last bar of a section. */
  fills: Array<{ bars: DrumBar[]; weight: number }>
}

export interface DrumTemplateLibrary {
  version: 1
  source: string
  license: string
  styles: DrumStyle[]
}

// ---------------------------------------------------------------------------
// what the generators need to know about the song
// ---------------------------------------------------------------------------

/** Per master bar facts of the song, read from the score. */
export interface SongBarInfo {
  num: number
  den: number
  /** Tempo at the start of the bar (quarter notes per minute). */
  bpm: number
  /** Section marker starting at this bar ("Verse", "副歌"…), or null. */
  section: string | null
  /** Onsets of the guide (rhythm) instrument in this bar, in quarter notes from the bar start, with 0–127 velocity. */
  onsets: Array<{ at: number; vel: number }>
  /** The bar has triplet-feel notes (tuplets of 3) in the guide track. */
  triplet: boolean
}

/** POST /api/drums/generate */
export interface GenerateDrumsBody {
  path: string
  title: string
  artist: string
  engine: 'template' | 'drumify'
  /** Template style id; null = pick automatically from meter and tempo. */
  style: string | null
  /** Index of the track whose rhythm guides the drums (usually a rhythm guitar); null = automatic. */
  guideTrack: number | null
  /** Only regenerate bars [first, last] (0-based, inclusive) of an existing part; null = whole song. */
  range: [number, number] | null
  /** 0.1–1.5: Drumify randomness (higher = busier, less predictable). Ignored by templates. */
  temperature: number
}

/** Answer of POST /api/drums/generate: bars for [first, first + bars.length - 1]. Not saved yet. */
export interface GenerateDrumsResult {
  first: number
  bars: DrumBar[]
  source: 'template' | 'drumify'
  style: string | null
}

/** POST /api/drums/save */
export interface SaveDrumsBody {
  part: DrumPart
}

/** GET /api/drums/styles: the template styles for the picker (without their patterns). */
export interface DrumStyleInfo {
  id: string
  zh: string
  meter: string
  minBpm: number
  maxBpm: number
}
