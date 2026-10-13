/**
 * Chunking for Demucs-style separation (pure): fixed-length segments with a
 * one-eighth overlap (0.16.3; was a quarter), cross-faded linearly. Unlike the reference script, the
 * very start and the very end are not faded (nothing overlaps there), so no
 * audio is lost at the edges.
 */

export const DEMUCS_RATE = 44100
/** htdemucs input length: 7.8 s at 44.1 kHz. */
export const SEGMENT = 343980
export const OVERLAP = SEGMENT >> 3
export const STEMS_6 = ['drums', 'bass', 'other', 'vocals', 'guitar', 'piano'] as const

export interface Chunk {
  start: number
  /** Real samples in this chunk (the rest is zero padding). */
  length: number
  fadeIn: boolean
  fadeOut: boolean
}

export function chunkPlan(total: number, segment = SEGMENT, overlap = OVERLAP): Chunk[] {
  const stride = segment - overlap
  const n = Math.max(1, Math.ceil(Math.max(0, total - overlap) / stride))
  return Array.from({ length: n }, (_, i) => {
    const start = i * stride
    const length = Math.max(0, Math.min(segment, total - start))
    return { start, length, fadeIn: i > 0, fadeOut: i < n - 1 }
  })
}

/** Weight of sample j (0-based, within the chunk). */
export function chunkWeight(c: Chunk, j: number, overlap = OVERLAP): number {
  let w = 1
  if (c.fadeIn && j < overlap) w = Math.min(w, j / overlap)
  if (c.fadeOut && j >= c.length - overlap) w = Math.min(w, (c.length - j) / overlap)
  return Math.max(w, 1e-4)
}
