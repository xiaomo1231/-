import type { ChordTypeId } from '@/music/chords'
import type { IntervalDirection, IntervalId } from '@/music/intervals'
import type { Mode, RomanId } from '@/music/keys'
import type { DegreeId, ScaleId } from '@/music/scales'
import type { MelodyNote } from '@/music/melody'
import type { SpelledNote } from '@/music/spelling'
import type { NoteMeasure } from '@/audio/pitch/analysis'
import type { InstrumentId } from '@/entities/types'

/**
 * Training-camp modules.
 *   E = ear training   R = rhythm   S = singing (microphone)
 *   N = staff reading  T = theory    I = instrument tasks (I1 main, I2 second)
 */
export type ModuleId =
  | 'E1'
  | 'E2'
  | 'E3'
  | 'E4'
  | 'E5'
  | 'E6'
  | 'E7'
  | 'E8'
  | 'E9'
  | 'R1'
  | 'R2'
  | 'R3'
  | 'S1'
  | 'S2'
  | 'S3'
  | 'S4'
  | 'S5'
  | 'S6'
  | 'S7'
  | 'N1'
  | 'T1'
  | 'I1'
  | 'I2'

export type ModuleKind = 'ear' | 'rhythm' | 'sing' | 'read' | 'instrument'

export const KIND_LABEL: Record<ModuleKind, string> = {
  ear: '听辨',
  rhythm: '节奏',
  sing: '音准（唱）',
  read: '读谱与乐理',
  instrument: '乐器',
}

export interface ModuleInfo {
  id: ModuleId
  name: string
  kind: ModuleKind
  tagline: string
  description: string
  maxLevel: number
  /** Rough seconds per question, used to size the daily plan. */
  secondsPerQuestion: number
}

