/**
 * Shapes shared by the score server (server/) and its web page (web/): accounts,
 * the band (乐队), the ensemble index (找乐队谱) and the rehearsal (排练).
 * Types only — no code, so both sides can import it.
 */

// ---------------------------------------------------------------------------
// accounts
// ---------------------------------------------------------------------------

export type Role = 'admin' | 'member'

export type Instrument = 'guitar' | 'bass' | 'drums' | 'keys' | 'vocal' | 'other'

/** What the page may know about an account (never the password hash). */
export interface UserInfo {
  id: string
  /** Login name: 2–32 chars, letters / digits / _ / - / Chinese. Unique, case-insensitive. */
  username: string
  /** Shown name, 1–32 chars. */
  displayName: string
  role: Role
  /** Can browse and open the whole library; otherwise only the band and its setlist. Admins always can. */
  libraryAccess: boolean
  instrument: Instrument | null
  createdAt: number
  /** Who made the invite this account registered with (null: made by an admin, or the first admin). */
  invitedBy: string | null
  /** A stopped account cannot sign in. */
  disabled: boolean
}

/** One band an account belongs to (GET /api/me). */
export interface BandBrief {
  id: string
  name: string
  leaderId: string
  /** This account leads it. */
  leader: boolean
  members: number
}

/** GET /api/me: the account and its bands. */
export interface MeInfo extends UserInfo {
  bands: BandBrief[]
}

/** POST /api/login */
export interface LoginBody {
  username: string
  password: string
}

/** POST /api/users (admin): a new account. Password 6–128 chars. */
export interface NewUserBody {
  /** The band it joins (admin form only; absent = none). */
  bandId?: string | null
  username: string
  displayName: string
  password: string
  role: Role
  libraryAccess: boolean
  instrument: Instrument | null
}

/** POST /api/users/update (admin): fields to change; password resets it (and signs that user out). */
export interface UpdateUserBody {
  id: string
  displayName?: string
  role?: Role
  libraryAccess?: boolean
  instrument?: Instrument | null
  password?: string
}

/** POST /api/me/update: a member's own name, instrument and (with the old one) password. */
export interface UpdateMeBody {
  displayName?: string
  instrument?: Instrument | null
  oldPassword?: string
  newPassword?: string
}

// ---------------------------------------------------------------------------
// band
// ---------------------------------------------------------------------------

export type SongStatus = 'learning' | 'ready' | 'maybe'

export interface BandSong {
  id: string
  /** Score file inside the library (a GP / MusicXML file). */
  path: string
  title: string
  artist: string
  status: SongStatus
  /** Track index (as a string key) → user id playing it. */
  parts: Record<string, string>
  /** Shared rehearsal note, up to 2000 chars. */
  note: string
  /** Speed everybody practises at, 15–175; null = the player's own choice. */
  rehearsalSpeedPct: number | null
  /** A combined band score (组合乐队谱) used instead of `path`, or null. Optional for older rows. */
  comboId?: string | null
  /** 补位: what the 音箱 plays in a rehearsal. Missing on older rows = all automatic. */
  fill?: FillConfig
  /** 小节留言, oldest first. Missing on older rows = none. */
  comments?: BarComment[]
  /** 自己上传的谱 of this song (an UploadSong id), or null. Missing on older rows = none. */
  uploadId?: string | null
  addedBy: string
  addedAt: number
  updatedAt: number
}

/** One member's practice of one band song (from their practice records). */
export interface MemberProgress {
  userId: string
  totalSeconds: number
  maxSpeedPct: number
  lastAt: number
}

/** A band's size limits, set by an admin. */
export interface BandLimits {
  /** Members, the leader included. */
  maxMembers: number
  /** Uploaded scores and rehearsal recordings together, in bytes. */
  storageBytes: number
}

/** GET /api/band (the band chosen with the X-Band header, else the account's first). */
export interface BandState {
  id: string
  name: string
  leaderId: string
  limits: BandLimits
  /** Bytes of uploads and recordings of this band. */
  storageUsed: number
  /** Setlist order. */
  songs: BandSong[]
  /** 今天排练的歌 (band song ids, in order). */
  rehearsalSetlist: string[]
  members: UserInfo[]
  /** songId → the members' practice of it (members who never practised it are left out). */
  progress: Record<string, MemberProgress[]>
}

