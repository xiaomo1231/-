import type { Rng } from '@/music/random'
import { chordNotes, chordTypeById } from '@/music/chords'
import { intervalById, type IntervalId } from '@/music/intervals'
import { COMFORTABLE_TONICS, PROGRESSIONS, romanChord, romanLabel, voiceRoman, type Mode, type Progression, type RomanId } from '@/music/keys'
import { fitMelodyToRange, generateMelody, type MelodyNote } from '@/music/melody'
import { midiToName, pitchClass } from '@/music/pitch'
import { rhythmPatternsForLevel, type RhythmPattern } from '@/music/rhythm'
import { degreeFromSemitone, degreeLabel, scaleNotes, semitoneFromDegree, type DegreeId } from '@/music/scales'
import { spell, spelledName, spelledToMidi, type Accidental } from '@/music/spelling'
import { LETTERS, type Letter } from '@/music/pitch'
import type { InstrumentId } from '@/entities/types'
import {
  BASSLINE_LEVELS,
  DICTATION_LEVELS,
  NOTE_NAME_LEVELS,
  PLAY_LEVELS,
  PROGRESSION_LEVELS,
  RHYTHM_CHOICE_LEVELS,
  SIGHT_LEVELS,
  SING_DEGREE_LEVELS,
  SING_INTERVAL_LEVELS,
  SING_NOTE_LEVELS,
  SING_SCALE_LEVELS,
  SING_SUSTAIN_LEVELS,
  THEORY_LEVELS,
} from './levelsP2'
import { generateTheoryItem } from './theory'
import {
  bassSkill,
  melodySkill,
  playSkill,
  readAccSkill,
  readSkill,
  rhythmReadSkill,
  romanSkill,
  singSkill,
  theorySkill,
} from './skills'
import type {
  BassLineQuestion,
  DictationQuestion,
  ModuleId,
  NoteNameQuestion,
  PerformQuestion,
  PerformTarget,
  ProgressionQuestion,
  RhythmChoiceQuestion,
  TheoryQuestion,
} from './types'

export interface P2Options {
  focusSkills?: string[]
  avoidAnswer?: string
  /** Student vocal range (MIDI). Defaults to a range most voices reach with octave folding. */
  vocalRange?: { low: number; high: number }
  octaveEquivalence?: boolean
  /** Instrument for I1 / I2. */
  instrument?: InstrumentId
}

export const DEFAULT_VOCAL_RANGE = { low: 50, high: 67 }

const id = (module: ModuleId, seed: number) => `${module}-${seed.toString(16)}`

function pickFocus<T extends string>(rng: Rng, pool: readonly T[], toSkill: (t: T) => string, opts: P2Options): T {
  const focus = opts.focusSkills
  if (focus?.length && rng.chance(0.6)) {
    const c = pool.filter((p) => focus.includes(toSkill(p)) && p !== opts.avoidAnswer)
    if (c.length) return rng.pick(c)
  }
  const fresh = pool.filter((p) => p !== opts.avoidAnswer)
  return rng.pick(fresh.length ? fresh : pool)
}

// ---------------------------------------------------------------------------
// E6 progressions
// ---------------------------------------------------------------------------

function voiceWithBass(tonic: number, roman: RomanId, mode: Mode): number[] {
  const c = romanChord(roman, mode)
  return [tonic - 12 + c.offset, ...voiceRoman(tonic, roman, mode)]
}

function progressionsAt(level: number): Progression[] {
  const exact = PROGRESSIONS.filter((p) => p.level === level)
  return exact.length ? exact : PROGRESSIONS.filter((p) => p.level <= level)
}

export function generateProgressionQ(level: number, seed: number, rng: Rng, opts: P2Options): ProgressionQuestion {
  const cfg = PROGRESSION_LEVELS[level - 1]!
  const first = rng.pick(progressionsAt(cfg.progressionLevel))
  let romans: RomanId[] = [...first.romans]
  if (cfg.chords === 8) {
    const second = rng.pick(PROGRESSIONS.filter((p) => p.mode === first.mode && p.level <= cfg.progressionLevel))
    romans = [...romans, ...second.romans]
  }
  // Focus: prefer a progression containing a weak chord.
  if (opts.focusSkills?.length && rng.chance(0.5) && cfg.chords === 4) {
    const withWeak = PROGRESSIONS.filter(
      (p) => p.level <= cfg.progressionLevel && p.romans.some((r) => opts.focusSkills!.includes(romanSkill(p.mode, r))),
    )
    if (withWeak.length) romans = [...rng.pick(withWeak).romans]
  }
  return buildProgressionQuestion(level, seed, rng.pick(COMFORTABLE_TONICS), first.mode, romans)
}

