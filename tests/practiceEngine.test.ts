import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TRAINER,
  GAP_OPTIONS,
  LOOP_COUNT_OPTIONS,
  SPEED_MAX,
  SPEED_MIN,
  STEP_OPTIONS,
  gapMs,
  loopStatus,
  nextPass,
  normalizeTrainer,
  startLoop,
  trainerSummary,
  type TrainerConfig,
} from '../web/viewer/practiceEngine'

const on: TrainerConfig = { ...DEFAULT_TRAINER, enabled: true, startPct: 60, targetPct: 100, stepPct: 5 }

describe('options', () => {
  it('exposes the gap, loop-count and step choices', () => {
    expect(GAP_OPTIONS.map((o) => o.value)).toEqual([0, 1, 2, 4])
    expect(GAP_OPTIONS[0].label).toBe('不停')
    expect(LOOP_COUNT_OPTIONS.map((o) => o.value)).toEqual([0, 3, 5, 10])
    expect(LOOP_COUNT_OPTIONS[0].label).toBe('不限')
    expect([...STEP_OPTIONS]).toEqual([1, 2, 5, 10])
    expect(SPEED_MIN).toBe(15)
    expect(SPEED_MAX).toBe(175)
  })
})

describe('normalizeTrainer', () => {
  it('returns the defaults for non-object input', () => {
    for (const raw of [null, undefined, 0, 'x', true, [], [1, 2]]) {
      expect(normalizeTrainer(raw)).toEqual(DEFAULT_TRAINER)
    }
  })

  it('returns a copy, not the shared default object', () => {
    const cfg = normalizeTrainer(null)
    cfg.startPct = 99
    expect(DEFAULT_TRAINER.startPct).toBe(60)
  })

  it('keeps a fully valid config unchanged', () => {
    const valid: TrainerConfig = {
      enabled: true,
      startPct: 70,
      targetPct: 120,
      stepPct: 10,
      gapBeats: 4,
      countInEachLoop: false,
      maxLoops: 5,
    }
    expect(normalizeTrainer(valid)).toEqual(valid)
  })

  it('falls back to defaults for wrong-typed fields', () => {
    const cfg = normalizeTrainer({
      enabled: 'yes',
      startPct: '70',
      targetPct: null,
      stepPct: '5',
      gapBeats: '2',
      countInEachLoop: 1,
      maxLoops: 'many',
    })
    expect(cfg).toEqual(DEFAULT_TRAINER)
  })

  it('treats NaN and Infinity as invalid numbers', () => {
    const cfg = normalizeTrainer({
      startPct: NaN,
      targetPct: Infinity,
      maxLoops: -Infinity,
      stepPct: NaN,
    })
    expect(cfg.startPct).toBe(DEFAULT_TRAINER.startPct)
    expect(cfg.targetPct).toBe(DEFAULT_TRAINER.targetPct)
    expect(cfg.maxLoops).toBe(DEFAULT_TRAINER.maxLoops)
    expect(cfg.stepPct).toBe(DEFAULT_TRAINER.stepPct)
  })

  it('rounds speeds to integers and clamps them to the speed range', () => {
    const cfg = normalizeTrainer({ startPct: 60.6, targetPct: 500 })
    expect(cfg.startPct).toBe(61)
    expect(cfg.targetPct).toBe(SPEED_MAX)
    const low = normalizeTrainer({ startPct: -20, targetPct: 0 })
    expect(low.startPct).toBe(SPEED_MIN)
    expect(low.targetPct).toBe(SPEED_MIN)
  })

  it('raises targetPct to startPct when it is below', () => {
    const cfg = normalizeTrainer({ startPct: 90, targetPct: 70 })
    expect(cfg.startPct).toBe(90)
    expect(cfg.targetPct).toBe(90)
  })

  it('accepts only listed step sizes', () => {
    expect(normalizeTrainer({ stepPct: 10 }).stepPct).toBe(10)
    expect(normalizeTrainer({ stepPct: 3 }).stepPct).toBe(DEFAULT_TRAINER.stepPct)
    expect(normalizeTrainer({ stepPct: 0 }).stepPct).toBe(DEFAULT_TRAINER.stepPct)
  })

  it('accepts only listed gap values', () => {
    for (const g of [0, 1, 2, 4]) {
      expect(normalizeTrainer({ gapBeats: g }).gapBeats).toBe(g)
    }
    for (const g of [3, 8, -1, 2.5]) {
      expect(normalizeTrainer({ gapBeats: g }).gapBeats).toBe(DEFAULT_TRAINER.gapBeats)
    }
  })

  it('rounds maxLoops and clamps it to 0..999', () => {
    expect(normalizeTrainer({ maxLoops: 4.4 }).maxLoops).toBe(4)
    expect(normalizeTrainer({ maxLoops: -3 }).maxLoops).toBe(0)
    expect(normalizeTrainer({ maxLoops: 5000 }).maxLoops).toBe(999)
  })

  it('keeps valid booleans and ignores extra fields', () => {
    const cfg = normalizeTrainer({ enabled: true, countInEachLoop: false, junk: 42 })
    expect(cfg.enabled).toBe(true)
    expect(cfg.countInEachLoop).toBe(false)
    expect(Object.keys(cfg).sort()).toEqual(Object.keys(DEFAULT_TRAINER).sort())
  })
})