export const MODULES: readonly ModuleInfo[] = [
  {
    id: 'E1',
    name: '音高比较',
    kind: 'ear',
    tagline: '谁高谁低',
    description: '听两个音，判断第二个比第一个高还是低。音差会从一个八度一路缩到 10 音分。',
    maxLevel: 6,
    secondsPerQuestion: 6,
  },
  {
    id: 'E2',
    name: '音程听辨',
    kind: 'ear',
    tagline: '两音之间的距离',
    description: '从纯五度、八度开始，逐级加入全部 12 种音程；先上行，再下行，再同时响。',
    maxLevel: 7,
    secondsPerQuestion: 10,
  },
  {
    id: 'E3',
    name: '级数听辨',
    kind: 'ear',
    tagline: '它是第几级',
    description: '先听一组和弦确立调性，再听一个音，答出它在调内的级数。作曲时“心里有音”的关键。',
    maxLevel: 6,
    secondsPerQuestion: 12,
  },
  {
    id: 'E4',
    name: '音阶与调式',
    kind: 'ear',
    tagline: '这条音阶的颜色',
    description: '大调、小调、五声、布鲁斯，再到教会调式。按流行摇滚的常用程度逐级引入。',
    maxLevel: 6,
    secondsPerQuestion: 12,
  },
  {
    id: 'E5',
    name: '和弦性质',
    kind: 'ear',
    tagline: '明亮还是暗',
    description: '大小三和弦、强力和弦与挂留、减增、七和弦，最后是转位。',
    maxLevel: 6,
    secondsPerQuestion: 10,
  },
  {
    id: 'R1',
    name: '跟拍',
    kind: 'rhythm',
    tagline: '稳住拍子',
    description: '跟着节拍器用空格键打拍，测量每一下的毫秒偏差。速度逐级加快。',
    maxLevel: 5,
    secondsPerQuestion: 14,
  },
  {
    id: 'R2',
    name: '节奏模仿',
    kind: 'rhythm',
    tagline: '听一遍，打回来',
    description: '听一小节节奏型，然后在下一小节用空格键打出来。四分、八分、附点、切分、十六分、三连音。',
    maxLevel: 5,
    secondsPerQuestion: 16,
  },
  {
    id: 'R3',
    name: '按谱打拍',
    kind: 'rhythm',
    tagline: '看着谱子打',
    description: '屏幕上给出节奏谱，跟着节拍器打出来。识谱与节奏感同时练。',
    maxLevel: 5,
    secondsPerQuestion: 16,
  },
  {
    id: 'E6',
    name: '和声进行',
    kind: 'ear',
    tagline: '听出四个和弦',
    description: '听一段和弦进行，逐个答出级数。从 I–IV–V 开始，逐步加入 vi、ii、小调、借用和弦与副属和弦。',
    maxLevel: 7,
    secondsPerQuestion: 20,
  },
  {
    id: 'E7',
    name: '低音线',
    kind: 'ear',
    tagline: '只听贝斯',
    description: '只听贝斯声部，答出每小节的根音级数。为编曲阶段的“贝斯与底鼓”打基础。',
    maxLevel: 5,
    secondsPerQuestion: 18,
  },
  {
    id: 'E8',
    name: '旋律听写',
    kind: 'ear',
    tagline: '听到就写下来',
    description: '听一段旋律，在键盘上把音一个个点出来，系统实时写在五线谱上。建议先唱一遍再写。',
    maxLevel: 6,
    secondsPerQuestion: 30,
  },
  {
    id: 'E9',
    name: '节奏听写',
    kind: 'ear',
    tagline: '听节奏选谱',
    description: '听一小节节奏，从四个节奏谱里选出它。读谱与节奏感一起练。',
    maxLevel: 6,
    secondsPerQuestion: 14,
  },
  {
    id: 'S1',
    name: '单音模仿',
    kind: 'sing',
    tagline: '听一个音，唱回来',
    description: '听参考音，然后唱出同一个音。屏幕上的指针实时显示偏高还是偏低，容差从 ±50 音分收紧到 ±15。',
    maxLevel: 4,
    secondsPerQuestion: 10,
  },
  {
    id: 'S2',
    name: '长音稳定',
    kind: 'sing',
    tagline: '把音稳住',
    description: '把一个音稳定地唱 2 到 5 秒，测量漂移。练气息，也练耳朵对“跑调”的敏感度。',
    maxLevel: 3,
    secondsPerQuestion: 12,
  },
  {
    id: 'S3',
    name: '音程演唱',
    kind: 'sing',
    tagline: '从根音唱出音程',
    description: '听根音，唱出它上方（进阶后也有下方）的指定音程。',
    maxLevel: 5,
    secondsPerQuestion: 12,
  },
  {
    id: 'S4',
    name: '音阶演唱',
    kind: 'sing',
    tagline: '一级一级唱准',
    description: '跟着节拍逐级唱音阶，每个音单独评分。大调、小调、五声、布鲁斯。',
    maxLevel: 5,
    secondsPerQuestion: 25,
  },
  {
    id: 'S5',
    name: '级数演唱',
    kind: 'sing',
    tagline: '心里有音',
    description: '听和弦确立调性，然后直接唱出指定级数。作曲时“想到就能唱出来”的关键能力。',
    maxLevel: 5,
    secondsPerQuestion: 14,
  },
  {
    id: 'S6',
    name: '视唱',
    kind: 'sing',
    tagline: '看谱就唱',
    description: '看五线谱上的旋律，跟着节拍唱出来，逐音评音准。',
    maxLevel: 4,
    secondsPerQuestion: 25,
  },
  {
    id: 'S7',
    name: '旋律模唱',
    kind: 'sing',
    tagline: '听一遍，唱回来',
    description: '听一段旋律，记住后跟着节拍唱回来。和旋律听写配合练效果最好。',
    maxLevel: 4,
    secondsPerQuestion: 25,
  },
  {
    id: 'N1',
    name: '五线谱识谱',
    kind: 'read',
    tagline: '看到就认出',
    description: '看五线谱上的音，说出它的音名。高音谱号、加线、低音谱号、升降号，最后是大谱表混合。五线谱是必修。',
    maxLevel: 5,
    secondsPerQuestion: 5,
  },
  {
    id: 'T1',
    name: '乐理知识',
    kind: 'read',
    tagline: '把规则弄明白',
    description: '时值与拍号、半音全音、大调音阶与调号、看音名判断音程、小调与关系调。',
    maxLevel: 5,
    secondsPerQuestion: 10,
  },
  {
    id: 'I1',
    name: '主乐器任务',
    kind: 'instrument',
    tagline: '在乐器上弹出来',
    description: '在你的主乐器上找音、弹音程、音阶、旋律和分解和弦，麦克风检测音高。',
    maxLevel: 5,
    secondsPerQuestion: 18,
  },
  {
    id: 'I2',
    name: '第二乐器任务',
    kind: 'instrument',
    tagline: '换一件乐器',
    description: '同样的任务，换到你的第二乐器上完成。',
    maxLevel: 5,
    secondsPerQuestion: 18,
  },
]