/** POST /api/band/songs/add */
export interface AddBandSongBody {
  path: string
  title: string
  artist: string
}

/** POST /api/band/songs/update */
export interface UpdateBandSongBody {
  id: string
  comboId?: string | null
  status?: SongStatus
  parts?: Record<string, string>
  note?: string
  rehearsalSpeedPct?: number | null
  fill?: FillConfig
  uploadId?: string | null
}

// ---------------------------------------------------------------------------
// 自己上传的谱 (members' own score files, kept in SCORES_DATA/uploads/, never in the library)
// ---------------------------------------------------------------------------

export type UploadKind = 'score' | 'pdf' | 'image'

export interface UploadFile {
  id: string
  /** Original file name. */
  name: string
  /** Which instrument / part it is, e.g. 贝斯, 主音吉他, 鼓 (1–20 chars). */
  label: string
  kind: UploadKind
  /** gp, gp3, gp4, gp5, gpx, musicxml, mxl, pdf, png, jpg, webp. */
  ext: string
  size: number
  /** The path to open it with (`~uploads/…`). */
  path: string
  uploadedBy: string
  uploadedAt: number
}

/** A song made from uploaded files: a new song, or the own files of a band song from the library. */
export interface UploadSong {
  id: string
  /** The band it belongs to (only that band's members see it); '' = 我的谱子, only its uploader's. */
  bandId: string
  title: string
  artist: string
  files: UploadFile[]
  createdBy: string
  createdAt: number
  updatedAt: number
}

/** POST /api/uploads/create */
export interface NewUploadSongBody {
  title: string
  artist: string
  /** Attach to this band song (its own files) instead of making a new song. */
  bandSongId: string | null
  /** 我的谱子: the uploader's own song, in no band (counts against the personal space). */
  personal?: boolean
}

/** POST /api/uploads/file?id=&label=&name= with the raw file as body. */
export interface UploadFileQuery {
  id: string
  label: string
  name: string
}

// ---------------------------------------------------------------------------
// 补位 (fill-in): which tracks the 音箱 plays for missing members
// ---------------------------------------------------------------------------

/** 'auto' = play when nobody present plays it; 'on' / 'off' = the conductor's choice. */
export type FillMode = 'auto' | 'on' | 'off'

/**
 * Where the drums come from.
 * auto      — the saved drum part (鼓谱编辑器) if any, else the file's drum track, else generated;
 * file      — the file's own drum track;
 * saved     — the saved drum part;
 * generated — generated from the templates (the same on every device: fixed seed);
 * metronome — no drums, the metronome only.
 */
export type FillDrumSource = 'auto' | 'file' | 'saved' | 'generated' | 'metronome'

export interface FillConfig {
  /** Track index (string key "0".."63") → mode; missing = 'auto'. Drum tracks are governed by `drums`. */
  tracks: Record<string, FillMode>
  /** Track index or 'drums' → volume in percent (0–150); missing = 100. */
  volumes: Record<string, number>
  drums: FillMode
  drumSource: FillDrumSource
  /** Template style id for generated drums; null = automatic. */
  drumStyle: string | null
  /** Metronome on the 音箱 (on regardless when drumSource is 'metronome' and drums play). */
  metronome: boolean
  countIn: boolean
}

/** POST /api/band/comments/add */
export interface AddCommentBody {
  songId: string
  /** 1-based bar number. */
  bar: number
  text: string
}

/** One 小节留言 on a band song. */
export interface BarComment {
  id: string
  /** 1-based bar number. */
  bar: number
  /** Up to 200 chars. */
  text: string
  userId: string
  at: number
}

// ---------------------------------------------------------------------------
// 排练 (rehearsal in one room): one 音箱 device plays, the others follow the score
// ---------------------------------------------------------------------------

