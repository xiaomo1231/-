import { chordNotes, chordTypeById, INVERSION_LABEL, type ChordTypeId } from '@/music/chords'
import { DIRECTION_LABEL, intervalById, type IntervalDirection, type IntervalId } from '@/music/intervals'
import { COMFORTABLE_TONICS, voiceRoman, type Mode } from '@/music/keys'
import { createRng, randomSeed, type Rng } from '@/music/random'
import { rhythmPatternsForLevel } from '@/music/rhythm'
import { degreeLabel, scaleById, scaleNotes, semitoneFromDegree, type DegreeId, type ScaleId } from '@/music/scales'
import {
  CHORD_LEVELS,
  DEGREE_LEVELS,
  INTERVAL_LEVELS,
  PITCH_COMPARE_LEVELS,
  RHYTHM_PATTERN_LEVELS,
  RHYTHM_TAP_LEVELS,
  SCALE_LEVELS,
  clampLevel,
} from './levels'
import { chordSkill, degreeSkill, intervalSkill, inversionSkill, pitchSkill, rhythmFigureSkill, rhythmTempoSkill, scaleSkill } from './skills'
import type { InstrumentId } from '@/entities/types'
import {
  generateBassLineQ,
  generateDictationQ,
  generateNoteNameQ,
  generatePlayQ,
  generateProgressionQ,
  generateRhythmChoiceQ,
  generateSingQ,
  generateTheoryQ,
} from './generatorsP2'
import type {
  ChordInversionQuestion,
  ChordQuestion,
  DegreeQuestion,
  DrillQuestion,
  IntervalQuestion,
  ModuleId,
  PitchCompareQuestion,
  RhythmPatternQuestion,
  RhythmTapQuestion,
  ScaleQuestion,
} from './types'

/** Comfortable melodic register for single notes: G3 … G5. */
const MELODIC_LOW = 55
const MELODIC_HIGH = 79

export interface GenerateOptions {
  seed?: number
  /**
   * Skills to favour (e.g. the student's weak intervals). When given, the
   * generator picks from them with 60% probability instead of the whole pool.
   */
  focusSkills?: string[]
  /** Avoid repeating this exact answer back-to-back. */
  avoidAnswer?: string
  /** Singing modules: the student's comfortable range. */
  vocalRange?: { low: number; high: number }
  octaveEquivalence?: boolean
  /** Instrument modules: which instrument the task is for. */
  instrument?: InstrumentId
}

export function generateQuestion(module: ModuleId, level: number, opts: GenerateOptions = {}): DrillQuestion {
  const seed = opts.seed ?? randomSeed()
  const rng = createRng(seed)
  const lvl = clampLevel(module, level)
  switch (module) {
    case 'E1':
      return generatePitchCompare(lvl, seed, rng, opts)
    case 'E2':
      return generateInterval(lvl, seed, rng, opts)
    case 'E3':
      return generateDegree(lvl, seed, rng, opts)
    case 'E4':
      return generateScale(lvl, seed, rng, opts)
    case 'E5':
      return generateChord(lvl, seed, rng, opts)
    case 'R1':
      return generateRhythmTap(lvl, seed)
    case 'R2':
      return generateRhythmPattern('R2', lvl, seed, rng)
    case 'R3':
      return generateRhythmPattern('R3', lvl, seed, rng)
    case 'E6':
      return generateProgressionQ(lvl, seed, rng, opts)
    case 'E7':
      return generateBassLineQ(lvl, seed, rng, opts)
    case 'E8':
      return generateDictationQ(lvl, seed, rng)
    case 'E9':
      return generateRhythmChoiceQ(lvl, seed, rng)
    case 'S1':
    case 'S2':
    case 'S3':
    case 'S4':
    case 'S5':
    case 'S6':
    case 'S7':
      return generateSingQ(module, lvl, seed, rng, opts)
    case 'N1':
      return generateNoteNameQ(lvl, seed, rng, opts)
    case 'T1':
      return generateTheoryQ(lvl, seed, rng, opts)
    case 'I1':
    case 'I2':
      return generatePlayQ(module, lvl, seed, rng, opts)
  }
}

function questionId(module: ModuleId, seed: number): string {
  return `${module}-${seed.toString(16)}`
}

/** Pick from the pool, preferring focus items when present and applicable. */
function pickWithFocus<T extends string>(
  rng: Rng,
  pool: readonly T[],
  toSkill: (item: T) => string,
  opts: GenerateOptions,
): T {
  const focus = opts.focusSkills
  if (focus && focus.length > 0 && rng.chance(0.6)) {
    const candidates = pool.filter((p) => focus.includes(toSkill(p)) && p !== opts.avoidAnswer)
    if (candidates.length > 0) return rng.pick(candidates)
  }
  const fresh = pool.filter((p) => p !== opts.avoidAnswer)
  return rng.pick(fresh.length > 0 ? fresh : pool)
}

