/**
 * The score viewer's display choices (谱面 / 缩放 / 配色), remembered on this device.
 * Playback and track state are not kept: they start fresh for every opened score.
 */
import type { AlphaTab } from './alphaTab'
import { DEFAULT_TRAINER, normalizeTrainer, type TrainerConfig } from './practiceEngine'
import { SOUND_FONTS, type SoundFontId } from './soundFonts'

export type StaffMode = 'ScoreTab' | 'Tab' | 'Score'
export type SheetMode = 'night' | 'paper'

export interface ScorePrefs {
  staff: StaffMode
  sheet: SheetMode
  /** null = the default for this screen (1.0, or 0.85 on phones). */
  zoom: number | null
  /** 指板 strip under the header. */
  fretboard: boolean
  soundFont: SoundFontId
  /** 渐进提速 and the other loop settings. */
  trainer: TrainerConfig
  /** How a drum track is shown: 五线谱 (alphaTab), 鼓谱网格 or 文字鼓谱. */
  drumView: DrumView
  /** How a singer's (主唱 / 旋律) track is shown: 简谱 or 五线谱 — never as guitar tab. */
  vocalStaff: VocalStaff
}

export type VocalStaff = 'Numbered' | 'Score'

export const VOCAL_STAFF_OPTIONS: ReadonlyArray<{ value: VocalStaff; label: string }> = [
  { value: 'Numbered', label: '简谱' },
  { value: 'Score', label: '五线谱' },
]

export type DrumView = 'staff' | 'grid' | 'tab'

/** The grid is for editing (编辑鼓谱); reading uses standard drum notation or the text tab. */
export const DRUM_VIEW_OPTIONS: ReadonlyArray<{ value: DrumView; label: string }> = [
  { value: 'staff', label: '标准鼓谱' },
  { value: 'tab', label: '文字鼓谱' },
]

export const STAFF_OPTIONS: ReadonlyArray<{ value: StaffMode; label: string }> = [
  { value: 'Tab', label: '六线谱' },
  { value: 'ScoreTab', label: '五线谱 + 六线谱' },
  { value: 'Score', label: '五线谱' },
]

export const ZOOM_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0.8, label: '小' },
  { value: 1, label: '中' },
  { value: 1.25, label: '大' },
  { value: 1.5, label: '特大' },
]

export const SHEET_OPTIONS: ReadonlyArray<{ value: SheetMode; label: string }> = [
  { value: 'night', label: '夜间' },
  { value: 'paper', label: '纸面' },
]

export const PHONE_SCALE = 0.85
export const SPEED_MIN = 15
export const SPEED_MAX = 175
export const SPEED_PRESETS = [50, 75, 100, 125] as const

const KEY = 'groovelab:scores:viewer'
const DEFAULT: ScorePrefs = {
  staff: 'Tab',
  sheet: 'night',
  zoom: null,
  fretboard: false,
  soundFont: 'basic',
  trainer: DEFAULT_TRAINER,
  drumView: 'staff',
  vocalStaff: 'Numbered',
}

export function loadPrefs(): ScorePrefs {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<ScorePrefs>
    return {
      staff: STAFF_OPTIONS.some((o) => o.value === v.staff)
        ? (v.staff as StaffMode)
        : DEFAULT.staff,
      sheet: v.sheet === 'paper' ? 'paper' : 'night',
      zoom:
        typeof v.zoom === 'number' && ZOOM_OPTIONS.some((o) => o.value === v.zoom) ? v.zoom : null,
      fretboard: v.fretboard === true,
      soundFont: SOUND_FONTS.some((o) => o.id === v.soundFont)
        ? (v.soundFont as SoundFontId)
        : DEFAULT.soundFont,
      trainer: normalizeTrainer(v.trainer),
      vocalStaff: v.vocalStaff === 'Score' ? 'Score' : 'Numbered',
      drumView: DRUM_VIEW_OPTIONS.some((o) => o.value === v.drumView)
        ? (v.drumView as DrumView)
        : DEFAULT.drumView,
    }
  } catch {
    return DEFAULT
  }
}

export function savePrefs(p: ScorePrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    // storage blocked: the choice lasts for this visit
  }
}

