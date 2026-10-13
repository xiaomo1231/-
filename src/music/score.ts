import { chordNotes, chordTypeById, type ChordTypeId } from './chords'
import { romanChord, romanLabel, type Mode, type RomanId } from './keys'
import { pitchClass } from './pitch'
import { spell, spelledName } from './spelling'

/**
 * The single music model behind every notation view (staff, jianpu, tab),
 * the composer and the rule engine. Times are in beats (quarter = 1) from
 * the start of the piece; 4/4 only for now.
 */
export interface ScoreNote {
  start: number
  beats: number
  midi: number
  /** One syllable / character sung on this note. */
  lyric?: string
}

export interface ChordSlot {
  start: number
  beats: number
  roman: RomanId
  /** Colour override (7th, sus, add9, power…); defaults to the diatonic triad. */
  quality?: ChordTypeId
  /** Bass note: 0 = root (default), 1 = third (first inversion), 2 = fifth (second inversion). */
  bass?: 0 | 1 | 2
}

export type SectionLabel = 'intro' | 'verse' | 'pre' | 'chorus' | 'bridge' | 'outro'

export const SECTION_LABEL: Record<SectionLabel, string> = {
  intro: '前奏',
  verse: '主歌',
  pre: '预副歌',
  chorus: '副歌',
  bridge: '桥段',
  outro: '尾奏',
}

/** A song section over whole bars. */
export interface Section {
  /** First bar (0-based). */
  start: number
  bars: number
  label: SectionLabel
  /** 1 = sparse, 2 = normal, 3 = full. Drives auto-generated parts. */
  energy: 1 | 2 | 3
  /** Key change for this section in semitones (chords and auto parts follow; melody notes are absolute). */
  transpose?: number
  /** Tracks that sit out in this section. */
  off?: TrackKind[]
}

export type TrackKind = 'keys' | 'guitar' | 'bass' | 'drums'

export type KeysPattern = 'block' | 'arpeggio' | 'pad' | 'stabs'
export type GuitarPattern = 'strum' | 'power8' | 'arpeggio' | 'offbeat'
export type BassPattern = 'roots' | 'root8' | 'fifths' | 'octaves' | 'walking'
export type DrumPattern = 'rock' | 'pop' | 'halftime' | 'punk' | 'rnb' | 'four'
export type TrackPattern = KeysPattern | GuitarPattern | BassPattern | DrumPattern

/**
 * An accompaniment track. `auto` tracks are generated from the chord track,
 * sections and pattern; `manual` tracks play their own notes (for drums the
 * MIDI numbers are GM drum keys: 36 kick, 38 snare, 42 hat, 46 open hat, 49 crash).
 */
export interface Track {
  id: string
  kind: TrackKind
  name: string
  source: 'auto' | 'manual'
  pattern: TrackPattern
  notes: ScoreNote[]
  /** Sound variant, e.g. 'piano' | 'epiano' | 'organ' (keys), 'clean' | 'drive' (guitar). */
  timbre: string
  /** 0–1. */
  volume: number
  /** −1 (left) … 1 (right). */
  pan: number
  mute: boolean
  solo: boolean
}

export type CompStyle = 'block' | 'arpeggio' | 'strum' | 'off'
export type BassStyle = 'roots' | 'fifths' | 'octaves' | 'off'
export type DrumStyle = 'off' | 'rock' | 'pop' | 'halftime'

export interface Accompaniment {
  comp: CompStyle
  bass: BassStyle
  drums: DrumStyle
}

export interface Score {
  /** Tonic MIDI note (e.g. 60 = C). For minor keys this is the minor tonic. */
  keyTonic: number
  mode: Mode
  bpm: number
  bars: number
  beatsPerBar: number
  melody: ScoreNote[]
  chords: ChordSlot[]
  accompaniment: Accompaniment
  /** Song sections (P4). Bars without a section count as energy 2, no key change. */
  sections?: Section[]
  /** Arrangement tracks (P4). Missing → derived from `accompaniment`. */
  tracks?: Track[]
  /** Lead (melody) track mix. */
  lead?: { volume: number; pan: number; mute: boolean; solo: boolean; timbre: string }
}

export const BEATS_PER_BAR = 4

export function emptyScore(partial: Partial<Score> = {}): Score {
  return {
    keyTonic: 60,
    mode: 'major',
    bpm: 96,
    bars: 4,
    beatsPerBar: BEATS_PER_BAR,
    melody: [],
    chords: [],
    accompaniment: { comp: 'block', bass: 'roots', drums: 'off' },
    ...partial,
  }
}

