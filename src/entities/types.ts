import type { SheetFormat, SheetTrackInfo } from '@/import/gpImport'
import type { PracticeRole, StemKind, StemMix, SyncMap } from '@/songs/backingSync'
import type { CompPlan, LyricLine, MixSettings } from '@/songs/singTypes'
import type { ModuleId } from '@/drills/types'
import type { Score } from '@/music/score'
import type { RigPreset, RigSettings } from '@/audio/guitar/rigSettings'
import type { GuitarExercise } from '@/guitar/units'

export type InstrumentId = 'guitar' | 'bass' | 'piano' | 'none'
export type NotationId = 'staff' | 'jianpu' | 'tab'
export type ThemeMode = 'dark' | 'light'

export const INSTRUMENT_LABEL: Record<InstrumentId, string> = {
  guitar: '吉他',
  bass: '贝斯',
  piano: '钢琴 / 键盘',
  none: '暂无乐器',
}

export interface StudentProfile {
  id: 'me'
  displayName: string
  instrument: InstrumentId
  secondInstrument?: InstrumentId
  notation: NotationId
  theme: ThemeMode
  /** Vocal range from calibration (MIDI), set in P2. */
  vocalRange?: { low: number; high: number }
  octaveEquivalence: boolean
  /** Measured tap latency (ms) subtracted from every tap; 0 until calibrated. */
  deviceLatencyMs: number
  /** Use the downloaded Salamander piano samples instead of the synth piano. */
  /** @deprecated The bundled piano is always available (0.10.0). */
  sampledPiano?: boolean
  /** Timbre for drills, placement and lessons. Default piano. */
  trainingTimbre?: 'piano' | 'instrument'
  /** Guitar tuning and capo (P4). */
  guitarTuning?: 'standard' | 'dropD' | 'halfDown'
  capo?: number
  /** Chosen audio devices (G1). Ids are stable per browser origin. */
  audioInputId?: string
  audioInputLabel?: string
  audioOutputId?: string
  audioOutputLabel?: string
  /** Calibrated total latency (ms) per "input→output" device pair. */
  latencyByDevice?: Record<string, number>
  /** Guitar monitor: current settings, saved presets, and whether monitoring is on. */
  guitarRig?: RigSettings
  guitarPresets?: RigPreset[]
  guitarPresetId?: string
  monitorOn?: boolean
  /** How often the chord-recognition hint agreed with the chart, per input kind (G2). */
  chordHintStats?: { cable?: { agree: number; total: number }; mic?: { agree: number; total: number } }
  /** Onboarding (name / instrument / notation) finished. */
  setupDone: boolean
  placementDone: boolean
  /** Highest curriculum stage unlocked (0–5). */
  unlockedStage: number
  /** Graduation project completed (P5). */
  graduatedAt?: number
  xp: number
  streak: { current: number; best: number; lastDate: string | null }
  createdAt: number
  updatedAt: number
}

export interface SkillObservation {
  /** 0–1 credit for this observation. */
  credit: number
  /** Relative weight (placement observations are lighter). */
  weight: number
  at: number
}

export interface SkillMastery {
  skillId: string
  module: ModuleId
  /** Most recent observations, oldest first, capped. */
  observations: SkillObservation[]
  /** Cached estimate 0–1 (recomputed on every write). */
  mastery: number
  attempts: number
  lastAt: number
}

export interface ModuleProgress {
  moduleId: ModuleId
  /** Level currently being practised. */
  level: number
  /** Highest level reached (for the level picker). */
  unlockedLevel: number
  /** Outcomes at the current level, oldest first, capped. */
  recentAtLevel: Array<{ correct: boolean; credit: number }>
  totalAttempts: number
  totalCorrect: number
  updatedAt: number
}

export type SessionKind = 'free' | 'daily' | 'placement' | 'challenge' | 'ai'

export interface DrillSession {
  id: string
  kind: SessionKind
  modules: ModuleId[]
  startedAt: number
  endedAt?: number
  questions: number
  correct: number
  creditSum: number
  xpEarned: number
  /** Challenge mode: best streak in this session. */
  bestStreak: number
}

export interface DrillAttempt {
  id: string
  sessionId: string
  module: ModuleId
  level: number
  seed: number
  skillIds: string[]
  correct: boolean
  credit: number
  expectedLabel: string
  givenLabel: string
  confusedWith?: string
  timingMs?: number
  responseMs: number
  createdAt: number
}

export interface ConfusionPair {
  /** `${module}|${expected}|${given}` */
  id: string
  module: ModuleId
  expected: string
  given: string
  count: number
  lastAt: number
}