describe('startLoop', () => {
  it('starts at the trainer start speed when enabled', () => {
    expect(startLoop(on, 100)).toEqual({ pass: 1, speedPct: 60, done: false })
  })

  it('keeps the current speed when the trainer is disabled', () => {
    expect(startLoop(DEFAULT_TRAINER, 85)).toEqual({ pass: 1, speedPct: 85, done: false })
  })
})

describe('nextPass', () => {
  it('steps the speed up by stepPct and increments the pass', () => {
    const s1 = nextPass(on, startLoop(on, 100))
    expect(s1).toEqual({ pass: 2, speedPct: 65, done: false })
    const s2 = nextPass(on, s1)
    expect(s2).toEqual({ pass: 3, speedPct: 70, done: false })
  })

  it('caps the speed at targetPct and keeps looping there', () => {
    let s = startLoop(on, 100)
    for (let i = 0; i < 20; i++) s = nextPass(on, s)
    expect(s.speedPct).toBe(100)
    expect(s.done).toBe(false)
    expect(nextPass(on, s).speedPct).toBe(100)
  })

  it('does not step past an uneven target', () => {
    const cfg = { ...on, startPct: 60, targetPct: 62, stepPct: 5 }
    expect(nextPass(cfg, { pass: 1, speedPct: 60, done: false }).speedPct).toBe(62)
  })

  it('never exceeds SPEED_MAX even if the target is higher', () => {
    const cfg = { ...on, startPct: 170, targetPct: 175, stepPct: 10 }
    expect(nextPass(cfg, { pass: 1, speedPct: 170, done: false }).speedPct).toBe(175)
    const cfg2 = { ...cfg, targetPct: 175 }
    expect(nextPass(cfg2, { pass: 1, speedPct: 175, done: false }).speedPct).toBe(175)
  })

  it('leaves the speed unchanged when the trainer is disabled', () => {
    const s = nextPass(DEFAULT_TRAINER, { pass: 2, speedPct: 85, done: false })
    expect(s).toEqual({ pass: 3, speedPct: 85, done: false })
  })

  it('finishes when the pass just played was the last allowed one', () => {
    const cfg = { ...on, maxLoops: 3 }
    let s = startLoop(cfg, 100)
    s = nextPass(cfg, s)
    expect(s).toEqual({ pass: 2, speedPct: 65, done: false })
    s = nextPass(cfg, s)
    expect(s).toEqual({ pass: 3, speedPct: 70, done: false })
    const end = nextPass(cfg, s)
    expect(end).toEqual({ pass: 3, speedPct: 70, done: true })
  })

  it('finishes with the speed unchanged on the last pass when disabled', () => {
    const cfg = { ...DEFAULT_TRAINER, maxLoops: 1 }
    const end = nextPass(cfg, startLoop(cfg, 90))
    expect(end).toEqual({ pass: 1, speedPct: 90, done: true })
  })

  it('never finishes when maxLoops is 0', () => {
    let s = startLoop(DEFAULT_TRAINER, 100)
    for (let i = 0; i < 50; i++) s = nextPass(DEFAULT_TRAINER, s)
    expect(s.done).toBe(false)
    expect(s.pass).toBe(51)
  })
})

