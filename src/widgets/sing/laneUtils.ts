/**
 * Fold a sung pitch next to the reference: first the phrase's octave shift,
 * then, when the singer has a value nearby, to the octave closest to it — so
 * the student's line is always on screen next to the singer's. Pure.
 */
export function foldToRef(midi: number, shift: number, ref: number | undefined, low: number, high: number): number {
  let m = midi - shift
  if (ref !== undefined && !Number.isNaN(ref)) m -= Math.round((m - ref) / 12) * 12
  while (m < low) m += 12
  while (m > high) m -= 12
  return m
}
