/**
 * Fretboard material for the lead line (pure): pentatonic box positions,
 * original licks, and note-name quizzes.
 */

export type Technique = 'bend' | 'bend-half' | 'vibrato' | 'hammer' | 'pull' | 'slide'

export interface TabNote {
  /** 0 = lowest string. */
  string: number
  fret: number
  beats: number
  tech?: Technique
}

const MINOR_PENTA = [0, 3, 5, 7, 10]

/**
 * Minor-pentatonic box `position` (1–5): two notes per string, twelve
 * notes ascending from the box's starting note on the lowest string. With
 * standard tuning this gives the five familiar shapes (the B-string shift
 * falls out of the tuning by itself).
 */
export function pentatonicBox(tonicPc: number, position: number, strings: readonly number[]): TabNote[] {
  const low = strings[0]!
  // Scale tones on the lowest string from fret 0 up; the box starts on the
  // tonic (position 1) or the following scale tones.
  const frets: number[] = []
  for (let f = 0; f <= 24; f++) if (MINOR_PENTA.includes((((low + f - tonicPc) % 12) + 12) % 12)) frets.push(f)
  const tonicFret = frets.find((f) => (((low + f - tonicPc) % 12) + 12) % 12 === 0)!
  const startIdx = frets.indexOf(tonicFret) + (position - 1)
  const startMidi = low + frets[startIdx]!
  // Twelve consecutive scale tones from the start note.
  const notes: number[] = []
  for (let m = startMidi; notes.length < 12; m++) if (MINOR_PENTA.includes((((m - tonicPc) % 12) + 12) % 12)) notes.push(m)
  return notes.map((m, i) => {
    const s = Math.min(strings.length - 1, Math.floor(i / 2))
    return { string: s, fret: m - strings[s]!, beats: 1 }
  })
}

/** Up the box and back down (the top note once). */
export function upAndDown(box: readonly TabNote[]): TabNote[] {
  return [...box, ...[...box].reverse().slice(1)]
}

export function tabMidi(n: Pick<TabNote, 'string' | 'fret'>, strings: readonly number[]): number {
  return strings[n.string]! + n.fret
}

/** Original licks in A minor pentatonic, box 1 (frets 5–8). Strings: 0 = low E. */
export const LICKS: ReadonlyArray<{ id: string; name: string; note: string; bpm: number; notes: TabNote[] }> = [
  {
    id: 'lick-climb',
    name: '上行三连',
    note: '在高音两根弦上，“问”一句往上走，最后落在根音 A。',
    bpm: 76,
    notes: [
      { string: 3, fret: 5, beats: 0.5 },
      { string: 3, fret: 7, beats: 0.5 },
      { string: 4, fret: 5, beats: 0.5 },
      { string: 4, fret: 8, beats: 0.5 },
      { string: 5, fret: 5, beats: 1 },
      { string: 4, fret: 8, beats: 1 },
      { string: 4, fret: 5, beats: 2, tech: 'vibrato' },
    ],
  },
  {
    id: 'lick-answer',
    name: '下行回答',
    note: '从高音 C 往下回到根音，像在回答上一句。',
    bpm: 76,
    notes: [
      { string: 5, fret: 8, beats: 0.5 },
      { string: 5, fret: 5, beats: 0.5 },
      { string: 4, fret: 8, beats: 0.5 },
      { string: 4, fret: 5, beats: 0.5 },
      { string: 3, fret: 7, beats: 1 },
      { string: 3, fret: 5, beats: 1 },
      { string: 2, fret: 7, beats: 2, tech: 'vibrato' },
    ],
  },
  {
    id: 'lick-repeat',
    name: '重复动机',
    note: '同一个三音小动机弹两遍，第二遍换一个结尾。重复是让乐句好记的秘诀。',
    bpm: 80,
    notes: [
      { string: 2, fret: 7, beats: 0.5 },
      { string: 3, fret: 5, beats: 0.5 },
      { string: 3, fret: 7, beats: 1 },
      { string: 2, fret: 7, beats: 0.5 },
      { string: 3, fret: 5, beats: 0.5 },
      { string: 2, fret: 5, beats: 1 },
      { string: 1, fret: 7, beats: 2 },
    ],
  },
  {
    id: 'lick-low',
    name: '低音区 riff',
    note: '在粗弦上的摇滚 riff，适合配强力和弦段落。',
    bpm: 84,
    notes: [
      { string: 0, fret: 5, beats: 0.5 },
      { string: 0, fret: 8, beats: 0.5 },
      { string: 1, fret: 5, beats: 0.5 },
      { string: 1, fret: 7, beats: 0.5 },
      { string: 0, fret: 8, beats: 0.5 },
      { string: 0, fret: 5, beats: 0.5 },
      { string: 1, fret: 7, beats: 1 },
    ],
  },
  {
    id: 'legato-hammer',
    name: '击弦三连',
    note: '只拨第一个音，后面的音用左手手指“砸”在品上发声。',
    bpm: 70,
    notes: [
      { string: 3, fret: 5, beats: 0.5, tech: 'hammer' },
      { string: 3, fret: 7, beats: 0.5 },
      { string: 4, fret: 5, beats: 0.5, tech: 'hammer' },
      { string: 4, fret: 8, beats: 0.5 },
      { string: 5, fret: 5, beats: 0.5, tech: 'hammer' },
      { string: 5, fret: 8, beats: 0.5 },
      { string: 4, fret: 8, beats: 1, tech: 'vibrato' },
    ],
  },
  {
    id: 'legato-pull',
    name: '勾弦下行',
    note: '只拨每根弦的第一个音，勾弦时手指向下“拨”一下离开，后面的音才响。',
    bpm: 70,
    notes: [
      { string: 5, fret: 8, beats: 0.5, tech: 'pull' },
      { string: 5, fret: 5, beats: 0.5 },
      { string: 4, fret: 8, beats: 0.5, tech: 'pull' },
      { string: 4, fret: 5, beats: 0.5 },
      { string: 3, fret: 7, beats: 0.5, tech: 'pull' },
      { string: 3, fret: 5, beats: 0.5 },
      { string: 2, fret: 7, beats: 1, tech: 'vibrato' },
    ],
  },
  {
    id: 'legato-slide',
    name: '滑音连接',
    note: '按住音滑到下一个品，手指不离开琴弦。用滑音把第一把位和第二把位连起来。',
    bpm: 70,
    notes: [
      { string: 3, fret: 7, beats: 1, tech: 'slide' },
      { string: 3, fret: 9, beats: 1 },
      { string: 4, fret: 8, beats: 0.5 },
      { string: 4, fret: 10, beats: 0.5, tech: 'slide' },
      { string: 4, fret: 8, beats: 1 },
      { string: 3, fret: 7, beats: 1, tech: 'vibrato' },
    ],
  },
]