// ---------------------------------------------------------------------------
// E1 pitch comparison
// ---------------------------------------------------------------------------

function generatePitchCompare(level: number, seed: number, rng: Rng, opts: GenerateOptions): PitchCompareQuestion {
  const cfg = PITCH_COMPARE_LEVELS[level - 1]!
  const base = rng.int(MELODIC_LOW + 4, MELODIC_HIGH - 12)
  let answer: PitchCompareQuestion['answer']
  if (cfg.allowSame && rng.chance(0.2) && opts.avoidAnswer !== 'same') {
    answer = 'same'
  } else {
    answer = rng.chance(0.5) ? 'higher' : 'lower'
    if (opts.avoidAnswer === answer && rng.chance(0.5)) answer = answer === 'higher' ? 'lower' : 'higher'
  }
  const sign = answer === 'higher' ? 1 : answer === 'lower' ? -1 : 0
  const totalCents = sign * cfg.cents
  const semis = Math.trunc(totalCents / 100)
  const detune = totalCents - semis * 100
  const options: PitchCompareQuestion['options'] = cfg.allowSame ? ['higher', 'lower', 'same'] : ['higher', 'lower']
  return {
    id: questionId('E1', seed),
    kind: 'pitch_compare',
    module: 'E1',
    level,
    seed,
    skillIds: [pitchSkill(cfg.cents)],
    prompt: '第二个音比第一个音高还是低？',
    a: { midi: base, detuneCents: 0 },
    b: { midi: base + semis, detuneCents: detune },
    answer,
    options,
  }
}

// ---------------------------------------------------------------------------
// E2 intervals
// ---------------------------------------------------------------------------

function generateInterval(level: number, seed: number, rng: Rng, opts: GenerateOptions): IntervalQuestion {
  const cfg = INTERVAL_LEVELS[level - 1]!
  const id = pickWithFocus<IntervalId>(rng, cfg.pool, intervalSkill, opts)
  const direction: IntervalDirection = rng.pick(cfg.directions)
  const semis = intervalById(id).semitones
  let root: number
  let second: number
  if (direction === 'down') {
    root = rng.int(MELODIC_LOW + semis, MELODIC_HIGH)
    second = root - semis
  } else {
    root = rng.int(MELODIC_LOW, MELODIC_HIGH - semis)
    second = root + semis
  }
  const directionText = direction === 'harmonic' ? '同时响起的' : `${DIRECTION_LABEL[direction]}的`
  return {
    id: questionId('E2', seed),
    kind: 'interval',
    module: 'E2',
    level,
    seed,
    skillIds: [intervalSkill(id)],
    prompt: `这是哪个${directionText}音程？`,
    root,
    second,
    direction,
    answer: id,
    options: [...cfg.pool],
  }
}

// ---------------------------------------------------------------------------
// E3 scale degrees
// ---------------------------------------------------------------------------

function generateDegree(level: number, seed: number, rng: Rng, opts: GenerateOptions): DegreeQuestion {
  const cfg = DEGREE_LEVELS[level - 1]!
  const mode: Mode = cfg.mode
  const tonic = rng.pick(COMFORTABLE_TONICS)
  const cadence =
    mode === 'major'
      ? [voiceRoman(tonic, 'I', mode), voiceRoman(tonic, 'IV', mode), voiceRoman(tonic, 'V', mode), voiceRoman(tonic, 'I', mode)]
      : [voiceRoman(tonic, 'i', mode), voiceRoman(tonic, 'iv', mode), voiceRoman(tonic, 'V', mode), voiceRoman(tonic, 'i', mode)]
  const answer: DegreeId[] = []
  for (let i = 0; i < cfg.sequence; i++) {
    const prev = answer[answer.length - 1]
    answer.push(pickWithFocus<DegreeId>(rng, cfg.pool, degreeSkill, { ...opts, avoidAnswer: prev ?? opts.avoidAnswer }))
  }
  // Put the melody in the octave above the tonic, occasionally the one above that.
  const notes = answer.map((d) => tonic + semitoneFromDegree(d) + (rng.chance(0.25) ? 12 : 0))
  return {
    id: questionId('E3', seed),
    kind: 'degree',
    module: 'E3',
    level,
    seed,
    skillIds: Array.from(new Set(answer.map(degreeSkill))),
    prompt:
      cfg.sequence === 1
        ? `先听和弦确立调性，再听一个音：它是${mode === 'minor' ? '小调' : '大调'}里的第几级？`
        : `先听和弦确立调性，再听 ${cfg.sequence} 个音：按顺序选出它们的级数。`,
    tonic,
    mode,
    cadence,
    notes,
    answer,
    options: [...cfg.pool],
  }
}

// ---------------------------------------------------------------------------
// E4 scales
// ---------------------------------------------------------------------------