describe('gapMs', () => {
  it('computes beats at tempo and speed', () => {
    expect(gapMs(1, 120, 100)).toBe(500)
    expect(gapMs(2, 120, 100)).toBe(1000)
    expect(gapMs(4, 60, 100)).toBe(4000)
  })

  it('stretches the gap at slower speeds', () => {
    expect(gapMs(2, 120, 50)).toBe(2000)
    expect(gapMs(1, 120, 200)).toBe(250)
  })

  it('returns 0 for no gap', () => {
    expect(gapMs(0, 120, 100)).toBe(0)
    expect(gapMs(0, 0, 0)).toBe(0)
  })

  it('rounds to whole milliseconds', () => {
    // 1 beat at 110 bpm = 545.45... ms
    expect(gapMs(1, 110, 100)).toBe(545)
    // 1 beat at 70 bpm, 90% = 952.38... ms
    expect(gapMs(1, 70, 90)).toBe(952)
    expect(Number.isInteger(gapMs(2, 97, 83))).toBe(true)
  })

  it('treats non-positive or non-finite tempo as 120 bpm', () => {
    for (const bpm of [0, -60, NaN, Infinity, -Infinity]) {
      expect(gapMs(2, bpm, 100)).toBe(1000)
    }
  })

  it('treats non-positive or non-finite speed as 100%', () => {
    for (const pct of [0, -50, NaN, Infinity]) {
      expect(gapMs(1, 120, pct)).toBe(500)
    }
  })
})

describe('loopStatus', () => {
  it('shows the climbing speed while below target', () => {
    const cfg = { ...on, maxLoops: 0 }
    expect(loopStatus(cfg, { pass: 3, speedPct: 70, done: false })).toBe('第 3 遍 · 70% → 100%')
  })

  it('shows the target reached once at target', () => {
    const cfg = { ...on, maxLoops: 0 }
    expect(loopStatus(cfg, { pass: 3, speedPct: 100, done: false })).toBe(
      '第 3 遍 · 100%（已到目标）',
    )
  })

  it('shows only the speed when the trainer is disabled', () => {
    expect(loopStatus(DEFAULT_TRAINER, { pass: 3, speedPct: 85, done: false })).toBe(
      '第 3 遍 · 85%',
    )
  })

  it('shows the pass out of maxLoops when a limit is set', () => {
    const cfg = { ...on, maxLoops: 5 }
    expect(loopStatus(cfg, { pass: 3, speedPct: 70, done: false })).toBe(
      '第 3 / 5 遍 · 70% → 100%',
    )
    expect(loopStatus(cfg, { pass: 5, speedPct: 100, done: false })).toBe(
      '第 5 / 5 遍 · 100%（已到目标）',
    )
    expect(
      loopStatus({ ...DEFAULT_TRAINER, maxLoops: 10 }, { pass: 2, speedPct: 90, done: false }),
    ).toBe('第 2 / 10 遍 · 90%')
  })
})

describe('trainerSummary', () => {
  it('describes an enabled trainer', () => {
    expect(trainerSummary({ ...on, startPct: 60, stepPct: 5, targetPct: 100 })).toBe(
      '从 60% 开始，每遍 +5%，到 100% 为止',
    )
  })

  it('reads "关闭" when disabled', () => {
    expect(trainerSummary(DEFAULT_TRAINER)).toBe('关闭')
  })
})