/** Phones are narrower than the remote's side-card breakpoint (860 px). */
export function isPhone(): boolean {
  return window.matchMedia('(max-width: 859px)').matches
}

/** The alphaTab display scale in effect for these choices. */
export function effectiveScale(p: ScorePrefs): number {
  return p.zoom ?? (isPhone() && !isShortLandscape() ? PHONE_SCALE : 1)
}

export function staveProfileOf(at: AlphaTab, staff: StaffMode): number {
  return (at.StaveProfile as unknown as Record<StaffMode, number>)[staff] ?? 0
}

const rgb = (hex: string) =>
  `rgb(${parseInt(hex.slice(1, 3), 16)}, ${parseInt(hex.slice(3, 5), 16)}, ${parseInt(hex.slice(5, 7), 16)})`

/** The two sheet palettes, as alphaTab notation colours. */
const PALETTE: Record<SheetMode, { lines: string; ink: string; dim: string; bar: string }> = {
  night: { lines: '#50575c', ink: '#e9ece7', dim: '#8d958f', bar: '#7f95ff' },
  paper: { lines: '#8e938c', ink: '#15171a', dim: '#6b716c', bar: '#2443d6' },
}

export function sheetResources(sheet: SheetMode) {
  const p = PALETTE[sheet]
  return {
    mainGlyphColor: rgb(p.ink),
    secondaryGlyphColor: rgb(p.dim),
    scoreInfoColor: rgb(p.ink),
    barNumberColor: rgb(p.bar),
    staffLineColor: rgb(p.lines),
    barSeparatorColor: rgb(p.lines),
  }
}

/** m:ss from milliseconds. */
export function fmtClock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/** A phone turned sideways: the sheet gets the full scale and the remote folds away while playing. */
export function isShortLandscape(): boolean {
  return window.matchMedia('(orientation: landscape) and (max-height: 500px)').matches
}

/** A track the student can read as tab: stringed, not percussion, with tab in the file. */
export function hasTab(track: {
  isPercussion?: boolean
  staves: ReadonlyArray<{ isPercussion?: boolean; tuning: number[]; showTablature?: boolean }>
}): boolean {
  const st = track.staves[0]
  if (!st || track.isPercussion || st.isPercussion) return false
  return st.tuning.length > 0 && st.showTablature !== false
}

/** The notation for a track: the student's choice for guitar and bass; drums, piano, vocals and other non-tab parts always in 五线谱. */
export function staffFor(track: Parameters<typeof hasTab>[0] | undefined, chosen: StaffMode): StaffMode {
  return !track || hasTab(track) ? chosen : 'Score'
}

/** A singer's part: named so (主唱 / 人声 / vocal / melody / 旋律 / 和声…) or a voice sound (GM 52–54, 85). */
export function isVocalTrack(track: {
  name: string
  isPercussion?: boolean
  playbackInfo: { program: number }
}): boolean {
  if (track.isPercussion) return false
  if (/主唱|人声|唱|和声|旋律|vocal|voice|vox|melody|harmony|lead\s*voc|sing/i.test(track.name))
    return true
  const p = track.playbackInfo.program
  return (p >= 52 && p <= 54) || p === 85
}

type NotationTrack = Parameters<typeof hasTab>[0] &
  Parameters<typeof isVocalTrack>[0] & {
    staves: ReadonlyArray<{
      showNumbered: boolean
      showStandardNotation: boolean
      showTablature: boolean
      showSlash: boolean
    }>
  }

/**
 * Sets up the notation of the shown track: a singer's part as 简谱 or 五线谱 (through the
 * staff's own flags and the default profile), any other part by the chosen profile
 * (drums / keys without tab fall back to 五线谱). Returns the stave profile to use.
 */
export function prepareNotation(
  at: AlphaTab,
  track: NotationTrack,
  prefs: Pick<ScorePrefs, 'staff' | 'vocalStaff'>,
): number {
  if (isVocalTrack(track)) {
    const numbered = prefs.vocalStaff === 'Numbered'
    for (const st of track.staves) {
      st.showNumbered = numbered
      st.showStandardNotation = !numbered
      st.showTablature = false
      st.showSlash = false
    }
    return (at.StaveProfile as unknown as Record<string, number>).Default ?? 0
  }
  return staveProfileOf(at, staffFor(track, prefs.staff))
}