export function totalBeats(s: Pick<Score, 'bars' | 'beatsPerBar'>): number {
  return s.bars * s.beatsPerBar
}

/** Major-key tonic whose signature the score uses (relative major for minor keys). */
export function signatureTonicOf(s: Pick<Score, 'keyTonic' | 'mode'>): number {
  return s.mode === 'minor' ? s.keyTonic + 3 : s.keyTonic
}

/** Chord symbol for a roman numeral in this key, e.g. `Am`. */
/**
 * Spelling of a chord root. Borrowed chords written with ♭ (♭VII, ♭VI, ♭III)
 * are flat roots (B♭, not A♯), whatever the key signature says.
 */
export function spellChordRoot(roman: RomanId, rootMidi: number, signatureTonic: number) {
  return roman.startsWith('b') ? spell(rootMidi, { preferFlats: true }) : spell(rootMidi, { keyTonic: signatureTonic })
}

export function chordSymbolFor(s: Pick<Score, 'keyTonic' | 'mode'>, roman: RomanId): string {
  const c = romanChord(roman, s.mode)
  const rootPc = pitchClass(s.keyTonic + c.offset)
  const name = spelledName(spellChordRoot(roman, 60 + rootPc, signatureTonicOf(s)))
  return `${name}${chordTypeById(c.type).symbol}`
}

export function chordLabel(s: Pick<Score, 'keyTonic' | 'mode'>, slot: Pick<ChordSlot, 'roman'>): { roman: string; symbol: string } {
  return { roman: romanLabel(slot.roman), symbol: chordSymbolFor(s, slot.roman) }
}

/** Pitch classes of a chord slot. */
export function chordPitchClasses(s: Pick<Score, 'keyTonic' | 'mode'>, roman: RomanId): number[] {
  const c = romanChord(roman, s.mode)
  return chordNotes(s.keyTonic + c.offset, c.type).map(pitchClass)
}

// ---------------------------------------------------------------------------
// Sections, key changes and coloured chords (P4)
// ---------------------------------------------------------------------------

export function sectionAt(s: Pick<Score, 'sections' | 'beatsPerBar'>, beat: number): Section | undefined {
  const bar = Math.floor(beat / s.beatsPerBar + 1e-6)
  return s.sections?.find((x) => bar >= x.start && bar < x.start + x.bars)
}

/** Tonic in force at a beat (key changes come from sections). */
export function tonicAt(s: Pick<Score, 'keyTonic' | 'sections' | 'beatsPerBar'>, beat: number): number {
  return s.keyTonic + (sectionAt(s, beat)?.transpose ?? 0)
}

type KeyCtx = Pick<Score, 'keyTonic' | 'mode'> & Partial<Pick<Score, 'sections' | 'beatsPerBar'>>

const ctxTonic = (s: KeyCtx, beat: number) =>
  s.sections && s.beatsPerBar ? tonicAt({ keyTonic: s.keyTonic, sections: s.sections, beatsPerBar: s.beatsPerBar }, beat) : s.keyTonic

export function slotQuality(s: Pick<Score, 'mode'>, slot: Pick<ChordSlot, 'roman' | 'quality'>): ChordTypeId {
  return slot.quality ?? romanChord(slot.roman, s.mode).type
}

/** Root MIDI (near the key tonic) of a chord slot, honouring key changes. */
export function slotRoot(s: KeyCtx, slot: Pick<ChordSlot, 'roman' | 'start'>): number {
  return ctxTonic(s, slot.start) + romanChord(slot.roman, s.mode).offset
}

/** Pitch classes of a chord slot, including its colour tones. */
export function slotPitchClasses(s: KeyCtx, slot: Pick<ChordSlot, 'roman' | 'start' | 'quality'>): number[] {
  return chordNotes(slotRoot(s, slot), slotQuality(s, slot)).map(pitchClass)
}

/** Interval (semitones above the root) of the slot's bass note. */
export function slotBassInterval(s: Pick<Score, 'mode'>, slot: Pick<ChordSlot, 'roman' | 'quality' | 'bass'>): number {
  const ints = chordTypeById(slotQuality(s, slot)).intervals
  return ints[Math.min(slot.bass ?? 0, ints.length - 1)]!
}

/** Full chord symbol for a slot, e.g. `Am7`, `C/E`, `Gsus4`. */
export function slotSymbol(s: KeyCtx, slot: Pick<ChordSlot, 'roman' | 'start' | 'quality' | 'bass'>): string {
  const tonic = ctxTonic(s, slot.start)
  const sig = s.mode === 'minor' ? tonic + 3 : tonic
  const root = slotRoot(s, slot)
  const name = spelledName(spellChordRoot(slot.roman, 60 + pitchClass(root), sig))
  const q = slotQuality(s, slot)
  const bassInt = slotBassInterval(s, slot)
  const slash = bassInt ? `/${spelledName(spell(60 + pitchClass(root + bassInt), { keyTonic: sig }))}` : ''
  return `${name}${chordTypeById(q).symbol}${slash}`
}

