import { beforeEach, describe, expect, it } from 'vitest'
import { GrooveLabDB, setDbForTests } from '@/infrastructure/db/database'
import { CourseService } from '@/services/courseService'
import { STAGES, allLessons, lessonById } from '@/course/stages'
import { INSTRUMENT_RANGE, MAX_STEPS, arpeggio, fitOctave, handsOnFor, progressionRoots, stepQuestion, strumSpec, type HandsOnStep, type StudentSetup } from '@/course/handsOn'
import type { PerformQuestion } from '@/drills/types'

let n = 0
beforeEach(() => setDbForTests(new GrooveLabDB(`ho-${Date.now()}-${n++}`)))

const PIANO: StudentSetup = { instrument: 'piano' }
const BASS: StudentSetup = { instrument: 'bass' }
const VOICE: StudentSetup = { instrument: 'none', vocalRange: { low: 48, high: 67 } }
const GUITAR: StudentSetup = { instrument: 'guitar' }
const NON_GUITAR = [PIANO, BASS, VOICE]

/** The perform question for a step, or null (guitar widgets, or non-perform kinds). */
function perform(step: HandsOnStep, setup: StudentSetup): PerformQuestion | null {
  const q = stepQuestion(step, setup)
  return q && q.kind === 'perform' ? q : null
}

function stepsByLesson() {
  return allLessons().map((l) => ({ lesson: l, steps: handsOnFor(l) }))
}

