/**
 * 课后实操 (pure): after reading a lesson, the student plays and sings its
 * material. Steps are derived from the lesson's own blocks (chords,
 * progressions, scales, fretboard notes, melodies, rhythms), then turned into
 * questions for the student's instrument, graded by the existing perform /
 * rhythm graders. Guitar players get the guitar workshop's chord check and
 * strumming desk for chord and progression steps.
 *
 * Hands-on practice never blocks lesson completion: skipped or failed steps
 * go to the "待补的实操" list instead (user decision, 2026-10-11).
 */
import type { DrillQuestion, PerformQuestion, PerformTarget, RhythmPatternQuestion } from '@/drills/types'
import type { InstrumentId } from '@/entities/types'
import { chordNotes, chordSymbol, chordTypeById, type ChordTypeId } from '@/music/chords'
import { romanChord, type Mode, type RomanId } from '@/music/keys'
import type { MelodyNote } from '@/music/melody'
import { scaleById, scaleNotes, type ScaleId } from '@/music/scales'
import { spell, spelledName } from '@/music/spelling'
import { RELATIVE_MAJOR } from '@/songs/practice'
import type { Lesson, LessonBlock } from './types'

export type HandsOnStep =
  | { id: string; kind: 'chord'; title: string; root: number; quality: ChordTypeId; inversion: number }
  | { id: string; kind: 'progression'; title: string; tonic: number; mode: Mode; romans: RomanId[]; beatsEach: number }
  | { id: string; kind: 'play'; title: string; notes: MelodyNote[]; bpm: number; keyTonic: number; what: string }
  | { id: string; kind: 'sing'; title: string; notes: MelodyNote[]; bpm: number; keyTonic: number }
  | { id: string; kind: 'rhythm'; title: string; onsets: number[]; beats: number; bpm: number }

export type HandsOnStatus = 'passed' | 'failed' | 'skipped'

/** At most this many steps per lesson (a few minutes of playing). */
export const MAX_STEPS = 3

const DISPLAY_ORDER: Record<HandsOnStep['kind'], number> = { chord: 0, progression: 1, play: 2, sing: 3, rhythm: 4 }

/** Chord-root names the way pop charts write them: B♭ E♭ A♭ D♭ but F♯. */
const rootName = (midi: number) => spelledName(spell(midi, { preferFlats: [1, 3, 8, 10].includes(((midi % 12) + 12) % 12) }))

function melodyOk(notes: readonly MelodyNote[] | undefined): notes is MelodyNote[] {
  if (!notes || notes.length < 3 || notes.length > 16) return false
  const ms = notes.map((n) => n.midi)
  return Math.max(...ms) - Math.min(...ms) <= 15
}

/** Candidate steps from one block (pure). */
function candidates(block: LessonBlock, i: number): HandsOnStep[] {
  switch (block.type) {
    case 'chord':
      return [{ id: `h-chord-${i}`, kind: 'chord', title: `弹出 ${chordSymbol(rootName(block.root), block.quality)}`, root: block.root, quality: block.quality, inversion: block.inversion ?? 0 }]
    case 'progression':
      return block.romans.length >= 2
        ? [{ id: `h-prog-${i}`, kind: 'progression', title: `弹这个进行：${block.romans.join(' – ')}`, tonic: block.tonic, mode: block.mode, romans: block.romans.slice(0, 8), beatsEach: block.beatsEach ?? 4 }]
        : []
    case 'scale': {
      const notes = scaleNotes(block.tonic, block.scale as ScaleId, true).map((midi) => ({ midi, beats: 1 }))
      return [{ id: `h-scale-${i}`, kind: 'play', title: `弹一遍 ${rootName(block.tonic)} ${scaleById(block.scale as ScaleId).name}`, notes, bpm: 72, keyTonic: block.tonic, what: '音阶' }]
    }
    case 'instrument': {
      if (block.notes.length < 1 || block.notes.length > 8) return []
      const keyTonic = block.rootPc !== undefined ? 60 + block.rootPc : 60
      // "All positions" diagrams show a scale's notes: play them once upwards.
      const notes = block.mode === 'all' ? [...block.notes].sort((a, b) => a - b).map((midi) => ({ midi, beats: 1 })) : block.notes.map((midi) => ({ midi, beats: 2 }))
      return [{ id: `h-inst-${i}`, kind: 'play', title: `在乐器上弹出：${block.title.replace(/(在你乐器上)?的全部位置$/, '')}`, notes, bpm: block.mode === 'all' ? 72 : 66, keyTonic, what: '这几个音' }]
    }
    case 'listen':
      return melodyOk(block.notes) ? [{ id: `h-sing-${i}`, kind: 'sing', title: `唱出：${block.title}`, notes: block.notes, bpm: block.bpm ?? 80, keyTonic: block.keyTonic ?? block.notes[0]!.midi }] : []
    case 'song': {
      const bars = block.score.beatsPerBar * 2
      const notes = block.score.melody.filter((n) => n.start < bars).map((n) => ({ midi: n.midi, beats: n.beats }))
      return melodyOk(notes) ? [{ id: `h-song-${i}`, kind: 'sing', title: `唱出「${block.title}」开头两小节`, notes, bpm: block.score.bpm, keyTonic: block.score.keyTonic }] : []
    }
    case 'rhythm':
      return block.onsets.length >= 2 ? [{ id: `h-rhythm-${i}`, kind: 'rhythm', title: `打出这个节奏：${block.title}`, onsets: block.onsets, beats: block.beats ?? 4, bpm: block.bpm ?? 80 }] : []
    default:
      return []
  }
}

