/**
 * 段落 and timing helpers for rehearsal (pure): sections from the score's section
 * markers, bar lookup by tick, count-in length and bar end ticks.
 */

export interface SectionBar {
  start: number
  section?: { text: string; marker: string } | null
}

export interface Section {
  name: string
  /** 1-based */
  startBar: number
  startTick: number
}

/** Sections from the masterBars' section markers. No markers → []. */
export function sectionsOf(bars: readonly SectionBar[]): Section[] {
  const marked: Section[] = []
  bars.forEach((bar, i) => {
    const s = bar.section
    if (!s) return
    const name = s.text.trim() || s.marker.trim()
    marked.push({ name, startBar: i + 1, startTick: bar.start })
  })
  if (marked.length === 0) return []

  const sections: Section[] = []
  if (marked[0].startBar !== 1) {
    sections.push({ name: '开头', startBar: 1, startTick: bars[0].start })
  }
  sections.push(...marked)
  return sections.map((s, i) => ({
    ...s,
    name: s.name || `段落 ${i + 1}`,
  }))
}

/** Index of the section containing 1-based `bar`, or -1. */
export function sectionAt(sections: readonly Section[], bar: number): number {
  let found = -1
  for (let i = 0; i < sections.length; i++) {
    if (sections[i].startBar <= bar) found = i
    else break
  }
  return found
}

/** The section after the one containing `bar`, or null. */
export function nextSection(sections: readonly Section[], bar: number): Section | null {
  for (const s of sections) {
    if (s.startBar > bar) return s
  }
  return null
}

/** The 1-based bar containing `tick` (bars sorted by start); 1 when before the first. */
export function barAtTick(bars: readonly { start: number }[], tick: number): number {
  let lo = 0
  let hi = bars.length - 1
  let found = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (bars[mid].start <= tick) {
      found = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return found < 0 ? 1 : found + 1
}

/**
 * Count-in length: beats × one beat at bpm × speed (speedPct 100 = written tempo),
 * in whole milliseconds. Non-positive bpm / speed / beats give 0.
 */
export function countInMs(beats: number, bpm: number, speedPct: number): number {
  if (!(beats > 0) || !(bpm > 0) || !(speedPct > 0)) return 0
  const beatMs = 60000 / ((bpm * speedPct) / 100)
  return Math.round(beats * beatMs)
}

/** End tick (exclusive) of 1-based bar `bar`: start of the next bar, or `songEndTick` for the last bar. */
export function barEndTick(
  bars: readonly { start: number }[],
  bar: number,
  songEndTick: number,
): number {
  if (bar < 1) return bars[0] ? bars[0].start : songEndTick
  const next = bars[bar]
  return next ? next.start : songEndTick
}
