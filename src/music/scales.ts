/**
 * Scale and mode definitions as semitone offsets from the root.
 * Ordered roughly by how often pop / rock players meet them.
 */
export type ScaleId =
  | 'major'
  | 'natural_minor'
  | 'pentatonic_major'
  | 'pentatonic_minor'
  | 'blues'
  | 'harmonic_minor'
  | 'melodic_minor'
  | 'dorian'
  | 'mixolydian'
  | 'lydian'
  | 'phrygian'
  | 'locrian'

export interface ScaleInfo {
  id: ScaleId
  name: string
  steps: readonly number[]
  /** One-line character description for feedback. */
  flavor: string
}

export const SCALES: readonly ScaleInfo[] = [
  { id: 'major', name: '自然大调', steps: [0, 2, 4, 5, 7, 9, 11], flavor: '明亮、完整、最常见。' },
  { id: 'natural_minor', name: '自然小调', steps: [0, 2, 3, 5, 7, 8, 10], flavor: '偏暗，摇滚与民谣的常用底色。' },
  { id: 'pentatonic_major', name: '大调五声', steps: [0, 2, 4, 7, 9], flavor: '没有半音，怎么弹都顺耳。' },
  { id: 'pentatonic_minor', name: '小调五声', steps: [0, 3, 5, 7, 10], flavor: '吉他 solo 的基本盘。' },
  { id: 'blues', name: '布鲁斯音阶', steps: [0, 3, 5, 6, 7, 10], flavor: '小调五声加一个“蓝调音”♭5。' },
  { id: 'harmonic_minor', name: '和声小调', steps: [0, 2, 3, 5, 7, 8, 11], flavor: '升高第七级，带异域与戏剧感。' },
  { id: 'melodic_minor', name: '旋律小调', steps: [0, 2, 3, 5, 7, 9, 11], flavor: '上行升六、七级，更顺滑。' },
  { id: 'dorian', name: '多利亚调式', steps: [0, 2, 3, 5, 7, 9, 10], flavor: '小调但第六级是大六度，爽朗的小调。' },
  { id: 'mixolydian', name: '混合利底亚调式', steps: [0, 2, 4, 5, 7, 9, 10], flavor: '大调但第七级降低，摇滚 riff 常用。' },
  { id: 'lydian', name: '利底亚调式', steps: [0, 2, 4, 6, 7, 9, 11], flavor: '大调升四级，漂浮、梦幻。' },
  { id: 'phrygian', name: '弗里几亚调式', steps: [0, 1, 3, 5, 7, 8, 10], flavor: '小调降二级，暗沉、西班牙风。' },
  { id: 'locrian', name: '洛克里亚调式', steps: [0, 1, 3, 5, 6, 8, 10], flavor: '连五度都是减的，极不稳定。' },
]

const BY_ID = new Map(SCALES.map((s) => [s.id, s]))

export function scaleById(id: ScaleId): ScaleInfo {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown scale ${id}`)
  return found
}

/** MIDI notes of one octave of the scale from `root`, ending on the octave. */
export function scaleNotes(root: number, id: ScaleId, includeOctave = true): number[] {
  const steps = scaleById(id).steps
  const notes = steps.map((s) => root + s)
  return includeOctave ? [...notes, root + 12] : notes
}

/**
 * Scale-degree labels relative to a major key, with accidentals for
 * chromatic notes. Used by the degree-recognition drill.
 */
export type DegreeId = '1' | 'b2' | '2' | 'b3' | '3' | '4' | '#4' | '5' | 'b6' | '6' | 'b7' | '7'

export const DEGREE_BY_SEMITONE: readonly DegreeId[] = [
  '1',
  'b2',
  '2',
  'b3',
  '3',
  '4',
  '#4',
  '5',
  'b6',
  '6',
  'b7',
  '7',
]

export function degreeFromSemitone(semitoneFromTonic: number): DegreeId {
  return DEGREE_BY_SEMITONE[((semitoneFromTonic % 12) + 12) % 12]!
}

export function semitoneFromDegree(degree: DegreeId): number {
  return DEGREE_BY_SEMITONE.indexOf(degree)
}

/** Pretty label: `♭3`, `♯4`. */
export function degreeLabel(degree: DegreeId): string {
  return degree.replace('b', '♭').replace('#', '♯')
}

/** Solfège syllable for the diatonic degrees (chromatic ones fall back to the label). */
export function degreeSolfege(degree: DegreeId): string {
  const map: Partial<Record<DegreeId, string>> = {
    '1': 'do',
    '2': 're',
    '3': 'mi',
    '4': 'fa',
    '5': 'sol',
    '6': 'la',
    '7': 'ti',
    b3: 'me',
    b6: 'le',
    b7: 'te',
    '#4': 'fi',
    b2: 'ra',
  }
  return map[degree] ?? degreeLabel(degree)
}
