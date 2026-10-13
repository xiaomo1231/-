import Dexie, { type Table } from 'dexie'
import type {
  MixCourseVoice,
  MixLessonProgress,
  EarDrillStats,
  UserMixPreset,
  LibraryFolder,
  LibrarySong,
  AISettingsRow,
  Badge,
  ConfusionPair,
  CryptoKeyRow,
  DailyPlan,
  DrillAttempt,
  DrillSession,
  ModuleProgress,
  PlacementResult,
  ReviewItem,
  LessonProgress,
  Composition,
  SkillMastery,
  StudentProfile,
  CompositionVersion,
  CritiqueRecord,
  GeneratedExercise,
  AdviceRecord,
  GuitarProgress,
  SongSheet,
  ActiveRun,
  SheetFile,
  AudioFile,
  SingSong,
  PitchCurveRow,
  SingTake,
  SingMeta,
  CoverWork,
} from '@/entities/types'

export const DB_NAME = 'groovelab'

/**
 * Single IndexedDB database. Everything the student does lives here; nothing
 * is sent anywhere unless the student configures an AI provider, and even then
 * only symbolic data (never audio) leaves the browser.
 */
export class GrooveLabDB extends Dexie {
  profile!: Table<StudentProfile, string>
  aiSettings!: Table<AISettingsRow, string>
  cryptoKeys!: Table<CryptoKeyRow, string>
  skillMastery!: Table<SkillMastery, string>
  moduleProgress!: Table<ModuleProgress, string>
  drillSessions!: Table<DrillSession, string>
  drillAttempts!: Table<DrillAttempt, string>
  confusions!: Table<ConfusionPair, string>
  dailyPlans!: Table<DailyPlan, string>
  placements!: Table<PlacementResult, string>
  badges!: Table<Badge, string>
  reviewItems!: Table<ReviewItem, string>
  lessonProgress!: Table<LessonProgress, string>
  compositions!: Table<Composition, string>
  compositionVersions!: Table<CompositionVersion, string>
  critiques!: Table<CritiqueRecord, string>
  generatedExercises!: Table<GeneratedExercise, string>
  advice!: Table<AdviceRecord, string>
  guitarProgress!: Table<GuitarProgress, string>
  songSheets!: Table<SongSheet, string>
  activeRuns!: Table<ActiveRun, string>
  sheetFiles!: Table<SheetFile, string>
  audioFiles!: Table<AudioFile, string>
  singSongs!: Table<SingSong, string>
  pitchCurves!: Table<PitchCurveRow, string>
  singTakes!: Table<SingTake, string>
  singMeta!: Table<SingMeta, string>
  covers!: Table<CoverWork, string>
  libraryFolders!: Table<LibraryFolder, string>
  librarySongs!: Table<LibrarySong, string>
  mixCourse!: Table<MixCourseVoice, string>
  mixProgress!: Table<MixLessonProgress, string>
  earStats!: Table<EarDrillStats, string>
  userMixPresets!: Table<UserMixPreset, string>

