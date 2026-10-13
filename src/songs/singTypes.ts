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
}

/** Mixer settings of the post-production desk (all plain numbers so they can be saved and exported). */
export interface MixSettings {
  vocal: {
    gainDb: number
    pan: number
    lowCut: { on: boolean; freq: number }
    eq: { on: boolean; bands: EqBand[] }
    comp: { on: boolean; thresholdDb: number; ratio: number; attackMs: number; releaseMs: number; makeupDb: number }
    deEss: { on: boolean; freq: number; amountDb: number }
    reverb: { on: boolean; size: number; decay: number; preDelayMs: number; mix: number }
    delay: { on: boolean; timeMs: number; sync: boolean; division: '1/4' | '1/8' | '1/8.' | '1/16'; feedback: number; mix: number }
  }
  backing: { gainDb: number; eq: { on: boolean; lowDb: number; midDb: number; highDb: number } }
  master: { limiter: boolean; gainDb: number }
}

export type EqBandType = 'lowshelf' | 'peaking' | 'highshelf'

export interface EqBand {
  type: EqBandType
  freq: number
  gainDb: number
  q: number
}

export type MixPresetId = 'pop' | 'rock' | 'warm' | 'bright' | 'radio' | 'raw'

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