function generateScale(level: number, seed: number, rng: Rng, opts: GenerateOptions): ScaleQuestion {
  const cfg = SCALE_LEVELS[level - 1]!
  const scale = pickWithFocus<ScaleId>(rng, cfg.pool, scaleSkill, opts)
  const root = rng.int(MELODIC_LOW, MELODIC_LOW + 11)
  const up = scaleNotes(root, scale, true)
  const notes = [...up, ...up.slice(0, -1).reverse()]
  return {
    id: questionId('E4', seed),
    kind: 'scale',
    module: 'E4',
    level,
    seed,
    skillIds: [scaleSkill(scale)],
    prompt: '这是哪种音阶或调式？',
    root,
    scale,
    notes,
    answer: scale,
    options: [...cfg.pool],
  }
}

// ---------------------------------------------------------------------------
// E5 chords
// ---------------------------------------------------------------------------

function generateChord(level: number, seed: number, rng: Rng, opts: GenerateOptions): ChordQuestion | ChordInversionQuestion {
  const cfg = CHORD_LEVELS[level - 1]!
  const root = rng.int(48, 62) // C3 … D4 keeps four-note chords under C6
  if (cfg.inversions) {
    const chordType = rng.pick(cfg.pool)
    const inversion = pickWithFocus<'0' | '1' | '2'>(rng, ['0', '1', '2'], (i) => inversionSkill(Number(i)), opts)
    const inv = Number(inversion)
    return {
      id: questionId('E5', seed),
      kind: 'chord_inversion',
      module: 'E5',
      level,
      seed,
      skillIds: [inversionSkill(inv)],
      prompt: `这个${chordTypeById(chordType).name}是原位还是转位？`,
      root,
      chordType,
      inversion: inv,
      notes: chordNotes(root, chordType, inv),
      answer: inv,
      options: [0, 1, 2],
    }
  }
  const chordType = pickWithFocus<ChordTypeId>(rng, cfg.pool, chordSkill, opts)
  return {
    id: questionId('E5', seed),
    kind: 'chord',
    module: 'E5',
    level,
    seed,
    skillIds: [chordSkill(chordType)],
    prompt: '这是什么性质的和弦？',
    root,
    chordType,
    inversion: 0,
    notes: chordNotes(root, chordType, 0),
    answer: chordType,
    options: [...cfg.pool],
  }
}

// ---------------------------------------------------------------------------
// R1 tap along
// ---------------------------------------------------------------------------

function generateRhythmTap(level: number, seed: number): RhythmTapQuestion {
  const cfg = RHYTHM_TAP_LEVELS[level - 1]!
  return {
    id: questionId('R1', seed),
    kind: 'rhythm_tap',
    module: 'R1',
    level,
    seed,
    skillIds: [rhythmTempoSkill(cfg.bpm)],
    prompt: `跟着节拍器，每一拍按一次空格键（${cfg.bpm} BPM，先听 4 拍预备）。`,
    bpm: cfg.bpm,
    countIn: 4,
    beats: cfg.beats,
  }
}

// ---------------------------------------------------------------------------
// R2 echo / R3 read
// ---------------------------------------------------------------------------

function generateRhythmPattern(module: 'R2' | 'R3', level: number, seed: number, rng: Rng): RhythmPatternQuestion {
  const cfg = RHYTHM_PATTERN_LEVELS[level - 1]!
  // Prefer patterns of exactly this level, fall back to anything unlocked.
  const exact = rhythmPatternsForLevel(level).filter((p) => p.level === level)
  const pool = exact.length > 0 ? exact : rhythmPatternsForLevel(level)
  const pattern = rng.pick(pool)
  return {
    id: questionId(module, seed),
    kind: module === 'R2' ? 'rhythm_echo' : 'rhythm_read',
    module,
    level,
    seed,
    skillIds: pattern.figures.map(rhythmFigureSkill),
    prompt:
      module === 'R2'
        ? `先听一小节节奏（${cfg.bpm} BPM），下一小节用空格键打出同样的节奏。`
        : `看谱，跟着节拍器用空格键打出这一小节（${cfg.bpm} BPM，先听 4 拍预备）。`,
    bpm: cfg.bpm,
    countIn: 4,
    patternId: pattern.id,
    onsets: [...pattern.onsets],
    beats: pattern.beats,
  }
}

// ---------------------------------------------------------------------------
// Labels shared by the UI and grading
// ---------------------------------------------------------------------------

export function pitchCompareLabel(a: PitchCompareQuestion['answer']): string {
  return a === 'higher' ? '更高' : a === 'lower' ? '更低' : '相同'
}

export function degreeOptionLabel(d: DegreeId): string {
  return degreeLabel(d)
}

export function scaleOptionLabel(s: ScaleId): string {
  return scaleById(s).name
}

export function chordOptionLabel(c: ChordTypeId): string {
  return chordTypeById(c).name
}

export function inversionOptionLabel(i: number): string {
  return INVERSION_LABEL[i] ?? `第${i}转位`
}
