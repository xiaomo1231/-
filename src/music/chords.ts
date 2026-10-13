/**
 * Chord qualities as semitone offsets from the root, plus inversions.
 */
export type ChordTypeId =
  | 'maj'
  | 'min'
  | 'dim'
  | 'aug'
  | 'power'
  | 'sus2'
  | 'sus4'
  | 'maj7'
  | 'dom7'
  | 'min7'
  | 'dim7'
  | 'add9'
  | 'm7b5'

export interface ChordTypeInfo {
  id: ChordTypeId
  name: string
  /** Suffix after the root, e.g. `m7`. */
  symbol: string
  intervals: readonly number[]
  flavor: string
}

export const CHORD_TYPES: readonly ChordTypeInfo[] = [
  { id: 'maj', name: '大三和弦', symbol: '', intervals: [0, 4, 7], flavor: '明亮、稳定。' },
  { id: 'min', name: '小三和弦', symbol: 'm', intervals: [0, 3, 7], flavor: '偏暗、内敛。' },
  { id: 'dim', name: '减三和弦', symbol: 'dim', intervals: [0, 3, 6], flavor: '紧缩、不安。' },
  { id: 'aug', name: '增三和弦', symbol: 'aug', intervals: [0, 4, 8], flavor: '漂浮、梦境感。' },
  { id: 'power', name: '强力和弦', symbol: '5', intervals: [0, 7], flavor: '没有三音，失真下最干净。' },
  { id: 'sus2', name: '挂二和弦', symbol: 'sus2', intervals: [0, 2, 7], flavor: '开放、通透。' },
  { id: 'sus4', name: '挂四和弦', symbol: 'sus4', intervals: [0, 5, 7], flavor: '悬着，想落回三音。' },
  { id: 'maj7', name: '大七和弦', symbol: 'maj7', intervals: [0, 4, 7, 11], flavor: '柔和、都市夜色。' },
  { id: 'dom7', name: '属七和弦', symbol: '7', intervals: [0, 4, 7, 10], flavor: '布鲁斯与推进感。' },
  { id: 'min7', name: '小七和弦', symbol: 'm7', intervals: [0, 3, 7, 10], flavor: '放松、R&B 质感。' },
  { id: 'dim7', name: '减七和弦', symbol: 'dim7', intervals: [0, 3, 6, 9], flavor: '极度紧张，到处可去。' },
  { id: 'add9', name: '加九和弦', symbol: 'add9', intervals: [0, 4, 7, 14], flavor: '大三和弦加一层光。' },
  { id: 'm7b5', name: '半减七和弦', symbol: 'm7♭5', intervals: [0, 3, 6, 10], flavor: '小调 ii 级的常客。' },
]

const BY_ID = new Map(CHORD_TYPES.map((c) => [c.id, c]))

export function chordTypeById(id: ChordTypeId): ChordTypeInfo {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown chord type ${id}`)
  return found
}

/**
 * Voice a chord. `inversion` moves the lowest n notes up an octave
 * (0 = root position, 1 = first inversion, …). Notes are returned ascending.
 */
export function chordNotes(root: number, type: ChordTypeId, inversion = 0): number[] {
  const base = chordTypeById(type).intervals.map((i) => root + i)
  const inv = Math.min(inversion, base.length - 1)
  const notes = [...base]
  for (let k = 0; k < inv; k++) {
    const lowest = notes.shift()!
    notes.push(lowest + 12)
  }
  return notes.sort((a, b) => a - b)
}

export const INVERSION_LABEL = ['原位', '第一转位', '第二转位', '第三转位'] as const

/** Chord symbol such as `Am7` or `F♯dim`. */
export function chordSymbol(rootName: string, type: ChordTypeId): string {
  return `${rootName}${chordTypeById(type).symbol}`
}
