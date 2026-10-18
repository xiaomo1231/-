/**
 * 练习模式 logic, free of alphaTab and React: the speed trainer (渐进提速), the loop
 * count, and the pause between passes.
 */

export type GapBeats = 0 | 1 | 2 | 4

export interface TrainerConfig {
  /** 渐进提速 on: every pass starts at startPct and rises by stepPct up to targetPct. */
  enabled: boolean
  startPct: number
  targetPct: number
  stepPct: number
  /** Silence between passes, in beats of the current tempo. */
  gapBeats: GapBeats
  /** Play the count-in again before every pass. */
  countInEachLoop: boolean
  /** Stop after this many passes; 0 = keep going. */
  maxLoops: number
}

export const DEFAULT_TRAINER: TrainerConfig = {
  enabled: false,
  startPct: 60,
  targetPct: 100,
  stepPct: 5,
  gapBeats: 0,
  countInEachLoop: false,
  maxLoops: 0,
}

/** The state of a practice loop run. */
export interface LoopState {
  /** Current pass, 1-based. */
  pass: number
  speedPct: number
  /** maxLoops reached: playback should stop instead of starting another pass. */
  done: boolean
}

/** Lowest playback speed (percent of the score tempo) the trainer may use. */
export const SPEED_MIN = 15
/** Highest playback speed (percent of the score tempo) the trainer may use. */
export const SPEED_MAX = 175

/** Choices for the silence between passes. */
export const GAP_OPTIONS: ReadonlyArray<{ value: GapBeats; label: string }> = [
  { value: 0, label: '不停' },
  { value: 1, label: '1 拍' },
  { value: 2, label: '2 拍' },
  { value: 4, label: '4 拍' },
]

/** Choices for how many passes to play; 0 means unlimited. */
export const LOOP_COUNT_OPTIONS: ReadonlyArray<{ value: number; label: string }> = [
  { value: 0, label: '不限' },
  { value: 3, label: '3 遍' },
  { value: 5, label: '5 遍' },
  { value: 10, label: '10 遍' },
]

/** Speed increments the trainer offers, in percentage points. */
export const STEP_OPTIONS = [1, 2, 5, 10] as const

const GAP_VALUES: ReadonlyArray<GapBeats> = [0, 1, 2, 4]
const MAX_LOOPS_LIMIT = 999

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function clampSpeed(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(SPEED_MAX, Math.max(SPEED_MIN, Math.round(value)))
}

/**
 * Repairs anything read from storage: unknown or invalid fields fall back to DEFAULT_TRAINER;
 * speeds are integers clamped to SPEED_MIN..SPEED_MAX; stepPct must be one of STEP_OPTIONS;
 * gapBeats must be 0, 1, 2 or 4; maxLoops is an integer in 0..999; targetPct is never
 * below startPct.
 */
export function normalizeTrainer(raw: unknown): TrainerConfig {
  const d = DEFAULT_TRAINER
  if (!isRecord(raw)) return { ...d }

  const enabled = typeof raw.enabled === 'boolean' ? raw.enabled : d.enabled
  const startPct = clampSpeed(raw.startPct, d.startPct)
  let targetPct = clampSpeed(raw.targetPct, d.targetPct)
  if (targetPct < startPct) targetPct = startPct
  const stepPct =
    typeof raw.stepPct === 'number' && (STEP_OPTIONS as readonly number[]).includes(raw.stepPct)
      ? raw.stepPct
      : d.stepPct
  const gapBeats =
    typeof raw.gapBeats === 'number' && (GAP_VALUES as readonly number[]).includes(raw.gapBeats)
      ? (raw.gapBeats as GapBeats)
      : d.gapBeats
  const countInEachLoop =
    typeof raw.countInEachLoop === 'boolean' ? raw.countInEachLoop : d.countInEachLoop
  const maxLoops =
    typeof raw.maxLoops === 'number' && Number.isFinite(raw.maxLoops)
      ? Math.min(MAX_LOOPS_LIMIT, Math.max(0, Math.round(raw.maxLoops)))
      : d.maxLoops

  return { enabled, startPct, targetPct, stepPct, gapBeats, countInEachLoop, maxLoops }
}

/**
 * First pass of a loop run. The speed is cfg.startPct when the trainer is enabled,
 * otherwise the current playback speed.
 */
export function startLoop(cfg: TrainerConfig, currentSpeedPct: number): LoopState {
  return {
    pass: 1,
    speedPct: cfg.enabled ? cfg.startPct : currentSpeedPct,
    done: false,
  }
}

/**
 * Advances the loop after a pass has finished. When the just-finished pass was the last
 * one allowed (maxLoops), returns done with pass and speed unchanged. Otherwise the pass
 * counter increases and, when the trainer is enabled, the speed rises by stepPct without
 * exceeding targetPct or SPEED_MAX.
 */
export function nextPass(cfg: TrainerConfig, s: LoopState): LoopState {
  if (cfg.maxLoops > 0 && s.pass >= cfg.maxLoops) {
    return { pass: s.pass, speedPct: s.speedPct, done: true }
  }
  const speedPct = cfg.enabled
    ? Math.min(s.speedPct + cfg.stepPct, cfg.targetPct, SPEED_MAX)
    : s.speedPct
  return { pass: s.pass + 1, speedPct, done: false }
}

/**
 * Milliseconds of silence for gapBeats at the given tempo and speed:
 * beats * 60000 / (bpm * speedPct / 100), rounded to whole milliseconds. A non-finite or
 * non-positive tempo is treated as 120 bpm, and a non-finite or non-positive speed as 100%.
 */
export function gapMs(gapBeats: GapBeats, tempoBpm: number, speedPct: number): number {
  const bpm = Number.isFinite(tempoBpm) && tempoBpm > 0 ? tempoBpm : 120
  const speed = Number.isFinite(speedPct) && speedPct > 0 ? speedPct : 100
  return Math.round((gapBeats * 60000) / (bpm * (speed / 100)))
}

/**
 * Short Chinese status for the remote, e.g. "第 3 遍 · 70% → 100%" while the trainer is
 * still climbing, "第 3 遍 · 100%（已到目标）" at the target, "第 3 遍 · 85%" when the
 * trainer is off. With maxLoops set the pass reads "第 3 / 5 遍".
 */
export function loopStatus(cfg: TrainerConfig, s: LoopState): string {
  const pass = cfg.maxLoops > 0 ? `第 ${s.pass} / ${cfg.maxLoops} 遍` : `第 ${s.pass} 遍`
  if (!cfg.enabled) return `${pass} · ${s.speedPct}%`
  if (s.speedPct >= cfg.targetPct) return `${pass} · ${s.speedPct}%（已到目标）`
  return `${pass} · ${s.speedPct}% → ${cfg.targetPct}%`
}

/**
 * One-line trainer summary for the settings row, e.g. "从 60% 开始，每遍 +5%，到 100% 为止",
 * or "关闭" when the trainer is disabled.
 */
export function trainerSummary(cfg: TrainerConfig): string {
  if (!cfg.enabled) return '关闭'
  return `从 ${cfg.startPct}% 开始，每遍 +${cfg.stepPct}%，到 ${cfg.targetPct}% 为止`
}