export interface DailyPlanItem {
  id: string
  module: ModuleId
  level: number
  questions: number
  /** Skills this item was built to target (shown as the reason). */
  focusSkills: string[]
  reason: string
  completed: boolean
  /** Where the item opens instead of the drill page (guitar workshop). */
  link?: string
  /** Display name instead of the module name. */
  label?: string
}

export interface DailyPlan {
  /** YYYY-MM-DD in local time. */
  date: string
  /** Plan format; older untouched plans are rebuilt. */
  version?: number
  items: DailyPlanItem[]
  createdAt: number
  completedAt?: number
}

export interface PlacementSectionResult {
  id: string
  title: string
  module?: ModuleId
  /** Highest level with ≥ the pass ratio, 0 when none. */
  reachedLevel: number
  attempts: number
  correct: number
  skipped: boolean
}

export interface PlacementResult {
  id: string
  startedAt: number
  finishedAt: number
  sections: PlacementSectionResult[]
  recommendedStage: number
  startingLevels: Partial<Record<ModuleId, number>>
  strengths: string[]
  gaps: string[]
}

/** Spaced-repetition state of one fine-grained skill (SM-2 family). */
export interface ReviewItem {
  skillId: string
  module: ModuleId
  /** Next review time (ms). */
  due: number
  /** Days; 0 while still in learning. */
  interval: number
  ease: number
  reps: number
  lapses: number
  lastAt: number
}

export interface LessonProgress {
  lessonId: string
  stage: number
  /** Exercise block ids passed in this lesson. */
  exercisesDone: string[]
  /** Composition saved for the lesson's micro-creation. */
  compositionId?: string
  /** 课后实操 results by step id (1.0). Not required for completion. */
  handsOn?: Record<string, { status: 'passed' | 'failed' | 'skipped'; score: number; at: number }>
  completedAt?: number
  updatedAt: number
}

export type CompositionKind = 'rhythm' | 'melody' | 'song'

/** A micro-creation. Steps are a fixed grid (eighth notes); null = rest. */
export interface Composition {
  id: string
  title: string
  kind: CompositionKind
  lessonId?: string
  stage: number
  bpm: number
  /** Grid length in eighth notes. */
  steps: number
  /** Rhythm: hit flags. Melody: MIDI per step (null = rest, -1 = hold previous). */
  cells: Array<number | null>
  /** Melody key (major tonic) and scale for display / constraints. */
  tonic?: number
  scale?: string
  /** Songs (composer / harmony lessons): the full score. `cells` is empty then. */
  score?: Score
  /** The graduation project (P5). */
  project?: 'graduation'
  /** Last time the student exported this work (any format). */
  exportedAt?: number
  createdAt: number
  updatedAt: number
}

/** A saved snapshot of a song, so earlier versions can be replayed or restored (P5). */
export interface CompositionVersion {
  id: string
  compositionId: string
  createdAt: number
  score: Score
  /** e.g. "恢复自 10/08 21:30 的版本" */
  note?: string
}

export type ReviewDimension = 'structure' | 'harmony' | 'melody' | 'arrangement'

export interface AIReviewPoint {
  /** 1-based bar the point refers to, when it refers to one. */
  bar?: number
  text: string
}

/** Validated AI critique of a work. Suggestions only; it never contains music for the student. */
export interface AIReview {
  summary: string
  dimensions: Array<{ dimension: ReviewDimension; strengths: string[]; suggestions: AIReviewPoint[] }>
  nextStep: string
}

/** One critique of a work: the rule-engine results at that moment, plus the optional AI review. */
export interface CritiqueRecord {
  id: string
  compositionId: string
  createdAt: number
  /** Bars and beats at review time (to tell later edits apart). */
  bars: number
  rules: Array<{ severity: 'warn' | 'info' | 'good'; message: string; bar?: number }>
  ai?: AIReview
  promptVersion?: string
  model?: string
}

/** Exercise specs the AI proposed, after local validation. The questions themselves are built locally. */
export type ExerciseSpec =
  | { kind: 'progression'; mode: 'major' | 'minor'; romans: string[] }
  | { kind: 'melody'; notes: Array<{ semitones: number; beats: number }> }
  | { kind: 'guitar'; exercise: GuitarExercise }

export interface GeneratedExercise {
  id: string
  module: 'E6' | 'E8' | 'guitar'
  level: number
  spec: ExerciseSpec
  /** Skills this exercise targets. */
  targetSkills: string[]
  /** Why the AI chose it, shown to the student. */
  reason: string
  promptVersion: string
  model: string
  createdAt: number
  usedAt?: number
}