export function chordAt(s: Pick<Score, 'chords'>, beat: number): ChordSlot | undefined {
  return s.chords.find((c) => beat >= c.start - 1e-6 && beat < c.start + c.beats - 1e-6)
}

// ---------------------------------------------------------------------------
// Editing helpers (pure). The melody is monophonic and never crosses a bar.
// ---------------------------------------------------------------------------

const EPS = 1e-6

/** Insert a note, trimming it at the bar line and removing anything it overlaps. */
export function addNote(s: Score, note: ScoreNote): Score {
  const barEnd = (Math.floor(note.start / s.beatsPerBar + EPS) + 1) * s.beatsPerBar
  const beats = Math.max(0.25, Math.min(note.beats, barEnd - note.start))
  const end = note.start + beats
  const melody = s.melody
    .filter((n) => n.start + n.beats <= note.start + EPS || n.start >= end - EPS)
    .concat({ ...note, beats })
    .sort((a, b) => a.start - b.start)
  return { ...s, melody }
}

export function removeNoteAt(s: Score, start: number): Score {
  return { ...s, melody: s.melody.filter((n) => Math.abs(n.start - start) > EPS) }
}

/** The note sounding at a beat, if any. */
export function noteAt(s: Pick<Score, 'melody'>, beat: number): ScoreNote | undefined {
  return s.melody.find((n) => beat >= n.start - EPS && beat < n.start + n.beats - EPS)
}

export function setChord(s: Score, slot: ChordSlot | { start: number; beats: number; roman: null }): Score {
  const end = slot.start + slot.beats
  const kept = s.chords.filter((c) => c.start + c.beats <= slot.start + EPS || c.start >= end - EPS)
  const chords = slot.roman ? [...kept, slot as ChordSlot] : kept
  return { ...s, chords: chords.sort((a, b) => a.start - b.start) }
}

/** Resize to a new bar count, dropping material beyond the end. */
export function resizeScore(s: Score, bars: number): Score {
  const end = bars * s.beatsPerBar
  return {
    ...s,
    bars,
    melody: s.melody.filter((n) => n.start < end - EPS).map((n) => ({ ...n, beats: Math.min(n.beats, end - n.start) })),
    chords: s.chords.filter((c) => c.start < end - EPS).map((c) => ({ ...c, beats: Math.min(c.beats, end - c.start) })),
    ...(s.sections ? { sections: s.sections.filter((x) => x.start < bars).map((x) => ({ ...x, bars: Math.min(x.bars, bars - x.start) })) } : {}),
    ...(s.tracks ? { tracks: s.tracks.map((t) => ({ ...t, notes: t.notes.filter((n) => n.start < end - EPS).map((n) => ({ ...n, beats: Math.min(n.beats, end - n.start) })) })) } : {}),
  }
}

/** Bar counts offered by the editor (songs up to about three minutes). */
export const BAR_CHOICES: readonly number[] = [2, 4, 8, 12, 16, 24, 32, 40, 48, 56, 64, 72, 80]

/** Transpose melody to a new tonic; chords are relative (roman) so they follow. */
export function transposeScore(s: Score, keyTonic: number): Score {
  const d = keyTonic - s.keyTonic
  return { ...s, keyTonic, melody: s.melody.map((n) => ({ ...n, midi: n.midi + d })) }
}

/** Spread characters of a lyric line over the melody notes, in order. */
export function applyLyrics(s: Score, text: string): Score {
  const chars = Array.from(text.replace(/\s+/g, ''))
  return { ...s, melody: s.melody.map((n, i) => (chars[i] ? { ...n, lyric: chars[i] } : (({ lyric: _l, ...rest }) => rest)(n))) }
}

// ---------------------------------------------------------------------------
// Rendering helpers
// ---------------------------------------------------------------------------

/** Durations every notation can draw without ties. */
const DRAWABLE = [4, 3, 2, 1.5, 1, 0.75, 0.5, 0.25]

/**
 * A sequence of notes and rests covering every bar, in drawable durations,
 * never crossing a bar line. Rests are split so they start on beat
 * boundaries where possible. This is what all three notation views draw.
 */
export interface Event {
  start: number
  beats: number
  midi: number | null
  lyric?: string
  /** Index into `score.melody`, or -1 for rests. */
  source: number
}