/**
 * Steps added by hand where a lesson's blocks do not show the point on an
 * instrument (they are tried before the derived ones of the same kind).
 */
const EXTRA: Record<string, HandsOnStep[]> = {
  // 自然小调与关系调: play the relative minor itself.
  'L1-4': [{ id: 'h-x-minor', kind: 'play', title: '弹一遍 A 自然小调（C 大调的关系小调）', notes: scaleNotes(57, 'natural_minor', true).map((midi) => ({ midi, beats: 1 })), bpm: 72, keyTonic: 57, what: '音阶' }],
  // 音程：度数与性质: major vs minor third on the instrument.
  'L1-8': [
    {
      id: 'h-x-thirds',
      kind: 'play',
      title: '弹出大三度和小三度：C–E，再 C–E♭',
      notes: [60, 64, 60, 63].map((midi) => ({ midi, beats: 2 })),
      bpm: 66,
      keyTonic: 60,
      what: '两个三度',
    },
  ],
}

/**
 * The lesson's hands-on steps: one per kind, singing first (everyone sings),
 * then chords, progressions, playing, rhythm, at most MAX_STEPS, shown in a
 * natural order (chord → progression → play → sing → rhythm).
 */
export function handsOnFor(lesson: Pick<Lesson, 'blocks'> & { id?: string }): HandsOnStep[] {
  const all = [...(lesson.id ? (EXTRA[lesson.id] ?? []) : []), ...lesson.blocks.flatMap((b, i) => candidates(b, i))]
  const firstOf = (k: HandsOnStep['kind']) => all.find((s) => s.kind === k)
  const picked: HandsOnStep[] = []
  for (const k of ['sing', 'chord', 'progression', 'play', 'rhythm'] as const) {
    const s = firstOf(k)
    if (s && picked.length < MAX_STEPS) picked.push(s)
  }
  return picked.sort((a, b) => DISPLAY_ORDER[a.kind] - DISPLAY_ORDER[b.kind])
}

// ---------------------------------------------------------------------------
// Steps → questions for the student's instrument
// ---------------------------------------------------------------------------

export const INSTRUMENT_RANGE: Record<Exclude<InstrumentId, 'none'>, { low: number; high: number }> = {
  guitar: { low: 40, high: 76 },
  bass: { low: 28, high: 55 },
  piano: { low: 48, high: 84 },
}

/** Shift whole octaves so the notes sit inside [low, high] (as centred as possible). Pure. */
export function fitOctave(midis: readonly number[], low: number, high: number): number {
  const lo = Math.min(...midis)
  const hi = Math.max(...midis)
  const mid = (low + high) / 2
  let shift = Math.round((mid - (lo + hi) / 2) / 12) * 12
  while (lo + shift < low && hi + shift + 12 <= high) shift += 12
  while (hi + shift > high && lo + shift - 12 >= low) shift -= 12
  // Wider than the range: keep the lowest note playable (answers an octave off still count).
  while (lo + shift < low) shift += 12
  return shift
}

const targetsOf = (notes: readonly MelodyNote[], shift: number, keyTonic: number): PerformTarget[] => {
  let t = 0
  return notes.map((n) => {
    const target = { midi: n.midi + shift, startBeat: t, beats: n.beats, label: spelledName(spell(n.midi + shift, { keyTonic })) }
    t += n.beats
    return target
  })
}

export interface StudentSetup {
  instrument: InstrumentId
  vocalRange?: { low: number; high: number }
}