/** A song sheet the student imported (MIDI, MusicXML, chord chart or tab). */
/**
 * Progress of a drill the student left before finishing (Dexie v6). Keyed by
 * where the drill lives (e.g. "module:E1", "plan:<item id>", "placement").
 * Temporary: not exported, expires after 7 days (plan items at day end).
 */
export interface ActiveRun {
  id: string
  /** What the snapshot belongs to; the owning component reads its own shape. */
  kind: 'drill' | 'placement' | 'guitar-quiz'
  title: string
  /** Route that resumes it. */
  link: string
  sessionId?: string
  /** Questions answered so far and total (for the "继续" card). */
  done: number
  total: number
  correct: number
  data: unknown
  createdAt: number
  updatedAt: number
  expiresAt: number
}

export interface SheetBacking {
  stems: Array<{ fileId: string; stem: StemKind; name: string; size: number }>
  sync: SyncMap
  mix?: Partial<Record<StemKind, StemMix>>
  role?: PracticeRole
  /** Sheet tracks played by the synth alongside the recording (e.g. rhythm guitar to replace the guitar stem). */
  fillTracks?: number[]
  /** Recording vs synth balance, 0–1 each. */
  recordingVolume?: number
  synthVolume?: number
}

/** 后期课堂 (0.19.0, Dexie v12): the student's own voice for the lessons (one row, id 'voice'). */
export interface MixCourseVoice {
  id: 'voice'
  /** Mono samples as a WAV blob. */
  blob: Blob
  sampleRate: number
  durationMs: number
  /** 'recorded' in the course, or taken from a 跟唱 take. */
  source: 'recorded' | 'take'
  createdAt: number
}

/** A lesson read / its task passed. */
export interface MixLessonProgress {
  lessonId: string
  readAt?: number
  taskPassedAt?: number
}

/** Ear-drill record per kind. */
export interface EarDrillStats {
  kind: string
  level: number
  attempts: number
  correct: number
  /** Last answers at the current level (true = right), newest last, at most 10. */
  recent: boolean[]
  best: number
  updatedAt: number
}

/** A mix the student saved as their own preset (0.21.0). */
export interface UserMixPreset {
  id: string
  name: string
  mix: import('@/songs/singTypes').MixSettings
  createdAt: number
}

/**
 * 歌曲库 (0.18.0, Dexie v11): a folder on this computer the student chose.
 * The handle is the browser's permission to read it (asked again after a
 * restart); songs are never copied, only listed.
 */
export interface LibraryFolder {
  id: string
  name: string
  handle: FileSystemDirectoryHandle
  addedAt: number
  lastScanAt?: number
}

/** A song file in a library folder, with its cleaned-up name. Id = folderId + '/' + path. */
export interface LibrarySong {
  id: string
  folderId: string
  /** Path inside the folder, '/'-separated. */
  path: string
  fileName: string
  size: number
  lastModified: number
  title: string
  artist: string
  album?: string
  /** Where the name came from; 'manual' names are never overwritten by a rescan. */
  source: 'tags' | 'filename' | 'manual'
  needsReview: boolean
  addedAt: number
}

/** 跟唱 (0.14.0): a song the student sings along to (Dexie v9). Its audio lives in audioFiles (sheetId = this id). */
export interface SingSong {
  id: string
  title: string
  artist?: string
  stems: Array<{ fileId: string; stem: StemKind; name: string; size: number }>
  /** Lead vocal level while singing along (0 = off, the student alone). */
  guideVolume?: number
  lastPracticedAt?: number
  createdAt: number
  updatedAt: number
}

/** Key of a sing-along source: "song:<id>" or "sheet:<id>". */
export type SingKey = string

/** One sung attempt (a phrase, or the whole song for the full version). Dexie v10. */
export interface SingTake {
  id: string
  key: SingKey
  /** Phrase index, or -1 for a full-song take. */
  phrase: number
  createdAt: number
  /** Note-level result (null when nothing scorable was sung). */
  score: TakeScore | null
  /** Sung pitch: recording-time ms and MIDI, same length. */
  sungMs: Float32Array
  sungMidi: Float32Array
  /** Recording of the take (Opus) and where it starts in the song, ms (latency already removed). */
  audio?: Blob
  audioStartMs?: number
  /** Extra nudge applied when playing / mixing, ms. */
  nudgeMs?: number
  /** The phrase's stretch when it was sung (takes follow it when the phrase cuts change). */
  fromMs?: number
  toMs?: number
  /** Playback speed it was sung at (1 = original). */
  speed?: number
  /** Student pinned it: never pruned. */
  kept?: boolean
}

