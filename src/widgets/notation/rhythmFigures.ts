export interface Figure {
  duration: string
  dots: number
  rest: boolean
  /** Length in beats. */
  beats: number
  tupletGroup?: number
}

/**
 * Turn onsets into VexFlow durations. Each onset lasts until the next onset
 * (or the bar end); gaps that start on a non-onset are rests. Triplets are
 * detected as runs of 1/3-beat figures.
 */
export function figuresFromOnsets(onsets: readonly number[], beats: number): Figure[] {
  const out: Figure[] = []
  const sorted = [...onsets].sort((a, b) => a - b)
  // Leading rest when the bar does not start on an onset.
  if (sorted.length === 0 || sorted[0]! > 0.0001) {
    pushDuration(out, sorted[0] ?? beats, true)
  }
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]!
    const end = i + 1 < sorted.length ? sorted[i + 1]! : beats
    pushDuration(out, end - start, false)
  }
  return out
}

function pushDuration(out: Figure[], length: number, rest: boolean): void {
  const l = Math.round(length * 1000) / 1000
  const table: Array<[number, string, number]> = [
    [4, 'w', 0],
    [3, 'h', 1],
    [2, 'h', 0],
    [1.5, 'q', 1],
    [1, 'q', 0],
    [0.75, '8', 1],
    [0.5, '8', 0],
    [0.25, '16', 0],
  ]
  if (Math.abs(l - 1 / 3) < 0.01) {
    out.push({ duration: '8', dots: 0, rest, beats: 1 / 3, tupletGroup: 3 })
    return
  }
  if (Math.abs(l - 2 / 3) < 0.01) {
    out.push({ duration: 'q', dots: 0, rest, beats: 2 / 3, tupletGroup: 3 })
    return
  }
  for (const [b, d, dots] of table) {
    if (Math.abs(l - b) < 0.001) {
      out.push({ duration: d, dots, rest, beats: b })
      return
    }
  }
  // Compound lengths: split greedily (e.g. 2.5 = half + eighth tied; we skip ties for rhythm-only staves).
  let remaining = l
  for (const [b, d, dots] of table) {
    while (remaining >= b - 0.001) {
      out.push({ duration: d, dots, rest, beats: b })
      remaining -= b
    }
  }
}