export function scoreEvents(s: Pick<Score, 'melody' | 'bars' | 'beatsPerBar'>): Event[] {
  const out: Event[] = []
  const notes = [...s.melody].map((n, i) => ({ n, i })).sort((a, b) => a.n.start - b.n.start)
  let t = 0
  const end = s.bars * s.beatsPerBar
  const pushRest = (from: number, to: number) => {
    let cur = from
    while (to - cur > EPS) {
      const barStart = Math.floor(cur / s.beatsPerBar + EPS) * s.beatsPerBar
      const limit = Math.min(to, barStart + s.beatsPerBar)
      const room = limit - cur
      const frac = cur - Math.floor(cur + EPS)
      let len: number
      if (frac > EPS) {
        // Off the beat: fill up to the next beat with an eighth or sixteenth rest.
        len = Math.abs(frac - 0.5) < EPS && room >= 0.5 - EPS ? 0.5 : 0.25
      } else {
        const inBar = cur - barStart
        if (inBar < EPS && room >= 4 - EPS) len = 4
        else if (Math.abs(inBar % 2) < EPS && room >= 2 - EPS) len = 2
        else if (room >= 1 - EPS) len = 1
        else len = room >= 0.5 - EPS ? 0.5 : 0.25
      }
      len = Math.min(len, room)
      out.push({ start: cur, beats: len, midi: null, source: -1 })
      cur += len
    }
  }
  for (const { n, i } of notes) {
    if (n.start >= end - EPS) break
    if (n.start > t + EPS) pushRest(t, n.start)
    // Split notes that are not drawable into drawable pieces (no ties: they read as repeated notes).
    let remaining = n.beats
    let cur = n.start
    let first = true
    while (remaining > EPS) {
      const len = DRAWABLE.find((d) => d <= remaining + EPS) ?? remaining
      out.push({ start: cur, beats: len, midi: n.midi, source: i, ...(first && n.lyric ? { lyric: n.lyric } : {}) })
      first = false
      cur += len
      remaining -= len
    }
    t = Math.max(t, n.start + n.beats)
  }
  if (end > t + EPS) pushRest(t, end)
  return out
}

/** Old micro-creations (quarter-note cells) → a Score, so every view can draw them. */
export function scoreFromCells(cells: ReadonlyArray<number | null>, opts: { tonic: number; mode: Mode; bpm: number }): Score {
  const bars = Math.max(1, Math.ceil(cells.length / BEATS_PER_BAR))
  const melody: ScoreNote[] = []
  cells.forEach((m, i) => {
    if (typeof m === 'number' && m >= 0) melody.push({ start: i, beats: 1, midi: m })
  })
  return emptyScore({ keyTonic: opts.tonic, mode: opts.mode, bpm: opts.bpm, bars, melody, accompaniment: { comp: 'off', bass: 'off', drums: 'off' } })
}

/** A sequential list of notes (e.g. a lesson example) → a Score. */
export function scoreFromNotes(notes: ReadonlyArray<{ midi: number | null; beats: number }>, opts: { tonic: number; mode?: Mode; bpm?: number }): Score {
  let t = 0
  const melody: ScoreNote[] = []
  for (const n of notes) {
    if (n.midi !== null) melody.push({ start: t, beats: n.beats, midi: n.midi })
    t += n.beats
  }
  return emptyScore({
    keyTonic: opts.tonic,
    mode: opts.mode ?? 'major',
    bpm: opts.bpm ?? 90,
    bars: Math.max(1, Math.ceil(t / BEATS_PER_BAR - 1e-6)),
    melody,
    accompaniment: { comp: 'off', bass: 'off', drums: 'off' },
  })
}

const ROMAN_SUFFIX: Partial<Record<ChordTypeId, string>> = {
  dom7: '7',
  min7: '7',
  maj7: 'maj7',
  m7b5: 'ø7',
  dim7: '°7',
  sus2: 'sus2',
  sus4: 'sus4',
  add9: 'add9',
  power: '5',
}

/** Roman label with colour and inversion, e.g. `V7`, `IVmaj7`, `I/3`. */
export function slotRomanLabel(s: Pick<Score, 'mode'>, slot: Pick<ChordSlot, 'roman' | 'quality' | 'bass'>): string {
  const base = romanLabel(slot.roman)
  const suffix = slot.quality && slot.quality !== romanChord(slot.roman, s.mode).type ? (ROMAN_SUFFIX[slot.quality] ?? '') : ''
  const inv = slot.bass === 1 ? '/3' : slot.bass === 2 ? '/5' : ''
  return `${base}${suffix}${inv}`
}
