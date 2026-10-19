import type {
  ScoreArtist,
  ScoreCategory,
  ScoreFormat,
  ScoreSearchResult,
  ScoreSong,
} from '@/songs/scoreLibraryTypes'

import type {
  AddBandSongBody,
  BandState,
  ComboRecipe,
  ConversionRecord,
  ConversionStatus,
  DailyMemberProgress,
  DailyState,
  EnsembleResult,
  LibraryJianpu,
  SaveComboBody,
  SheetUpload,
  SheetUploadQuery,
  SongInfo,
  LiveCommand,
  LiveState,
  LoginBody,
  NewUserBody,
  UpdateBandSongBody,
  UpdateMeBody,
  UpdateUserBody,
  UserInfo,
} from '@/songs/scoreServerTypes'

import type {
  DrumPart,
  DrumStyleInfo,
  GenerateDrumsBody,
  GenerateDrumsResult,
  SaveDrumsBody,
} from '@/songs/drumTypes'

export type * from '@/songs/scoreServerTypes'
export type * from '@/songs/drumTypes'

/** A starred score (kept on the server, so every device sees the same list). */
export interface FavoriteItem {
  path: string
  format: ScoreFormat
  pages: string[]
  title: string
  artist: string
  addedAt: number
}

/** 搜索谱 filters: a format, a category id ("1-华语"), and the order. */
/** 练习记录: one score's practice state and totals, kept on the server. */
export interface PracticeRecord {
  path: string
  title: string
  artist: string
  /** Last playback speed, percent (15–175). */
  speedPct: number
  /** Last loop range as 1-based bar numbers [first, last], or null for none. */
  loopBars: [number, number] | null
  /** Indexes of the muted tracks. */
  muted: number[]
  /** Seconds of actual playback, all sessions. */
  totalSeconds: number
  /** Highest speed actually played, percent (0 when never played). */
  maxSpeedPct: number
  firstAt: number
  lastAt: number
}

/** What the viewer sends: state to remember and, optionally, the playback since the last save. */
export interface PracticeUpdate {
  path: string
  title: string
  artist: string
  speedPct?: number
  loopBars?: [number, number] | null
  muted?: number[]
  /** Seconds played since the last save (the server adds them, at most 600 per call). */
  addSeconds?: number
  /** Highest speed during those seconds. */
  playedSpeedPct?: number
}

export interface SearchOptions {
  fmt?: ScoreFormat | ''
  cat?: string
  sort?: 'rel' | 'ver' | 'name'
}

const searchQuery = (o: SearchOptions = {}) =>
  (o.fmt ? `&fmt=${enc(o.fmt)}` : '') +
  (o.cat ? `&cat=${enc(o.cat)}` : '') +
  (o.sort && o.sort !== 'rel' ? `&sort=${o.sort}` : '')

export interface LibraryInfo {
  root: string
  scannedAt: number
  files: number
  scanning: boolean
  categories: ScoreCategory[]
}

/** Fired on window when the server no longer accepts the session (a 401). */
export const AUTH_LOST = 'scores:auth-lost'

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

export function errorText(e: unknown): string {
  return e instanceof Error && e.message ? e.message : '出错了，请稍后再试。'
}

function unauthorized(): ApiError {
  window.dispatchEvent(new Event(AUTH_LOST))
  return new ApiError(401, '登录已过期，请重新输入密码。')
}

const STATUS_TEXT: Record<number, string> = {
  404: '没有找到这个内容。',
  429: '尝试次数太多，请稍等几分钟再试。',
  500: '服务器出错了，请稍后再试。',
}

async function failure(res: Response): Promise<ApiError> {
  let message = ''
  try {
    const body = (await res.json()) as { error?: unknown }
    if (typeof body.error === 'string') message = body.error
  } catch {
    // not JSON: fall back to the status text below
  }
  return new ApiError(
    res.status,
    message || STATUS_TEXT[res.status] || `请求失败（${res.status}）。`,
  )
}

interface Call {
  method?: 'GET' | 'POST'
  body?: unknown
  signal?: AbortSignal
  /** A 401 is an answer here (wrong password), not a lost session. */
  quietAuth?: boolean
}

async function call<T>(url: string, opts: Call = {}): Promise<T> {
  const init: RequestInit = {
    method: opts.method ?? 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    signal: opts.signal,
  }
  if (opts.body !== undefined) {
    init.method = 'POST'
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(opts.body)
  }
  const res = await fetch(url, init)
  if (res.status === 401 && !opts.quietAuth) throw unauthorized()
  if (!res.ok) throw await failure(res)
  const text = await res.text()
  return (text ? JSON.parse(text) : undefined) as T
}

const enc = encodeURIComponent