export function moduleInfo(id: ModuleId): ModuleInfo {
  const found = MODULES.find((m) => m.id === id)
  if (!found) throw new Error(`Unknown module ${id}`)
  return found
}

interface QuestionBase {
  id: string
  module: ModuleId
  level: number
  seed: number
  /** Fine-grained skills this question exercises (mastery keys). */
  skillIds: string[]
  /** Instruction shown above the answer controls. */
  prompt: string
}

export type PitchCompareAnswer = 'higher' | 'lower' | 'same'

export interface PitchCompareQuestion extends QuestionBase {
  kind: 'pitch_compare'
  module: 'E1'
  a: { midi: number; detuneCents: number }
  b: { midi: number; detuneCents: number }
  answer: PitchCompareAnswer
  options: PitchCompareAnswer[]
}

export interface IntervalQuestion extends QuestionBase {
  kind: 'interval'
  module: 'E2'
  root: number
  second: number
  direction: IntervalDirection
  answer: IntervalId
  options: IntervalId[]
}

export interface DegreeQuestion extends QuestionBase {
  kind: 'degree'
  module: 'E3'
  tonic: number
  mode: Mode
  /** Chords played first to establish the key (MIDI voicings). */
  cadence: number[][]
  /** Notes to identify, in order (length 1 except at the sequence level). */
  notes: number[]
  answer: DegreeId[]
  options: DegreeId[]
}

export interface ScaleQuestion extends QuestionBase {
  kind: 'scale'
  module: 'E4'
  root: number
  scale: ScaleId
  /** Ascending then descending for playback. */
  notes: number[]
  answer: ScaleId
  options: ScaleId[]
}

export interface ChordQuestion extends QuestionBase {
  kind: 'chord'
  module: 'E5'
  root: number
  chordType: ChordTypeId
  inversion: number
  notes: number[]
  answer: ChordTypeId
  options: ChordTypeId[]
}

export interface ChordInversionQuestion extends QuestionBase {
  kind: 'chord_inversion'
  module: 'E5'
  root: number
  chordType: ChordTypeId
  inversion: number
  notes: number[]
  answer: number
  options: number[]
}

export interface RhythmTapQuestion extends QuestionBase {
  kind: 'rhythm_tap'
  module: 'R1'
  bpm: number
  /** Count-in beats before scoring starts. */
  countIn: number
  /** Beats to tap (one tap per beat). */
  beats: number
}

export interface RhythmPatternQuestion extends QuestionBase {
  kind: 'rhythm_echo' | 'rhythm_read'
  module: 'R2' | 'R3'
  bpm: number
  countIn: number
  patternId: string
  /** Expected onsets in beats from the start of the answer bar. */
  onsets: number[]
  beats: number
}

export interface ProgressionQuestion extends QuestionBase {
  kind: 'progression'
  module: 'E6'
  tonic: number
  mode: Mode
  /** Voiced chords (bass first). */
  chords: number[][]
  answer: RomanId[]
  options: RomanId[]
  /** Leading answers shown to the student (the first chord). */
  given: number
}

export interface BassLineQuestion extends QuestionBase {
  kind: 'bassline'
  module: 'E7'
  tonic: number
  /** Chord played once to establish the key. */
  keyChord: number[]
  notes: MelodyNote[]
  /** Root degree of each bar. */
  answer: DegreeId[]
  options: DegreeId[]
  given: number
}

export interface DictationQuestion extends QuestionBase {
  kind: 'dictation'
  module: 'E8'
  tonic: number
  scale: ScaleId
  keyChord: number[]
  melody: MelodyNote[]
  /** Leading notes shown on the staff. */
  given: number
}

export interface RhythmChoiceOption {
  id: string
  /** Onsets per bar. */
  bars: number[][]
}

export interface RhythmChoiceQuestion extends QuestionBase {
  kind: 'rhythm_choice'
  module: 'E9'
  bpm: number
  beatsPerBar: number
  options: RhythmChoiceOption[]
  answer: string
}

