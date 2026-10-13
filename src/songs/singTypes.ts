/**
 * 跟唱 2.0 shared types (lyrics, takes, full version, mix). Pure data only.
 */

/** One lyric line with its timing in the recording. */
export interface LyricLine {
  startMs: number
  /** Optional explicit end (else the next line's start). */
  endMs?: number
  text: string
  /** Word / character timings when known (enhanced LRC, GP syllables). */
  words?: Array<{ startMs: number; text: string }>
  /** A translation / romanisation shown under the line (from the lyric file, 0.22.0). */
  translation?: string
}

/** Insert effects on the voice, in the order the student chose (0.21.0). */
export type InsertId = 'gate' | 'lowCut' | 'eq' | 'dynEq' | 'comp' | 'comp2' | 'parallel' | 'deEss' | 'saturation' | 'mod'

export const DEFAULT_ORDER: InsertId[] = ['gate', 'lowCut', 'eq', 'dynEq', 'comp', 'comp2', 'parallel', 'deEss', 'saturation', 'mod']

export interface CompSettings {
  on: boolean
  thresholdDb: number
  ratio: number
  attackMs: number
  releaseMs: number
  makeupDb: number
}

export interface MultibandBand {
  thresholdDb: number
  ratio: number
  gainDb: number
}

/**
 * Mixer settings of the post-production desk (all plain numbers so they can
 * be saved and exported). Fields added in 0.21.0 are filled with neutral
 * defaults by clampMix when an older saved mix lacks them.
 */
export interface MixSettings {
  vocal: {
    gainDb: number
    pan: number
    lowCut: { on: boolean; freq: number }
    eq: { on: boolean; bands: EqBand[] }
    comp: CompSettings
    /** De-esser: a dynamic cut around `freq`, at most `amountDb`, when the sibilance passes `thresholdDb`. */
    deEss: { on: boolean; freq: number; amountDb: number; thresholdDb: number }
    reverb: { on: boolean; type: 'room' | 'plate' | 'hall'; size: number; decay: number; preDelayMs: number; mix: number; lowCut: number; highCut: number }
    delay: { on: boolean; timeMs: number; sync: boolean; division: '1/4' | '1/8' | '1/8.' | '1/16'; feedback: number; mix: number; pingPong: boolean; highCut: number }
    /** Noise gate / downward expander: quieter than the threshold is turned down by up to `rangeDb`. */
    gate: { on: boolean; thresholdDb: number; rangeDb: number; releaseMs: number }
    /** Dynamic EQ: one band cut only when it gets loud (e.g. boomy 250 Hz, harsh 3 kHz). */
    dynEq: { on: boolean; freq: number; q: number; thresholdDb: number; ratio: number; maxCutDb: number }
    /** A second compressor in series. */
    comp2: CompSettings
    /** Parallel ("New York") compression: a heavily squashed copy blended under the voice. */
    parallel: { on: boolean; thresholdDb: number; ratio: number; blend: number }
    saturation: { on: boolean; type: 'tape' | 'tube' | 'hard'; drive: number; mix: number }
    /** Modulation: chorus, flanger, phaser, or a doubler (two detuned copies left / right). */
    mod: { on: boolean; type: 'chorus' | 'flanger' | 'phaser' | 'doubler'; rate: number; depth: number; mix: number }
    order: InsertId[]
    /** Phrase-by-phrase level riding (applied to the voice before the chain); extra dB per phrase. */
    autoLevel: { on: boolean; strength: number; phraseDb: Record<number, number> }
    /**
     * Pitch correction (experimental, applied to the voice before the chain).
     * scale 'reference' pulls toward the original singer's notes (the song's
     * pitch line); `range` = largest pull in semitones (farther = sung on
     * purpose, left alone); `gaps` = what to do where the original has no note.
     */
    tune: { on: boolean; amount: number; speedMs: number; scale: 'chromatic' | 'key' | 'reference'; keyTonic: number; mode: 'major' | 'minor'; range: number; gaps: 'keep' | 'nearest' }
  }
  backing: {
    gainDb: number
    eq: { on: boolean; lowDb: number; midDb: number; highDb: number }
    /** Sidechain ducking: the backing dips while the voice sings. */
    duck: { on: boolean; amountDb: number; releaseMs: number }
    /** A dip in the backing where the voice is clearest ("vocal pocket"). */
    pocket: { on: boolean; freq: number; amountDb: number }
    /** Separated stems: level and mute per stem, keyed by stem name. */
    stems: Record<string, { gainDb: number; mute: boolean }>
  }
  master: {
    limiter: boolean
    gainDb: number
    ceilingDb: number
    multiband: { on: boolean; lowHz: number; highHz: number; bands: [MultibandBand, MultibandBand, MultibandBand] }
    width: { on: boolean; amount: number }
    /** Target loudness for "一键到目标响度" (LUFS), null = off. */
    targetLufs: number | null
  }
}

export type EqBandType = 'lowshelf' | 'peaking' | 'highshelf'

export interface EqBand {
  type: EqBandType
  freq: number
  gainDb: number
  q: number
}

export type MixPresetId = 'pop' | 'rock' | 'warm' | 'bright' | 'radio' | 'raw' | 'ballad' | 'folk' | 'rap' | 'rnb' | 'lofi' | 'ktv'

/** How the full version is put together. */
export interface CompPlan {
  mode: 'full' | 'comp'
  /** Full-song take (mode 'full'). */
  fullTakeId?: string
  /** Per phrase: a take id, 'guide' (original vocal fills in) or null (empty). */
  picks: Record<number, string | 'guide' | null>
  /** Whole-version nudge, ms (+ = later). */
  offsetMs: number
  /** Per-phrase nudge, ms. */
  phraseOffsets: Record<number, number>
}

export const EMPTY_COMP: CompPlan = { mode: 'comp', picks: {}, offsetMs: 0, phraseOffsets: {} }
