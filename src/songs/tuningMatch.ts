import { GUITAR_TUNINGS, type GuitarTuningId } from '@/music/fretboard'

/** Which known tuning + capo produces these open strings (lowest first), if any. */
export function matchTuning(strings: readonly number[], capo: number): { id: GuitarTuningId; capo: number } | null {
  for (const [id, t] of Object.entries(GUITAR_TUNINGS) as Array<[GuitarTuningId, (typeof GUITAR_TUNINGS)[GuitarTuningId]]>) {
    if (t.strings.length === strings.length && t.strings.every((s, i) => s === strings[i])) return { id, capo }
  }
  return null
}