/** Chords a student at this E6 level can answer with, in one mode. */
export function progressionOptions(level: number, mode: Mode): RomanId[] {
  const cfg = PROGRESSION_LEVELS[Math.max(0, Math.min(PROGRESSION_LEVELS.length - 1, level - 1))]!
  const pool = PROGRESSIONS.filter((p) => p.mode === mode && p.level <= cfg.progressionLevel)
  return sortRomans(Array.from(new Set(pool.flatMap((p) => p.romans))), mode)
}

/** An E6 question for a given progression (used by the generator and by AI exercises). */
export function buildProgressionQuestion(level: number, seed: number, tonic: number, mode: Mode, romans: RomanId[]): ProgressionQuestion {
  const options = Array.from(new Set([...progressionOptions(level, mode), ...romans]))
  return {
    id: id('E6', seed),
    kind: 'progression',
    module: 'E6',
    level,
    seed,
    skillIds: Array.from(new Set(romans.slice(1).map((r) => romanSkill(mode, r)))),
    prompt: `听这段${mode === 'major' ? '大调' : '小调'}和弦进行，第一个和弦是 ${romanLabel(romans[0]!)}，答出后面每个和弦的级数。`,
    tonic,
    mode,
    chords: romans.map((r) => voiceWithBass(tonic, r, mode)),
    answer: romans,
    options: sortRomans(options, mode),
    given: 1,
  }
}


const ROMAN_ORDER: RomanId[] = ['I', 'i', 'II', 'ii', 'ii°', 'bIII', 'III', 'iii', 'IV', 'iv', 'V', 'v', 'bVI', 'VI', 'vi', 'bVII', 'VII', 'vii°']
function sortRomans(rs: RomanId[], _mode: Mode): RomanId[] {
  return [...rs].sort((a, b) => ROMAN_ORDER.indexOf(a) - ROMAN_ORDER.indexOf(b))
}

// ---------------------------------------------------------------------------
// E7 bass lines
// ---------------------------------------------------------------------------

export function generateBassLineQ(level: number, seed: number, rng: Rng, opts: P2Options): BassLineQuestion {
  const cfg = BASSLINE_LEVELS[level - 1]!
  const pool = PROGRESSIONS.filter((p) => p.mode === 'major' && p.level <= cfg.progressionLevel)
  let prog = rng.pick(pool)
  if (opts.focusSkills?.length && rng.chance(0.5)) {
    const weak = pool.filter((p) => p.romans.some((r) => opts.focusSkills!.includes(bassSkill(degreeFromSemitone(romanChord(r, 'major').offset)))))
    if (weak.length) prog = rng.pick(weak)
  }
  const tonic = rng.pick(COMFORTABLE_TONICS)
  const bassTonic = tonic - 24
  const roots = prog.romans.map((r) => bassTonic + romanChord(r, 'major').offset)
  const scale = scaleNotes(bassTonic, 'major', false)
  const notes: MelodyNote[] = []
  roots.forEach((r, i) => {
    const next = roots[i + 1] ?? roots[0]!
    switch (cfg.style) {
      case 'roots':
        for (let b = 0; b < 4; b++) notes.push({ midi: r, beats: 1 })
        break
      case 'fifths':
        notes.push({ midi: r, beats: 1 }, { midi: r + 7, beats: 1 }, { midi: r + 12, beats: 1 }, { midi: r + 7, beats: 1 })
        break
      case 'passing': {
        // Approach the next root from the scale tone just below (or above) it.
        const below = [...scale, ...scale.map((s) => s + 12)].filter((s) => s < next).pop() ?? next - 2
        notes.push({ midi: r, beats: 1 }, { midi: r + (romanChord(prog.romans[i]!, 'major').type === 'min' ? 3 : 4), beats: 1 }, { midi: r + 7, beats: 1 }, { midi: below, beats: 1 })
        break
      }
      case 'syncopated':
        notes.push({ midi: r, beats: 1.5 }, { midi: r, beats: 1.5 }, { midi: r + 7, beats: 1 })
        break
    }
  })
  const answer = prog.romans.map((r) => degreeFromSemitone(romanChord(r, 'major').offset))
  const options = Array.from(new Set(pool.flatMap((p) => p.romans.map((r) => degreeFromSemitone(romanChord(r, 'major').offset))))).sort(
    (a, b) => semitoneFromDegree(a) - semitoneFromDegree(b),
  )
  return {
    id: id('E7', seed),
    kind: 'bassline',
    module: 'E7',
    level,
    seed,
    skillIds: Array.from(new Set(answer.slice(1).map(bassSkill))),
    prompt: `先听主和弦，再只听贝斯。第一小节的根音是 ${degreeLabel(answer[0]!)} 级，答出后面每小节的根音级数。`,
    tonic,
    keyChord: voiceRoman(tonic, 'I', 'major'),
    notes,
    answer,
    options,
    given: 1,
  }
}

