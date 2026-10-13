/**
 * Latency maths (pure). What the student hears lags the scheduled click by
 * the output latency; what we receive lags their pluck by the input latency.
 * Calibration measures the sum directly: pluck along with clicks and take
 * the typical offset between each click and the detected pluck.
 */

export interface LatencyParts {
  /** AudioContext.baseLatency, seconds. */
  base: number
  /** AudioContext.outputLatency, seconds. */
  output: number
  /** Capture track latency reported by the browser, seconds (0 = unknown). */
  input: number
}

/** Assumed input latency when the browser does not report one. */
export const UNKNOWN_INPUT_LATENCY = 0.012

/** Estimated round trip (pluck → hear it through the monitor), in ms. */
export function estimateRoundTripMs(p: LatencyParts): number {
  const input = p.input > 0 ? p.input : UNKNOWN_INPUT_LATENCY
  return Math.round((Math.max(0, p.base) + Math.max(0, p.output) + input) * 1000)
}

export const MONITOR_WARN_MS = 60

export interface CalibrationOptions {
  /** Clicks ignored at the start (warm-up). */
  warmup: number
  minValid: number
  /** Maximum standard deviation of the kept offsets, seconds. */
  maxSpread: number
  /** Plausible total latency range, seconds. */
  range: [number, number]
}

export const DEFAULT_CALIBRATION: CalibrationOptions = { warmup: 4, minValid: 8, maxSpread: 0.025, range: [0, 0.3] }

export interface CalibrationResult {
  ok: boolean
  /** Offset to subtract from detected onset times, ms. */
  offsetMs: number
  spreadMs: number
  used: number
  reason?: 'too-few' | 'unsteady' | 'out-of-range'
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/**
 * Match each click (after the warm-up) with the nearest detected onset in a
 * window from slightly early to clearly late, drop outliers (median absolute
 * deviation) and summarise.
 */
export function calibrate(clicks: readonly number[], onsets: readonly number[], opts: CalibrationOptions = DEFAULT_CALIBRATION): CalibrationResult {
  const offsets: number[] = []
  const used = new Set<number>()
  for (const c of clicks.slice(opts.warmup)) {
    let best = -1
    let bestD = Infinity
    onsets.forEach((o, i) => {
      if (used.has(i)) return
      const d = o - c
      if (d < -0.12 || d > opts.range[1] + 0.12) return
      if (Math.abs(d - 0.06) < bestD) {
        bestD = Math.abs(d - 0.06)
        best = i
      }
    })
    if (best >= 0) {
      used.add(best)
      offsets.push(onsets[best]! - c)
    }
  }
  if (offsets.length < opts.minValid) return { ok: false, offsetMs: 0, spreadMs: 0, used: offsets.length, reason: 'too-few' }
  const med = median(offsets)
  const mad = median(offsets.map((x) => Math.abs(x - med)))
  const kept = offsets.filter((x) => Math.abs(x - med) <= 3 * mad + 0.008)
  const mean = kept.reduce((a, b) => a + b, 0) / kept.length
  const sd = Math.sqrt(kept.reduce((a, b) => a + (b - mean) ** 2, 0) / kept.length)
  const base = { offsetMs: Math.round(mean * 1000), spreadMs: Math.round(sd * 1000), used: kept.length }
  if (kept.length < opts.minValid) return { ok: false, ...base, reason: 'too-few' }
  if (sd > opts.maxSpread) return { ok: false, ...base, reason: 'unsteady' }
  if (mean < opts.range[0] || mean > opts.range[1]) return { ok: false, ...base, reason: 'out-of-range' }
  return { ok: true, ...base }
}

export const CALIBRATION_MESSAGE: Record<NonNullable<CalibrationResult['reason']>, string> = {
  'too-few': '检测到的拨弦太少。确认输入设备有信号（电平条会跳），每一拍都拨一下空弦，再试一次。',
  unsteady: '这次的节奏不太稳，偏差波动比较大。放松，跟着节拍器再来一次。',
  'out-of-range': '测出的延迟不在合理范围内。检查输入、输出设备是否选对，关掉蓝牙耳机后重试。',
}

/** The offset (seconds) to subtract when judging, preferring the calibrated value. */
export function judgeOffset(byDevice: Readonly<Record<string, number>> | undefined, key: string, estimateMs: number): { seconds: number; calibrated: boolean } {
  const v = byDevice?.[key]
  return typeof v === 'number' ? { seconds: v / 1000, calibrated: true } : { seconds: estimateMs / 1000, calibrated: false }
}
