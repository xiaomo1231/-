/**
 * The score viewer's display choices (谱面 / 缩放 / 配色), remembered on this device.
 * Playback and track state are not kept: they start fresh for every opened score.
 */
import type { AlphaTab } from './alphaTab'

export type StaffMode = 'ScoreTab' | 'Tab' | 'Score'
export type SheetMode = 'night' | 'paper'

export interface ScorePrefs {
  staff: StaffMode
  sheet: SheetMode
  /** null = the default for this screen (1.0, or 0.85 on phones). */
  zoom: number | null
}

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
const DEFAULT: ScorePrefs = { staff: 'Tab', sheet: 'night', zoom: null }

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
  return p.zoom ?? (isPhone() ? PHONE_SCALE : 1)
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