// ---------------------------------------------------------------------------
// E8 melodic dictation
// ---------------------------------------------------------------------------

export function generateDictationQ(level: number, seed: number, rng: Rng): DictationQuestion {
  const cfg = DICTATION_LEVELS[level - 1]!
  const tonic = rng.pick(COMFORTABLE_TONICS)
  const melody = generateMelody(
    { tonic, scale: 'major', beats: cfg.notes, maxLeap: cfg.maxLeap, eighths: false, chromatic: cfg.chromatic, startOnTonic: true, noteCount: cfg.notes },
    rng,
  )
  return buildDictationQuestion(level, seed, tonic, melody, cfg.chromatic)
}

/** An E8 question for a given melody (first note is the tonic, shown to the student). */
export function buildDictationQuestion(level: number, seed: number, tonic: number, melody: MelodyNote[], chromatic = false): DictationQuestion {
  const skills = new Set<string>([melodySkill('step')])
  for (let i = 1; i < melody.length; i++) if (Math.abs(melody[i]!.midi - melody[i - 1]!.midi) >= 3) skills.add(melodySkill('leap'))
  if (chromatic) skills.add(melodySkill('chromatic'))
  return {
    id: id('E8', seed),
    kind: 'dictation',
    module: 'E8',
    level,
    seed,
    skillIds: [...skills],
    prompt: `听这段旋律（第一个音已经写好，是主音），在键盘上依次点出其余 ${melody.length - 1} 个音。`,
    tonic,
    scale: 'major',
    keyChord: voiceRoman(tonic, 'I', 'major'),
    melody,
    given: 1,
  }
}

// ---------------------------------------------------------------------------
// E9 rhythmic dictation (choose the notation)
// ---------------------------------------------------------------------------

export function generateRhythmChoiceQ(level: number, seed: number, rng: Rng): RhythmChoiceQuestion {
  const cfg = RHYTHM_CHOICE_LEVELS[level - 1]!
  const all = rhythmPatternsForLevel(cfg.patternLevel)
  const exact = all.filter((p) => p.level === cfg.patternLevel)
  const pickBar = (from: RhythmPattern[]) => rng.pick(from)
  const answerBars: RhythmPattern[] = Array.from({ length: cfg.bars }, (_, i) => pickBar(i === 0 && exact.length ? exact : all))
  const key = (bars: RhythmPattern[]) => bars.map((b) => b.id).join('+')
  const options = new Map<string, RhythmPattern[]>([[key(answerBars), answerBars]])
  let guard = 0
  while (options.size < 4 && guard++ < 50) {
    // Distractors differ in exactly one bar so they look alike.
    const bars = [...answerBars]
    const which = rng.int(0, bars.length - 1)
    bars[which] = pickBar(all)
    options.set(key(bars), bars)
  }
  const list = rng.shuffle([...options.entries()]).map(([k, bars]) => ({ id: k, bars: bars.map((b) => [...b.onsets]) }))
  const figures = Array.from(new Set(answerBars.flatMap((b) => b.figures)))
  return {
    id: id('E9', seed),
    kind: 'rhythm_choice',
    module: 'E9',
    level,
    seed,
    skillIds: figures.map(rhythmReadSkill),
    prompt: '听这段节奏，选出对应的节奏谱。',
    bpm: cfg.bpm,
    beatsPerBar: 4,
    options: list,
    answer: key(answerBars),
  }
}