/** A device connected to the rehearsal (one browser tab). */
export interface RehearsalDevice {
  /** Random id kept by the browser tab (sessionStorage). */
  deviceId: string
  userId: string
  /** e.g. "iPad", "电脑", "手机". */
  label: string
  /** 我准备好了 for the current song. */
  ready: boolean
  /** This device also makes sound (耳机出声); the 音箱 always does. */
  audible: boolean
  /** Calibrated output latency of this device in ms (0–1000). */
  latencyMs: number
  /** Last measured distance from the reference position in ms (null = not measured / not playing). */
  driftMs: number | null
}

/** A conductor's loop: bars, passes and the speed ladder (爬速度). */
export interface RehearsalLoop {
  startTick: number
  /** Exclusive end tick (the start of the bar after the last one). */
  endTick: number
  /** 1-based, inclusive, for display. */
  startBar: number
  endBar: number
  /** Number of passes; null = until stopped. */
  passes: number | null
  /** Speed added after each pass, 0–20 (percent points). */
  rampPct: number
  /** Ramp stops at this speed (15–175). */
  rampMaxPct: number
}

/** 从第 X 小节再来: a member's request, waiting for the conductor. */
export interface RehearsalRequest {
  id: string
  userId: string
  /** 1-based bar number. */
  bar: number
  tick: number
  at: number
}

/** Event "rehearsal" of GET /api/rehearsal/events: the band's one rehearsal. Times are server epoch ms. */
export interface RehearsalState {
  active: boolean
  /** The song on everyone's stand (a band song id), or null. */
  songId: string | null
  /** 指挥 (user id), and the device the conductor uses. */
  leaderId: string | null
  leaderDevice: string | null
  /** 音箱 device id, or null (no device plays for the room yet). */
  speakerDevice: string | null
  playing: boolean
  /** Position (MIDI tick) where playback starts / stopped. */
  tick: number
  speedPct: number
  countIn: boolean
  /** When playing: server time at which the 音箱 starts `tick` (its count-in first, if on). */
  startAt: number
  loop: RehearsalLoop | null
  /** Current pass of the loop, 1-based (1 when not looping). */
  pass: number
  requests: RehearsalRequest[]
  devices: RehearsalDevice[]
  /** Bumped on every change of the transport, song or loop (not on device status changes). */
  seq: number
  startedAt: number
}

/**
 * The reference device's position (the 音箱, else the conductor's device), sent every
 * ~2 s while playing (event "clock"): `timeMs` is its player's position (alphaTab
 * timePosition, i.e. real milliseconds at the current speed) at server time `at`.
 */
export interface RehearsalClock {
  seq: number
  pass: number
  timeMs: number
  at: number
}

/** POST /api/rehearsal/command (the device id is sent with every command). */
export type RehearsalCommand =
  /** Starts the rehearsal with the first song of the setlist (the server saves the setlist). */
  | { type: 'start'; setlist: string[] }
  | { type: 'end' }
  | { type: 'lead'; take: boolean }
  | { type: 'speaker'; take: boolean }
  | { type: 'song'; songId: string }
  | { type: 'play'; tick: number; speedPct: number }
  | { type: 'pause'; tick: number }
  | { type: 'seek'; tick: number }
  | { type: 'speed'; speedPct: number }
  | { type: 'countIn'; on: boolean }
  | { type: 'loop'; loop: RehearsalLoop | null }
  /** The reference device finished a pass (or the song): next pass, or stop. */
  | { type: 'passEnded'; seq: number; pass: number }
  | { type: 'clock'; seq: number; pass: number; timeMs: number; at: number }
  | {
      type: 'device'
      ready?: boolean
      audible?: boolean
      latencyMs?: number
      label?: string
      driftMs?: number | null
    }
  | { type: 'request'; bar: number; tick: number }
  | { type: 'dismiss'; requestId: string }

export interface RehearsalCommandBody {
  deviceId: string
  command: RehearsalCommand
}

// ---------------------------------------------------------------------------
// 邀请链接 (invite links)
// ---------------------------------------------------------------------------

/** leader: the person registers (or uses his account) to start a new band of his own; member: joins `bandId`. */
export type InviteKind = 'leader' | 'member'

