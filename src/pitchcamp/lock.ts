import { centsFromTarget, type PitchFrame } from '@/audio/pitch/analysis'

/**
 * 滑音找音、持续音唱级数用：最近一段连续落在目标音 ±tol 音分以内的时长（秒）
 * 和这段的中位偏差。中间偶尔一帧没测到（换气、清辅音）不打断，测到偏离才打断。
 */
export function trailingLock(
  frames: readonly PitchFrame[],
  targetMidi: number,
  tol: number,
  octaveEquivalence = true,
): { seconds: number; cents: number | null } {
  let start: number | null = null
  let end: number | null = null
  const cents: number[] = []
  let gap = 0
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i]!
    if (f.hz === null) {
      gap += 1
      if (gap > 3) break
      continue
    }
    const c = centsFromTarget(f.hz, targetMidi, octaveEquivalence)
    if (Math.abs(c) > tol) break
    gap = 0
    if (end === null) end = f.t
    start = f.t
    cents.push(c)
  }
  if (start === null || end === null) return { seconds: 0, cents: null }
  cents.sort((a, b) => a - b)
  return { seconds: end - start, cents: Math.round(cents[Math.floor(cents.length / 2)]!) }
}

/** 第一次出声的时间（滑音从这里开始算）。 */
export function firstVoiced(frames: readonly PitchFrame[], from: number): number | null {
  const f = frames.find((x) => x.t >= from && x.hz !== null)
  return f ? f.t : null
}