// ---------------------------------------------------------------------------
// S1–S7 singing
// ---------------------------------------------------------------------------

function inRange(range: { low: number; high: number }, margin = 2): [number, number] {
  const low = range.low + margin
  const high = Math.max(low, range.high - margin)
  return [low, high]
}

function foldTo(midi: number, low: number, high: number): number {
  let m = midi
  while (m < low) m += 12
  while (m > high) m -= 12
  return m
}

const singBase = (module: PerformQuestion['module'], level: number, seed: number) => ({
  id: id(module, seed),
  kind: 'perform' as const,
  module,
  level,
  seed,
  source: 'voice' as const,
})

export function generateSingQ(module: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7', level: number, seed: number, rng: Rng, opts: P2Options): PerformQuestion {
  const range = opts.vocalRange ?? DEFAULT_VOCAL_RANGE
  const octaveEq = opts.octaveEquivalence ?? true
  const [lo, hi] = inRange(range)
  switch (module) {
    case 'S1': {
      const cfg = SING_NOTE_LEVELS[level - 1]!
      const target = rng.int(lo, hi)
      return {
        ...singBase('S1', level, seed),
        skillIds: [singSkill('pitch', String(cfg.tolerance))],
        prompt: `听参考音，然后唱出同一个音（容差 ±${cfg.tolerance} 音分）。`,
        mode: 'note',
        targets: [{ midi: target, startBeat: 0, beats: 3, label: midiToName(target, { octave: true }) }],
        bpm: 60,
        countIn: 0,
        freeTiming: true,
        takeSeconds: 3.5,
        toleranceCents: cfg.tolerance,
        octaveEquivalence: octaveEq,
        reference: { type: 'notes', notes: [{ midi: target, beats: 1.2 }] },
        showStaff: false,
        keyTonic: 60,
      }
    }
    case 'S2': {
      const cfg = SING_SUSTAIN_LEVELS[level - 1]!
      const target = rng.int(lo, hi)
      return {
        ...singBase('S2', level, seed),
        skillIds: [singSkill('sustain', String(cfg.seconds))],
        prompt: `听参考音，然后把它稳定地唱 ${cfg.seconds} 秒。`,
        mode: 'sustain',
        targets: [{ midi: target, startBeat: 0, beats: cfg.seconds, label: midiToName(target, { octave: true }) }],
        bpm: 60,
        countIn: 0,
        freeTiming: true,
        takeSeconds: cfg.seconds + 2,
        toleranceCents: cfg.tolerance,
        sustainSeconds: cfg.seconds,
        maxDriftCents: cfg.maxDrift,
        octaveEquivalence: octaveEq,
        reference: { type: 'notes', notes: [{ midi: target, beats: 1.2 }] },
        showStaff: false,
        keyTonic: 60,
      }
    }
    case 'S3': {
      const cfg = SING_INTERVAL_LEVELS[level - 1]!
      const ivl = pickFocus<IntervalId>(rng, cfg.pool, (i) => singSkill('interval', i), opts)
      const semis = intervalById(ivl).semitones
      const down = cfg.down && rng.chance(0.4)
      const root = down ? rng.int(Math.min(hi, lo + semis), hi) : rng.int(lo, Math.max(lo, hi - semis))
      const target = down ? root - semis : root + semis
      return {
        ...singBase('S3', level, seed),
        skillIds: [singSkill('interval', ivl)],
        prompt: `听根音，唱出它${down ? '下方' : '上方'}的${intervalById(ivl).name}。`,
        mode: 'interval',
        targets: [{ midi: target, startBeat: 0, beats: 3, label: intervalById(ivl).name }],
        bpm: 60,
        countIn: 0,
        freeTiming: true,
        takeSeconds: 4,
        toleranceCents: 40,
        // An octave or unison is trivial with octave folding; score exact pitch.
        octaveEquivalence: semis % 12 === 0 ? false : octaveEq,
        reference: { type: 'notes', notes: [{ midi: root, beats: 1.2 }] },
        showStaff: false,
        keyTonic: 60,
      }
    }
    case 'S4': {
      const cfg = SING_SCALE_LEVELS[level - 1]!
      const scale = rng.pick(cfg.pool)
      const tonic = rng.int(lo, Math.max(lo, hi - 12))
      const up = scaleNotes(tonic, scale, true)
      const seq = cfg.descend ? [...up, ...up.slice(0, -1).reverse()] : up
      const targets: PerformTarget[] = seq.map((m, i) => ({ midi: m, startBeat: i, beats: 1, label: degreeLabel(degreeFromSemitone(m - tonic)) }))
      return {
        ...singBase('S4', level, seed),
        skillIds: [singSkill('scale', scale)],
        prompt: `听主音和 4 拍预备，然后跟着节拍一拍一个音唱${cfg.title}。`,
        mode: 'scale',
        targets,
        bpm: 72,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        toleranceCents: 40,
        octaveEquivalence: false,
        reference: { type: 'notes', notes: [{ midi: tonic, beats: 1.5 }] },
        showStaff: false,
        keyTonic: scale === 'natural_minor' || scale === 'pentatonic_minor' || scale === 'blues' ? tonic + 3 : tonic,
      }
    }
    case 'S5': {
      const cfg = SING_DEGREE_LEVELS[level - 1]!
      const degree = pickFocus<DegreeId>(rng, cfg.pool, (d) => singSkill('degree', d), opts)
      const tonic = rng.int(lo, Math.max(lo, hi - 7))
      const cadence =
        cfg.mode === 'major'
          ? (['I', 'IV', 'V', 'I'] as RomanId[]).map((r) => voiceRoman(tonic, r, 'major'))
          : (['i', 'iv', 'V', 'i'] as RomanId[]).map((r) => voiceRoman(tonic, r, 'minor'))
      const target = foldTo(tonic + semitoneFromDegree(degree), lo, hi)
      return {
        ...singBase('S5', level, seed),
        skillIds: [singSkill('degree', degree)],
        prompt: `听和弦确立调性，然后唱出第 ${degreeLabel(degree)} 级。`,
        mode: 'degree',
        targets: [{ midi: target, startBeat: 0, beats: 3, label: `第 ${degreeLabel(degree)} 级` }],
        bpm: 60,
        countIn: 0,
        freeTiming: true,
        takeSeconds: 4,
        toleranceCents: 40,
        octaveEquivalence: octaveEq,
        reference: { type: 'cadence', chords: cadence },
        showStaff: false,
        keyTonic: cfg.mode === 'minor' ? tonic + 3 : tonic,
      }
    }
    case 'S6':
    case 'S7': {
      const cfg = SIGHT_LEVELS[level - 1]!
      const tonic = rng.int(lo, Math.max(lo, hi - 9))
      const raw = generateMelody({ tonic, scale: 'major', beats: cfg.beats, maxLeap: cfg.maxLeap, eighths: cfg.eighths }, rng)
      const melody = fitMelodyToRange(raw, range.low, range.high)
      let t = 0
      const targets: PerformTarget[] = melody.map((n) => {
        const target = { midi: n.midi, startBeat: t, beats: n.beats, label: degreeLabel(degreeFromSemitone(n.midi - tonic)) }
        t += n.beats
        return target
      })
      const echo = module === 'S7'
      return {
        ...singBase(module, level, seed),
        skillIds: [singSkill(echo ? 'echo' : 'sight', String(level))],
        prompt: echo
          ? '听这段旋律，记住它；4 拍预备后跟着节拍唱回来。'
          : '先听主和弦和第一个音，4 拍预备后跟着节拍看谱唱出这段旋律。',
        mode: echo ? 'echo' : 'sight',
        targets,
        bpm: cfg.bpm,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        toleranceCents: 50,
        octaveEquivalence: false,
        reference: echo
          ? { type: 'notes', notes: melody }
          : { type: 'cadence', chords: [voiceRoman(foldTo(tonic, 53, 64), 'I', 'major')], then: [melody[0]!.midi] },
        showStaff: !echo,
        revealAfter: echo,
        keyTonic: tonic,
      }
    }
  }
}

