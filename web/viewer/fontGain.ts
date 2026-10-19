/**
 * Loudness balance between the sound fonts (音色). The three fonts are mixed at very
 * different levels: in 高品质 (MuseScore General) an overdriven guitar is ~12 dB quieter
 * than in 标准 while the drums are 7 dB louder, and 最高品质 (FluidR3) is louder again.
 * Each track gets a gain that brings its instrument to the level 标准 (sonivox) plays it
 * at, so switching 音色 changes the sound, not the balance.
 *
 * Levels are RMS dB of the same passage (春日影, 30 s) rendered offline through alphaTab
 * with each General MIDI program; programs not measured use the nearest measured one of
 * the same family (GM groups programs by eight).
 */
import type { SoundFontId } from './soundFonts'

type Levels = Readonly<Record<number, number>>

const MEASURED: Readonly<Record<SoundFontId, { programs: Levels; drums: number }>> = {
  basic: {
    programs: {
      0: -42.4,
      4: -41.1,
      16: -41.5,
      19: -41.1,
      24: -44.8,
      25: -46.1,
      26: -42.9,
      27: -48.5,
      28: -53.5,
      29: -43.7,
      30: -45.3,
      31: -42.3,
      32: -43.3,
      33: -41.1,
      34: -43.7,
      35: -42.9,
      36: -46.6,
      38: -43.4,
      40: -45.3,
      48: -46.3,
      52: -42.5,
      56: -47.2,
      61: -46.3,
      65: -46.4,
      71: -41.7,
      73: -35.9,
      80: -43.7,
      81: -45.9,
      88: -40,
    },
    drums: -27.7,
  },
  musescore: {
    programs: {
      // 0 / 1 / 3 are silent in alphaTab and played as 2 (see playedProgram).
      2: -58.4,
      4: -52.3,
      16: -47.6,
      19: -51.8,
      24: -54.4,
      25: -60.6,
      26: -52.9,
      27: -43.4,
      28: -51,
      29: -55.4,
      30: -54.8,
      31: -52.7,
      32: -44.5,
      33: -42.5,
      34: -43.6,
      35: -48.3,
      36: -49.1,
      38: -57.5,
      40: -49.9,
      48: -54.1,
      52: -54.5,
      56: -43.8,
      61: -45.6,
      65: -44.6,
      71: -52.1,
      73: -48.8,
      80: -52.7,
      81: -50.1,
      88: -65.7,
    },
    drums: -20.7,
  },
  fluid: {
    programs: {
      0: -54.7,
      4: -46.2,
      16: -41.9,
      19: -40.5,
      24: -43.2,
      25: -44,
      26: -40.9,
      27: -42.4,
      28: -50,
      29: -39.5,
      30: -33.9,
      31: -36.7,
      32: -43.6,
      33: -41.5,
      34: -42.6,
      35: -42.3,
      36: -48.1,
      38: -50.6,
      40: -44.8,
      48: -43.1,
      52: -43.9,
      56: -42.4,
      61: -42.6,
      65: -38.8,
      71: -39.1,
      73: -44.3,
      80: -48.9,
      81: -46.9,
      88: -57.1,
    },
    drums: -29.3,
  },
}

/** Largest correction either way: beyond it a font's sample is just a different sound. */
const MAX_DB = 12

/**
 * The program a track really plays with this font. MuseScore General's acoustic pianos
 * (0 Grand, 1 Bright, 3 Honky-tonk) render silent in alphaTab, so they use its Electric
 * Grand (2), the nearest piano that sounds.
 */
export function playedProgram(font: SoundFontId, program: number): number {
  if (font === 'musescore' && (program === 0 || program === 1 || program === 3)) return 2
  return program
}

function levelOf(levels: Levels, program: number): number {
  const keys = Object.keys(levels).map(Number)
  const family = keys.filter((k) => k >> 3 === program >> 3)
  const pool = family.length ? family : keys
  let best = pool[0]!
  for (const k of pool) if (Math.abs(k - program) < Math.abs(best - program)) best = k
  return levels[best]!
}

/** Gain in dB for a track of this program (or the drums) with this font, relative to 标准. */
export function fontGainDb(font: SoundFontId, program: number, percussion: boolean): number {
  if (font === 'basic') return 0
  const ref = MEASURED.basic
  const f = MEASURED[font]
  const db = percussion
    ? ref.drums - f.drums
    : levelOf(ref.programs, program) - levelOf(f.programs, playedProgram(font, program))
  return Math.max(-MAX_DB, Math.min(MAX_DB, Math.round(db * 10) / 10))
}

/** The same gain as a volume multiplier. */
export function fontGain(font: SoundFontId, program: number, percussion: boolean): number {
  return 10 ** (fontGainDb(font, program, percussion) / 20)
}
