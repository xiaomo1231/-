import type { IntervalId } from '@/music/intervals'
import type { DegreeId, ScaleId } from '@/music/scales'
import type { LevelInfo } from './levels'

// ---------------------------------------------------------------------------
// Ear training E6–E9
// ---------------------------------------------------------------------------

export const PROGRESSION_LEVELS: ReadonlyArray<LevelInfo & { progressionLevel: number; chords: number }> = [
  { level: 1, title: 'I · IV · V', progressionLevel: 1, chords: 4 },
  { level: 2, title: '加入 vi', progressionLevel: 2, chords: 4 },
  { level: 3, title: '加入 ii · iii', progressionLevel: 3, chords: 4 },
  { level: 4, title: '小调进行', progressionLevel: 4, chords: 4 },
  { level: 5, title: '借用和弦 ♭VII · ♭VI · iv', progressionLevel: 5, chords: 4 },
  { level: 6, title: '副属和弦', progressionLevel: 6, chords: 4 },
  { level: 7, title: '8 个和弦', progressionLevel: 6, chords: 8 },
]

export type BassStyle = 'roots' | 'fifths' | 'passing' | 'syncopated'

export const BASSLINE_LEVELS: ReadonlyArray<LevelInfo & { progressionLevel: number; style: BassStyle }> = [
  { level: 1, title: '根音 · I IV V', progressionLevel: 1, style: 'roots' },
  { level: 2, title: '根音 · 加入 vi', progressionLevel: 2, style: 'roots' },
  { level: 3, title: '根音 + 五度八度', progressionLevel: 3, style: 'fifths' },
  { level: 4, title: '加入经过音', progressionLevel: 3, style: 'passing' },
  { level: 5, title: '切分节奏', progressionLevel: 3, style: 'syncopated' },
]

export const DICTATION_LEVELS: ReadonlyArray<LevelInfo & { notes: number; maxLeap: number; chromatic: boolean }> = [
  { level: 1, title: '2 个音', notes: 2, maxLeap: 4, chromatic: false },
  { level: 2, title: '1 小节 · 级进', notes: 4, maxLeap: 1, chromatic: false },
  { level: 3, title: '1 小节 · 含跳进', notes: 4, maxLeap: 3, chromatic: false },
  { level: 4, title: '2 小节', notes: 8, maxLeap: 4, chromatic: false },
  { level: 5, title: '3 小节', notes: 12, maxLeap: 4, chromatic: false },
  { level: 6, title: '含变化音', notes: 8, maxLeap: 3, chromatic: true },
]

export const RHYTHM_CHOICE_LEVELS: ReadonlyArray<LevelInfo & { patternLevel: number; bars: number; bpm: number }> = [
  { level: 1, title: '四分 / 八分', patternLevel: 1, bars: 1, bpm: 84 },
  { level: 2, title: '附点 / 切分', patternLevel: 2, bars: 1, bpm: 84 },
  { level: 3, title: '十六分', patternLevel: 3, bars: 1, bpm: 76 },
  { level: 4, title: '三连音', patternLevel: 4, bars: 1, bpm: 76 },
  { level: 5, title: '休止与弱起', patternLevel: 5, bars: 1, bpm: 84 },
  { level: 6, title: '2 小节', patternLevel: 5, bars: 2, bpm: 84 },
]

// ---------------------------------------------------------------------------
// Singing S1–S7
// ---------------------------------------------------------------------------

export const SING_NOTE_LEVELS: ReadonlyArray<LevelInfo & { tolerance: number }> = [
  { level: 1, title: '±50 音分', tolerance: 50 },
  { level: 2, title: '±35 音分', tolerance: 35 },
  { level: 3, title: '±25 音分', tolerance: 25 },
  { level: 4, title: '±15 音分', tolerance: 15 },
]

export const SING_SUSTAIN_LEVELS: ReadonlyArray<LevelInfo & { seconds: number; tolerance: number; maxDrift: number }> = [
  { level: 1, title: '2 秒', seconds: 2, tolerance: 40, maxDrift: 60 },
  { level: 2, title: '3 秒', seconds: 3, tolerance: 35, maxDrift: 45 },
  { level: 3, title: '5 秒', seconds: 5, tolerance: 30, maxDrift: 35 },
]

