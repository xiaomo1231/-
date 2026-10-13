/**
 * Separation timings on this device (for the progress estimate and the admin
 * view). Kept in localStorage: a per-device diagnostic, fine to lose.
 */
export interface SeparationTiming {
  at: number
  mode: 'vocals' | 'stems'
  engine: 'local' | 'browser'
  backend?: string
  precision?: string
  threads?: number
  seconds: number
  audioSeconds: number
}

const KEY = 'groovelab:separation-timings'

export function loadTimings(): SeparationTiming[] {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as SeparationTiming[]) : []
  } catch {
    return []
  }
}

export function recordTiming(t: SeparationTiming): void {
  try {
    localStorage.setItem(KEY, JSON.stringify([t, ...loadTimings()].slice(0, 20)))
  } catch {
    // storage blocked: nothing to remember
  }
}

/** "约 1 分 20 秒" from seconds. */
export function durationText(sec: number): string {
  const s = Math.max(0, Math.round(sec))
  return s < 60 ? `${s} 秒` : `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

/** Remaining time from elapsed time and progress (null early on, when the guess would be wild). */
export function etaSeconds(elapsed: number, ratio: number): number | null {
  if (ratio < 0.05 || elapsed < 2) return null
  return (elapsed / ratio) * (1 - ratio)
}