describe('handsOnFor / stepQuestion over the curriculum', () => {
  it('every lesson has at most MAX_STEPS steps with unique ids', () => {
    for (const { lesson, steps } of stepsByLesson()) {
      expect(steps.length, lesson.id).toBeLessThanOrEqual(MAX_STEPS)
      const ids = steps.map((s) => s.id)
      expect(new Set(ids).size, lesson.id).toBe(ids.length)
    }
  })

  it('every step builds a question for piano, bass and voice', () => {
    for (const { lesson, steps } of stepsByLesson()) {
      for (const step of steps) {
        for (const setup of NON_GUITAR) {
          expect(stepQuestion(step, setup), `${lesson.id} ${step.id} ${setup.instrument}`).not.toBeNull()
        }
      }
    }
  })

  it('guitar gets null for chord and progression steps only', () => {
    for (const { lesson, steps } of stepsByLesson()) {
      for (const step of steps) {
        const q = stepQuestion(step, GUITAR)
        if (step.kind === 'chord' || step.kind === 'progression') {
          expect(q, `${lesson.id} ${step.id}`).toBeNull()
        } else {
          expect(q, `${lesson.id} ${step.id}`).not.toBeNull()
        }
      }
    }
  })

  it('perform targets sit inside the instrument or vocal range whenever the material fits', () => {
    for (const { lesson, steps } of stepsByLesson()) {
      for (const step of steps) {
        for (const setup of NON_GUITAR) {
          const q = perform(step, setup)
          if (!q) continue
          // Sing steps are always voice (vocal range, default 48–72); instrument steps use the instrument.
          const range = q.source === 'voice' ? (setup.vocalRange ?? { low: 48, high: 72 }) : INSTRUMENT_RANGE[setup.instrument as Exclude<typeof setup.instrument, 'none'>]
          const mids = q.targets.map((t) => t.midi)
          // Only check when some whole-octave shift can place the material in range (see report: L0-2 bass).
          const lo = Math.min(...mids)
          const hi = Math.max(...mids)
          const octaveFits = [-36, -24, -12, 0, 12, 24, 36].some((s) => lo + s >= range.low && hi + s <= range.high)
          if (!octaveFits) continue
          for (const m of mids) {
            expect(m, `${lesson.id} ${step.id} ${setup.instrument}`).toBeGreaterThanOrEqual(range.low)
            expect(m, `${lesson.id} ${step.id} ${setup.instrument}`).toBeLessThanOrEqual(range.high)
          }
        }
      }
    }
  })

  it('sing steps always produce voice questions', () => {
    let seen = 0
    for (const { steps } of stepsByLesson()) {
      for (const step of steps) {
        if (step.kind !== 'sing') continue
        seen++
        for (const setup of [PIANO, BASS, VOICE]) {
          expect(perform(step, setup)?.source).toBe('voice')
        }
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('play steps with no instrument produce voice questions', () => {
    let seen = 0
    for (const { steps } of stepsByLesson()) {
      for (const step of steps) {
        if (step.kind !== 'play') continue
        seen++
        expect(perform(step, VOICE)?.source).toBe('voice')
      }
    }
    expect(seen).toBeGreaterThan(0)
  })

  it('lesson L1-8 has a hand-written 大三度 play step', () => {
    expect(lessonById('L1-8')).toBeDefined()
    const steps = handsOnFor(lessonById('L1-8')!)
    expect(steps.some((s) => s.kind === 'play' && s.title.includes('大三度'))).toBe(true)
  })

  it('lesson L1-4 has an A 自然小调 play step', () => {
    expect(lessonById('L1-4')).toBeDefined()
    const steps = handsOnFor(lessonById('L1-4')!)
    expect(steps.some((s) => s.kind === 'play' && s.title.includes('A 自然小调'))).toBe(true)
  })

  it('stages and lessons are wired', () => {
    expect(STAGES.length).toBeGreaterThan(0)
    expect(allLessons().length).toBeGreaterThan(0)
  })
})

describe('fitOctave / arpeggio / progressionRoots / strumSpec', () => {
  it('fitOctave keeps notes that already fit and shifts whole octaves otherwise', () => {
    expect(fitOctave([60, 64, 67], 48, 84)).toBe(0)
    expect(fitOctave([36, 48, 55], 48, 72)).toBe(12)
    expect(fitOctave([40, 52], 60, 84)).toBe(24)
  })

  it('arpeggio of C major is the chord tones plus the octave root', () => {
    expect(arpeggio(60, 'maj').map((n) => n.midi)).toEqual([60, 64, 67, 72])
  })

  it('progressionRoots takes each chord root in the key', () => {
    expect(progressionRoots(60, 'major', ['I', 'V', 'vi', 'IV'], 4).map((n) => n.midi)).toEqual([60, 67, 69, 65])
  })

  it('strumSpec maps a minor progression to its relative major', () => {
    const step: Extract<HandsOnStep, { kind: 'progression' }> = {
      id: 'p',
      kind: 'progression',
      title: 't',
      tonic: 57,
      mode: 'minor',
      romans: ['i', 'iv', 'v'],
      beatsEach: 4,
    }
    expect(strumSpec(step)).toEqual({ tonic: 60, romans: ['vi', 'ii', 'iii'] })
  })

  it('strumSpec returns null when a roman has no relative major', () => {
    const step: Extract<HandsOnStep, { kind: 'progression' }> = {
      id: 'p',
      kind: 'progression',
      title: 't',
      tonic: 57,
      mode: 'minor',
      romans: ['i', 'I'],
      beatsEach: 4,
    }
    expect(strumSpec(step)).toBeNull()
  })
})

describe('CourseService hands-on status', () => {
  const LESSON = 'L1-8'
  const OTHER = 'L1-4'
  const stepIds = (id: string) => handsOnFor(lessonById(id)!).map((s) => s.id)

  it('skipped then passed ends as passed', async () => {
    const id = stepIds(LESSON)[0]!
    await CourseService.markHandsOn(LESSON, id, 'skipped')
    await CourseService.markHandsOn(LESSON, id, 'passed', 80)
    const p = await CourseService.progress(LESSON)
    expect(p.handsOn?.[id]?.status).toBe('passed')
  })

  it('passed then skipped stays passed', async () => {
    const id = stepIds(LESSON)[0]!
    await CourseService.markHandsOn(LESSON, id, 'passed', 90)
    await CourseService.markHandsOn(LESSON, id, 'skipped', 0)
    const p = await CourseService.progress(LESSON)
    expect(p.handsOn?.[id]?.status).toBe('passed')
    expect(p.handsOn?.[id]?.score).toBe(90)
  })

  it('keeps the best score across attempts', async () => {
    const id = stepIds(LESSON)[0]!
    await CourseService.markHandsOn(LESSON, id, 'failed', 40)
    await CourseService.markHandsOn(LESSON, id, 'failed', 70)
    await CourseService.markHandsOn(LESSON, id, 'failed', 30)
    const p = await CourseService.progress(LESSON)
    expect(p.handsOn?.[id]?.score).toBe(70)
    expect(p.handsOn?.[id]?.status).toBe('failed')
  })

  it('pendingHandsOn lists skipped or unpassed steps and drops them once passed', async () => {
    const id = stepIds(LESSON)[0]!
    const otherId = stepIds(OTHER)[0]!
    expect(await CourseService.pendingHandsOn()).toEqual([])

    await CourseService.markHandsOn(LESSON, id, 'skipped')
    await CourseService.markHandsOn(OTHER, otherId, 'passed', 100)
    const pending = await CourseService.pendingHandsOn()
    expect(pending.map((p) => p.lesson.id)).toEqual([LESSON])
    expect(pending[0]!.steps.map((s) => s.id)).toEqual([id])

    await CourseService.markHandsOn(LESSON, id, 'passed', 85)
    expect(await CourseService.pendingHandsOn()).toEqual([])
  })
})
