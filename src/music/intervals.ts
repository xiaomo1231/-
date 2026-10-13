/**
 * The twelve simple intervals plus the octave, with the labels used across
 * drills, feedback and the skill map. Ids are stable (they are skill keys).
 */
export type IntervalId =
  | 'P1'
  | 'm2'
  | 'M2'
  | 'm3'
  | 'M3'
  | 'P4'
  | 'A4'
  | 'P5'
  | 'm6'
  | 'M6'
  | 'm7'
  | 'M7'
  | 'P8'

export interface IntervalInfo {
  id: IntervalId
  semitones: number
  /** Chinese name, e.g. 大三度. */
  name: string
  /** Short label for compact UI. */
  short: string
  /** A memorable hook students can hum (an original cue, not a song). */
  hint: string
}

export const INTERVALS: readonly IntervalInfo[] = [
  { id: 'P1', semitones: 0, name: '纯一度', short: 'P1', hint: '同一个音，完全重合。' },
  { id: 'm2', semitones: 1, name: '小二度', short: 'm2', hint: '相邻半音，最“挤”的紧张感。' },
  { id: 'M2', semitones: 2, name: '大二度', short: 'M2', hint: '音阶里相邻两音，像上楼梯一级。' },
  { id: 'm3', semitones: 3, name: '小三度', short: 'm3', hint: '小和弦的底色，偏暗、略忧。' },
  { id: 'M3', semitones: 4, name: '大三度', short: 'M3', hint: '大和弦的底色，明亮、开阔。' },
  { id: 'P4', semitones: 5, name: '纯四度', short: 'P4', hint: '像号角起句，坚定向上。' },
  { id: 'A4', semitones: 6, name: '增四度', short: 'A4/d5', hint: '恰好一半八度，悬而不决。' },
  { id: 'P5', semitones: 7, name: '纯五度', short: 'P5', hint: '强力和弦的骨架，空旷稳定。' },
  { id: 'm6', semitones: 8, name: '小六度', short: 'm6', hint: '比五度再宽一点，带着叹息感。' },
  { id: 'M6', semitones: 9, name: '大六度', short: 'M6', hint: '宽而甜，常用于抒情起句。' },
  { id: 'm7', semitones: 10, name: '小七度', short: 'm7', hint: '属七和弦的张力来源，想要解决。' },
  { id: 'M7', semitones: 11, name: '大七度', short: 'M7', hint: '差半音到八度，又亮又刺。' },
  { id: 'P8', semitones: 12, name: '纯八度', short: 'P8', hint: '同名高音，完全融合。' },
]

const BY_ID = new Map(INTERVALS.map((i) => [i.id, i]))
const BY_SEMITONES = new Map(INTERVALS.map((i) => [i.semitones, i]))

export function intervalById(id: IntervalId): IntervalInfo {
  const found = BY_ID.get(id)
  if (!found) throw new Error(`Unknown interval ${id}`)
  return found
}

/** Interval for a semitone distance 0–12 (larger distances fold into one octave). */
export function intervalFromSemitones(semitones: number): IntervalInfo {
  const abs = Math.abs(semitones)
  const folded = abs === 12 ? 12 : abs % 12
  return BY_SEMITONES.get(folded)!
}

export type IntervalDirection = 'up' | 'down' | 'harmonic'

export const DIRECTION_LABEL: Record<IntervalDirection, string> = {
  up: '上行',
  down: '下行',
  harmonic: '同时',
}
