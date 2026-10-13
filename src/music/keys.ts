/**
 * Keys, diatonic chords and the pop / rock progression library.
 */
import { chordNotes, type ChordTypeId } from './chords'
import { midiToName, pitchClass } from './pitch'

export type Mode = 'major' | 'minor'

/** Roman-numeral labels for the diatonic triads (and common borrowed chords). */
export type RomanId =
  | 'I'
  | 'ii'
  | 'iii'
  | 'IV'
  | 'V'
  | 'vi'
  | 'vii°'
  | 'i'
  | 'ii°'
  | 'III'
  | 'iv'
  | 'v'
  | 'VI'
  | 'VII'
  | 'bVII'
  | 'bVI'
  | 'bIII'
  | 'II'

export interface RomanChord {
  roman: RomanId
  /** Semitones above the tonic. */
  offset: number
  type: ChordTypeId
  /** Harmonic function label for feedback. */
  func: '主' | '下属' | '属' | '借用' | '副属'
}

export const MAJOR_DIATONIC: readonly RomanChord[] = [
  { roman: 'I', offset: 0, type: 'maj', func: '主' },
  { roman: 'ii', offset: 2, type: 'min', func: '下属' },
  { roman: 'iii', offset: 4, type: 'min', func: '主' },
  { roman: 'IV', offset: 5, type: 'maj', func: '下属' },
  { roman: 'V', offset: 7, type: 'maj', func: '属' },
  { roman: 'vi', offset: 9, type: 'min', func: '主' },
  { roman: 'vii°', offset: 11, type: 'dim', func: '属' },
]

export const MINOR_DIATONIC: readonly RomanChord[] = [
  { roman: 'i', offset: 0, type: 'min', func: '主' },
  { roman: 'ii°', offset: 2, type: 'dim', func: '下属' },
  { roman: 'III', offset: 3, type: 'maj', func: '主' },
  { roman: 'iv', offset: 5, type: 'min', func: '下属' },
  { roman: 'v', offset: 7, type: 'min', func: '属' },
  { roman: 'V', offset: 7, type: 'maj', func: '属' },
  { roman: 'VI', offset: 8, type: 'maj', func: '下属' },
  { roman: 'VII', offset: 10, type: 'maj', func: '属' },
]

/** Chords borrowed into a major key from its parallel minor (level 5+). */
export const MAJOR_BORROWED: readonly RomanChord[] = [
  { roman: 'bVII', offset: 10, type: 'maj', func: '借用' },
  { roman: 'bVI', offset: 8, type: 'maj', func: '借用' },
  { roman: 'iv', offset: 5, type: 'min', func: '借用' },
  { roman: 'bIII', offset: 3, type: 'maj', func: '借用' },
]

/** Secondary dominants in a major key (level 6+): V/V and V/vi. */
export const MAJOR_SECONDARY: readonly RomanChord[] = [
  { roman: 'II', offset: 2, type: 'maj', func: '副属' },
  { roman: 'III', offset: 4, type: 'maj', func: '副属' },
]

export function romanChord(roman: RomanId, mode: Mode): RomanChord {
  const pool = mode === 'major' ? [...MAJOR_DIATONIC, ...MAJOR_BORROWED, ...MAJOR_SECONDARY] : MINOR_DIATONIC
  const found = pool.find((c) => c.roman === roman)
  if (!found) throw new Error(`Unknown roman ${roman} in ${mode}`)
  return found
}

/**
 * Voice a roman-numeral chord near a reference register. Chords are kept in
 * close position within one octave above `tonic`, root position, so a
 * progression sounds like a keyboard player comping — not a leap each bar.
 */
export function voiceRoman(tonic: number, roman: RomanId, mode: Mode): number[] {
  const c = romanChord(roman, mode)
  const root = tonic + c.offset
  const notes = chordNotes(root, c.type)
  // Fold notes that run above tonic + 16 back down for smoother motion.
  return notes.map((n) => (n > tonic + 16 ? n - 12 : n)).sort((a, b) => a - b)
}

export interface Progression {
  id: string
  name: string
  mode: Mode
  romans: readonly RomanId[]
  /** Why it works / where students will hear it (no copyrighted excerpts). */
  note: string
  /** Earliest E6 level that uses it. */
  level: number
}

