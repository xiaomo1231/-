import type { ModuleId } from '@/drills/types'
import type { MelodyNote } from '@/music/melody'
import type { ScaleId } from '@/music/scales'
import type { RhythmFigure } from '@/music/rhythm'
import type { ChordTypeId } from '@/music/chords'
import type { Mode, RomanId } from '@/music/keys'
import type { Accompaniment, ChordSlot, Score, ScoreNote, Section, SectionLabel, Track, TrackKind } from '@/music/score'
import type { NonChordTone } from '@/analysis/ruleEngine'

/**
 * Lesson content is plain data. Text uses a tiny markdown subset rendered by
 * `LessonText`: paragraphs, **bold**, `- ` bullets and `> ` callouts.
 */
export type LessonBlock =
  | { type: 'text'; md: string }
  | { type: 'tip'; md: string }
  /** Notes / chords to play, optionally drawn on a staff. */
  | { type: 'listen'; title: string; notes?: MelodyNote[]; chords?: number[][]; bpm?: number; staff?: boolean; keyTonic?: number; caption?: string }
  /** A rhythm on a one-line staff with a play button. */
  | { type: 'rhythm'; title: string; onsets: number[]; beats?: number; bpm?: number; caption?: string }
  /** Highlight notes on the student's instrument. */
  | { type: 'instrument'; title: string; notes: number[]; labels?: string[]; rootPc?: number; mode?: 'positions' | 'all'; caption?: string }
  /** A scale: staff + instrument map + play. */
  | { type: 'scale'; title: string; tonic: number; scale: ScaleId; caption?: string }
  /** A chord: notes, instrument shape, play. */
  | { type: 'chord'; title: string; root: number; quality: ChordTypeId; inversion?: number; caption?: string }
  /** A progression in a key: chord chips, shapes, play with accompaniment. */
  | { type: 'progression'; title: string; tonic: number; mode: Mode; romans: RomanId[]; beatsEach?: number; caption?: string }
  /** A short song excerpt drawn in the student's notation, playable with accompaniment. */
  | { type: 'song'; title: string; score: Score; caption?: string }
  /** Embedded practice: pass by answering `count` questions with ≥ `pass` accuracy. */
  | {
      type: 'drill'
      id: string
      title: string
      module: ModuleId
      level: number
      count: number
      pass?: number
      /** Used instead when the student has no instrument (for I1 drills). */
      noInstrument?: { module: ModuleId; level: number }
    }

export interface CreationCheck {
  /** Minimum number of hits (rhythm) or notes (melody). */
  minNotes?: number
  maxNotes?: number
  /** Rhythm: at least one hit on an off-beat eighth. */
  needsOffbeat?: boolean
  /** Melody: first / last note must be this scale degree (semitones from tonic). */
  startDegree?: number
  endDegree?: number
  /** Melody: largest allowed leap in semitones. */
  maxLeap?: number
  /** Rhythm: must contain this figure (only 'syncopation' and 'rest' are checked). */
  figure?: RhythmFigure
  /** Melody: at most this many different pitches. */
  maxDistinct?: number
  /** Melody: at least one leap of this many semitones or more. */
  needsLeap?: number
}

export interface CreationSpec {
  kind: 'rhythm' | 'melody'
  title: string
  prompt: string
  /** Rhythm: eighth-note cells. Melody: quarter-note cells. */
  steps: number
  bpm: number
  tonic?: number
  scale?: ScaleId
  check: CreationCheck
}

/** Checks for composer-based creations (harmonising a melody, writing a song section). */
export interface SongCheck {
  everyBarChord?: boolean
  endsOnTonicChord?: boolean
  /** Final cadence required. */
  cadence?: 'authentic' | 'plagal' | 'half'
  /** At most this many rule-engine warnings. */
  maxWarnings?: number
  minNotes?: number
  /** Last melody note's degree (semitones from tonic). */
  endDegree?: number
  needsLyrics?: boolean
  /** The highest note occurs exactly once. */
  climaxOnce?: boolean
  /** Average pitch of the second half at least this many semitones above the first half. */
  secondHalfHigher?: number
  /** Bar 1's rhythm returns in a later bar. */
  motifRepeat?: boolean
  /** These bars (0-based) must be identical in rhythm and pitch. */
  repeatBars?: [number, number]
  requireRomans?: RomanId[]
  /** At least one non-chord tone of each listed kind. */
  needsNct?: NonChordTone[]
  /** The melody note ending bar `bar` (0-based) is not the tonic, and the last note is. */
  questionAnswer?: { bar: number }
  /** At least one silence of a beat or more inside the melody. */
  needsRest?: boolean
  /** Last note lasts at least this many beats. */
  lastNoteBeats?: number