export const NATURAL_NAMES: ReadonlyArray<{ name: string; pc: number }> = [
  { name: 'C', pc: 0 },
  { name: 'D', pc: 2 },
  { name: 'E', pc: 4 },
  { name: 'F', pc: 5 },
  { name: 'G', pc: 7 },
  { name: 'A', pc: 9 },
  { name: 'B', pc: 11 },
]

export const ALL_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export interface NoteQuizItem {
  string: number
  fret: number
  name: string
  midi: number
}

/** Deterministic quiz of natural notes on frets 0–12 (seeded). */
export function noteQuiz(count: number, strings: readonly number[], seed: number, onlyStrings?: number[]): NoteQuizItem[] {
  let s = seed >>> 0 || 1
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 0x100000000)
  const pool: NoteQuizItem[] = []
  strings.forEach((open, si) => {
    if (onlyStrings && !onlyStrings.includes(si)) return
    for (let f = 0; f <= 12; f++) {
      const n = NATURAL_NAMES.find((x) => x.pc === (open + f) % 12)
      if (n) pool.push({ string: si, fret: f, name: n.name, midi: open + f })
    }
  })
  const out: NoteQuizItem[] = []
  while (out.length < count && pool.length) {
    const i = Math.floor(rnd() * pool.length)
    const item = pool[i]!
    if (!out.length || out[out.length - 1]!.name !== item.name) out.push(item)
    if (out.length > count * 4) break
  }
  return out
}

export type PlaySource =
  | { type: 'box'; position: number }
  | { type: 'lick'; id: string }
  | { type: 'scale'; name: string; tonicPc: number; scale: 'major' | 'major-penta'; lowFret: number; highFret: number }
  | { type: 'notes'; name: string; notes: TabNote[] }

export const PLAY_PASS = 0.8

/** Tab notes for a box (A minor pentatonic, up and down) or a lick. */
export function playNotes(source: PlaySource, strings: readonly number[]): { notes: TabNote[]; title: string; reference: boolean } {
  if (source.type === 'box') return { notes: upAndDown(pentatonicBox(9, source.position, strings)), title: `A 小调五声 第 ${source.position} 把位`, reference: false }
  if (source.type === 'notes') return { notes: source.notes, title: source.name, reference: true }
  if (source.type === 'scale') {
    const notes = scaleInWindow(source.tonicPc, source.scale === 'major' ? MAJOR_SCALE : MAJOR_PENTA, strings, source.lowFret, source.highFret)
    return { notes: upAndDown(notes), title: source.name, reference: false }
  }
  const lick = LICKS.find((l) => l.id === source.id)
  if (!lick) throw new Error(`unknown lick ${source.id}`)
  return { notes: lick.notes, title: lick.name, reference: true }
}

/** Scale tones in a fret window, ascending from the lowest one on the lowest string, at most three per string. */
export function scaleInWindow(tonicPc: number, intervals: readonly number[], strings: readonly number[], lowFret: number, highFret: number): TabNote[] {
  const inScale = (m: number) => intervals.includes((((m - tonicPc) % 12) + 12) % 12)
  const out: TabNote[] = []
  let string = 0
  let perString = 0
  for (let m = strings[0]! + lowFret; string < strings.length; m++) {
    if (!inScale(m)) continue
    // Move up a string when this note is out of the window or the string has three notes.
    while (string < strings.length && (m - strings[string]! > highFret || perString >= 3)) {
      string++
      perString = 0
    }
    if (string >= strings.length) break
    const fret = m - strings[string]!
    if (fret < lowFret) continue
    out.push({ string, fret, beats: 1 })
    perString++
  }
  return out
}

export const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11]
export const MAJOR_PENTA = [0, 2, 4, 7, 9]