export const SING_INTERVAL_LEVELS: ReadonlyArray<LevelInfo & { pool: IntervalId[]; down: boolean }> = [
  { level: 1, title: '大二 · 大三 · 纯五', pool: ['M2', 'M3', 'P5'], down: false },
  { level: 2, title: '加入小三 · 纯四 · 八度', pool: ['M2', 'M3', 'P5', 'm3', 'P4', 'P8'], down: false },
  { level: 3, title: '加入小二 · 大六 · 下行', pool: ['M2', 'M3', 'P5', 'm3', 'P4', 'P8', 'm2', 'M6'], down: true },
  { level: 4, title: '加入小六 · 七度', pool: ['M2', 'M3', 'P5', 'm3', 'P4', 'm2', 'M6', 'm6', 'm7', 'M7'], down: true },
  { level: 5, title: '全部音程', pool: ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'], down: true },
]

export const SING_SCALE_LEVELS: ReadonlyArray<LevelInfo & { pool: ScaleId[]; descend: boolean }> = [
  { level: 1, title: '大调上行', pool: ['major'], descend: false },
  { level: 2, title: '大调上下行', pool: ['major'], descend: true },
  { level: 3, title: '自然小调', pool: ['natural_minor'], descend: true },
  { level: 4, title: '五声音阶', pool: ['pentatonic_major', 'pentatonic_minor'], descend: true },
  { level: 5, title: '布鲁斯音阶', pool: ['blues'], descend: true },
]

export const SING_DEGREE_LEVELS: ReadonlyArray<LevelInfo & { pool: DegreeId[]; mode: 'major' | 'minor' }> = [
  { level: 1, title: '1 · 3 · 5 级', pool: ['1', '3', '5'], mode: 'major' },
  { level: 2, title: '加入 2 · 4 级', pool: ['1', '2', '3', '4', '5'], mode: 'major' },
  { level: 3, title: '加入 6 · 7 级', pool: ['1', '2', '3', '4', '5', '6', '7'], mode: 'major' },
  { level: 4, title: '小调级数', pool: ['1', '2', 'b3', '4', '5', 'b6', 'b7'], mode: 'minor' },
  { level: 5, title: '加入变化音', pool: ['1', 'b3', '3', '4', '#4', '5', 'b7', '7'], mode: 'major' },
]

export const SIGHT_LEVELS: ReadonlyArray<LevelInfo & { beats: number; maxLeap: number; eighths: boolean; bpm: number }> = [
  { level: 1, title: '1 小节 · 级进', beats: 4, maxLeap: 1, eighths: false, bpm: 66 },
  { level: 2, title: '1 小节 · 三度内跳进', beats: 4, maxLeap: 2, eighths: false, bpm: 66 },
  { level: 3, title: '2 小节 · 含八分音符', beats: 8, maxLeap: 2, eighths: true, bpm: 66 },
  { level: 4, title: '4 小节 · 五度内跳进', beats: 16, maxLeap: 4, eighths: true, bpm: 72 },
]

// ---------------------------------------------------------------------------
// Reading & theory
// ---------------------------------------------------------------------------

export const NOTE_NAME_LEVELS: ReadonlyArray<
  LevelInfo & { clefs: Array<'treble' | 'bass'>; low: Record<'treble' | 'bass', number>; high: Record<'treble' | 'bass', number>; accidentals: boolean }
> = [
  { level: 1, title: '高音谱号 · 线与间', clefs: ['treble'], low: { treble: 64, bass: 43 }, high: { treble: 77, bass: 57 }, accidentals: false },
  { level: 2, title: '高音谱号 · 加线', clefs: ['treble'], low: { treble: 57, bass: 43 }, high: { treble: 84, bass: 57 }, accidentals: false },
  { level: 3, title: '低音谱号', clefs: ['bass'], low: { treble: 64, bass: 40 }, high: { treble: 77, bass: 60 }, accidentals: false },
  { level: 4, title: '升降号', clefs: ['treble'], low: { treble: 60, bass: 43 }, high: { treble: 81, bass: 57 }, accidentals: true },
  { level: 5, title: '大谱表混合', clefs: ['treble', 'bass'], low: { treble: 57, bass: 40 }, high: { treble: 84, bass: 62 }, accidentals: true },
]

export type TheoryTopic = 'rhythm' | 'pitch' | 'major' | 'interval' | 'minor'

export const THEORY_LEVELS: ReadonlyArray<LevelInfo & { topics: TheoryTopic[] }> = [
  { level: 1, title: '时值与拍号', topics: ['rhythm'] },
  { level: 2, title: '音名 · 半音与全音', topics: ['rhythm', 'pitch'] },
  { level: 3, title: '大调音阶与调号', topics: ['pitch', 'major'] },
  { level: 4, title: '音程（看音名）', topics: ['major', 'interval'] },
  { level: 5, title: '小调与关系调', topics: ['interval', 'minor'] },
]

// ---------------------------------------------------------------------------
// Instrument tasks
// ---------------------------------------------------------------------------

export type PlayMode = 'find_note' | 'interval' | 'scale' | 'melody' | 'arpeggio'

export const PLAY_LEVELS: ReadonlyArray<LevelInfo & { mode: PlayMode; tolerance: number }> = [
  { level: 1, title: '找到这个音', mode: 'find_note', tolerance: 30 },
  { level: 2, title: '弹出音程', mode: 'interval', tolerance: 30 },
  { level: 3, title: '弹大调音阶', mode: 'scale', tolerance: 30 },
  { level: 4, title: '看谱弹旋律', mode: 'melody', tolerance: 30 },
  { level: 5, title: '分解和弦', mode: 'arpeggio', tolerance: 30 },
]
