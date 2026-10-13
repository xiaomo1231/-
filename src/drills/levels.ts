import type { ChordTypeId } from '@/music/chords'
import type { IntervalDirection, IntervalId } from '@/music/intervals'
import type { DegreeId, ScaleId } from '@/music/scales'
import type { ModuleId } from './types'
import * as P2 from './levelsP2'

/** Human label of each level, shown on the module card and in the skill map. */
export interface LevelInfo {
  level: number
  title: string
}

export const PITCH_COMPARE_LEVELS: ReadonlyArray<LevelInfo & { cents: number; allowSame: boolean }> = [
  { level: 1, title: '一个八度', cents: 1200, allowSame: false },
  { level: 2, title: '大二度', cents: 200, allowSame: false },
  { level: 3, title: '半音', cents: 100, allowSame: true },
  { level: 4, title: '50 音分', cents: 50, allowSame: true },
  { level: 5, title: '20 音分', cents: 20, allowSame: true },
  { level: 6, title: '10 音分', cents: 10, allowSame: true },
]

export const INTERVAL_LEVELS: ReadonlyArray<
  LevelInfo & { pool: IntervalId[]; directions: IntervalDirection[] }
> = [
  { level: 1, title: '纯一 / 纯五 / 纯八', pool: ['P1', 'P5', 'P8'], directions: ['up'] },
  { level: 2, title: '加入四度与三度', pool: ['P1', 'P5', 'P8', 'P4', 'M3', 'm3'], directions: ['up'] },
  {
    level: 3,
    title: '加入二度 · 上下行',
    pool: ['P1', 'P5', 'P8', 'P4', 'M3', 'm3', 'M2', 'm2'],
    directions: ['up', 'down'],
  },
  {
    level: 4,
    title: '加入六度',
    pool: ['P5', 'P8', 'P4', 'M3', 'm3', 'M2', 'm2', 'M6', 'm6'],
    directions: ['up', 'down'],
  },
  {
    level: 5,
    title: '加入七度 · 同时响',
    pool: ['P5', 'P8', 'P4', 'M3', 'm3', 'M2', 'm2', 'M6', 'm6', 'M7', 'm7'],
    directions: ['up', 'down', 'harmonic'],
  },
  {
    level: 6,
    title: '加入增四度',
    pool: ['P5', 'P8', 'P4', 'M3', 'm3', 'M2', 'm2', 'M6', 'm6', 'M7', 'm7', 'A4'],
    directions: ['up', 'down', 'harmonic'],
  },
  {
    level: 7,
    title: '全部混合',
    pool: ['P1', 'P5', 'P8', 'P4', 'M3', 'm3', 'M2', 'm2', 'M6', 'm6', 'M7', 'm7', 'A4'],
    directions: ['up', 'down', 'harmonic'],
  },
]

export const DEGREE_LEVELS: ReadonlyArray<
  LevelInfo & { pool: DegreeId[]; mode: 'major' | 'minor'; sequence: number }
> = [
  { level: 1, title: '1 · 3 · 5 级', pool: ['1', '3', '5'], mode: 'major', sequence: 1 },
  { level: 2, title: '加入 2 · 4 级', pool: ['1', '2', '3', '4', '5'], mode: 'major', sequence: 1 },
  { level: 3, title: '加入 6 · 7 级', pool: ['1', '2', '3', '4', '5', '6', '7'], mode: 'major', sequence: 1 },
  { level: 4, title: '小调级数', pool: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], mode: 'minor', sequence: 1 },
  {
    level: 5,
    title: '加入变化音',
    pool: ['1', '2', 'b3', '3', '4', '#4', '5', 'b6', '6', 'b7', '7'],
    mode: 'major',
    sequence: 1,
  },
  { level: 6, title: '连续多个音', pool: ['1', '2', '3', '4', '5', '6', '7'], mode: 'major', sequence: 3 },
]