export type PerformMode =
  | 'note'
  | 'sustain'
  | 'interval'
  | 'scale'
  | 'degree'
  | 'sight'
  | 'echo'
  | 'find_note'
  | 'melody'
  | 'arpeggio'

/** One target note. Times are in beats from the start of the sung / played part. */
export interface PerformTarget {
  midi: number
  startBeat: number
  beats: number
  /** Label under the note (degree, name). */
  label?: string
}

/**
 * Sing or play a note / sequence; the microphone measures each target.
 * Free-timing questions score the best stable stretch of one take.
 */
export interface PerformQuestion extends QuestionBase {
  kind: 'perform'
  module: 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6' | 'S7' | 'I1' | 'I2'
  mode: PerformMode
  source: 'voice' | Exclude<InstrumentId, 'none'>
  targets: PerformTarget[]
  /** Paced at this tempo; ignored for free timing. */
  bpm: number
  countIn: number
  freeTiming: boolean
  /** Seconds of the take for free-timing questions. */
  takeSeconds: number
  toleranceCents: number
  /** Sustain checks (S2). */
  sustainSeconds?: number
  maxDriftCents?: number
  octaveEquivalence: boolean
  /** What to play before the take. */
  reference:
    | { type: 'none' }
    | { type: 'notes'; notes: MelodyNote[] }
    | { type: 'cadence'; chords: number[][]; then?: number[] }
  /** Show the targets on a staff before performing (sight-singing, instrument melody). */
  showStaff: boolean
  /** Hide the staff until graded (echo singing). */
  revealAfter?: boolean
  /** Major-key tonic for spelling. */
  keyTonic: number
  /** Chord symbol whose shape to show (arpeggio). */
  chordSymbol?: string
  chordRootPc?: number
  chordSuffix?: string
}

export interface NoteNameQuestion extends QuestionBase {
  kind: 'note_name'
  module: 'N1'
  clef: 'treble' | 'bass'
  note: SpelledNote
  answer: string
  options: string[]
}

export interface TheoryQuestion extends QuestionBase {
  kind: 'theory'
  module: 'T1'
  topic: string
  /** Optional notes to show on a staff with the question. */
  staff?: { clef: 'treble' | 'bass'; notes: SpelledNote[]; keySignature?: string }
  answer: string
  options: Array<{ value: string; label: string }>
  explanation: string
}

export type DrillQuestion =
  | ProgressionQuestion
  | BassLineQuestion
  | DictationQuestion
  | RhythmChoiceQuestion
  | PerformQuestion
  | NoteNameQuestion
  | TheoryQuestion
  | PitchCompareQuestion
  | IntervalQuestion
  | DegreeQuestion
  | ScaleQuestion
  | ChordQuestion
  | ChordInversionQuestion
  | RhythmTapQuestion
  | RhythmPatternQuestion

/** What the student submitted. */
export type DrillResponse =
  | { kind: 'choice'; value: string }
  | { kind: 'choices'; values: string[] }
  | {
      kind: 'taps'
      /** Tap times in beats relative to the start of the scored bar, latency-compensated. */
      taps: number[]
    }
  | { kind: 'skip' }
  | {
      kind: 'performance'
      /** One measurement per target, in order. */
      notes: NoteMeasure[]
    }
  | { kind: 'notes'; midis: number[] }

export interface GradeResult {
  correct: boolean
  /** 0–1 partial credit (sequence and rhythm questions). */
  credit: number
  /** Human-readable correct answer. */
  expectedLabel: string
  /** Human-readable submitted answer. */
  givenLabel: string
  /** For choice questions: the wrong option chosen, for the confusion matrix. */
  confusedWith?: string
  /** The expected key the wrong option was confused with (sequence-aware). */
  confusedExpected?: string
  /** Per-skill credit when it differs from the overall credit. */
  skillCredits?: Record<string, number>
  /** Rhythm metrics. */
  timing?: {
    meanAbsDeviationMs: number
    /** Positive = late on average. */
    meanSignedDeviationMs: number
    matched: number
    expected: number
    extra: number
  }
  /** Short, non-judgemental explanation shown after answering. */
  feedback: string
}
