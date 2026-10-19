/**
 * Pure math for the sound-latency calibration: match each tap to the click it answers,
 * drop the outliers, and report the median delay. No DOM or audio here, so it can be tested.
 */

/** Taps further than this from every click are not answers to a click. */
const MATCH_WINDOW_MS = 400
/** A tap this long before the first click is a stray tap, not an answer. */
const EARLY_TAP_MS = 100
/** Offsets further than this from the median are dropped as outliers. */
const OUTLIER_MS = 120
/** Fewer kept offsets than this and the result is not trusted. */
const MIN_KEPT = 5
const MAX_MS = 1000

function median(sorted: number[]): number {
  const n = sorted.length
  const mid = Math.floor(n / 2)
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Linear-interpolated quantile of an ascending list (q in 0–1). */
function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo)
}

/**
 * `clicks` are the expected times of the scheduled clicks and `taps` the times of the
 * presses, both in performance.now() milliseconds. Returns the device delay, or null when
 * there are too few usable taps.
 */
export function estimateLatency(
  clicks: number[],
  taps: number[],
): { ms: number; used: number; spread: number } | null {
  if (clicks.length === 0 || taps.length === 0) return null
  const sortedClicks = [...clicks].sort((a, b) => a - b)
  const first = sortedClicks[0]

  const offsets: number[] = []
  for (const tap of taps) {
    if (!Number.isFinite(tap) || tap < first - EARLY_TAP_MS) continue
    // Nearest click: the list is sorted, so a linear scan keeps this simple and fast enough
    // for the 16 clicks a calibration uses.
    let best = sortedClicks[0]
    for (const c of sortedClicks) {
      if (Math.abs(tap - c) < Math.abs(tap - best)) best = c
    }
    if (Math.abs(tap - best) > MATCH_WINDOW_MS) continue
    offsets.push(tap - best)
  }
  if (offsets.length < MIN_KEPT) return null

  offsets.sort((a, b) => a - b)
  const center = median(offsets)
  const kept = offsets.filter((o) => Math.abs(o - center) <= OUTLIER_MS)
  if (kept.length < MIN_KEPT) return null

  const ms = Math.min(MAX_MS, Math.max(0, Math.round(median(kept))))
  const spread = Math.round(quantile(kept, 0.75) - quantile(kept, 0.25))
  return { ms, used: kept.length, spread }
}

/**
 * The output latency the browser reports for an AudioContext, in ms. Both properties are
 * in seconds in the Web Audio API; either may be missing, and Bluetooth often reports
 * nothing useful. Returns null when neither is a number.
 */
export function reportedLatencyMs(ctx: { outputLatency?: number; baseLatency?: number }): number | null {
  const parts = [ctx.outputLatency, ctx.baseLatency].filter(
    (v): v is number => typeof v === 'number' && Number.isFinite(v),
  )
  if (parts.length === 0) return null
  return Math.round(parts.reduce((sum, v) => sum + v, 0) * 1000)
}