export const SCALE_LEVELS: ReadonlyArray<LevelInfo & { pool: ScaleId[] }> = [
  { level: 1, title: '大调 vs 小调', pool: ['major', 'natural_minor'] },
  { level: 2, title: '加入五声', pool: ['major', 'natural_minor', 'pentatonic_major', 'pentatonic_minor'] },
  {
    level: 3,
    title: '加入布鲁斯',
    pool: ['major', 'natural_minor', 'pentatonic_major', 'pentatonic_minor', 'blues'],
  },
  {
    level: 4,
    title: '加入和声 / 旋律小调',
    pool: ['major', 'natural_minor', 'pentatonic_minor', 'blues', 'harmonic_minor', 'melodic_minor'],
  },
  {
    level: 5,
    title: '加入多利亚 / 混合利底亚',
    pool: ['major', 'natural_minor', 'harmonic_minor', 'dorian', 'mixolydian'],
  },
  {
    level: 6,
    title: '全部调式',
    pool: ['major', 'natural_minor', 'dorian', 'mixolydian', 'lydian', 'phrygian', 'locrian'],
  },
]

export const CHORD_LEVELS: ReadonlyArray<LevelInfo & { pool: ChordTypeId[]; inversions: boolean }> = [
  { level: 1, title: '大 vs 小', pool: ['maj', 'min'], inversions: false },
  { level: 2, title: '加入强力 / 挂留', pool: ['maj', 'min', 'power', 'sus2', 'sus4'], inversions: false },
  { level: 3, title: '加入减 / 增', pool: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'], inversions: false },
  { level: 4, title: '七和弦', pool: ['maj7', 'dom7', 'min7', 'dim7'], inversions: false },
  {
    level: 5,
    title: '加入加九 / 半减七',
    pool: ['maj', 'min', 'maj7', 'dom7', 'min7', 'dim7', 'add9', 'm7b5'],
    inversions: false,
  },
  { level: 6, title: '转位', pool: ['maj', 'min'], inversions: true },
]

export const RHYTHM_TAP_LEVELS: ReadonlyArray<LevelInfo & { bpm: number; beats: number }> = [
  { level: 1, title: '80 BPM', bpm: 80, beats: 8 },
  { level: 2, title: '100 BPM', bpm: 100, beats: 8 },
  { level: 3, title: '120 BPM', bpm: 120, beats: 12 },
  { level: 4, title: '140 BPM', bpm: 140, beats: 12 },
  { level: 5, title: '60 BPM 慢拍', bpm: 60, beats: 8 },
]

export const RHYTHM_PATTERN_LEVELS: ReadonlyArray<LevelInfo & { bpm: number }> = [
  { level: 1, title: '四分 / 八分', bpm: 84 },
  { level: 2, title: '附点 / 切分', bpm: 84 },
  { level: 3, title: '十六分', bpm: 76 },
  { level: 4, title: '三连音', bpm: 76 },
  { level: 5, title: '休止与弱起', bpm: 88 },
]

export function levelTitles(module: ModuleId): LevelInfo[] {
  switch (module) {
    case 'E1':
      return PITCH_COMPARE_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'E2':
      return INTERVAL_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'E3':
      return DEGREE_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'E4':
      return SCALE_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'E5':
      return CHORD_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'R1':
      return RHYTHM_TAP_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'R2':
    case 'R3':
      return RHYTHM_PATTERN_LEVELS.map(({ level, title }) => ({ level, title }))
    case 'E6':
      return strip(P2.PROGRESSION_LEVELS)
    case 'E7':
      return strip(P2.BASSLINE_LEVELS)
    case 'E8':
      return strip(P2.DICTATION_LEVELS)
    case 'E9':
      return strip(P2.RHYTHM_CHOICE_LEVELS)
    case 'S1':
      return strip(P2.SING_NOTE_LEVELS)
    case 'S2':
      return strip(P2.SING_SUSTAIN_LEVELS)
    case 'S3':
      return strip(P2.SING_INTERVAL_LEVELS)
    case 'S4':
      return strip(P2.SING_SCALE_LEVELS)
    case 'S5':
      return strip(P2.SING_DEGREE_LEVELS)
    case 'S6':
    case 'S7':
      return strip(P2.SIGHT_LEVELS)
    case 'N1':
      return strip(P2.NOTE_NAME_LEVELS)
    case 'T1':
      return strip(P2.THEORY_LEVELS)
    case 'I1':
    case 'I2':
      return strip(P2.PLAY_LEVELS)
  }
}

function strip(levels: ReadonlyArray<LevelInfo>): LevelInfo[] {
  return levels.map(({ level, title }) => ({ level, title }))
}

export function clampLevel(module: ModuleId, level: number): number {
  const max = levelTitles(module).length
  return Math.max(1, Math.min(max, Math.round(level)))
}