// ---------------------------------------------------------------------------
// I1 / I2 instrument tasks
// ---------------------------------------------------------------------------

const INSTRUMENT_RANGE: Record<Exclude<InstrumentId, 'none'>, { low: number; high: number }> = {
  guitar: { low: 40, high: 72 },
  bass: { low: 28, high: 52 },
  piano: { low: 48, high: 79 },
}

export function generatePlayQ(module: 'I1' | 'I2', level: number, seed: number, rng: Rng, opts: P2Options): PerformQuestion {
  const cfg = PLAY_LEVELS[level - 1]!
  const instrument = opts.instrument && opts.instrument !== 'none' ? opts.instrument : 'piano'
  const range = INSTRUMENT_RANGE[instrument]
  const base = {
    id: id(module, seed),
    kind: 'perform' as const,
    module,
    level,
    seed,
    source: instrument,
    skillIds: [playSkill(instrument, cfg.mode)],
    toleranceCents: cfg.tolerance,
    octaveEquivalence: true,
  }
  switch (cfg.mode) {
    case 'find_note': {
      const midi = rng.int(range.low, range.high - 5)
      const n = spell(midi, { preferFlats: rng.chance(0.3) })
      return {
        ...base,
        prompt: `在乐器上找到 ${spelledName(n)} 并弹出来（任意八度都可以）。`,
        mode: 'find_note',
        targets: [{ midi, startBeat: 0, beats: 3, label: spelledName(n) }],
        bpm: 60,
        countIn: 0,
        freeTiming: true,
        takeSeconds: 6,
        reference: { type: 'none' },
        showStaff: true,
        keyTonic: n.accidental === 'b' ? 65 : 60,
      }
    }
    case 'interval': {
      const ivl = rng.pick<IntervalId>(['M2', 'm3', 'M3', 'P4', 'P5', 'M6', 'P8'])
      const semis = intervalById(ivl).semitones
      const root = rng.int(range.low, range.high - semis - 2)
      return {
        ...base,
        prompt: `跟着节拍：先弹根音 ${midiToName(root)}（2 拍），再弹它上方的${intervalById(ivl).name}（2 拍）。`,
        mode: 'interval',
        targets: [
          { midi: root, startBeat: 0, beats: 2, label: '根音' },
          { midi: root + semis, startBeat: 2, beats: 2, label: intervalById(ivl).name },
        ],
        bpm: 60,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        octaveEquivalence: semis % 12 === 0 ? false : true,
        reference: { type: 'notes', notes: [{ midi: root, beats: 1 }] },
        showStaff: false,
        keyTonic: 60,
      }
    }
    case 'scale': {
      const tonic = rng.int(range.low, Math.max(range.low, range.high - 13))
      const notes = scaleNotes(tonic, 'major', true)
      return {
        ...base,
        prompt: `跟着节拍，一拍一个音弹 ${spelledName(spell(tonic, { keyTonic: tonic }))} 大调音阶（上行一个八度）。`,
        mode: 'scale',
        targets: notes.map((m, i) => ({ midi: m, startBeat: i, beats: 1, label: degreeLabel(degreeFromSemitone(m - tonic)) })),
        bpm: 60,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        reference: { type: 'notes', notes: [{ midi: tonic, beats: 1 }] },
        showStaff: false,
        keyTonic: tonic,
      }
    }
    case 'melody': {
      const tonic = rng.int(range.low + 2, Math.max(range.low + 2, range.high - 10))
      const melody = generateMelody({ tonic, scale: 'major', beats: 4, maxLeap: 2, eighths: false }, rng)
      let t = 0
      return {
        ...base,
        prompt: '看谱，跟着节拍把这段旋律弹出来。',
        mode: 'melody',
        targets: melody.map((n) => {
          const target = { midi: n.midi, startBeat: t, beats: n.beats, label: spelledName(spell(n.midi, { keyTonic: tonic })) }
          t += n.beats
          return target
        }),
        bpm: 60,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        reference: { type: 'none' },
        showStaff: true,
        keyTonic: tonic,
      }
    }
    case 'arpeggio': {
      const minor = rng.chance(0.4)
      const root = rng.int(range.low, range.high - 14)
      const type = minor ? 'min' : 'maj'
      const notes = [...chordNotes(root, type), root + 12]
      const rootName = spelledName(spell(root, { preferFlats: [1, 3, 8, 10].includes(pitchClass(root)) }))
      const symbol = `${rootName}${chordTypeById(type).symbol}`
      return {
        ...base,
        prompt: `跟着节拍把 ${symbol} 和弦分解弹出：根音、三音、五音、高八度根音，一拍一个。`,
        mode: 'arpeggio',
        targets: notes.map((m, i) => ({ midi: m, startBeat: i, beats: 1, label: ['根音', '三音', '五音', '八度'][i]! })),
        bpm: 60,
        countIn: 4,
        freeTiming: false,
        takeSeconds: 0,
        reference: { type: 'notes', notes: [{ midi: notes[0]!, beats: 0.5 }, { midi: notes[1]!, beats: 0.5 }, { midi: notes[2]!, beats: 0.5 }, { midi: notes[3]!, beats: 1 }] },
        showStaff: false,
        keyTonic: minor ? root + 3 : root,
        chordSymbol: symbol,
        chordRootPc: pitchClass(root),
        chordSuffix: minor ? 'm' : '',
      }
    }
  }
}