function performQ(id: string, prompt: string, notes: MelodyNote[], bpm: number, keyTonic: number, who: 'voice' | Exclude<InstrumentId, 'none'>, setup: StudentSetup, mode: PerformQuestion['mode']): PerformQuestion {
  const range = who === 'voice' ? (setup.vocalRange ?? { low: 48, high: 72 }) : INSTRUMENT_RANGE[who]
  const shift = fitOctave(
    notes.map((n) => n.midi),
    range.low,
    range.high,
  )
  return {
    id,
    kind: 'perform',
    module: who === 'voice' ? 'S3' : 'I1',
    level: 1,
    seed: 0,
    skillIds: [],
    prompt,
    mode,
    source: who,
    targets: targetsOf(notes, shift, keyTonic + shift),
    bpm,
    countIn: 4,
    freeTiming: false,
    takeSeconds: 0,
    toleranceCents: who === 'voice' ? 50 : 40,
    // Singing may be in any comfortable octave; instruments too (a guitar's G3 or G4 both count).
    octaveEquivalence: true,
    reference: { type: 'notes', notes: notes.slice(0, 1).map((n) => ({ midi: n.midi + shift, beats: 1 })) },
    showStaff: true,
    keyTonic: keyTonic + shift,
  }
}

/** Who plays an instrument step: the main instrument, or the voice when there is none. */
const player = (s: StudentSetup): 'voice' | Exclude<InstrumentId, 'none'> => (s.instrument === 'none' ? 'voice' : s.instrument)

/** Chord tones low → high (with the root an octave up to finish), one beat each. */
export function arpeggio(root: number, quality: ChordTypeId, inversion = 0): MelodyNote[] {
  const tones = chordNotes(root, quality, inversion)
  return [...tones, tones[0]! + 12].map((midi) => ({ midi, beats: 1 }))
}

/** Root of each chord, `beatsEach` beats long. */
export function progressionRoots(tonic: number, mode: Mode, romans: readonly RomanId[], beatsEach: number): MelodyNote[] {
  return romans.map((r) => ({ midi: tonic + romanChord(r, mode).offset, beats: Math.min(4, beatsEach) }))
}

/**
 * The question for a step, or null when a guitar widget handles it (guitar
 * chord check / strumming desk). Pure.
 */
export function stepQuestion(step: HandsOnStep, setup: StudentSetup, opts: { notesOnly?: boolean } = {}): DrillQuestion | null {
  const who = player(setup)
  const on = who === 'voice' ? '唱' : '弹'
  switch (step.kind) {
    case 'chord': {
      if (setup.instrument === 'guitar' && !opts.notesOnly) return null
      const name = chordSymbol(rootName(step.root), step.quality)
      return performQ(step.id, `跟着节拍，一拍一个音${on}出 ${name}（${chordTypeById(step.quality).name}）的分解和弦：从根音往上，最后回到高八度的根音。`, arpeggio(step.root, step.quality, step.inversion), 72, step.root, who, setup, 'arpeggio')
    }
    case 'progression': {
      if (setup.instrument === 'guitar' && !opts.notesOnly) return null
      const notes = progressionRoots(step.tonic, step.mode, step.romans, step.beatsEach)
      return performQ(step.id, `跟着节拍${on}出每个和弦的根音：${step.romans.join(' – ')}（每个 ${notes[0]!.beats} 拍）。`, notes, 80, step.tonic, who, setup, 'melody')
    }
    case 'play':
      return performQ(step.id, `跟着节拍${on}出${step.what}，看谱上的音名。`, step.notes, step.bpm, step.keyTonic, who, setup, step.what === '音阶' ? 'scale' : 'melody')
    case 'sing':
      return performQ(step.id, '先听一遍，再跟着节拍唱出来（任意舒服的八度都可以）。', step.notes, step.bpm, step.keyTonic, 'voice', setup, 'echo')
    case 'rhythm': {
      const q: RhythmPatternQuestion = {
        id: step.id,
        kind: 'rhythm_read',
        module: 'R3',
        level: 1,
        seed: 0,
        skillIds: [],
        prompt: '看节奏谱，听完预备拍后用空格键（或拍打）打出来。',
        bpm: step.bpm,
        countIn: 4,
        patternId: step.id,
        onsets: step.onsets,
        beats: step.beats,
      }
      return q
    }
  }
}

const ASCII_ROOTS = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']

/** Guitar chord check wants an ASCII symbol ("Bb", "F#m") it can look a shape up for. */
export function chordStepSymbol(step: Extract<HandsOnStep, { kind: 'chord' }>): string {
  return ASCII_ROOTS[((step.root % 12) + 12) % 12]! + chordTypeById(step.quality).symbol
}

/** Minor progressions go through the relative major for the strumming desk (it works in major keys). */
export function strumSpec(step: Extract<HandsOnStep, { kind: 'progression' }>): { tonic: number; romans: RomanId[] } | null {
  if (step.mode === 'major') return { tonic: step.tonic, romans: step.romans }
  const romans = step.romans.map((r) => RELATIVE_MAJOR[r] ?? null)
  if (romans.some((r) => r === null)) return null
  return { tonic: step.tonic + 3, romans: romans as RomanId[] }
}