  // --- Advanced harmony (stage 4) ---
  /** At least this many slots use a borrowed chord (♭VII, ♭VI, ♭III, iv in major). */
  needsBorrowed?: number
  /** At least one secondary dominant (II or III in major, or any slot whose quality is dom7 on a non-V root). */
  needsSecondary?: boolean
  /** Each listed chord colour appears on at least one slot. */
  needsQuality?: ChordTypeId[]
  /** At least one slash chord (bass on the 3rd or 5th). */
  needsSlash?: boolean
  /** At least one section with a key change. */
  needsTranspose?: boolean

  // --- Arrangement (stage 5) ---
  /** Voices playing (audible tracks + melody). */
  minVoices?: number
  /** Sections with these labels must exist. */
  needsSections?: SectionLabel[]
  /** Chorus denser than verse (the arrangement checker's contrast rule). */
  chorusFuller?: boolean
  /** Bass and kick lock (≥ 60 % of kicks have a bass note). */
  bassKickLock?: boolean
  /** No track out of its instrument range. */
  noRangeWarnings?: boolean
  /** These instruments must be playing. */
  needsTracks?: TrackKind[]
  /** This track must play with a different pattern or sound than it started with. */
  changedFrom?: { kind: TrackKind; pattern: string; timbre: string }
  /** Two pitched tracks panned to opposite sides, each at least 40 % off centre. */
  needsWidePan?: boolean
  /** A manual (hand-written) track: any kind, or this kind. */
  needsManual?: true | TrackKind
  /** At least one section where some track sits out (entries and exits). */
  needsDropout?: boolean
  /** Energy goes up from the first to the last section. */
  energyRises?: boolean
  /** At most this many arrangement warnings. */
  maxArrangeWarnings?: number
}

export interface SongCreationSpec {
  /** 'arrange' opens the arranger (tracks, sections, styles) on top of the composer. */
  kind: 'chords' | 'song' | 'arrange'
  title: string
  prompt: string
  bars: number
  bpm: number
  tonic: number
  mode: Mode
  givenMelody?: ScoreNote[]
  givenChords?: ChordSlot[]
  /** One valid harmonisation, offered as a hint ("chords" lessons). */
  exampleChords?: ChordSlot[]
  /** Sections the score starts with. */
  givenSections?: Section[]
  /** Sections of one valid solution (for key changes / arrangements), offered with the example. */
  exampleSections?: Section[]
  /** Unlock 7ths, sus, add9, power chords, slash chords and borrowed chords in the chord palette. */
  advancedChords?: boolean
  /** Show the arranger tab (always on for 'arrange'). */
  arranger?: boolean
  /** Starting accompaniment (default: block keys, root bass, pop drums). */
  accompaniment?: Accompaniment
  /** Changes to the starting tracks, e.g. a badly placed part to fix. */
  trackPatch?: Partial<Record<TrackKind, Partial<Track>>>
  /** Style template applied by the example button (before the example sections). */
  exampleStyle?: 'pop' | 'rock' | 'punk' | 'rnb'
  lyrics?: boolean
  check: SongCheck
}

export type AnyCreationSpec = CreationSpec | SongCreationSpec

export function isSongCreation(c: AnyCreationSpec): c is SongCreationSpec {
  return c.kind === 'chords' || c.kind === 'song' || c.kind === 'arrange'
}

export interface Lesson {
  id: string
  stage: number
  /** 1-based order within the stage, e.g. lesson 0.3 → index 3. */
  index: number
  title: string
  summary: string
  minutes: number
  blocks: LessonBlock[]
  creation: AnyCreationSpec
}

export interface StageRequirement {
  module: ModuleId
  /** The level that must be passed (its 85 % window cleared). */
  level: number
  label: string
}

export interface StageInfo {
  stage: number
  title: string
  tagline: string
  /** Lessons available in this build (empty = not yet released). */
  lessons: Lesson[]
  /** Training thresholds needed (with the previous stage's lessons) to enter this stage. */
  requirements: StageRequirement[]
  releasedIn?: string
}
