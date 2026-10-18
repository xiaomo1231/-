/** 变调 limits: semitones up or down, the same range as the desktop app. */
export const TRANSPOSE_MIN = -6
export const TRANSPOSE_MAX = 6

export function clampTranspose(n: number): number {
  return Math.max(TRANSPOSE_MIN, Math.min(TRANSPOSE_MAX, Math.round(n) || 0))
}

/** "原调", "+2", "−3". */
export function transposeLabel(n: number): string {
  if (n === 0) return '原调'
  return n > 0 ? `+${n}` : `−${-n}`
}