// ---------------------------------------------------------------------------
// N1 note names
// ---------------------------------------------------------------------------

const VALID_ACC: Record<Letter, Accidental[]> = {
  C: ['#'],
  D: ['#', 'b'],
  E: ['b'],
  F: ['#'],
  G: ['#', 'b'],
  A: ['#', 'b'],
  B: ['b'],
}

export function noteNameLabel(name: string): string {
  return name.replace('#', '♯').replace(/^([A-G])b$/, '$1♭')
}

export function generateNoteNameQ(level: number, seed: number, rng: Rng, opts: P2Options): NoteNameQuestion {
  const cfg = NOTE_NAME_LEVELS[level - 1]!
  const clef = rng.pick(cfg.clefs)
  const lo = cfg.low[clef]
  const hi = cfg.high[clef]
  // Candidate natural notes in range.
  const naturals: Array<{ letter: Letter; octave: number; midi: number }> = []
  for (let m = lo; m <= hi; m++) {
    const n = spell(m)
    if (n.accidental === '') naturals.push({ letter: n.letter, octave: n.octave, midi: m })
  }
  let pick = rng.pick(naturals)
  if (opts.focusSkills?.length && rng.chance(0.6)) {
    const weak = naturals.filter((n) => opts.focusSkills!.includes(readSkill(clef, n.letter)))
    if (weak.length) pick = rng.pick(weak)
  }
  let accidental: Accidental = ''
  if (cfg.accidentals && rng.chance(0.5)) accidental = rng.pick(VALID_ACC[pick.letter])
  const midi = spelledToMidi(pick.letter, accidental, pick.octave)
  const note = { letter: pick.letter, accidental, octave: pick.octave, midi }
  const answer = `${pick.letter}${accidental}`
  let options: string[]
  if (!cfg.accidentals) {
    options = [...LETTERS]
  } else {
    const idx = LETTERS.indexOf(pick.letter)
    const neighbours = [LETTERS[(idx + 6) % 7]!, LETTERS[(idx + 1) % 7]!]
    const set = new Set<string>([answer, pick.letter, ...VALID_ACC[pick.letter].map((a) => `${pick.letter}${a}`), ...neighbours])
    options = [...set].sort((a, b) => LETTERS.indexOf(a[0] as Letter) - LETTERS.indexOf(b[0] as Letter) || a.length - b.length || a.localeCompare(b))
  }
  return {
    id: id('N1', seed),
    kind: 'note_name',
    module: 'N1',
    level,
    seed,
    skillIds: [readSkill(clef, pick.letter), ...(accidental ? [readAccSkill()] : [])],
    prompt: `这个音叫什么？（${clef === 'treble' ? '高音谱号' : '低音谱号'}）`,
    clef,
    note,
    answer,
    options,
  }
}

// ---------------------------------------------------------------------------
// T1 theory
// ---------------------------------------------------------------------------

export function generateTheoryQ(level: number, seed: number, rng: Rng, opts: P2Options): TheoryQuestion {
  const cfg = THEORY_LEVELS[level - 1]!
  const topic = pickFocus(rng, cfg.topics, theorySkill, opts)
  const item = generateTheoryItem(topic, rng)
  return {
    id: id('T1', seed),
    kind: 'theory',
    module: 'T1',
    level,
    seed,
    skillIds: [theorySkill(topic)],
    prompt: item.prompt,
    topic,
    ...(item.staff ? { staff: item.staff } : {}),
    answer: item.answer,
    options: item.options,
    explanation: item.explanation,
  }
}
