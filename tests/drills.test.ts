import { describe, expect, it } from 'vitest'
import { generateQuestion } from '@/drills/generators'
import { gradeQuestion, gradeTaps } from '@/drills/grading'
import { INTERVAL_LEVELS, PITCH_COMPARE_LEVELS, clampLevel, levelTitles } from '@/drills/levels'
import { skillLabel, skillModule } from '@/drills/skills'
import { MODULES, type ModuleId } from '@/drills/types'
import { intervalById } from '@/music/intervals'

describe('generators', () => {
  it('are deterministic per seed', () => {
    const a = generateQuestion('E2', 3, { seed: 123 })
    const b = generateQuestion('E2', 3, { seed: 123 })
    expect(a).toEqual(b)
  })

  it('cover every module and level without throwing', () => {
    for (const m of MODULES) {
      for (const { level } of levelTitles(m.id)) {
        for (let s = 1; s <= 25; s++) {
          const q = generateQuestion(m.id, level, { seed: s * 7919 + level })
          expect(q.module).toBe(m.id)
          expect(q.level).toBe(level)
          expect(q.skillIds.length).toBeGreaterThan(0)
          if (m.id !== 'I2') for (const sk of q.skillIds) expect(skillModule(sk)).toBe(m.id === 'R3' || m.id === 'R2' ? 'R2' : m.id)
        }
      }
    }
  })

  it('pitch comparison respects the level resolution', () => {
    for (const cfg of PITCH_COMPARE_LEVELS) {
      for (let s = 1; s <= 30; s++) {
        const q = generateQuestion('E1', cfg.level, { seed: s })
        if (q.kind !== 'pitch_compare') throw new Error('kind')
        const cents = (q.b.midi - q.a.midi) * 100 + q.b.detuneCents
        if (q.answer === 'same') expect(cents).toBe(0)
        else expect(Math.abs(cents)).toBe(cfg.cents)
        if (q.answer === 'higher') expect(cents).toBeGreaterThan(0)
        if (q.answer === 'lower') expect(cents).toBeLessThan(0)
        if (!cfg.allowSame) expect(q.answer).not.toBe('same')
      }
    }
  })

  it('interval questions match the answer distance and the level pool', () => {
    for (const cfg of INTERVAL_LEVELS) {
      for (let s = 1; s <= 30; s++) {
        const q = generateQuestion('E2', cfg.level, { seed: s })
        if (q.kind !== 'interval') throw new Error('kind')
        expect(cfg.pool).toContain(q.answer)
        expect(Math.abs(q.second - q.root)).toBe(intervalById(q.answer).semitones)
        expect(cfg.directions).toContain(q.direction)
        if (q.direction === 'down') expect(q.second).toBeLessThanOrEqual(q.root)
      }
    }
  })

  it('favours focus skills most of the time', () => {
    let hits = 0
    for (let s = 1; s <= 200; s++) {
      const q = generateQuestion('E2', 7, { seed: s, focusSkills: ['interval:m6'] })
      if (q.kind === 'interval' && q.answer === 'm6') hits++
    }
    expect(hits).toBeGreaterThan(80)
    expect(hits).toBeLessThan(200)
  })

  it('avoids repeating the previous answer when asked', () => {
    for (let s = 1; s <= 50; s++) {
      const q = generateQuestion('E5', 1, { seed: s, avoidAnswer: 'maj' })
      if (q.kind === 'chord') expect(q.answer).toBe('min')
    }
  })

  it('degree sequences at level 6 have three notes in key', () => {
    const q = generateQuestion('E3', 6, { seed: 99 })
    if (q.kind !== 'degree') throw new Error('kind')
    expect(q.notes).toHaveLength(3)
    expect(q.answer).toHaveLength(3)
    expect(q.cadence).toHaveLength(4)
  })

  it('clamps levels', () => {
    expect(clampLevel('E1', 0)).toBe(1)
    expect(clampLevel('E1', 99)).toBe(6)
  })
})