  constructor(name = DB_NAME) {
    super(name)
    this.version(1).stores({
      profile: 'id',
      aiSettings: 'id',
      cryptoKeys: 'id',
      skillMastery: 'skillId, module, mastery',
      moduleProgress: 'moduleId',
      drillSessions: 'id, kind, startedAt',
      drillAttempts: 'id, sessionId, module, createdAt, [module+createdAt]',
      confusions: 'id, module, count',
      dailyPlans: 'date',
      placements: 'id, finishedAt',
      badges: 'id',
    })
    // v2 (P2): spaced repetition, lesson progress, micro-creation portfolio.
    this.version(2).stores({
      reviewItems: 'skillId, due, module',
      lessonProgress: 'lessonId, stage',
      compositions: 'id, lessonId, stage, createdAt',
    })
    // v3 (P5): version history, critiques, AI exercises, weekly advice.
    this.version(3).stores({
      compositionVersions: 'id, compositionId, createdAt, [compositionId+createdAt]',
      critiques: 'id, compositionId, createdAt, [compositionId+createdAt]',
      generatedExercises: 'id, module, createdAt, usedAt',
      advice: 'week',
    })
    // v4 (G1): guitar workshop progress.
    this.version(4).stores({
      guitarProgress: 'exerciseId, unitId',
    })
    // v5: imported song sheets.
    this.version(5).stores({
      songSheets: 'id, createdAt',
    })
    // v6: progress of unfinished drills (resume later).
    this.version(6).stores({
      activeRuns: 'id, updatedAt, expiresAt',
    })
    // v7: original files of imported sheets; sheets indexed by artist.
    this.version(7).stores({
      songSheets: 'id, createdAt, artist, updatedAt',
      sheetFiles: 'id',
    })
    // v8: recordings / stems attached to sheets (原曲伴奏).
    this.version(8).stores({
      audioFiles: 'id, sheetId',
    })
    // v9: sing-along songs and cached pitch curves of vocals stems.
    this.version(9).stores({
      singSongs: 'id, updatedAt',
      pitchCurves: 'fileId',
    })
    // v10: 跟唱 2.0 — takes (with recordings), per-source lyrics / full version / mix, covers.
    // Scoring changed to note level: the old per-song bests are dropped.
    this.version(10)
      .stores({
        singTakes: 'id, key, [key+phrase], createdAt',
        singMeta: 'key',
        covers: 'id, key, createdAt',
      })
      .upgrade(async (tx) => {
        await tx
          .table('singSongs')
          .toCollection()
          .modify((s: { phraseBests?: unknown }) => {
            delete s.phraseBests
          })
      })
    // v11: 歌曲库 — folders the student picked (directory handles) and the songs found in them.
    this.version(11).stores({
      libraryFolders: 'id',
      librarySongs: 'id, folderId, artist, addedAt',
    })
    // v12: 后期课堂 — own voice for lessons, lesson progress, ear-drill stats; user mix presets (跟唱后期).
    this.version(12).stores({
      mixCourse: 'id',
      mixProgress: 'lessonId',
      earStats: 'kind',
      userMixPresets: 'id, createdAt',
    })
  }
}

let instance: GrooveLabDB | null = null

export function getDb(): GrooveLabDB {
  if (!instance) instance = new GrooveLabDB()
  return instance
}

/** Tests swap in a fresh database per case. */
export function setDbForTests(db: GrooveLabDB | null): void {
  instance = db
}

/** Wipe every table (data management → reset). The device key is kept. */
export async function clearAllData(): Promise<void> {
  const db = getDb()
  await db.transaction(
    'rw',
    [
      db.profile,
      db.aiSettings,
      db.skillMastery,
      db.moduleProgress,
      db.drillSessions,
      db.drillAttempts,
      db.confusions,
      db.dailyPlans,
      db.placements,
      db.badges,
      db.reviewItems,
      db.lessonProgress,
      db.compositions,
      db.compositionVersions,
      db.critiques,
      db.generatedExercises,
      db.advice,
      db.guitarProgress,
      db.songSheets,
      db.activeRuns,
      db.sheetFiles,
      db.audioFiles,
      db.singSongs,
      db.pitchCurves,
      db.singTakes,
      db.singMeta,
      db.covers,
      db.libraryFolders,
      db.librarySongs,
      db.mixCourse,
      db.mixProgress,
      db.earStats,
      db.userMixPresets,
    ],
    async () => {
      await Promise.all([
        db.profile.clear(),
        db.aiSettings.clear(),
        db.skillMastery.clear(),
        db.moduleProgress.clear(),
        db.drillSessions.clear(),
        db.drillAttempts.clear(),
        db.confusions.clear(),
        db.dailyPlans.clear(),
        db.placements.clear(),
        db.badges.clear(),
        db.reviewItems.clear(),
        db.lessonProgress.clear(),
        db.compositions.clear(),
        db.compositionVersions.clear(),
        db.critiques.clear(),
        db.generatedExercises.clear(),
        db.advice.clear(),
        db.guitarProgress.clear(),
        db.songSheets.clear(),
        db.activeRuns.clear(),
        db.sheetFiles.clear(),
        db.audioFiles.clear(),
        db.singSongs.clear(),
        db.pitchCurves.clear(),
        db.singTakes.clear(),
        db.singMeta.clear(),
        db.covers.clear(),
        db.libraryFolders.clear(),
        db.librarySongs.clear(),
        db.mixCourse.clear(),
        db.mixProgress.clear(),
        db.earStats.clear(),
        db.userMixPresets.clear(),
      ])
    },
  )
}