/** An invite as its maker sees it (never the code itself after creation). */
export interface InviteInfo {
  id: string
  kind: InviteKind
  /** The band a member invite joins; null for a leader invite. */
  bandId: string | null
  createdBy: string
  createdAt: number
  /** Epoch ms; null = never. */
  expiresAt: number | null
  /** null = unlimited. */
  maxUses: number | null
  uses: number
  /** User ids that joined with it. */
  usedBy: string[]
  instrument: Instrument | null
  libraryAccess: boolean
  /** Shown to the person invited, up to 100 chars. */
  note: string
  revoked: boolean
}

/** POST /api/invites: an admin makes leader invites (or member ones of any band); a leader, member invites of his band. */
export interface NewInviteBody {
  kind: InviteKind
  /** The band of a member invite (ignored for a leader invite). */
  bandId: string | null
  /** 1–90 days; null = never expires. */
  days: number | null
  /** 1–50; null = unlimited. */
  maxUses: number | null
  instrument: Instrument | null
  libraryAccess: boolean
  note: string
}

/** Answer of POST /api/invites: the only time the code is shown (it is also the link's token). */
export interface NewInviteResult {
  invite: InviteInfo
  token: string
}

/** GET /api/invite/check?token= (no login): whether the link still works. */
export interface InviteCheck {
  valid: boolean
  /** Why not (Chinese), when invalid. */
  reason: string | null
  kind: InviteKind
  /** The band a member invite joins ('' for a leader invite). */
  bandName: string
  /** Name of the person who made it. */
  inviter: string
  instrument: Instrument | null
  note: string
}

/** POST /api/invite/accept (no login): creates the account and signs it in. */
export interface AcceptInviteBody {
  token: string
  username: string
  displayName: string
  password: string
  instrument: Instrument | null
  /** Name of the new band (leader invites only), 1–40 chars. */
  bandName?: string
}

/** POST /api/invite/join (signed in): an existing account uses an invite. */
export interface JoinInviteBody {
  token: string
  /** Name of the new band (leader invites only). */
  bandName?: string
}

/** Answer of POST /api/invite/join: the band joined or started. */
export interface JoinInviteResult {
  bandId: string
}

// ---------------------------------------------------------------------------
// 乐队管理 (admin overview, leaders' member list)
// ---------------------------------------------------------------------------

/** GET /api/admin/bands: every band, for the admin. */
export interface BandOverview {
  id: string
  name: string
  leaderId: string
  memberIds: string[]
  limits: BandLimits
  storageUsed: number
  createdAt: number
}

/** POST /api/admin/bands/update (admin). */
export interface UpdateBandBody {
  id: string
  limits?: Partial<BandLimits>
  leaderId?: string
}

// ---------------------------------------------------------------------------
// 排练录音 (rehearsal recordings, uploaded by members)
// ---------------------------------------------------------------------------

export interface RecordingInfo {
  id: string
  /** The band of the song. */
  bandId: string
  /** Band song id. */
  songId: string
  /** e.g. "10 月 19 日排练", up to 60 chars. */
  label: string
  fileName: string
  size: number
  /** MIME type (audio/mpeg, audio/mp4, audio/wav, audio/ogg, audio/webm, audio/flac). */
  type: string
  uploadedBy: string
  uploadedAt: number
}

/** POST /api/recordings/upload?songId=&label=&name= with the raw audio file as body. */
export interface RecordingUploadQuery {
  songId: string
  label: string
  name: string
}

// ---------------------------------------------------------------------------
// ensemble index (找乐队谱)
// ---------------------------------------------------------------------------

export type TrackKind = 'guitar' | 'bass' | 'drums' | 'keys' | 'vocal' | 'other'

export interface EnsembleTrack {
  name: string
  kind: TrackKind
}

/** One GP file with its tracks, as the server's background reader found them. */
export interface EnsembleFile {
  path: string
  title: string
  artist: string
  tracks: EnsembleTrack[]
  /** Counts per kind, e.g. { guitar: 2, bass: 1, drums: 1 }. */
  counts: Partial<Record<TrackKind, number>>
  /** Drums, bass and a guitar or keys: a full band arrangement. */
  band: boolean
}

/** GET /api/ensembles?q=&need=guitar2,keys&offset=&limit=&untitled=1 */
export interface EnsembleResult {
  items: EnsembleFile[]
  total: number
  /** Matching files whose song title could not be read (file names like 1129121537.gp4), left out unless asked for. */
  hiddenUntitled: number
  /** Background reading progress. */
  indexed: number
  toIndex: number
  indexing: boolean
}