describe('grading choice questions', () => {
  it('marks correct and wrong with confusion', () => {
    const q = generateQuestion('E2', 2, { seed: 5 })
    if (q.kind !== 'interval') throw new Error('kind')
    const ok = gradeQuestion(q, { kind: 'choice', value: q.answer })
    expect(ok.correct).toBe(true)
    expect(ok.credit).toBe(1)
    const wrongValue = q.options.find((o) => o !== q.answer)!
    const bad = gradeQuestion(q, { kind: 'choice', value: wrongValue })
    expect(bad.correct).toBe(false)
    expect(bad.confusedWith).toBe(wrongValue)
    expect(bad.confusedExpected).toBe(q.answer)
    expect(bad.feedback.length).toBeGreaterThan(5)
  })

  it('skip is never correct', () => {
    const q = generateQuestion('E5', 1, { seed: 3 })
    const r = gradeQuestion(q, { kind: 'skip' })
    expect(r.correct).toBe(false)
    expect(r.givenLabel).toBe('跳过')
  })

  it('degree sequences give partial credit per skill', () => {
    const q = generateQuestion('E3', 6, { seed: 11 })
    if (q.kind !== 'degree') throw new Error('kind')
    const partial = [...q.answer]
    partial[1] = partial[1] === '1' ? '2' : '1'
    const r = gradeQuestion(q, { kind: 'choices', values: partial })
    expect(r.correct).toBe(false)
    expect(r.credit).toBeCloseTo(2 / 3)
    expect(r.confusedExpected).toBe(q.answer[1])
    expect(r.skillCredits![`degree:${q.answer[0]}`]).toBe(1)
  })
})

describe('grading taps', () => {
  const bpm = 120 // 500 ms per beat
  const onsets = [0, 1, 2, 3]

  it('perfect taps are correct with tiny deviation', () => {
    const r = gradeTaps(onsets, 4, bpm, { kind: 'taps', taps: [0, 1.01, 1.99, 3] }, ['rhythm:tempo:120'])
    expect(r.correct).toBe(true)
    expect(r.timing!.matched).toBe(4)
    expect(r.timing!.meanAbsDeviationMs).toBeLessThan(10)
    expect(r.credit).toBe(1)
  })

  it('late taps report positive signed deviation and reduced credit', () => {
    const r = gradeTaps(onsets, 4, bpm, { kind: 'taps', taps: [0.2, 1.2, 2.2, 3.2] }, [])
    expect(r.timing!.meanSignedDeviationMs).toBeGreaterThan(90)
    expect(r.correct).toBe(false)
    expect(r.credit).toBeGreaterThan(0)
    expect(r.credit).toBeLessThan(1)
  })

  it('missing and extra taps lower the credit', () => {
    const missing = gradeTaps(onsets, 4, bpm, { kind: 'taps', taps: [0, 1] }, [])
    expect(missing.timing!.matched).toBe(2)
    expect(missing.credit).toBeLessThan(0.6)
    const extra = gradeTaps(onsets, 4, bpm, { kind: 'taps', taps: [0, 0.5, 1, 2, 3] }, [])
    expect(extra.timing!.extra).toBe(1)
    expect(extra.correct).toBe(false)
  })

  it('no taps yields zero credit', () => {
    const r = gradeTaps(onsets, 4, bpm, { kind: 'taps', taps: [] }, [])
    expect(r.credit).toBe(0)
  })
})

describe('skills', () => {
  it('labels known skills', () => {
    expect(skillLabel('interval:M3')).toBe('大三度')
    expect(skillLabel('chord:inv:1')).toBe('第一转位')
    expect(skillLabel('rhythm:fig:dotted')).toBe('附点')
    expect(skillLabel('pitch:res:50')).toBe('50 音分分辨')
    expect(skillLabel('weird:thing')).toBe('weird:thing')
  })
  it('maps skills to modules', () => {
    const cases: Array<[string, ModuleId]> = [
      ['interval:P5', 'E2'],
      ['degree:3', 'E3'],
      ['scale:blues', 'E4'],
      ['chord:maj7', 'E5'],
      ['rhythm:tempo:80', 'R1'],
    ]
    for (const [s, m] of cases) expect(skillModule(s)).toBe(m)
  })
})