export const api = {
  /** Resolves when the session cookie is valid; rejects with a 401 ApiError otherwise. */
  /** The signed-in account; rejects with a 401 ApiError when the session is gone. */
  async me(): Promise<UserInfo> {
    const res = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' })
    if (res.status === 401) throw new ApiError(401, '')
    if (!res.ok) throw await failure(res)
    return (await res.json()) as UserInfo
  },
  login: (username: string, password: string) =>
    call<UserInfo>('/api/login', { body: { username, password } satisfies LoginBody, quietAuth: true }),
  updateMe: (b: UpdateMeBody) => call<UserInfo>('/api/me/update', { body: b }),
  // accounts (admin)
  users: (signal?: AbortSignal) => call<UserInfo[]>('/api/users', { signal }),
  addUser: (b: NewUserBody) => call<UserInfo[]>('/api/users', { body: b }),
  updateUser: (b: UpdateUserBody) => call<UserInfo[]>('/api/users/update', { body: b }),
  removeUser: (id: string) => call<UserInfo[]>('/api/users/remove', { body: { id } }),
  // band
  band: (signal?: AbortSignal) => call<BandState>('/api/band', { signal }),
  addBandSong: (b: AddBandSongBody) => call<BandState>('/api/band/songs/add', { body: b }),
  updateBandSong: (b: UpdateBandSongBody) =>
    call<BandState>('/api/band/songs/update', { body: b }),
  removeBandSong: (id: string) => call<BandState>('/api/band/songs/remove', { body: { id } }),
  reorderBandSongs: (ids: string[]) =>
    call<BandState>('/api/band/songs/reorder', { body: { ids } }),
  renameBand: (name: string) => call<BandState>('/api/band/rename', { body: { name } }),
  // 找乐队谱
  ensembles: (
    o: { q?: string; need?: string; offset?: number; limit?: number },
    signal?: AbortSignal,
  ) =>
    call<EnsembleResult>(
      `/api/ensembles?q=${enc(o.q ?? '')}&need=${enc(o.need ?? '')}&offset=${o.offset ?? 0}&limit=${o.limit ?? 50}`,
      { signal },
    ),
  // 鼓谱
  drums: (path: string, signal?: AbortSignal) =>
    call<DrumPart | null>(`/api/drums?path=${enc(path)}`, { signal }),
  drumStyles: (signal?: AbortSignal) => call<DrumStyleInfo[]>('/api/drums/styles', { signal }),
  generateDrums: (b: GenerateDrumsBody) =>
    call<GenerateDrumsResult>('/api/drums/generate', { body: b }),
  saveDrums: (part: DrumPart) =>
    call<DrumPart>('/api/drums/save', { body: { part } satisfies SaveDrumsBody }),
  removeDrums: (path: string) => call<{ ok: boolean }>('/api/drums/remove', { body: { path } }),
  // 歌曲的各版本、上传的简谱、组合乐队谱
  song: (path: string, signal?: AbortSignal) =>
    call<SongInfo>(`/api/song?path=${enc(path)}`, { signal }),
  sheets: (path: string, signal?: AbortSignal) =>
    call<SheetUpload[]>(`/api/sheets?path=${enc(path)}`, { signal }),
  /** Raw upload (no multipart): the file is the body. */
  async uploadSheet(q: SheetUploadQuery, file: Blob): Promise<SheetUpload[]> {
    const res = await fetch(
      `/api/sheets/upload?path=${enc(q.path)}&label=${enc(q.label)}&name=${enc(q.name)}`,
      {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: file,
      },
    )
    if (res.status === 401) throw unauthorized()
    if (!res.ok) throw await failure(res)
    return (await res.json()) as SheetUpload[]
  },
  removeSheet: (id: string) => call<SheetUpload[]>('/api/sheets/remove', { body: { id } }),
  reorderSheets: (path: string, ids: string[]) =>
    call<SheetUpload[]>('/api/sheets/reorder', { body: { path, ids } }),
  combos: (path: string, signal?: AbortSignal) =>
    call<ComboRecipe[]>(`/api/combos?path=${enc(path)}`, { signal }),
  combo: (id: string, signal?: AbortSignal) =>
    call<ComboRecipe>(`/api/combos/get?id=${enc(id)}`, { signal }),
  saveCombo: (b: SaveComboBody) => call<ComboRecipe>('/api/combos/save', { body: b }),
  removeCombo: (id: string) => call<{ ok: boolean }>('/api/combos/remove', { body: { id } }),
  // PDF 转换版
  conversionStatus: () => call<ConversionStatus>('/api/conversions/status'),
  conversions: (path: string, signal?: AbortSignal) =>
    call<ConversionRecord[]>(`/api/conversions?path=${enc(path)}`, { signal }),
  conversion: (id: string, signal?: AbortSignal) =>
    call<ConversionRecord>(`/api/conversions/get?id=${enc(id)}`, { signal }),
  /** Converts one PDF (only when the user asks); can take up to a minute. */
  startConversion: (path: string) =>
    call<ConversionRecord>('/api/conversions/start', { body: { path } }),
  rateConversion: (id: string, stars: number) =>
    call<ConversionRecord>('/api/conversions/rate', { body: { id, stars } }),
  removeConversion: (id: string) =>
    call<{ ok: boolean }>('/api/conversions/remove', { body: { id } }),
  // 每日一练
  daily: (signal?: AbortSignal) => call<DailyState>('/api/daily', { signal }),
  /** Day 1 = the first time this account opens 每日一练 (idempotent). */
  startDaily: () => call<DailyState>('/api/daily/start', { method: 'POST' }),
  markDaily: (day: number, done: boolean) =>
    call<DailyState>('/api/daily/done', { body: { day, done } }),
  /** Records that this tempo was played 10 times on that day (the server keeps the highest). */
  markDailyBpm: (day: number, bpm: number) =>
    call<DailyState>('/api/daily/bpm', { body: { day, bpm } }),
  dailyMembers: (signal?: AbortSignal) =>
    call<DailyMemberProgress[]>('/api/daily/members', { signal }),
  // 谱库里的简谱
  jianpu: (path: string, signal?: AbortSignal) =>
    call<LibraryJianpu[]>(`/api/jianpu?path=${enc(path)}`, { signal }),
  // 一起播放
  serverTime: () => call<{ now: number }>('/api/time'),
  liveCommand: (c: LiveCommand) => call<LiveState>('/api/live/command', { body: c }),
  logout: () => call<unknown>('/api/logout', { method: 'POST' }),
  library: (signal?: AbortSignal) => call<LibraryInfo>('/api/library', { signal }),
  rescan: () => call<unknown>('/api/rescan', { method: 'POST' }),
  artists: (groupId: string, signal?: AbortSignal) =>
    call<ScoreArtist[]>(`/api/artists?group=${enc(groupId)}`, { signal }),
  songs: (artistId: string, signal?: AbortSignal) =>
    call<ScoreSong[]>(`/api/songs?artist=${enc(artistId)}`, { signal }),
  search: (q: string, opts: SearchOptions = {}, signal?: AbortSignal) =>
    call<ScoreSearchResult>(`/api/search?q=${enc(q)}${searchQuery(opts)}`, { signal }),
  /** Songs with the most versions (搜索谱 before anything is typed). */
  top: (opts: SearchOptions = {}, signal?: AbortSignal) =>
    call<ScoreSearchResult>(`/api/top?limit=50${searchQuery(opts)}`, { signal }),
  favorites: (signal?: AbortSignal) => call<FavoriteItem[]>('/api/favorites', { signal }),
  addFavorite: (item: Omit<FavoriteItem, 'addedAt'>) =>
    call<FavoriteItem[]>('/api/favorites', { body: item }),
  removeFavorite: (path: string) =>
    call<FavoriteItem[]>('/api/favorites/remove', { body: { path } }),
  /** All practice records, most recently practised first. */
  practice: (signal?: AbortSignal) => call<PracticeRecord[]>('/api/practice', { signal }),
  savePractice: (u: PracticeUpdate) => call<PracticeRecord>('/api/practice', { body: u }),
  removePractice: (path: string) =>
    call<PracticeRecord[]>('/api/practice/remove', { body: { path } }),
  text: (path: string, signal?: AbortSignal) =>
    call<{ text: string }>(`/api/text?p=${enc(path)}`, { signal }),
}

/** A library file's URL; each path segment is encoded, '/' kept. */
export function fileUrl(path: string, download = false): string {
  const encoded = path.split('/').map(enc).join('/')
  return `/files/${encoded}${download ? '?download=1' : ''}`
}

/** The bytes of a library file (score viewer). */
export async function fetchBytes(url: string, signal?: AbortSignal): Promise<Uint8Array> {
  const res = await fetch(url, { credentials: 'same-origin', signal })
  if (res.status === 401) throw unauthorized()
  if (!res.ok) throw await failure(res)
  return new Uint8Array(await res.arrayBuffer())
}

/** An uploaded sheet's file (image or PDF), served with the session cookie. */
export function sheetFileUrl(id: string): string {
  return `/api/sheets/file?id=${encodeURIComponent(id)}`
}

/** A converted GP5 file (PDF 转换版). */
export function conversionFileUrl(id: string): string {
  return `/api/conversions/file?id=${encodeURIComponent(id)}`
}