/** One score file's facts for the version line: its tracks, tempo (BPM) and bar count, when read. */
export interface VersionInfo {
  tracks: EnsembleTrack[]
  tempo: number | null
  bars: number | null
  /** The reader could not parse this file (it may still open in the viewer). */
  unreadable?: boolean
}

/** POST /api/versions/info: the score files to describe (at most 400 paths). */
export interface VersionInfoBody {
  paths: string[]
}

// ---------------------------------------------------------------------------
// songs: the versions of one song, and the song's key (歌曲标识)
// ---------------------------------------------------------------------------

/** GET /api/song?path=: the song a file belongs to and all its playable versions. */
export interface SongInfo {
  /** Library song id (`${artistId}#${normalized title}`): uploads and combos hang on it. */
  songKey: string
  title: string
  artist: string
  /** Score-format files (GP / MusicXML) of this song, the given one included. */
  versions: Array<{ path: string; label: string; tags: string[]; size: number }>
}

// ---------------------------------------------------------------------------
// uploaded sheets (上传的简谱)
// ---------------------------------------------------------------------------

export type SheetKind = 'image' | 'pdf'

/** One uploaded file (an image page or a PDF) attached to a song; kept in SCORES_DATA/sheets/. */
export interface SheetUpload {
  id: string
  songKey: string
  /** What it is, e.g. "主唱简谱", up to 40 chars. */
  label: string
  kind: SheetKind
  /** Original file name (for display / download). */
  fileName: string
  size: number
  /** Order among the song's uploads (page order). */
  order: number
  uploadedBy: string
  uploadedAt: number
}

/** POST /api/sheets/upload?path=<score file>&label=<text>&name=<file name> with the raw file as body. */
export interface SheetUploadQuery {
  path: string
  label: string
  name: string
}

// ---------------------------------------------------------------------------
// combined band score (组合乐队谱)
// ---------------------------------------------------------------------------

/** One part taken from a version of the song. */
export interface ComboPart {
  /** Source file (a version of the same song). */
  path: string
  /** Track index in that file. */
  track: number
  /** Shown name (defaults to the track's Chinese name). */
  name: string
  /** Bars to shift the part: +2 = it starts 2 bars later than in its file. */
  offsetBars: number
  /** Semitones to transpose the part (−12…12). */
  transpose: number
  /** Expand repeat signs of the source file before aligning (when versions write repeats differently). */
  unrollRepeats: boolean
}

/** A recipe, not a file: the base version gives bars, tempo and sections; parts are copied onto it. */
export interface ComboRecipe {
  id: string
  songKey: string
  title: string
  artist: string
  /** Base version: its bars, tempo, sections; its own tracks are not included unless listed in `parts`. */
  base: string
  baseUnrollRepeats: boolean
  parts: ComboPart[]
  createdBy: string
  updatedAt: number
}

/** POST /api/combos/save (id empty = new). */
export interface SaveComboBody {
  recipe: Omit<ComboRecipe, 'createdBy' | 'updatedAt' | 'id'> & { id: string | null }
}

// ---------------------------------------------------------------------------
// PDF → GP conversions (PDF 转换版), made only when a user asks for one
// ---------------------------------------------------------------------------

/** A PDF tab converted into a playable GP5 (kept in SCORES_DATA/conversions/, never in the library). */
export interface ConversionRecord {
  id: string
  songKey: string
  /** The PDF it came from (library path). */
  sourcePath: string
  title: string
  artist: string
  createdBy: string
  createdAt: number
  bars: number
  /** Track names found (one per tab part). */
  tracks: string[]
  /** What the converter could not read well (Chinese). */
  warnings: string[]
  /** 用户品鉴: 1–5 stars from the members. */
  rating: { average: number; count: number }
  /** The signed-in user's own stars, or null. */
  myRating: number | null
}

/** GET /api/conversions/status: whether the server has the converter installed. */
export interface ConversionStatus {
  available: boolean
  /** Why not (Chinese), when unavailable. */
  reason: string | null
}