export const PROGRESSIONS: readonly Progression[] = [
  { id: 'I-IV-V-I', name: '三和弦基本进行', mode: 'major', romans: ['I', 'IV', 'V', 'I'], note: '主—下属—属—主，一切的起点。', level: 1 },
  { id: 'I-V-IV-I', name: '摇滚三和弦', mode: 'major', romans: ['I', 'V', 'IV', 'I'], note: '属先于下属，更有摇滚推力。', level: 1 },
  { id: 'I-IV-I-V', name: '两段式', mode: 'major', romans: ['I', 'IV', 'I', 'V'], note: '停在属上，等待下一句。', level: 1 },
  { id: 'I-V-vi-IV', name: '万能流行进行', mode: 'major', romans: ['I', 'V', 'vi', 'IV'], note: '现代流行最常见的四和弦循环。', level: 2 },
  { id: 'vi-IV-I-V', name: '小调起句循环', mode: 'major', romans: ['vi', 'IV', 'I', 'V'], note: '同一组和弦从 vi 开始，情绪立刻变暗。', level: 2 },
  { id: 'I-vi-IV-V', name: '五十年代进行', mode: 'major', romans: ['I', 'vi', 'IV', 'V'], note: '老派抒情，Doo-wop 的基本盘。', level: 2 },
  { id: 'I-IV-vi-V', name: '流行变体', mode: 'major', romans: ['I', 'IV', 'vi', 'V'], note: '把 vi 放到第三个位置，更舒展。', level: 2 },
  { id: 'ii-V-I-I', name: 'ii–V–I', mode: 'major', romans: ['ii', 'V', 'I', 'I'], note: '爵士与 R&B 的核心进行。', level: 3 },
  { id: 'I-iii-IV-V', name: '含 iii 的上行', mode: 'major', romans: ['I', 'iii', 'IV', 'V'], note: 'iii 作为主功能的替代色。', level: 3 },
  { id: 'I-V-ii-IV', name: 'ii 替代 vi', mode: 'major', romans: ['I', 'V', 'ii', 'IV'], note: '把 vi 换成 ii，下属色彩更浓。', level: 3 },
  { id: 'i-VI-III-VII', name: '小调流行循环', mode: 'minor', romans: ['i', 'VI', 'III', 'VII'], note: '小调版的四和弦循环。', level: 4 },
  { id: 'i-iv-v-i', name: '小调基本进行', mode: 'minor', romans: ['i', 'iv', 'v', 'i'], note: '自然小调，没有导音的柔和属。', level: 4 },
  { id: 'i-VII-VI-VII', name: '安达卢西亚变体', mode: 'minor', romans: ['i', 'VII', 'VI', 'VII'], note: '摇滚 riff 常用的下行色彩。', level: 4 },
  { id: 'i-iv-V-i', name: '和声小调终止', mode: 'minor', romans: ['i', 'iv', 'V', 'i'], note: '用大 V 制造明确回家的感觉。', level: 4 },
  { id: 'I-bVII-IV-I', name: '混合利底亚摇滚', mode: 'major', romans: ['I', 'bVII', 'IV', 'I'], note: '借来的 ♭VII 是摇滚的标志性和弦。', level: 5 },
  { id: 'I-V-bVI-bVII', name: '借用上行', mode: 'major', romans: ['I', 'V', 'bVI', 'bVII'], note: '♭VI–♭VII 推向 I，史诗感。', level: 5 },
  { id: 'I-iv-I-V', name: '小下属借用', mode: 'major', romans: ['I', 'iv', 'I', 'V'], note: '大调里突然的小 iv，忧郁一闪。', level: 5 },
  { id: 'I-bIII-IV-I', name: '♭III 借用', mode: 'major', romans: ['I', 'bIII', 'IV', 'I'], note: '另一种摇滚色彩借用。', level: 5 },
  { id: 'I-II-IV-I', name: '重属和弦', mode: 'major', romans: ['I', 'II', 'IV', 'I'], note: '大调里出现大 II，明亮地推向下属。', level: 6 },
  { id: 'I-III-vi-IV', name: '副属导向 vi', mode: 'major', romans: ['I', 'III', 'vi', 'IV'], note: '大 III 是 vi 的属和弦，让 vi 更有落点。', level: 6 },
  { id: 'I-vi-II-V', name: '重属终止', mode: 'major', romans: ['I', 'vi', 'II', 'V'], note: 'II（V/V）把属和弦推得更强。', level: 6 },
  { id: 'I-IV-II-V', name: '下属到重属', mode: 'major', romans: ['I', 'IV', 'II', 'V'], note: '从 IV 走到 II 再到 V，层层上推。', level: 6 },
]

/** Display label for a roman numeral (♭ instead of b). */
export function romanLabel(roman: RomanId): string {
  return roman.replace(/^b/, '♭')
}

export function progressionsForLevel(level: number): Progression[] {
  return PROGRESSIONS.filter((p) => p.level <= level)
}

/** Common tonic choices that keep voicings in a comfortable register. */
export const COMFORTABLE_TONICS: readonly number[] = [53, 55, 57, 58, 60, 62, 64, 65] // F3 … F4

export function keyName(tonic: number, mode: Mode): string {
  const name = midiToName(tonic, { flats: FLAT_KEYS.has(pitchClass(tonic)) })
  return `${name} ${mode === 'major' ? '大调' : '小调'}`
}

/** Keys conventionally spelled with flats. */
const FLAT_KEYS = new Set([5, 10, 3, 8, 1])

/** Number of sharps (+) or flats (−) for a major key tonic pitch class. */
export function majorKeySignature(tonicPc: number): number {
  const circle = [0, 7, 2, 9, 4, 11, 6, 1, 8, 3, 10, 5] // C G D A E B F# C# G# D# A# F
  const idx = circle.indexOf(((tonicPc % 12) + 12) % 12)
  return idx <= 6 ? idx : idx - 12
}

/** The diatonic seventh chord on a roman numeral (I → maj7, V → 7, vi → m7 …). */
export function diatonicSeventh(roman: RomanId, mode: Mode): ChordTypeId {
  const t = romanChord(roman, mode).type
  if (roman === 'V' || roman === 'II' || roman === 'III' || roman === 'VII' || roman === 'bVII') return 'dom7'
  if (t === 'dim') return 'm7b5'
  if (t === 'min') return 'min7'
  return 'maj7'
}
