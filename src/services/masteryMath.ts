import type { SkillObservation } from '@/entities/types'

/** Observations kept per skill. Older ones have negligible weight anyway. */
export const MAX_OBSERVATIONS = 40

/**
 * Mastery estimate from observations: newer observations count more
 * (0.9^age), each weighted by its own `weight`. This is an estimate from
 * practice records, never a statement about ability.
 */
export function computeMastery(observations: readonly SkillObservation[]): number {
  if (observations.length === 0) return 0
  let num = 0
  let den = 0
  observations.forEach((o, i) => {
    const recency = Math.pow(0.9, observations.length - 1 - i)
    const w = recency * o.weight
    den += w
    num += w * o.credit
  })
  return den === 0 ? 0 : clamp01(num / den)
}

export function appendObservation(list: readonly SkillObservation[], obs: SkillObservation): SkillObservation[] {
  const next = [...list, obs]
  return next.length > MAX_OBSERVATIONS ? next.slice(next.length - MAX_OBSERVATIONS) : next
}

/** Bands used by the skill map and module cards. */
export type MasteryBand = 'new' | 'learning' | 'solid' | 'mastered'

export function masteryBand(mastery: number, attempts: number): MasteryBand {
  if (attempts === 0) return 'new'
  if (mastery >= 0.9 && attempts >= 8) return 'mastered'
  if (mastery >= 0.7) return 'solid'
  return 'learning'
}

export const BAND_LABEL: Record<MasteryBand, string> = {
  new: '未开始',
  learning: '练习中',
  solid: '稳定',
  mastered: '已掌握',
}

export interface LevelDecision {
  action: 'up' | 'down' | 'stay'
  reason: string
  /** Accuracy over the window, null when too few samples. */
  accuracy: number | null
}

/** Window of outcomes considered for a level change. */
export const LEVEL_WINDOW = 10
export const LEVEL_UP_RATIO = 0.85
export const LEVEL_DOWN_RATIO = 0.5
const MIN_FOR_UP = 10
const MIN_FOR_DOWN = 6

/**
 * Decide whether the student should move level. Needs a full window to go
 * up (so a lucky streak cannot skip practice) and fewer samples to come down
 * (so nobody is stuck failing).
 */
export function decideLevel(recent: ReadonlyArray<{ correct: boolean; credit: number }>, level: number, maxLevel: number): LevelDecision {
  const window = recent.slice(-LEVEL_WINDOW)
  if (window.length === 0) return { action: 'stay', reason: '还没有记录', accuracy: null }
  const accuracy = window.reduce((s, r) => s + r.credit, 0) / window.length
  if (window.length >= MIN_FOR_UP && accuracy >= LEVEL_UP_RATIO && level < maxLevel) {
    return { action: 'up', reason: `最近 ${window.length} 题正确率 ${Math.round(accuracy * 100)}%，可以升级`, accuracy }
  }
  if (window.length >= MIN_FOR_DOWN && accuracy < LEVEL_DOWN_RATIO && level > 1) {
    return { action: 'down', reason: `最近 ${window.length} 题正确率 ${Math.round(accuracy * 100)}%，先回到上一级巩固`, accuracy }
  }
  return { action: 'stay', reason: '继续当前级别', accuracy }
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x))
}