// ---------------------------------------------------------------------------
// 每日一练 (12-每日一练: 52 weeks / 365 days of Guitar Aerobics)
// ---------------------------------------------------------------------------

/** One day of the program, from 每日练习索引.json plus the files found in its folder (library paths). */
export interface DailyDay {
  day: number
  week: number
  /** 周一…周日 */
  weekday: string
  /** Technique, e.g. 交替拨弦. */
  technique: string
  /** Backing style of the day, e.g. 金属 (matches DailyBacking.style). */
  backingStyle: string
  /** Suggested tempo ladder in bpm, e.g. [40, 48, 56, …]. */
  tempos: number[]
  demoSeconds: number | null
  /** Exercise images: Chinese and English (null when missing). */
  imageZh: string | null
  imageEn: string | null
  /** Demo audio of the day. */
  demo: string | null
  /** The day's own backing tracks from its 练习信息.json, slowest first (library paths). */
  backingList: Array<{ bpm: number; path: string }>
  /** Pages in the books (全书), when given. */
  bookPage: { zh: number | null; en: number | null } | null
  /** How to practise it (练法), when given. */
  method: string | null
}

export interface DailyBacking {
  track: number
  style: string
  bpm: number
  /** Library path of the mp3. */
  path: string
}

/** GET /api/daily */
export interface DailyState {
  /** False when the library has no 每日一练 folder or index. */
  available: boolean
  days: DailyDay[]
  backing: DailyBacking[]
  /** Extra files of the program (全书 PDFs, whole-week demos, tuning audio): library paths with labels. */
  extras: Array<{ label: string; path: string }>
  /** This account's progress: when they first opened 每日一练 (day 1), and the days marked done. */
  startedAt: number | null
  done: Record<string, number>
  /** Highest backing tempo completed (10 times through) per day: day number → bpm. */
  bpm: Record<string, number>
}

/** GET /api/daily/members: band members' progress (for the band page). */
export interface DailyMemberProgress {
  userId: string
  startedAt: number | null
  doneCount: number
  /** Most recent day marked done (day number), or null. */
  lastDay: number | null
  lastDoneAt: number | null
}

// ---------------------------------------------------------------------------
// 13-简谱 matched to songs
// ---------------------------------------------------------------------------

/** A 简谱 file of the library that belongs to the same song (same artist and title). */
export interface LibraryJianpu {
  path: string
  title: string
  artist: string
  /** File name as shown. */
  label: string
}

// ---------------------------------------------------------------------------
// 改编谱 (a member's own instruments / mix of a score) and 我的谱子
// ---------------------------------------------------------------------------

/** One track's changes in an arrangement; absent fields keep the score's own. */
export interface ArrangementTrack {
  /** General MIDI program 0–127. */
  program?: number
  /** Percent, 0–150 (100 = unchanged). */
  volume?: number
  mute?: boolean
}

/**
 * 改编谱: not a copy of the file, only how to play it — each track's instrument,
 * volume and mute, and the transposition. Private to its owner.
 */
export interface Arrangement {
  id: string
  owner: string
  /** 1–60 characters. */
  name: string
  /** The score it changes (a library or uploaded file). */
  path: string
  title: string
  artist: string
  /** Track index ("0".."63") → its changes. */
  tracks: Record<string, ArrangementTrack>
  /** Semitones, −6..6. */
  transpose: number
  /** Tracks the score had when saved (a changed file is noticed). */
  trackCount: number
  createdAt: number
  updatedAt: number
}

/** POST /api/arrangements/save (id null = a new one). */
export interface SaveArrangementBody {
  id: string | null
  name: string
  path: string
  title: string
  artist: string
  tracks: Record<string, ArrangementTrack>
  transpose: number
  trackCount: number
}

/** GET /api/mine: 我的谱子. */
export interface MyScores {
  arrangements: Arrangement[]
  /** Songs I uploaded (in my bands). */
  uploads: UploadSong[]
  /** 组合乐队谱 I made. */
  combos: ComboRecipe[]
  /** The personal upload space (我的谱子 uploads); limit null = unlimited (admins). */
  storage: { used: number; limit: number | null }
}