/** Score of one take (the summary of SingAlong's note-level scoring). */
export interface TakeScore {
  score: number
  notesSung: number
  notesTotal: number
  meanAbsCents: number
  biasCents: number
  lagMs: number
  octaveShift: number
  /** Per-note cents (null = not sung), in note order. */
  noteCents: Array<number | null>
}

/** Per-source sing-along data shared by 跟唱 songs and sheets (Dexie v10). */
export interface SingMeta {
  key: SingKey
  scoreVersion: number
  phraseBests: Record<number, number>
  lyrics?: LyricLine[]
  /** The lyric times are trusted (LRC, a confirmed alignment, tapping): phrases follow the lines. */
  lyricsTimed?: boolean
  /** Phrases merged / split by hand (empty or missing = automatic). */
  phraseCuts?: Array<{ startMs: number; endMs: number }>
  comp?: CompPlan
  mix?: MixSettings
  updatedAt: number
}

/** A finished cover (rendered mix), shown in 作品集 → 翻唱 (Dexie v10). Audio not exported. */
export interface CoverWork {
  id: string
  key: SingKey
  title: string
  artist?: string
  mix: MixSettings
  blob: Blob
  durationMs: number
  createdAt: number
}

/** Cached pitch curve of a vocals stem (Dexie v9). */
export interface PitchCurveRow {
  fileId: string
  version: number
  /** Seconds per frame. */
  hop: number
  /** MIDI per frame (fractional), NaN = unvoiced. */
  midi: Float32Array
  createdAt: number
}

/** A recording or stem attached to a sheet (Dexie v8). Kept as a Blob; not part of data export. */
export interface AudioFile {
  id: string
  sheetId: string
  stem: StemKind
  name: string
  size: number
  type: string
  blob: Blob
  createdAt: number
}

/** Original bytes of an imported sheet (base64, so backups stay plain JSON). Dexie v7. */
export interface SheetFile {
  id: string
  name: string
  size: number
  base64: string
  createdAt: number
}

export interface SongSheet {
  id: string
  title: string
  source: 'midi' | 'musicxml' | 'chords' | 'tab' | 'gp'
  /** File format it came from (1.0: all new imports; older rows infer from source). */
  format?: SheetFormat
  /** Singer / band, for grouping. Empty = not filled in. */
  artist?: string
  /** Who made the tab (GP "tab" field), shown in the version picker. */
  tabber?: string
  /** The student's own name for this version ("原版", "简化版"…). */
  versionLabel?: string
  /** Original file (sheetFiles), kept for formats alphaTab renders. */
  fileId?: string
  /** Tracks of a multi-track file. */
  tracks?: SheetTrackInfo[]
  defaultTrack?: number
  bars?: number
  sections?: Array<{ bar: number; name: string }>
  tags?: string[]
  lastOpenedAt?: number
  lastPracticedAt?: number
  /** Best practice score per "track:fromBar-toBar". */
  sectionBests?: Record<string, number>
  /** 变调 in semitones (−6…+6) and how the guitar plays it. */
  transpose?: number
  transposeWay?: 'capo' | 'frets'
  /** 原曲伴奏 (0.13.0): the recording or its stems, aligned to the sheet. */
  backing?: SheetBacking
  /** Melody and / or chords. */
  score?: Score
  /** Guitar tab (lead line), for tab imports. */
  tab?: Array<{ string: number; fret: number; beats: number; tech?: 'bend' | 'bend-half' | 'vibrato' | 'hammer' | 'pull' | 'slide' }>
  /** Strumming pattern to practise with. */
  pattern?: string
  bpm: number
  notes?: string
  createdAt: number
  updatedAt: number
}

/** Best result per guitar-workshop exercise (G1). */
export interface GuitarProgress {
  exerciseId: string
  unitId: string
  /** Best score 0–1. */
  best: number
  attempts: number
  passedAt?: number
  /** Short description of the last attempt, e.g. "准 18 · 可 5 · 漏 1". */
  last?: string
  updatedAt: number
}

/** Weekly training advice from the AI, keyed by the Monday of the week. */
export interface AdviceRecord {
  week: string
  createdAt: number
  focus: Array<{ module: ModuleId; minutes: number; reason: string }>
  tip: string
  promptVersion: string
  model: string
}

export interface Badge {
  id: string
  earnedAt: number
}

export interface AISettingsRow {
  id: 'default'
  provider: 'openai' | 'qwen' | 'deepseek' | 'MiniMax' | 'mimo' | 'custom'
  baseURL: string
  /** AES-GCM encrypted payload (see infrastructure/crypto). */
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  updatedAt: number
}

export interface CryptoKeyRow {
  id: string
  key: CryptoKey
  createdAt: number
}
