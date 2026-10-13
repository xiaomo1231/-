import { intervalById } from '@/music/intervals'
import { chordTypeById, INVERSION_LABEL } from '@/music/chords'
import { romanLabel } from '@/music/keys'
import { degreeLabel, degreeSolfege, scaleById } from '@/music/scales'
import { noteNameLabel } from '@/drills/generatorsP2'
import { midiToName } from '@/music/pitch'
import type { DrillQuestion } from '@/drills/types'

export interface AnswerOption {
  value: string
  label: string
  /** Secondary line (symbol, solfège…). */
  sub?: string
}

/** Answer buttons for a choice-style question, in display order. */
export function optionsFor(q: DrillQuestion): AnswerOption[] {
  switch (q.kind) {
    case 'pitch_compare':
      return q.options.map((o) => ({
        value: o,
        label: o === 'higher' ? '更高' : o === 'lower' ? '更低' : '相同',
        sub: o === 'higher' ? '↑' : o === 'lower' ? '↓' : '＝',
      }))
    case 'interval':
      return [...q.options]
        .sort((a, b) => intervalById(a).semitones - intervalById(b).semitones)
        .map((o) => ({ value: o, label: intervalById(o).name, sub: intervalById(o).short }))
    case 'degree':
    case 'bassline':
      return q.options.map((o) => ({ value: o, label: degreeLabel(o), sub: degreeSolfege(o) }))
    case 'progression':
      return q.options.map((o) => ({ value: o, label: romanLabel(o) }))
    case 'scale':
      return q.options.map((o) => ({ value: o, label: scaleById(o).name }))
    case 'chord':
      return q.options.map((o) => {
        const c = chordTypeById(o)
        return { value: o, label: c.name, sub: c.symbol ? `C${c.symbol}` : 'C' }
      })
    case 'chord_inversion':
      return q.options.map((o) => ({ value: String(o), label: INVERSION_LABEL[o] ?? String(o) }))
    case 'note_name':
      return q.options.map((o) => ({ value: o, label: noteNameLabel(o) }))
    case 'theory':
      return q.options.map((o) => ({ value: o.value, label: o.label }))
    default:
      return []
  }
}

/** Machine keys of the correct answers, for highlighting after grading. */
export function correctValues(q: DrillQuestion): string[] {
  switch (q.kind) {
    case 'pitch_compare':
    case 'interval':
    case 'scale':
    case 'chord':
    case 'note_name':
    case 'theory':
    case 'rhythm_choice':
      return [String(q.answer)]
    case 'chord_inversion':
      return [String(q.answer)]
    case 'degree':
      return [...q.answer]
    case 'progression':
    case 'bassline':
      return q.answer.slice(q.given)
    default:
      return []
  }
}

/** Sequence questions: how many answers to collect and which are pre-filled. */
export function sequenceInfo(q: DrillQuestion): { needed: number; givenLabels: string[] } | null {
  if (q.kind === 'degree' && q.answer.length > 1) return { needed: q.answer.length, givenLabels: [] }
  if (q.kind === 'progression') return { needed: q.answer.length - q.given, givenLabels: q.answer.slice(0, q.given).map(romanLabel) }
  if (q.kind === 'bassline') return { needed: q.answer.length - q.given, givenLabels: q.answer.slice(0, q.given).map(degreeLabel) }
  return null
}

/** Notes to show on the instrument after answering. */
export function revealNotes(q: DrillQuestion): number[] {
  switch (q.kind) {
    case 'interval':
      return [q.root, q.second]
    case 'chord':
    case 'chord_inversion':
      return q.notes
    case 'scale':
      return q.notes.slice(0, Math.ceil(q.notes.length / 2))
    case 'degree':
      return [q.tonic, ...q.notes]
    case 'pitch_compare':
      return [q.a.midi, q.b.midi]
    case 'note_name':
      return [q.note.midi]
    case 'theory':
      return q.staff?.notes.map((n) => n.midi) ?? []
    default:
      return []
  }
}

/** Gap between notes in the reveal "逐个播放"; keep in step with playNotes' sequence spacing (features/audio/useAudio.ts). */
export const REVEAL_STEP_MS = 450

/** When each reveal note should be highlighted during sequential playback, plus when to clear it. */
export function revealSchedule(count: number): { steps: Array<{ index: number; atMs: number }>; endMs: number } {
  return {
    steps: Array.from({ length: count }, (_, index) => ({ index, atMs: index * REVEAL_STEP_MS })),
    endMs: count * REVEAL_STEP_MS,
  }
}

const CN_COUNT = ['零', '一', '两', '三', '四', '五']

/**
 * Labels for the reveal notes. Two-note questions get their order (①②) and
 * the note name with octave; other kinds get the name with octave only.
 */
/** Note names with octave (G4, G3) for the revealed notes. */
export function revealLabels(q: DrillQuestion): string[] | undefined {
  const notes = revealNotes(q)
  if (notes.length === 0) return undefined
  return notes.map((m) => midiToName(m, { octave: true }))
}

/** Order badges (1, 2) for questions where the order of the notes matters. */
export function revealOrder(q: DrillQuestion): string[] | undefined {
  if (q.kind !== 'pitch_compare' && q.kind !== 'interval') return undefined
  return revealNotes(q).map((_, i) => String(i + 1))
}

/**
 * One-line explanation when the two notes share a pitch class but sit in
 * different octaves (e.g. G4 then G3). Otherwise null.
 */
export function revealNote(q: DrillQuestion): string | null {
  if (q.kind !== 'pitch_compare' && q.kind !== 'interval') return null
  const [first, second] = q.kind === 'pitch_compare' ? [q.a.midi, q.b.midi] : [q.root, q.second]
  const diff = second - first
  if (diff === 0 || diff % 12 !== 0) return null
  const octaves = Math.abs(diff) / 12
  const count = CN_COUNT[octaves] ?? String(octaves)
  const direction = diff < 0 ? '低' : '高'
  return `两个都是 ${midiToName(first)}，第二个${direction}${count}个八度`
}

export function isRhythmQuestion(q: DrillQuestion): q is Extract<DrillQuestion, { kind: 'rhythm_tap' | 'rhythm_echo' | 'rhythm_read' }> {
  return q.kind === 'rhythm_tap' || q.kind === 'rhythm_echo' || q.kind === 'rhythm_read'
}

/** Questions that start with a listening example (auto-play + replay). */
export function isListeningQuestion(q: DrillQuestion): boolean {
  return ['pitch_compare', 'interval', 'degree', 'scale', 'chord', 'chord_inversion', 'progression', 'bassline', 'dictation', 'rhythm_choice'].includes(q.kind)
}
