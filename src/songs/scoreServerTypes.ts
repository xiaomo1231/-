/**
 * Shapes shared by the score server (server/) and its web page (web/): accounts,
 * the band (乐队), the ensemble index (找乐队谱) and live rehearsal (一起播放).
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
}

/** POST /api/login */
export interface LoginBody {
  username: string
  password: string
}

/** POST /api/users (admin): a new account. Password 6–128 chars. */
export interface NewUserBody {
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

/** GET /api/band */
export interface BandState {
  name: string
  /** Setlist order. */
  songs: BandSong[]
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
  status?: SongStatus
  parts?: Record<string, string>
  note?: string
  rehearsalSpeedPct?: number | null
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

/** GET /api/ensembles?q=&need=guitar2,keys&offset=&limit= */
export interface EnsembleResult {
  items: EnsembleFile[]
  total: number
  /** Background reading progress. */
  indexed: number
  toIndex: number
  indexing: boolean
}

// ---------------------------------------------------------------------------
// live rehearsal (一起播放)
// ---------------------------------------------------------------------------

/**
 * The shared transport of one band song. Times are server epoch ms: a follower
 * starts playing tick `tick` at `startAt` (its own clock corrected by the measured offset).
 */
export interface LiveState {
  songId: string
  leaderId: string | null
  playing: boolean
  tick: number
  speedPct: number
  /** When `playing`: server time at which `tick` sounds (after the shared count-in). */
  startAt: number
  /** Bumped on every change, so a client ignores stale events. */
  seq: number
  /** Members connected to this song right now. */
  present: string[]
}

/** POST /api/live/command (leader only, except 'lead' which claims or releases the lead). */
export type LiveCommand =
  | { songId: string; type: 'lead'; take: boolean }
  | { songId: string; type: 'play'; tick: number; speedPct: number }
  | { songId: string; type: 'pause'; tick: number }
  | { songId: string; type: 'seek'; tick: number }
  | { songId: string; type: 'speed'; speedPct: number }
